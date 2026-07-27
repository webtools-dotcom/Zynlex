use super::{eval_json, find_tab_webview};
use crate::xevo_log;
use tauri::webview::{PageLoadEvent, WebviewBuilder};
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Position, Size, WebviewUrl,
};

// ─── Viewport (device emulation) Mode ─────────────────────────────

/// One device's emulated characteristics.
///
/// `width`/`height` are the **measured frame rect**, not the preset — the
/// frontend clamps the card to the panel with CSS and sends the rect it actually
/// measured, so the CDP layout viewport and the webview bounds are the same
/// number by construction and cannot drift apart.
#[derive(Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceSpec {
    pub width: u32,
    pub height: u32,
    pub device_scale_factor: f64,
    pub mobile: bool,
    pub touch: bool,
    pub user_agent: Option<String>,
}

/// Apply device emulation to a viewport webview.
///
/// Deliberately does NOT scale anything. Earlier revisions carried a display
/// scale so a whole device could be shown shrunk, which meant three values had
/// to agree — webview bounds, WebView2 zoom factor, and the CDP layout-viewport
/// override — set by separate async calls that raced. Whichever landed last won,
/// and the two visible failures were a frame overflowing its card by exactly
/// `1/scale` (zoom lost) and a page laid out wider than the surface showing it
/// (override applied, zoom lost). The frame is now 1:1 and clamped by CSS, so
/// there is no scale factor left to disagree about.
///
/// What stays here is only what geometry cannot express: DPR, the mobile flag
/// (which is what makes a page with no viewport meta lay out at Chromium's 980px
/// default and scale down, exactly as a real phone does) and touch.
fn apply_viewport_emulation(webview: &tauri::Webview, spec: &DeviceSpec) {
    #[cfg(windows)]
    {
        let spec = spec.clone();
        let _ = webview.with_webview(move |platform| unsafe {
            use webview2_com::CallDevToolsProtocolMethodCompletedHandler;
            use windows_core::HSTRING;
            let core = match platform.controller().CoreWebView2() {
                Ok(c) => c,
                Err(e) => {
                    xevo_log!("[xevo] viewport emulation: CoreWebView2 unavailable: {e:?}");
                    return;
                }
            };
            let call = |method: &str, params: String| {
                let handler = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(
                    |_r: windows_core::Result<()>, _json: String| -> windows_core::Result<()> {
                        Ok(())
                    },
                ));
                let _ = core.CallDevToolsProtocolMethod(
                    &HSTRING::from(method),
                    &HSTRING::from(params),
                    &handler,
                );
            };
            call(
                "Emulation.setDeviceMetricsOverride",
                serde_json::json!({
                    "width": spec.width,
                    "height": spec.height,
                    "deviceScaleFactor": spec.device_scale_factor,
                    "mobile": spec.mobile,
                })
                .to_string(),
            );
            call(
                "Emulation.setTouchEmulationEnabled",
                serde_json::json!({
                    "enabled": spec.touch,
                    "maxTouchPoints": if spec.touch { 5 } else { 0 },
                })
                .to_string(),
            );
            // Pin the page to 1:1. With `mobile: true` Chromium shrink-to-fits
            // when anything overflows the viewport (an ad banner is enough),
            // which showed up as a page scale of exactly 2/3 in both axes: the
            // layout viewport was a correct 412 but `innerWidth` read 618 and
            // the page rendered zoomed out. A real phone with
            // `initial-scale=1`, and Chrome's device toolbar at 100%, both stay
            // at scale 1 and let the overflow scroll.
            call(
                "Emulation.setPageScaleFactor",
                serde_json::json!({ "pageScaleFactor": 1 }).to_string(),
            );
            // User-Agent Client Hints. The build-time UA sets the header and
            // `navigator.userAgent`, but NOT `Sec-CH-UA*` — so a site reading
            // client hints still saw the real Edge-on-Windows and warned about
            // the mismatch. Chromium prefers hints over the UA string, so this
            // has to be overridden too or modern sites still serve desktop.
            if let Some(ua) = &spec.user_agent {
                let platform = if ua.contains("iPhone") || ua.contains("iPad") {
                    "iOS"
                } else if ua.contains("Android") {
                    "Android"
                } else {
                    "Windows"
                };
                call(
                    "Emulation.setUserAgentOverride",
                    serde_json::json!({
                        "userAgent": ua,
                        "platform": platform,
                        "userAgentMetadata": {
                            "platform": platform,
                            "platformVersion": "",
                            "architecture": "",
                            "model": "",
                            "mobile": spec.mobile,
                            "brands": [
                                { "brand": "Chromium", "version": "125" },
                                { "brand": "Google Chrome", "version": "125" },
                                { "brand": "Not.A/Brand", "version": "24" },
                            ],
                        },
                    })
                    .to_string(),
                );
            }
        });
    }
}

