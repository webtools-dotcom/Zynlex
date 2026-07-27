use super::find_tab_webview;
use crate::BrowserState;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

/// Result of a screenshot capture: PNG bytes + saved file path.
#[derive(serde::Serialize)]
pub struct ScreenshotResult {
    pub bytes: Vec<u8>,
    pub path: String,
}

/// Captures the active browser tab's page content as a PNG screenshot
/// using the DevTools Protocol via the WebView2 COM API.
#[tauri::command]
pub async fn browser_screenshot(
    app: AppHandle,
    #[allow(unused_variables)] window: tauri::WebviewWindow,
) -> Result<ScreenshotResult, String> {
    #[cfg(target_os = "windows")]
    {
        let active_label = app
            .state::<BrowserState>()
            .active_tab_label
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone();

        let png_bytes = if let Some(ref label) = active_label {
            if let Some(browser_wv) = find_tab_webview(&app, label) {
                capture_browser_devtools(&browser_wv).await?
            } else {
                return Err("No browser webview found".to_string());
            }
        } else {
            return Err("No active tab".to_string());
        };

        // ── Save to app screenshots directory ────────────────────────
        let screenshots_dir = app
            .path()
            .app_data_dir()
            .map_err(|e| e.to_string())?
            .join("screenshots");
        std::fs::create_dir_all(&screenshots_dir)
            .map_err(|e| format!("Failed to create screenshots dir: {e}"))?;

        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        let filename = format!("Xevo-{timestamp}.png");
        let filepath = screenshots_dir.join(&filename);

        std::fs::write(&filepath, &png_bytes)
            .map_err(|e| format!("Failed to save screenshot: {e}"))?;

        // ── Inject toast into active browser webview ─────────────────
        let toast_js = include_str!("scripts/screenshot_toast.js");

        if let Some(label) = app
            .state::<BrowserState>()
            .active_tab_label
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
        {
            if let Some(wv) = find_tab_webview(&app, &label) {
                let _ = wv.eval(toast_js);
            }
        }

        let path_str = filepath.to_string_lossy().to_string();
        Ok(ScreenshotResult {
            bytes: png_bytes,
            path: path_str,
        })
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, window);
        Err("Screenshots are only supported on Windows".to_string())
    }
}

/// Capture the active browser webview content via Chrome DevTools Protocol.
/// Uses WebView2's `CallDevToolsProtocolMethod` to invoke `Page.captureScreenshot`
/// which returns a base64-encoded PNG.
#[cfg(target_os = "windows")]
async fn capture_browser_devtools(wv: &tauri::Webview) -> Result<Vec<u8>, String> {
    use base64::Engine;
    use std::sync::Arc;
    use tokio::sync::oneshot;
    use webview2_com::CallDevToolsProtocolMethodCompletedHandler;
    use windows_core::HSTRING;

    let (inner_tx, rx) = oneshot::channel::<Result<Vec<u8>, String>>();
    let tx = Arc::new(Mutex::new(Some(inner_tx)));
    let tx_outer = tx.clone();

    wv.with_webview(move |platform| {
        #[cfg(windows)]
        unsafe {
            let controller = platform.controller();
            let core_webview = match controller.CoreWebView2() {
                Ok(wv) => wv,
                Err(e) => {
                    if let Some(s) = tx_outer.lock().unwrap_or_else(|e| e.into_inner()).take() {
                        let _ = s.send(Err(format!("CoreWebView2 failed: {:?}", e)));
                    }
                    return;
                }
            };

            let tx_inner = tx_outer.clone();
            let handler = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(
                move |result: windows_core::Result<()>, json: String| -> windows_core::Result<()> {
                    let sender = tx_inner.lock().unwrap_or_else(|e| e.into_inner()).take();
                    if let Some(s) = sender {
                        if let Err(e) = result {
                            let _ = s.send(Err(format!("DevTools failed: {:?}", e)));
                        } else {
                            match serde_json::from_str::<serde_json::Value>(&json) {
                                Ok(v) => {
                                    if let Some(data) = v.get("data").and_then(|d| d.as_str()) {
                                        match base64::engine::general_purpose::STANDARD.decode(data)
                                        {
                                            Ok(bytes) => {
                                                let _ = s.send(Ok(bytes));
                                            }
                                            Err(e) => {
                                                let _ = s.send(Err(format!(
                                                    "base64 decode failed: {e}"
                                                )));
                                            }
                                        }
                                    } else {
                                        let _ = s.send(Err(
                                            "No 'data' field in DevTools response".to_string()
                                        ));
                                    }
                                }
                                Err(e) => {
                                    let _ = s.send(Err(format!("JSON parse failed: {e}")));
                                }
                            }
                        }
                    }
                    Ok(())
                },
            ));

            let method = HSTRING::from("Page.captureScreenshot");
            let params = HSTRING::from(
                r#"{"format":"png","captureBeyondViewport":false,"fromSurface":true}"#,
            );
            if let Err(e) = core_webview.CallDevToolsProtocolMethod(&method, &params, &handler) {
                if let Some(s) = tx_outer.lock().unwrap_or_else(|e| e.into_inner()).take() {
                    let _ = s.send(Err(format!("CallDevToolsProtocolMethod failed: {:?}", e)));
                }
            }
        }
    })
    .map_err(|e| format!("with_webview error: {e}"))?;

    rx.await
        .map_err(|_| "Screenshot channel closed".to_string())?
}
