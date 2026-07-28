mod find;
pub use find::*;
mod events;
pub use events::*;
mod inspector;
pub use inspector::*;
mod viewport;
pub use viewport::*;

mod net;
pub use net::*;

use crate::xevo_log;
use crate::BrowserState;
use std::sync::atomic::Ordering;
use tauri::webview::{DownloadEvent, PageLoadEvent, WebviewBuilder};
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Position, Size, WebviewUrl,
};
use tauri_plugin_opener::OpenerExt;

/// Reads a single COM `PWSTR` out-parameter into an owned `String`, treating a
/// null pointer as empty. `f` is the COM getter call, e.g. `|p| request.Uri(p)`.
#[cfg(target_os = "windows")]
unsafe fn pwstr_to_string(f: impl FnOnce(*mut windows::core::PWSTR)) -> String {
    let mut p = windows::core::PWSTR::null();
    f(&mut p);
    if p.is_null() {
        String::new()
    } else {
        p.to_string().unwrap_or_default()
    }
}

// ─── Injected Scripts ────────────────────────────────────────────────

const CHROME_FEATURES_SCRIPT: &str = include_str!("scripts/chrome_features.js");
const JSON_VIEWER_SCRIPT: &str = include_str!("scripts/json_viewer.js");

// ─── Helpers ─────────────────────────────────────────────────────────

fn webview_label_for_tab(tab_id: &str) -> String {
    format!("browser-{}", tab_id)
}

/// Resolve a tab/viewport webview by label: Tauri's own registry first, then
/// our persistent handle map (webviews whose strong refs we hold may not appear
/// in `app.webviews()` — Tauri #14843).
///
/// Every tab lookup routes through here, so the registry-then-map fallback that
/// used to be copy-pasted at ~25 call sites lives in exactly one place.
pub fn find_tab_webview(app: &AppHandle, label: &str) -> Option<tauri::Webview> {
    if let Some(wv) = app.get_webview(label) {
        return Some(wv);
    }
    let state = app.state::<BrowserState>();
    let guard = state.webviews.lock().unwrap_or_else(|e| e.into_inner());
    guard.get(label).cloned()
}

/// Hide all browser-* webviews EXCEPT the one with the given label.
/// This is the authoritative way to ensure exactly one webview is visible.
fn hide_all_browser_webviews_except(
    app: &AppHandle,
    state: &crate::BrowserState,
    except_label: &str,
) {
    // Hide via Tauri's built-in registry
    for (label, wv) in app.webviews() {
        if label.starts_with("browser-") && label != except_label {
            let _ = wv.hide();
        }
    }
    // Also hide via our persistent handle map — webviews whose strong refs
    // we hold may not appear in app.webviews() (Tauri #14843).
    if let Ok(webviews) = state.webviews.lock() {
        for (label, wv) in webviews.iter() {
            if label.starts_with("browser-") && label != except_label {
                let _ = wv.hide();
            }
        }
    }
}

/// Fullscreen belongs to exactly one tab at a time.
///
/// Returns `true` if `keep` *is* the fullscreen tab — the caller should leave its
/// bounds alone, since the fullscreen handler owns them. Otherwise leaves
/// fullscreen (clearing the flag and dropping the window out of OS fullscreen)
/// and returns `false`, so the caller proceeds normally.
///
/// Pass `keep: None` to unconditionally exit — used when the fullscreen tab is
/// being closed, which would otherwise strand the flag set forever (its
/// `ContainsFullScreenElementChanged` handler dies with the webview, so nothing
/// would ever clear it and every later show/bounds call would no-op).
fn exit_fullscreen_unless(
    app: &AppHandle,
    state: &crate::BrowserState,
    keep: Option<&str>,
) -> bool {
    let mut fs = state
        .fullscreen_tab
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    match fs.as_deref() {
        None => false,
        Some(current) if Some(current) == keep => true,
        Some(_) => {
            *fs = None;
            drop(fs);
            if let Some(main) = app.get_window("main") {
                let _ = main.set_fullscreen(false);
            }
            false
        }
    }
}

/// Poll until no webview is registered under `label`, in either Tauri's own
/// registry or our persistent handle map. `destroy()` on Windows is async — a
/// window can still be found for a few ms after we call it — so a caller that
/// just destroyed the old handle for this label needs to wait for it to
/// actually clear before treating "still present" as a real conflict.
async fn wait_until_absent(app: &AppHandle, state: &crate::BrowserState, label: &str) {
    for _ in 0..25 {
        let present = app.get_webview(label).is_some()
            || state
                .webviews
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .contains_key(label);
        if !present {
            return;
        }
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }
}

