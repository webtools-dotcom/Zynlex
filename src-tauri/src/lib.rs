mod commands;

use std::sync::{Arc, atomic::{AtomicBool, Ordering}};
use std::time::Duration;
use tauri::{Emitter, Manager};
use std::sync::Mutex;

/// Tracks which browser webview is currently visible.
/// Each tab gets its own WebviewWindow with label `browser-{tab_id}`.
pub struct BrowserState {
    /// Label of the currently visible webview (e.g. "browser-tab-123").
    pub active_tab_label: Mutex<Option<String>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_os::init())
        .setup(|app| {
            let main_window = app
                .get_webview_window("main")
                .expect("main window not found");
            let app_handle = app.handle().clone();
            let was_minimized = Arc::new(AtomicBool::new(false));

            let wm = was_minimized.clone();
            let mw_clone = main_window.clone();
            main_window.on_window_event(move |event| {
                match event {
                    tauri::WindowEvent::Focused(false) => {
                        if mw_clone.is_minimized().unwrap_or(false) {
                            wm.store(true, Ordering::Relaxed);
                            let _ = app_handle.emit("xevo://minimize-state", true);
                        }
                    }
                    tauri::WindowEvent::Focused(true) => {
                        if wm.swap(false, Ordering::Relaxed) {
                            let _ = app_handle.emit("xevo://minimize-state", false);
                            let app = app_handle.clone();
                            tauri::async_runtime::spawn(async move {
                                tokio::time::sleep(Duration::from_millis(150)).await;
                                let Some(win) = app.get_webview_window("main") else { return };
                                let was_maximized = win.is_maximized().unwrap_or(false);
                                if !was_maximized {
                                    let _ = win.maximize();
                                    let _ = win.unmaximize();
                                } else {
                                    let _ = win.unmaximize();
                                    let _ = win.maximize();
                                }
                            });
                        }
                    }
                    _ => {}
                }
            });
            Ok(())
        })
        .manage(BrowserState {
            active_tab_label: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            commands::browser::browser_create_tab,
            commands::browser::browser_activate_tab,
            commands::browser::browser_close_tab,
            commands::browser::browser_navigate_tab,
            commands::browser::browser_set_bounds,
            commands::browser::browser_go_back,
            commands::browser::browser_go_forward,
            commands::browser::browser_reload,
            commands::browser::browser_stop_loading,
            commands::browser::browser_bookmark_request,
            commands::browser::forward_shortcut,
            commands::browser::update_tab_info,
            commands::browser::browser_find,
            commands::browser::browser_find_next,
            commands::browser::browser_stop_find,
            commands::browser::browser_find_callback,
            commands::browser::browser_reposition,
            commands::browser::browser_set_theme,
            commands::browser::browser_hide_tab,
            commands::browser::browser_show_tab,
            commands::ports::scan_ports,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
