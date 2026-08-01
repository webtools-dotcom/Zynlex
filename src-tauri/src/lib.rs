mod commands;

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};

/// Opt-in trace logging: silent unless `ZYNLEX_TRACE=1` is set, even in debug
/// builds — `browser_set_bounds` alone fires on every resize/drag frame, so
/// always-on-in-debug drowned a first `pnpm tauri dev` in noise. Release
/// builds also set `windows_subsystem = "windows"` (see main.rs), so there's
/// no console to read stderr from there regardless.
#[macro_export]
macro_rules! zynlex_log {
    ($($arg:tt)*) => {
        if $crate::trace_enabled() { eprintln!($($arg)*); }
    };
}

pub fn trace_enabled() -> bool {
    static ENABLED: OnceLock<bool> = OnceLock::new();
    *ENABLED.get_or_init(|| std::env::var("ZYNLEX_TRACE").as_deref() == Ok("1"))
}

/// Tracks which browser webview is currently visible.
/// Each tab gets a child Webview (via `Window::add_child`) inside the main
/// window, labelled `browser-{tab_id}`.
pub struct BrowserState {
    /// Label of the currently visible webview (e.g. "browser-tab-123").
    pub active_tab_label: Mutex<Option<String>>,
    /// Custom user agent override (None = default browser UA).
    pub user_agent: Mutex<Option<String>>,
    /// Persistent strong references to ALL browser webview handles.
    /// Prevents the webview from being destroyed when the Rust async
    /// function's local variable goes out of scope (Tauri #14843).
    /// Key = label (e.g. "browser-tab-123"), value = cloneable handle.
    pub webviews: Mutex<HashMap<String, tauri::Webview>>,
    /// Content-area insets in logical px — (left, top, right, bottom) — learned
    /// from the last `browser_set_bounds` call. Lets a window resize reposition
    /// the active child webview entirely in Rust, inside the native resize
    /// event, instead of waiting on the JS → rAF → IPC → Tokio round trip.
    pub content_insets: Mutex<Option<(f64, f64, f64, f64)>>,
    /// True while a settle-timer resync is already scheduled. Coalesces the
    /// burst of `Resized` events a drag/maximize emits down to one delayed
    /// re-apply, so we don't spawn a timer per frame.
    pub resync_pending: AtomicBool,
    /// Label of the tab that currently has an element in HTML fullscreen (video
    /// fullscreen), or `None`. Gates bounds application so the fullscreen child
    /// covers the whole window instead of the inset content area, and so the JS
    /// bounds-sync can't shrink it back.
    ///
    /// Scoped to a tab, not a global bool: the `ContainsFullScreenElementChanged`
    /// handler that sets it is per-webview, so a global flag stayed set when the
    /// user switched away from (or closed) the fullscreen tab — which made
    /// `browser_show_tab` early-return and silently stop switching tabs.
    pub fullscreen_tab: Mutex<Option<String>>,
    /// Last preferred color scheme pushed to webviews (true = dark). Stored so a
    /// newly-created tab can adopt the current theme immediately, before any
    /// theme toggle. Default dark = the app's default theme.
    pub preferred_dark: AtomicBool,
}