/// Build a child Webview for a tab. Injects per-tab __XEVO_TAB_ID plus
/// all shared init scripts (core, chrome features, JSON viewer).
///
/// Uses `Window::add_child`, NOT `WebviewWindowBuilder::parent()`. On Windows
/// `.parent()` creates an *owner* window (top-level, screen coordinates) which
/// the OS never moves with its owner — that is what forced the old JS
/// onMoved/onResized bounds-following. A child webview lives inside the main
/// window's HWND at window-relative coordinates, so it moves and clips for free.
///
/// Callers MUST be async: a sync `#[tauri::command]` runs on the main thread and
/// creating a webview needs to pump the event loop that thread is blocked on,
/// which deadlocks (the webview is created and hit-tests but never paints).
#[allow(clippy::too_many_arguments)]
fn create_webview_for_tab(
    app: &AppHandle,
    tab_id: &str,
    url: &str,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    show_immediately: bool,
) -> Result<tauri::Webview, String> {
    let width = width.max(1.0);
    let height = height.max(1.0);
    let label = webview_label_for_tab(tab_id);
    let parsed = url.parse::<url::Url>().map_err(|e| e.to_string())?;
    let target_url = parsed.clone();

    let tab_id_nav = tab_id.to_string();
    let app_for_nav = app.clone();
    let tab_id_load = tab_id.to_string();
    let app_for_load = app.clone();
    let app_for_new_window = app.clone();
    let tab_id_download = tab_id.to_string();
    let app_for_download = app.clone();

    // Per-tab init script that sets __XEVO_TAB_ID
    let tab_id_init = format!("window.__XEVO_TAB_ID = \"{}\";", tab_id);

    let state = app.state::<BrowserState>();
    let user_agent = state
        .user_agent
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone();

    let main_window = app.get_window("main").ok_or("main window not found")?;

    // decorations/resizable/inner_size/position are window concepts — a child
    // webview gets its geometry from add_child's position/size arguments below.
    // No .data_directory() — a data directory that differs from the main window's
    // spawns a second WebView2 environment, and with it a duplicate browser + GPU +
    // network process set. Sharing the default keeps every webview in one tree.
    let mut builder = WebviewBuilder::new(
        &label,
        WebviewUrl::External(url::Url::parse("about:blank").expect("about:blank must parse")),
    )
    // Ctrl +/- and Ctrl+mousewheel zoom natively inside the page (WebView2
    // IsZoomControlEnabled). Builder attribute — only affects new webviews.
    .zoom_hotkeys_enabled(true)
    // Matches tauri.conf.json's backgroundColor (#0f0f0f). Without this,
    // WebView2's own default paints the strip newly exposed by a resize
    // before the page repaints it — a flash against the dark chrome.
    // Hardcoded to dark: in light theme this becomes a dark flash instead
    // of a light one — wiring it to the theme store is a separate change.
    .background_color(tauri::webview::Color(15, 15, 15, 255))
    .initialization_script(&tab_id_init)
    .initialization_script(CHROME_FEATURES_SCRIPT)
    .initialization_script(JSON_VIEWER_SCRIPT);

    if let Some(ref ua) = user_agent {
        builder = builder.user_agent(ua);
    }

    let builder = builder
        .on_navigation(move |nav_url| {
            let scheme = nav_url.scheme();
            let allowed = matches!(scheme, "http" | "https" | "" | "tauri");
            if !allowed {
                return false;
            }
            let url_str = nav_url.to_string();
            let _ = app_for_nav.emit(
                "browser://url-changed",
                serde_json::json!({
                    "tabId": tab_id_nav,
                    "url": url_str,
                }),
            );
            true
        })
        .on_page_load(move |_webview, payload| match payload.event() {
            PageLoadEvent::Started => {
                let _ = app_for_load.emit(
                    "browser://loading",
                    serde_json::json!({
                        "tabId": tab_id_load,
                        "loading": true,
                    }),
                );
            }
            PageLoadEvent::Finished => {
                let _ = app_for_load.emit(
                    "browser://loading",
                    serde_json::json!({
                        "tabId": tab_id_load,
                        "loading": false,
                    }),
                );
            }
        })
        .on_new_window(move |url, _features| {
            let _ = app_for_new_window.emit(
                "browser://open-new-tab",
                serde_json::json!({
                    "url": url.to_string()
                }),
            );
            tauri::webview::NewWindowResponse::Deny
        })
        // Downloads go to the OS default destination. Tauri's DownloadEvent
        // exposes no progress callback, so the UI shows started → finished,
        // not a percentage.
        .on_download(move |_webview, event| {
            match event {
                DownloadEvent::Requested { url, destination } => {
                    let _ = app_for_download.emit(
                        "xevo://download-started",
                        serde_json::json!({
                            "tabId": tab_id_download,
                            "url": url.to_string(),
                            "destination": destination.to_string_lossy(),
                        }),
                    );
                }
                DownloadEvent::Finished { url, path, success } => {
                    let _ = app_for_download.emit(
                        "xevo://download-finished",
                        serde_json::json!({
                            "url": url.to_string(),
                            "path": path.as_ref().map(|p| p.to_string_lossy().to_string()),
                            "success": success,
                        }),
                    );
                }
                _ => {}
            }
            true
        });

    // Position/size are relative to the main window's client area, not the
    // screen — this is what makes window moves free.
    let webview = main_window
        .add_child(
            builder,
            Position::Logical(LogicalPosition::new(x, y)),
            Size::Logical(LogicalSize::new(width, height)),
        )
        .map_err(|e| e.to_string())?;

    register_webview_network_capture(&webview, app, tab_id);
    register_webview_native_events(&webview, app, tab_id);

    // Adopt the current app theme immediately, so a page's prefers-color-scheme
    // matches from first paint instead of defaulting to the OS scheme.
    apply_color_scheme(&webview, state.preferred_dark.load(Ordering::SeqCst));

    // Navigate to the real URL now that network handlers are registered
    let _ = webview.navigate(target_url);

    if show_immediately {
        webview.show().map_err(|e| e.to_string())?;
    }
    Ok(webview)
}

