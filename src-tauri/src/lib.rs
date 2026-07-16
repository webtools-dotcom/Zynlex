mod commands;


use std::sync::{Arc, atomic::{AtomicBool, Ordering}};
use tauri::{Emitter, Manager, WebviewUrl, webview::WebviewWindowBuilder};
use std::sync::Mutex;
use std::time::Duration;
use std::collections::HashMap;

/// Tracks which browser webview is currently visible.
/// Each tab gets its own WebviewWindow with label `browser-{tab_id}`.
pub struct BrowserState {
    /// Label of the currently visible webview (e.g. "browser-tab-123").
    pub active_tab_label: Mutex<Option<String>>,
    /// Custom user agent override (None = default browser UA).
    pub user_agent: Mutex<Option<String>>,
    /// Persistent strong references to ALL browser webview handles.
    /// Prevents the OS window from being destroyed when the Rust async
    /// function's local variable goes out of scope (Tauri #14843).
    /// Key = label (e.g. "browser-tab-123"), value = cloneable handle.
    pub webviews: Mutex<HashMap<String, tauri::WebviewWindow>>,

}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_opener::Builder::new()
                .open_js_links_on_click(false)
                .build(),
        )
        .plugin(tauri_plugin_os::init())
        .setup(|app| {
            let main_window = app
                .get_webview_window("main")
                .ok_or("main window not found")?;

            // Pre-warm: create a hidden about:blank webview to initialize
            // the WebView2 browser process. This makes subsequent tab
            // creation ~200ms faster.
            let warmup_label = "xevo-warmup";
            let _warmup = WebviewWindowBuilder::new(
                app.handle(),
                warmup_label,
                WebviewUrl::External("about:blank".parse().unwrap()),
            )
            .parent(&main_window)?
            .inner_size(1.0, 1.0)
            .position(-9999.0, -9999.0)
            .build();

            // Destroy it after 2 seconds — just here to warm up the process
            let warmup_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(Duration::from_secs(2)).await;
                if let Some(wv) = warmup_handle.get_webview_window(warmup_label) {
                    let _ = wv.destroy();
                }
            });
            let app_handle = app.handle().clone();
            let was_minimized = Arc::new(AtomicBool::new(false));

            let wm = was_minimized.clone();
            let mw_clone = main_window.clone();
            main_window.on_window_event(move |event| {
                match event {
                    tauri::WindowEvent::Focused(false) => {
                        if mw_clone.is_minimized().unwrap_or(false) {
                            eprintln!("[XEVO-BOUNDS] Focused(false) + is_minimized → minimize detected");
                            wm.store(true, Ordering::Relaxed);
                            let _ = app_handle.emit("xevo://minimize-state", true);
                            for (_, wv) in app_handle.webview_windows() {
                                if wv.label().starts_with("browser-") {
                                    let _ = wv.hide();
                                    commands::browser::apply_memory_target(&wv, true);
                                }
                            }
                        }
                    }
                    tauri::WindowEvent::Resized(_) => {
                        // SECONDARY minimize detection: Focused(false) can fire
                        // before is_minimized() returns true on Windows (message
                        // ordering race). Resized fires AFTER the window state
                        // is committed, so is_minimized() is reliable here.
                        if mw_clone.is_minimized().unwrap_or(false) {
                            if !wm.swap(true, Ordering::Relaxed) {
                                eprintln!("[XEVO-BOUNDS] Resized + is_minimized → minimize detected (fallback)");
                                let _ = app_handle.emit("xevo://minimize-state", true);
                                for (_, wv) in app_handle.webview_windows() {
                                    if wv.label().starts_with("browser-") {
                                        let _ = wv.hide();
                                        commands::browser::apply_memory_target(&wv, true);
                                    }
                                }
                            }
                        }
                    }
                    tauri::WindowEvent::Focused(true) => {
                        if wm.swap(false, Ordering::Relaxed) {
                            eprintln!("[XEVO-BOUNDS] Focused(true) — restore from minimize");
                            let _ = app_handle.emit("xevo://minimize-state", false);
                            let state = app_handle.state::<BrowserState>();
                            let mut active_label = state.active_tab_label.lock().unwrap_or_else(|e| e.into_inner()).clone();
                            // Hide ALL browser webviews first, then show only
                            // the active one. This prevents orphan floating
                            // windows from stale active_tab_label state or
                            // frontend desync.
                            for (_, wv) in app_handle.webview_windows() {
                                if wv.label().starts_with("browser-") {
                                    let _ = wv.hide();
                                }
                            }
                            // Also hide from our persistent handle map (webviews whose
                            // handles we hold but Tauri's registry dropped).
                            if let Ok(webviews) = state.webviews.lock() {
                                for (_, wv) in webviews.iter() {
                                    if wv.label().starts_with("browser-") {
                                        let _ = wv.hide();
                                    }
                                }
                            }
                            // Resolve which webview to show: use active_tab_label if set,
                            // otherwise fall back to any browser-* webview.
                            let show_label: Option<String> = if let Some(ref label) = active_label {
                                if app_handle.get_webview_window(label).is_some() || state.webviews.lock().unwrap_or_else(|e| e.into_inner()).contains_key(label) {
                                    Some(label.clone())
                                } else {
                                    eprintln!("[XEVO-BOUNDS] Focused(true) — active_tab_label '{}' points to non-existent webview, scanning fallback", label);
                                    active_label = None;
                                    // Scan Tauri's registry
                                    let found = app_handle.webview_windows()
                                        .iter()
                                        .find(|(l, _)| l.starts_with("browser-"))
                                        .map(|(l, _)| l.clone());
                                    // Fallback: scan our persistent map
                                    let found = found.or_else(|| {
                                        state.webviews.lock().unwrap_or_else(|e| e.into_inner()).keys()
                                            .find(|l| l.starts_with("browser-"))
                                            .cloned()
                                    });
                                    found.or_else(|| {
                                        eprintln!("[XEVO-BOUNDS] Focused(true) — no browser-* webviews found at all");
                                        None
                                    })
                                }
                            } else {
                                eprintln!("[XEVO-BOUNDS] Focused(true) — active_tab_label was None, scanning fallback");
                                // Scan Tauri's registry
                                let found = app_handle.webview_windows()
                                    .iter()
                                    .find(|(l, _)| l.starts_with("browser-"))
                                    .map(|(l, _)| l.clone());
                                // Fallback: scan our persistent map
                                let found = found.or_else(|| {
                                    state.webviews.lock().unwrap_or_else(|e| e.into_inner()).keys()
                                        .find(|l| l.starts_with("browser-"))
                                        .cloned()
                                });
                                found.or_else(|| {
                                    eprintln!("[XEVO-BOUNDS] Focused(true) — no browser-* webviews found at all");
                                    None
                                })
                            };
                            if let Some(label) = show_label {
                                // Try Tauri's registry first, then fallback to our map
                                let wv = app_handle.get_webview_window(&label)
                                    .or_else(|| {
                                        state.webviews.lock().unwrap_or_else(|e| e.into_inner()).get(&label).cloned()
                                    });
                                if let Some(wv) = wv {
                                    let _ = wv.show();
                                    commands::browser::apply_memory_target(&wv, false);
                                    // Restore active_tab_label so subsequent operations can find it
                                    *state.active_tab_label.lock().unwrap_or_else(|e| e.into_inner()) = Some(label.clone());
                                    eprintln!("[XEVO-BOUNDS] Focused(true) — showed webview '{}', emitting force-sync", label);
                                    let _ = app_handle.emit("xevo://force-sync", ());
                                }
                            } else {
                                eprintln!("[XEVO-BOUNDS] Focused(true) — no webview to show");
                            }
                        } else {
                            eprintln!("[XEVO-BOUNDS] Focused(true) — was_minimized flag was false, skipping restore");
                        }
                    }
                    _ => {}
                }
            });
            Ok(())
        })
        .manage(BrowserState {
            active_tab_label: Mutex::new(None),
            user_agent: Mutex::new(None),
            webviews: Mutex::new(HashMap::new()),
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
            commands::browser::browser_bookmark_request,
            commands::browser::forward_shortcut,
            commands::browser::open_external_url,
            commands::browser::update_tab_info,
            commands::browser::browser_find,
            commands::browser::browser_find_next,
            commands::browser::browser_stop_find,
            commands::browser::browser_find_callback,
            commands::browser::browser_set_theme,
            commands::browser::browser_hide_tab,
            commands::browser::browser_show_tab,
            commands::browser::browser_set_user_agent,
            commands::browser::browser_set_memory_target,
            commands::browser::browser_eval_inspector,
            commands::browser::inspector_data,
            commands::browser::inspector_mutate,
            commands::browser::create_viewport,
            commands::browser::destroy_viewport,
            commands::browser::resize_viewport,
            commands::browser::show_viewport,
            commands::browser::hide_viewport,
            commands::browser::scroll_viewport,
            commands::browser::click_viewport,
            commands::browser::notify_viewport_scroll,
            commands::browser::notify_viewport_click,
            commands::browser::notify_viewport_input,
            commands::browser::notify_viewport_metrics,
            commands::browser::browser_eval_raw,
            commands::browser::browser_screenshot,
            commands::browser::browser_save_tab_state,
            commands::browser::browser_tab_state_saved,
            commands::browser::browser_restore_tab_state,
            commands::headers::set_header_rules,
            commands::headers::get_header_rules,
            commands::ports::scan_ports,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