/// Create the viewport webview, built the same way a tab is: blank first,
/// configured, then navigated.
///
/// The order matters and was the source of two shipped bugs. The user agent is a
/// *build-time* builder attribute (same as `create_browser_webview`), so it has
/// to be set here or server-side mobile detection never sees it. And emulation
/// is re-applied on every `PageLoadEvent::Finished`, because a navigation commit
/// can drop overrides — that's why the frame used to render full-size and
/// overflow its card on open and on every navigation.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn create_viewport(
    app: AppHandle,
    label: String,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    spec: DeviceSpec,
) -> Result<(), String> {
    let parent = app.get_window("main").ok_or("main window not found")?;
    let target_url = url::Url::parse(&url).map_err(|e| e.to_string())?;

    if find_tab_webview(&app, &label).is_some() {
        return Err(format!("viewport {label} already exists"));
    }

    let mut builder = WebviewBuilder::new(
        &label,
        WebviewUrl::External(url::Url::parse("about:blank").expect("about:blank must parse")),
    )
    .background_color(tauri::webview::Color(15, 15, 15, 255));

    if let Some(ref ua) = spec.user_agent {
        builder = builder.user_agent(ua);
    }

    let spec_for_load = spec.clone();
    let app_for_load = app.clone();
    let builder = builder.on_page_load(move |webview, payload| {
        if matches!(payload.event(), PageLoadEvent::Finished) {
            apply_viewport_emulation(&webview, &spec_for_load);
            // Tells the frontend when to probe. Rust→frontend, unlike the
            // page→Rust IPC that remote pages reject.
            let _ = app_for_load.emit("viewport://loaded", serde_json::json!({}));
        }
    });

    let webview = parent
        .add_child(
            builder,
            Position::Logical(LogicalPosition::new(x, y)),
            Size::Logical(LogicalSize::new(width.max(1.0), height.max(1.0))),
        )
        .map_err(|e| e.to_string())?;

    // Emulate before the real navigation so the first document request already
    // carries the device metrics, then navigate.
    apply_viewport_emulation(&webview, &spec);
    let _ = webview.navigate(target_url);

    Ok(())
}

/// Navigate the existing viewport webview. Used instead of destroy+recreate on
/// URL change: recreating dropped the emulation and produced a full-size frame
/// until the next device switch.
#[tauri::command]
pub async fn navigate_viewport(app: AppHandle, label: String, url: String) -> Result<(), String> {
    if let Some(webview) = find_tab_webview(&app, &label) {
        let parsed = url::Url::parse(&url).map_err(|e| e.to_string())?;
        webview.navigate(parsed).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Ask the viewport page what it actually thinks it is, so the UI can show it
/// instead of everyone inferring emulation state from screenshots.
///
/// Uses `eval_json` (Rust→page via `ExecuteScript`) rather than injected JS that
/// calls back into Tauri — the app declares no `remote` capability scope, so
/// page-originated IPC is silently dropped for `https://` content.
#[tauri::command]
pub async fn probe_viewport(app: AppHandle, label: String) -> Result<serde_json::Value, String> {
    #[cfg(target_os = "windows")]
    {
        let wv = find_tab_webview(&app, &label).ok_or("viewport not found")?;
        // `screen.*` is also overwritten by setDeviceMetricsOverride, so it
        // distinguishes "the override never applied" from "it applied and
        // something else resized the viewport afterwards" — the two have
        // completely different fixes.
        eval_json(&wv, include_str!("scripts/viewport_probe.js").to_string()).await
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, label);
        Err("Viewport probe is only supported on Windows".to_string())
    }
}

/// Destroy a viewport webview
#[tauri::command]
pub async fn destroy_viewport(app: AppHandle, label: String) -> Result<(), String> {
    if let Some(webview) = find_tab_webview(&app, &label) {
        webview.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Reposition/resize the viewport webview **and re-assert its emulation**, in
/// that order, in one command.
///
/// These used to be two separate async invokes and nothing ordered them. A
/// WebView2 controller resize resets the emulated viewport to the widget's
/// natural size — while keeping `deviceScaleFactor` — so whenever the bounds
/// change landed last, the page reported the raw widget size (e.g. 422×726 for
/// a 412×707 frame) with DPR still correctly 3.5. Re-asserting the override
/// after every bounds change, in the same command, makes that unorderable.
#[tauri::command]
pub async fn resize_viewport(
    app: AppHandle,
    label: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    spec: DeviceSpec,
) -> Result<(), String> {
    if let Some(webview) = find_tab_webview(&app, &label) {
        // One set_bounds call, same reason as create_viewport: set_position +
        // set_size are two separate wry event-loop messages, so the viewport
        // visibly moved on one frame and resized on the next.
        let bounds = tauri::Rect {
            position: Position::Logical(LogicalPosition::new(x, y)),
            size: Size::Logical(LogicalSize::new(width.max(1.0), height.max(1.0))),
        };
        webview.set_bounds(bounds).map_err(|e| e.to_string())?;
        apply_viewport_emulation(&webview, &spec);
    }
    Ok(())
}

/// Show a viewport webview
#[tauri::command]
pub async fn show_viewport(app: AppHandle, label: String) -> Result<(), String> {
    if let Some(webview) = find_tab_webview(&app, &label) {
        webview.show().map_err(|e| e.to_string())?;
    }
    Ok(())
}