// ─── Commands ────────────────────────────────────────────────────────

/// Create a new webview for a tab and show it. Hides the previously active
/// webview. Called on first navigation (when a URL is entered).
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn browser_create_tab(
    app: AppHandle,
    state: tauri::State<'_, BrowserState>,
    tab_id: String,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let label = webview_label_for_tab(&tab_id);

    // Destroy any stale handle in our persistent map for this label.
    // This catches orphaned OS windows from previous race conditions that
    // Tauri's internal registry dropped but the HWND survived (Windows).
    {
        let mut webviews = state.webviews.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(old_wv) = webviews.remove(&label) {
            xevo_log!(
                "[XEVO-LIFECYCLE] browser_create_tab — closing stale handle for label={}",
                label
            );
            let _ = old_wv.close();
        }
    }

    // Close any orphan webview in Tauri's registry with this label.
    if let Some(orphan) = app.get_webview(&label) {
        xevo_log!(
            "[XEVO-LIFECYCLE] browser_create_tab — closing orphan label={}",
            label
        );
        let _ = orphan.close();
    }

    // We just destroyed whatever was under this label above, but destroy() is
    // async on Windows — wait for it to actually clear rather than treating
    // "still present a moment later" as a legitimate pre-existing webview and
    // silently no-op'ing (that used to report success without creating
    // anything, leaving the tab permanently blank).
    wait_until_absent(&app, &state, &label).await;
    {
        let webviews = state.webviews.lock().unwrap_or_else(|e| e.into_inner());
        if app.get_webview(&label).is_some() || webviews.contains_key(&label) {
            xevo_log!("[XEVO-LIFECYCLE] browser_create_tab — label={} did not release after waiting, aborting", label);
            return Err(format!(
                "webview for tab {} did not release in time",
                tab_id
            ));
        }
    }

    xevo_log!(
        "[XEVO-LIFECYCLE] browser_create_tab — creating label={} url={} x={} y={} w={} h={}",
        label,
        url,
        x,
        y,
        width,
        height
    );

    // Hide ALL other browser webviews — this is authoritative.
    // The old approach (hide only active_tab_label) missed webviews hidden
    // by the frontend without updating the backend, causing orphan floating
    // windows that became "stuck".
    hide_all_browser_webviews_except(&app, &state, &label);

    // A child webview is hidden and restored by the OS along with its parent
    // window, so minimize state no longer gates creation.
    let webview = create_webview_for_tab(&app, &tab_id, &url, x, y, width, height, true)?;

    // Store a persistent strong reference to prevent the Webview
    // from being destroyed when this async function returns (Tauri #14843).
    // Without this, the handle drops and the OS window disappears, causing
    // browser_set_bounds to find only ["main"].
    {
        let mut webviews = state.webviews.lock().unwrap_or_else(|e| e.into_inner());
        // Race check: another call may have created this webview while we were
        // creating ours. If so, drop our duplicate to avoid orphaning theirs.
        if webviews.contains_key(&label) {
            xevo_log!("[XEVO-LIFECYCLE] browser_create_tab — RACE: label={} already in map, dropping duplicate", label);
            drop(webview);
            return Ok(());
        }
        webviews.insert(label.clone(), webview.clone());
    }

    // Track as active
    *state
        .active_tab_label
        .lock()
        .unwrap_or_else(|e| e.into_inner()) = Some(webview.label().to_string());

    Ok(())
}