/// Re-apply the active child webview's bounds from the current window size and
/// cached content insets. Shared by the synchronous resize handler and the
/// settle-timer resync.
///
/// `nudge` forces a WebView2 recomposite: on an *animated* maximize, the
/// synchronous handler applies bounds computed from a mid-animation size, and a
/// later same-size `set_bounds` is suppressed by the compositor — leaving the
/// child visually stuck at the wrong size even though its controller bounds are
/// correct. Setting height-1 then the real height once (settle timer only, never
/// per frame) forces the surface to re-render.
#[cfg(target_os = "windows")]
pub(crate) fn apply_active_child_bounds(
    app: &tauri::AppHandle,
    win_w: f64,
    win_h: f64,
    nudge: bool,
) {
    use tauri::Manager;
    let state = app.state::<BrowserState>();
    let fullscreen = state
        .fullscreen_tab
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .is_some();

    // Fullscreen (video): cover the entire window with zero insets. `win_w`/
    // `win_h` are always the real, authoritative window client size at the
    // moment of the call — never an independently-computed monitor size. A
    // borderless window's (decorations:false) client rect IS the fullscreen
    // rect once `set_fullscreen` completes, so trusting the window itself is
    // the only value that can't drift from wherever the OS actually put the
    // window (origin, work area vs. full monitor, DPI) — the same principle
    // this file already relies on for every ordinary resize.
    let (x, y, w, h) = if fullscreen {
        (0.0, 0.0, win_w.max(1.0), win_h.max(1.0))
    } else {
        let Some((left, top, right, bottom)) = *state
            .content_insets
            .lock()
            .unwrap_or_else(|e| e.into_inner())
        else {
            return;
        };
        (
            left,
            top,
            (win_w - left - right).max(1.0),
            (win_h - top - bottom).max(1.0),
        )
    };

    let label = state
        .active_tab_label
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone();
    let Some(label) = label else { return };
    let Some(wv) = commands::browser::find_tab_webview(app, &label) else {
        return;
    };

    // The recomposite nudge is for the animated-maximize freeze only. Skip it
    // while fullscreen — a height-1→height flash mid fullscreen transition is
    // exactly the "webview freezes for ~0.5s" jitter.
    if nudge && !fullscreen {
        let _ = wv.set_size(tauri::Size::Logical(tauri::LogicalSize::new(
            w,
            (h - 1.0).max(1.0),
        )));
    }
    let bounds = tauri::Rect {
        position: tauri::Position::Logical(tauri::LogicalPosition::new(x, y)),
        size: tauri::Size::Logical(tauri::LogicalSize::new(w, h)),
    };
    let _ = wv.set_bounds(bounds);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_opener::Builder::new()
                .open_js_links_on_click(false)
                .build(),
        )
        .setup(|_app| {
            // The minimize/restore/orphan-recovery apparatus that used to live
            // here is gone. It existed because each tab was a top-level *owner*
            // window (WebviewWindowBuilder::parent()), which the OS leaves
            // floating on screen when its owner minimizes — so we had to detect
            // minimize ourselves and hide/show/re-find every webview by hand.
            //
            // Tabs are now child webviews inside the main window's HWND
            // (Window::add_child), which the OS hides, restores, moves and clips
            // with the parent for free. Nothing left to do at setup.
            //
            // The WebView2 pre-warm webview is gone too: it only existed to boot
            // the browser process early, and the main window's own webview
            // already does that.

            // ZYNLEX is Windows-only. Every dev feature — network capture,
            // header injection, cookies, tab titles/favicons, in-page shortcuts,
            // zoom, hard reload, viewport emulation, memory targeting — is
            // implemented against WebView2 COM behind #[cfg(windows)], with no
            // WebKit fallbacks. A non-Windows build compiles and silently loses
            // all of it, so refuse to start rather than pretend to work.
            #[cfg(not(target_os = "windows"))]
            {
                let _ = _app;
                eprintln!(
                    "ZYNLEX is Windows-only: every developer feature is built on \
                     WebView2 COM APIs with no macOS/Linux equivalent implemented yet. \
                     Refusing to start rather than launch a browser with none of them."
                );
                std::process::exit(1);
            }

            #[cfg(target_os = "windows")]
            {
                // Reposition the active child webview directly from Rust, inside
                // the native resize event, instead of going through the JS
                // ResizeObserver → rAF → invoke() → Tokio round trip (which put
                // the page 3-5 frames behind the window during a drag-resize or
                // maximize). Safe to call set_bounds re-entrantly here: Tauri's
                // event loop drops its window-registry borrow before invoking
                // window-event listeners (verified against tauri-runtime-wry
                // 2.11.2's WindowEvent match arm).
                use tauri::Manager;
                if let Some(main) = _app.get_window("main") {
                    let app_handle = _app.handle().clone();
                    main.on_window_event(move |event| {
                        if let tauri::WindowEvent::Resized(physical_size) = event {
                            // Synchronous re-apply from THIS event's size — keeps
                            // the child tracking the window smoothly during a drag.
                            let Some(win) = app_handle.get_window("main") else {
                                return;
                            };
                            let scale = win.scale_factor().unwrap_or(1.0);
                            let win_w = physical_size.width as f64 / scale;
                            let win_h = physical_size.height as f64 / scale;
                            apply_active_child_bounds(&app_handle, win_w, win_h, false);

                            // Settle-timer resync: the size above can be a
                            // mid-animation value on an animated maximize, leaving
                            // the child stuck. Re-read the settled size ~320ms later
                            // (outlasts the Windows maximize animation) and re-apply,
                            // forcing a recomposite only when actually maximized.
                            // Coalesced so a drag burst spawns at most one timer.
                            let state = app_handle.state::<BrowserState>();
                            if !state.resync_pending.swap(true, Ordering::SeqCst) {
                                let app2 = app_handle.clone();
                                std::thread::spawn(move || {
                                    std::thread::sleep(std::time::Duration::from_millis(320));
                                    let app3 = app2.clone();
                                    let _ = app2.run_on_main_thread(move || {
                                        let st = app3.state::<BrowserState>();
                                        st.resync_pending.store(false, Ordering::SeqCst);
                                        // Fullscreen bounds are owned by the sync
                                        // resize handler (monitor-sized); a settle
                                        // re-apply here just adds a mid-transition
                                        // jump.
                                        if st
                                            .fullscreen_tab
                                            .lock()
                                            .unwrap_or_else(|e| e.into_inner())
                                            .is_some()
                                        {
                                            return;
                                        }
                                        let Some(win) = app3.get_window("main") else {
                                            return;
                                        };
                                        let Ok(sz) = win.inner_size() else { return };
                                        let scale = win.scale_factor().unwrap_or(1.0);
                                        let maximized = win.is_maximized().unwrap_or(false);
                                        apply_active_child_bounds(
                                            &app3,
                                            sz.width as f64 / scale,
                                            sz.height as f64 / scale,
                                            maximized,
                                        );
                                    });
                                });
                            }
                        }
                    });
                }
                Ok(())
            }
        })
        .manage(BrowserState {
            active_tab_label: Mutex::new(None),
            user_agent: Mutex::new(None),
            webviews: Mutex::new(HashMap::new()),
            content_insets: Mutex::new(None),
            resync_pending: AtomicBool::new(false),
            fullscreen_tab: Mutex::new(None),
            preferred_dark: AtomicBool::new(true),
        })
        .invoke_handler(tauri::generate_handler![
            commands::browser::browser_create_tab,
            commands::browser::browser_close_tab,
            commands::browser::browser_navigate_tab,
            commands::browser::browser_set_bounds,
            commands::browser::browser_go_back,
            commands::browser::browser_go_forward,
            commands::browser::browser_reload,
            commands::browser::browser_stop_loading,
            commands::browser::browser_set_zoom,
            commands::browser::browser_hard_reload,
            commands::browser::browser_bookmark_request,
            commands::browser::open_download,
            commands::browser::browser_find,
            commands::browser::browser_find_next,
            commands::browser::browser_stop_find,
            commands::browser::browser_find_callback,
            commands::browser::browser_set_theme,
            commands::browser::browser_set_network_capture,
            commands::browser::browser_hide_tab,
            commands::browser::browser_show_tab,
            commands::browser::browser_set_user_agent,
            commands::browser::browser_set_memory_target,
            commands::browser::browser_eval_inspector,
            commands::browser::inspector_mutate,
            commands::browser::create_viewport,
            commands::browser::destroy_viewport,
            commands::browser::navigate_viewport,
            commands::browser::probe_viewport,
            commands::browser::resize_viewport,
            commands::browser::show_viewport,
            commands::browser::browser_save_tab_state,
            commands::browser::browser_tab_state_saved,
            commands::browser::browser_restore_tab_state,
            commands::browser::browser_set_header_rules,
            commands::http::api_fetch,
            commands::ports::scan_ports,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
