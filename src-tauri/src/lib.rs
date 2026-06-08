mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::browser::browser_navigate,
            commands::browser::browser_set_bounds,
            commands::browser::browser_go_back,
            commands::browser::browser_go_forward,
            commands::browser::browser_reload,
            commands::browser::browser_close,
            commands::browser::browser_bookmark_request,
            commands::browser::browser_show,
            commands::browser::browser_hide,
            commands::browser::update_tab_info,
            commands::browser::browser_find,
            commands::browser::browser_find_next,
            commands::browser::browser_stop_find,
            commands::browser::browser_find_callback,
            commands::browser::browser_stop_loading,
            commands::browser::browser_reposition,
            commands::browser::forward_shortcut,
            commands::ports::scan_ports,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