/// Close a tab's webview.
#[tauri::command]
pub async fn browser_close_tab(
    app: AppHandle,
    state: tauri::State<'_, BrowserState>,
    tab_id: String,
) -> Result<(), String> {
    let label = webview_label_for_tab(&tab_id);
    let exists = app.get_webview(&label).is_some();
    xevo_log!(
        "[XEVO-LIFECYCLE] browser_close_tab — label={} tab_id={} exists_before={}",
        label,
        tab_id,
        exists
    );

    // If the tab being closed owns fullscreen, leave fullscreen now. Its
    // ContainsFullScreenElementChanged handler dies with the webview, so nothing
    // else would ever clear the flag — and while set, every later show/bounds
    // call no-ops, i.e. tab switching stops working permanently.
    exit_fullscreen_unless(&app, &state, None);
    // Remove from our persistent map FIRST — this is the authoritative source
    // of strong references. The handle will drop after removal, allowing the
    // OS window to be destroyed naturally (confirming the close on Rust's side).
    state
        .webviews
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .remove(&label);
    if let Some(wv) = app.get_webview(&label) {
        wv.close().map_err(|e| e.to_string())?;
        xevo_log!(
            "[XEVO-LIFECYCLE] browser_close_tab — label={} closed OK, still_exists={}",
            label,
            app.get_webview(&label).is_some()
        );
    } else {
        xevo_log!(
            "[XEVO-LIFECYCLE] browser_close_tab — label={} not found (already closed?)",
            label
        );
    }
    // If this was the active tab, clear the tracker
    let mut active = state
        .active_tab_label
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    if active.as_deref() == Some(&label) {
        *active = None;
    }
    drop(active);

    // Sweep any still-pending network request timing entries for this tab —
    // otherwise cancelled/in-flight requests from a closed tab leak forever.
    if let Some(store) = NETWORK_REQUEST_META.get() {
        if let Ok(mut map) = store.lock() {
            let prefix = format!("{}:", tab_id);
            map.retain(|k, _| !k.starts_with(&prefix));
        }
    }

    Ok(())
}

/// Navigate a specific tab's webview to a new URL.
#[tauri::command]
pub async fn browser_navigate_tab(
    app: AppHandle,
    tab_id: String,
    url: String,
) -> Result<(), String> {
    let label = webview_label_for_tab(&tab_id);
    if let Some(wv) = find_tab_webview(&app, &label) {
        wv.navigate(url.parse().map_err(|e: url::ParseError| e.to_string())?)
            .map_err(|e| {
                xevo_log!("[xevo] browser_navigate_tab failed: {e}");
                e.to_string()
            })?;
    }
    Ok(())
}

