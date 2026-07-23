mod commands;

/// Debug-build-only trace logging. Release builds set `windows_subsystem =
/// "windows"` (see main.rs), so there is no console to read stderr from in a
/// release build regardless — these calls were previously unconditional,
/// running on every window-move/resize frame for no one to see.
#[macro_export]
macro_rules! xevo_log {
    ($($arg:tt)*) => {
        if cfg!(debug_assertions) { eprintln!($($arg)*); }
    };
}

use std::sync::Mutex;
use std::collections::HashMap;

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

            // XEVO is Windows-only for v1.0. Every dev feature — network
            // capture, header injection, cookies, tab titles/favicons, in-page
            // shortcuts, zoom, hard reload, screenshots, memory targeting — is
            // implemented against WebView2 COM behind #[cfg(windows)], with no
            // WebKit fallbacks. A non-Windows build compiles and silently loses
            // all of it, so refuse to start rather than pretend to work.
            #[cfg(not(target_os = "windows"))]
            {
                let _ = _app;
                eprintln!(
                    "XEVO is Windows-only for v1.0: every developer feature is built on \
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
                            let state = app_handle.state::<BrowserState>();
                            let insets = *state.content_insets.lock().unwrap_or_else(|e| e.into_inner());
                            let Some((left, top, right, bottom)) = insets else { return };
                            let label = state.active_tab_label.lock().unwrap_or_else(|e| e.into_inner()).clone();
                            let Some(label) = label else { return };
                            let Some(wv) = commands::browser::find_tab_webview(&app_handle, &label) else { return };

                            let Some(win) = app_handle.get_window("main") else { return };
                            let scale = win.scale_factor().unwrap_or(1.0);
                            let win_w = physical_size.width as f64 / scale;
                            let win_h = physical_size.height as f64 / scale;

                            let bounds = tauri::Rect {
                                position: tauri::Position::Logical(tauri::LogicalPosition::new(left, top)),
                                size: tauri::Size::Logical(tauri::LogicalSize::new(
                                    (win_w - left - right).max(1.0),
                                    (win_h - top - bottom).max(1.0),
                                )),
                            };
                            let _ = wv.set_bounds(bounds);
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
            commands::browser::forward_shortcut,
            commands::browser::open_external_url,
            commands::browser::open_download,
            commands::browser::update_tab_info,
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
            commands::browser::browser_set_header_rules,
            commands::http::api_fetch,
            commands::ports::scan_ports,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
