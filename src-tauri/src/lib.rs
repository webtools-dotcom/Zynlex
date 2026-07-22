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