// ─── Bounds ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn browser_set_bounds(
    app: AppHandle,
    state: tauri::State<'_, crate::BrowserState>,
    tab_id: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let label = webview_label_for_tab(&tab_id);

    // While *this* tab is fullscreen (video) the child covers the whole window
    // and is owned by the fullscreen handler + native resize path, so ignore
    // JS-driven bounds pushes (from the ResizeObserver) that would shrink it back
    // to the inset content area. A push for any other tab is fine — unlike
    // browser_show_tab, a resize must not kick the user out of fullscreen.
    if state
        .fullscreen_tab
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_deref()
        == Some(label.as_str())
    {
        return Ok(());
    }
    xevo_log!(
        "[XEVO-BOUNDS] browser_set_bounds called — label={} x={} y={} w={} h={}",
        label,
        x,
        y,
        width,
        height
    );
    // Try Tauri's registry first, then fallback to our persistent handle map
    let wv = find_tab_webview(&app, &label);
    if let Some(wv) = wv {
        // One set_bounds call instead of set_position + set_size: each of those is a
        // separate message to the wry event loop, processed on separate iterations,
        // so the webview visibly moved on one frame and resized on the next.
        // set_bounds does both in a single message.
        xevo_log!("[XEVO-BOUNDS] browser_set_bounds — webview found, calling set_bounds");
        let bounds = tauri::Rect {
            position: Position::Logical(LogicalPosition::new(x, y)),
            size: Size::Logical(LogicalSize::new(width.max(1.0), height.max(1.0))),
        };
        if let Err(e) = wv.set_bounds(bounds) {
            xevo_log!("[XEVO-BOUNDS] browser_set_bounds — set_bounds ERROR: {}", e);
            return Err(format!("set_bounds failed: {}", e));
        }
        xevo_log!("[XEVO-BOUNDS] browser_set_bounds — OK");

        // Cache the content-area insets so a native window resize can reposition
        // the active webview directly from Rust (see on_window_event in lib.rs),
        // without waiting on the JS ResizeObserver → rAF → IPC round trip.
        if let Some(main) = app.get_window("main") {
            if let Ok(win_size) = main.inner_size() {
                let scale = main.scale_factor().unwrap_or(1.0);
                let win_w = win_size.width as f64 / scale;
                let win_h = win_size.height as f64 / scale;
                let insets = (x, y, win_w - x - width, win_h - y - height);
                *state
                    .content_insets
                    .lock()
                    .unwrap_or_else(|e| e.into_inner()) = Some(insets);
            }
        }
    } else {
        xevo_log!(
            "[XEVO-BOUNDS] browser_set_bounds — webview NOT FOUND for label: {}",
            label
        );
    }
    Ok(())
}

// ─── Navigation (per-tab) ────────────────────────────────────────────

#[tauri::command]
pub async fn browser_go_back(app: AppHandle, tab_id: String) -> Result<(), String> {
    let label = webview_label_for_tab(&tab_id);
    if let Some(wv) = find_tab_webview(&app, &label) {
        wv.eval("window.history.back()")
            .map_err(|e| format!("browser_go_back eval failed: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn browser_go_forward(app: AppHandle, tab_id: String) -> Result<(), String> {
    let label = webview_label_for_tab(&tab_id);
    if let Some(wv) = find_tab_webview(&app, &label) {
        wv.eval("window.history.forward()")
            .map_err(|e| format!("browser_go_forward eval failed: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn browser_reload(app: AppHandle, tab_id: String) -> Result<(), String> {
    let label = webview_label_for_tab(&tab_id);
    if let Some(wv) = find_tab_webview(&app, &label) {
        wv.eval("window.location.reload()")
            .map_err(|e| format!("browser_reload eval failed: {e}"))?;
    }
    Ok(())
}

/// Cache-bypassing reload (Ctrl+Shift+R).
///
/// Neither wry nor `ICoreWebView2::Reload()` offers an ignore-cache option, and
/// `location.reload(true)` has been a no-op in Chromium for years — so this goes
/// through the DevTools protocol (`CallDevToolsProtocolMethod`) instead.
/// Fire-and-forget: CDP reports completion, but there is nothing to report back.
#[tauri::command]
pub async fn browser_hard_reload(app: AppHandle, tab_id: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let label = webview_label_for_tab(&tab_id);
        let wv = match find_tab_webview(&app, &label) {
            Some(wv) => wv,
            None => return Ok(()),
        };
        wv.with_webview(move |platform| {
            #[cfg(windows)]
            unsafe {
                use webview2_com::CallDevToolsProtocolMethodCompletedHandler;
                use windows_core::HSTRING;
                let core = match platform.controller().CoreWebView2() {
                    Ok(c) => c,
                    Err(e) => {
                        xevo_log!("[xevo] hard reload: CoreWebView2 failed: {e:?}");
                        return;
                    }
                };
                let handler = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(
                    |_result: windows_core::Result<()>,
                     _json: String|
                     -> windows_core::Result<()> { Ok(()) },
                ));
                let _ = core.CallDevToolsProtocolMethod(
                    &HSTRING::from("Page.reload"),
                    &HSTRING::from(r#"{"ignoreCache":true}"#),
                    &handler,
                );
            }
        })
        .map_err(|e| format!("browser_hard_reload failed: {e}"))?;
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, tab_id);
        Err("Hard reload is only supported on Windows".to_string())
    }
}

#[tauri::command]
pub async fn browser_set_zoom(app: AppHandle, tab_id: String, factor: f64) -> Result<(), String> {
    let label = webview_label_for_tab(&tab_id);
    if let Some(wv) = find_tab_webview(&app, &label) {
        wv.set_zoom(factor.clamp(0.25, 5.0))
            .map_err(|e| format!("browser_set_zoom failed: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn browser_stop_loading(app: AppHandle, tab_id: String) -> Result<(), String> {
    let label = webview_label_for_tab(&tab_id);
    if let Some(wv) = find_tab_webview(&app, &label) {
        wv.eval("window.stop()").map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Open a downloaded file, or reveal it in the OS file manager.
#[tauri::command]
pub fn open_download(app: AppHandle, path: String, reveal: bool) -> Result<(), String> {
    let opener = app.opener();
    if reveal {
        opener.reveal_item_in_dir(&path).map_err(|e| e.to_string())
    } else {
        opener
            .open_path(&path, None::<&str>)
            .map_err(|e| e.to_string())
    }
}

// ─── Theme (apply to all webviews) ───────────────────────────────────

/// Set a webview's preferred color scheme natively via WebView2's
/// `ICoreWebView2Profile::PreferredColorScheme`. This is what actually drives
/// the `prefers-color-scheme` media query that sites (Google, YouTube, …) use to
/// pick their theme. The old approach set `document.documentElement.style
/// .colorScheme` + a `<meta color-scheme>` via eval, which only affects UA
/// widget rendering — it never changed `prefers-color-scheme`, so pages stayed
/// dark regardless of the app theme.
pub fn apply_color_scheme(wv: &tauri::Webview, dark: bool) {
    let _ = wv.with_webview(move |platform| {
        #[cfg(windows)]
        unsafe {
            use webview2_com::Microsoft::Web::WebView2::Win32::{
                ICoreWebView2_13, COREWEBVIEW2_PREFERRED_COLOR_SCHEME_DARK,
                COREWEBVIEW2_PREFERRED_COLOR_SCHEME_LIGHT,
            };
            use windows_core::Interface;

            let core = match platform.controller().CoreWebView2() {
                Ok(c) => c,
                Err(e) => {
                    xevo_log!("[xevo] color-scheme: CoreWebView2() failed: {e:?}");
                    return;
                }
            };
            match core.cast::<ICoreWebView2_13>() {
                Ok(c13) => match c13.Profile() {
                    Ok(profile) => {
                        let scheme = if dark {
                            COREWEBVIEW2_PREFERRED_COLOR_SCHEME_DARK
                        } else {
                            COREWEBVIEW2_PREFERRED_COLOR_SCHEME_LIGHT
                        };
                        if let Err(e) = profile.SetPreferredColorScheme(scheme) {
                            xevo_log!("[xevo] SetPreferredColorScheme failed: {e:?}");
                        }
                    }
                    Err(e) => xevo_log!("[xevo] Profile() unavailable: {e:?}"),
                },
                Err(e) => xevo_log!("[xevo] ICoreWebView2_13 unavailable: {e:?}"),
            }
        }
        #[cfg(not(windows))]
        let _ = (platform, dark);
    });
}

#[tauri::command]
pub async fn browser_set_theme(app: AppHandle, theme: String) -> Result<(), String> {
    let dark = theme != "light";
    // Remember it so a tab created later adopts the current theme on creation.
    app.state::<BrowserState>()
        .preferred_dark
        .store(dark, Ordering::SeqCst);
    // Apply to ALL browser webviews (all labels starting with "browser-").
    for (_, wv) in app.webviews() {
        if wv.label().starts_with("browser-") {
            apply_color_scheme(&wv, dark);
        }
    }
    Ok(())
}

// ─── Hide/Show (for overlays) ────────────────────────────────────────

#[tauri::command]
pub async fn browser_hide_tab(
    app: AppHandle,
    state: tauri::State<'_, BrowserState>,
    tab_id: String,
) -> Result<(), String> {
    let label = webview_label_for_tab(&tab_id);
    xevo_log!("[XEVO-LIFECYCLE] browser_hide_tab — label={}", label);
    let wv = find_tab_webview(&app, &label);
    if let Some(wv) = wv {
        wv.hide().map_err(|e| format!("failed to hide tab: {e}"))?;
        xevo_log!(
            "[XEVO-LIFECYCLE] browser_hide_tab — label={} hidden OK",
            label
        );
        // Clear active_tab_label if we just hid the tracked webview.
        // This prevents stale state where active_tab_label points to a
        // hidden webview — which causes orphan floating windows on restore.
        let mut active = state
            .active_tab_label
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        if active.as_deref() == Some(&label) {
            *active = None;
        }
    } else {
        xevo_log!(
            "[XEVO-LIFECYCLE] browser_hide_tab — label={} not found",
            label
        );
    }
    Ok(())
}

#[tauri::command]
pub async fn browser_show_tab(
    app: AppHandle,
    state: tauri::State<'_, crate::BrowserState>,
    tab_id: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let label = webview_label_for_tab(&tab_id);

    // Fullscreen is owned by one tab. Showing *that* tab means leaving its
    // bounds alone (the fullscreen handler owns them). Showing a *different*
    // tab means leaving fullscreen first — same as Chrome/Edge, where switching
    // tabs exits fullscreen — otherwise this returned early and the new tab
    // never appeared at all.
    if exit_fullscreen_unless(&app, &state, Some(&label)) {
        return Ok(());
    }

    xevo_log!("[XEVO-BOUNDS] browser_show_tab called — label={}", label);
    // Try Tauri's registry first, then fallback to our persistent handle map
    let wv = find_tab_webview(&app, &label);
    if let Some(wv) = wv {
        wv.set_position(Position::Logical(LogicalPosition::new(x, y)))
            .map_err(|e| format!("failed to set position: {e}"))?;
        // Recomposite nudge (see apply_active_child_bounds in lib.rs for the
        // same fix on the resize path): if this tab's bounds didn't change
        // while it was hidden — e.g. an absolutely-positioned overlay like
        // Settings that doesn't reflow the content area — this set_size is
        // byte-identical to the one already applied, and WebView2 suppresses
        // a same-size set_bounds. That's invisible on its own (a hidden
        // webview repaints fine from its existing surface once shown), but a
        // profile-wide change made while hidden — e.g. browser_set_theme's
        // SetPreferredColorScheme — leaves the surface stale, and the
        // suppressed set_size then means show() never repaints it. Forcing
        // height-1 then the real height is a one-line "always changed" bounds
        // update. Unconditional and flicker-free here, unlike the maximize
        // case: the webview is still hidden at this point (show() is next),
        // so nothing is ever composited at height-1.
        let _ = wv.set_size(Size::Logical(LogicalSize::new(
            width.max(1.0),
            (height - 1.0).max(1.0),
        )));
        wv.set_size(Size::Logical(LogicalSize::new(
            width.max(1.0),
            height.max(1.0),
        )))
        .map_err(|e| format!("failed to set size: {e}"))?;
        // Hide every other browser webview — authoritative, same as
        // browser_create_tab. Without this, `show` trusted the frontend to have
        // hidden the outgoing tab, so any missed or out-of-order hide left the
        // old page rendered over the new one ("tab switches, webview doesn't").
        // Hiding before show avoids a frame where both are visible.
        hide_all_browser_webviews_except(&app, &state, &label);
        wv.show().map_err(|e| format!("failed to show tab: {e}"))?;
        // browser_hide_tab clears active_tab_label when it hides the tracked
        // webview; the native resize path reads it to find the child to resize.
        *state
            .active_tab_label
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = Some(label.clone());
        xevo_log!(
            "[XEVO-BOUNDS] browser_show_tab — restored active_tab_label to {}",
            label
        );
    } else {
        xevo_log!(
            "[XEVO-BOUNDS] browser_show_tab — webview NOT FOUND for label: {}",
            label
        );
    }
    Ok(())
}

// ─── User Agent ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn browser_set_user_agent(app: AppHandle, user_agent: String) -> Result<(), String> {
    let state = app.state::<BrowserState>();
    let ua = if user_agent.is_empty() {
        None
    } else {
        Some(user_agent)
    };
    *state.user_agent.lock().unwrap_or_else(|e| e.into_inner()) = ua;
    Ok(())
}

// ─── Memory Target ────────────────────────────────────────────────

/// Set the memory usage target level for a specific tab's webview.
/// Best-effort — silently no-ops on non-Windows or older WebView2 runtimes,
/// but logs which step failed so it's debuggable.
pub fn apply_memory_target(wv: &tauri::Webview, low: bool) {
    let _ = wv.with_webview(move |platform| {
        #[cfg(windows)]
        unsafe {
            use webview2_com::Microsoft::Web::WebView2::Win32::{
                ICoreWebView2_19, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW,
                COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
            };
            use windows_core::Interface;

            let level = if low {
                COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW
            } else {
                COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL
            };

            match platform.controller().CoreWebView2() {
                Ok(core) => match core.cast::<ICoreWebView2_19>() {
                    Ok(core19) => {
                        if let Err(e) = core19.SetMemoryUsageTargetLevel(level) {
                            xevo_log!("[xevo] SetMemoryUsageTargetLevel failed: {e:?}");
                        }
                    }
                    Err(e) => xevo_log!("[xevo] ICoreWebView2_19 unavailable: {e:?}"),
                },
                Err(e) => xevo_log!("[xevo] CoreWebView2() failed: {e:?}"),
            }
        }
    });
}

/// `low: true` hints WebView2 to reduce memory usage for background tabs.
/// `low: false` resets to normal memory target for the active tab.
#[tauri::command]
pub async fn browser_set_memory_target(
    app: AppHandle,
    tab_id: String,
    low: bool,
) -> Result<(), String> {
    let label = webview_label_for_tab(&tab_id);
    xevo_log!(
        "[XEVO-LIFECYCLE] browser_set_memory_target — label={} low={}",
        label,
        low
    );
    let wv = find_tab_webview(&app, &label).ok_or_else(|| {
        xevo_log!(
            "[XEVO-LIFECYCLE] browser_set_memory_target — label={} NOT FOUND",
            label
        );
        format!("no webview for tab {}", tab_id)
    })?;
    apply_memory_target(&wv, low);
    Ok(())
}

// ─── Tab State Save/Restore ────────────────────────────────────────

/// Ask a tab's webview to capture its state (scroll + forms).
/// The webview's init script will call browser_tab_state_saved back with the result.
#[tauri::command]
pub async fn browser_save_tab_state(app: AppHandle, tab_id: String) -> Result<(), String> {
    let label = webview_label_for_tab(&tab_id);
    let wv =
        find_tab_webview(&app, &label).ok_or_else(|| format!("no webview for tab {}", tab_id))?;

    let capture_script = include_str!("scripts/capture_tab_state.js");

    wv.eval(capture_script)
        .map_err(|e| format!("browser_save_tab_state eval failed: {}", e))?;

    Ok(())
}

/// Called by the webview's JS after capturing state.
/// Emits the state to the frontend for storage.
#[tauri::command]
pub fn browser_tab_state_saved(
    app: AppHandle,
    tab_id: String,
    state_json: String,
) -> Result<(), String> {
    app.emit(
        "browser://tab-state-saved",
        serde_json::json!({
            "tabId": tab_id,
            "stateJson": state_json,
        }),
    )
    .map_err(|e| e.to_string())
}

/// Restore a tab's scroll position and form input values from a JSON string.
#[tauri::command]
pub async fn browser_restore_tab_state(
    app: AppHandle,
    tab_id: String,
    state_json: String,
) -> Result<(), String> {
    let label = webview_label_for_tab(&tab_id);
    let wv =
        find_tab_webview(&app, &label).ok_or_else(|| format!("no webview for tab {}", tab_id))?;

    // ponytail: state_json is already valid JSON — embed directly as JS expression, no string escaping
    let restore_script = format!(
        r#"(function() {{
            try {{
                var state = {state_json};
                if (state.scrollX || state.scrollY) {{
                    window.scrollTo(state.scrollX || 0, state.scrollY || 0);
                }}
                if (state.formState && state.formState.length > 0) {{
                    var inputs = document.querySelectorAll('input, textarea, select');
                    for (var j = 0; j < state.formState.length; j++) {{
                        var s = state.formState[j];
                        var el = inputs[s.i];
                        if (!el) continue;
                        if (s.type === 'checkbox' || s.type === 'radio') {{
                            el.checked = s.checked;
                        }} else if (s.tag === 'SELECT') {{
                            el.selectedIndex = s.selectedIndex;
                        }} else if (el.isContentEditable && s.html !== undefined) {{
                            el.innerHTML = s.html;
                        }} else {{
                            el.value = s.value;
                        }}
                        el.dispatchEvent(new Event('input', {{ bubbles: true }}));
                        el.dispatchEvent(new Event('change', {{ bubbles: true }}));
                    }}
                }}
            }} catch(e) {{
                console.warn('[xevo] restore state failed:', e);
            }}
        }})()"#
    );

    wv.eval(&restore_script)
        .map_err(|e| format!("browser_restore_tab_state eval failed: {}", e))?;

    Ok(())
}
