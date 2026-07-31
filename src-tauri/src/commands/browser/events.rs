// Tab title/favicon + in-page shortcut forwarding (native, no injected JS).
//
// Both used to be handled by injected JS calling back into Tauri IPC, which
// is silently rejected for every remote (https://) page — see the Inspector
// panel fix above. These go through native WebView2 events instead: no
// page-originated IPC, so no ACL to satisfy.

use super::{pwstr_to_string, webview_label_for_tab};
use crate::zynlex_log;
use tauri::{AppHandle, Emitter, Manager};

// ─── Bookmark & Shortcut forwarding (global, not tab-specific) ───────

#[tauri::command]
pub fn browser_bookmark_request(app: AppHandle) -> Result<(), String> {
    app.emit("browser://bookmark-request", ())
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Called from the native accelerator-key handler — never exposed as an
/// IPC command, since it would let any page spoof a keyboard shortcut.
fn forward_shortcut(app: AppHandle, shortcut: String) -> Result<(), String> {
    app.emit("zynlex://shortcut", shortcut)
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Called from the native title-changed handler — never exposed as an IPC
/// command, since it would let any page spoof another tab's title/url/favicon.
fn update_tab_info(
    app: AppHandle,
    tab_id: String,
    title: String,
    url: String,
    favicon: Option<String>,
) -> Result<(), String> {
    app.emit(
        "browser://tab-info",
        serde_json::json!({
            "tabId": tab_id,
            "title": title,
            "url": url,
            "favicon": favicon,
        }),
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn register_webview_native_events(wv: &tauri::Webview, app: &tauri::AppHandle, tab_id: &str) {
    let app = app.clone();
    let tab_id = tab_id.to_string();
    let _ = wv.with_webview(move |platform| {
        #[cfg(windows)]
        unsafe {
            use webview2_com::Microsoft::Web::WebView2::Win32::COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN;
            use webview2_com::{
                AcceleratorKeyPressedEventHandler, ContainsFullScreenElementChangedEventHandler,
                DocumentTitleChangedEventHandler,
            };

            let core = match platform.controller().CoreWebView2() {
                Ok(core) => core,
                Err(e) => {
                    zynlex_log!("[zynlex] CoreWebView2() failed for native events: {e:?}");
                    return;
                }
            };

            let app_title = app.clone();
            let tab_id_title = tab_id.clone();
            let core_title = core.clone();
            let title_handler =
                DocumentTitleChangedEventHandler::create(Box::new(move |_webview, _args| {
                    let title = pwstr_to_string(|p| {
                        let _ = core_title.DocumentTitle(p);
                    });
                    let url = pwstr_to_string(|p| {
                        let _ = core_title.Source(p);
                    });

                    let _ =
                        update_tab_info(app_title.clone(), tab_id_title.clone(), title, url, None);
                    Ok(())
                }));
            let mut title_token: i64 = 0;
            let _ = core.add_DocumentTitleChanged(&title_handler, &mut title_token);

            let app_key = app.clone();
            let controller = platform.controller();
            let key_handler =
                AcceleratorKeyPressedEventHandler::create(Box::new(move |_controller, args| {
                    let args = match args {
                        Some(a) => a,
                        None => return Ok(()),
                    };
                    let mut kind = Default::default();
                    let _ = args.KeyEventKind(&mut kind);
                    if kind != COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN {
                        return Ok(());
                    }
                    let mut vkey: u32 = 0;
                    let _ = args.VirtualKey(&mut vkey);

                    // Mirrors the key set the old injected CORE_SCRIPT mapped
                    // (ctrl+t/w/b/,/l/1-9, ctrl+shift+t, ctrl+shift+tab, ctrl+?, alt+left/right, escape).
                    let ctrl = windows::Win32::UI::Input::KeyboardAndMouse::GetKeyState(
                        windows::Win32::UI::Input::KeyboardAndMouse::VK_CONTROL.0 as i32,
                    ) < 0;
                    let shift = windows::Win32::UI::Input::KeyboardAndMouse::GetKeyState(
                        windows::Win32::UI::Input::KeyboardAndMouse::VK_SHIFT.0 as i32,
                    ) < 0;
                    let alt = windows::Win32::UI::Input::KeyboardAndMouse::GetKeyState(
                        windows::Win32::UI::Input::KeyboardAndMouse::VK_MENU.0 as i32,
                    ) < 0;

                    let shortcut = if vkey == 0x1B {
                        Some("escape")
                    } else if alt && !ctrl && !shift && vkey == 0x25 {
                        Some("alt+left")
                    } else if alt && !ctrl && !shift && vkey == 0x27 {
                        Some("alt+right")
                    } else if ctrl && shift && !alt && vkey == 0x54 {
                        Some("ctrl+shift+t")
                    } else if ctrl && shift && !alt && vkey == 0x09 {
                        Some("ctrl+shift+tab")
                    } else if ctrl && shift && !alt && vkey == 0x52 {
                        Some("ctrl+shift+r")
                    } else if ctrl && shift && !alt && (0x31..=0x39).contains(&vkey) {
                        // Ctrl+Shift+1..9 → switch workspace. Table, not format!, so
                        // the whole match stays &'static str.
                        const WS: [&str; 9] = [
                            "ctrl+shift+1",
                            "ctrl+shift+2",
                            "ctrl+shift+3",
                            "ctrl+shift+4",
                            "ctrl+shift+5",
                            "ctrl+shift+6",
                            "ctrl+shift+7",
                            "ctrl+shift+8",
                            "ctrl+shift+9",
                        ];
                        Some(WS[(vkey - 0x31) as usize])
                    } else if ctrl && shift && !alt && (vkey == 0xBF || vkey == 0x6F) {
                        Some("ctrl+?")
                    } else if ctrl && !shift && !alt {
                        match vkey {
                            0x4B => Some("ctrl+k"),
                            0x54 => Some("ctrl+t"),
                            0x57 => Some("ctrl+w"),
                            0x42 => Some("ctrl+b"),
                            0xBC => Some("ctrl+,"),
                            0x4C => Some("ctrl+l"),
                            0x48 => Some("ctrl+h"),
                            0x31 => Some("ctrl+1"),
                            0x32 => Some("ctrl+2"),
                            0x33 => Some("ctrl+3"),
                            0x34 => Some("ctrl+4"),
                            0x35 => Some("ctrl+5"),
                            0x36 => Some("ctrl+6"),
                            0x37 => Some("ctrl+7"),
                            0x38 => Some("ctrl+8"),
                            0x39 => Some("ctrl+9"),
                            // Zoom: forwarded (and SetHandled) so the app's per-tab
                            // zoom store stays the single source of truth. Ctrl+wheel
                            // is still handled natively by zoom_hotkeys_enabled.
                            0xBB | 0x6B => Some("ctrl+="),
                            0xBD | 0x6D => Some("ctrl+-"),
                            0x30 | 0x60 => Some("ctrl+0"),
                            _ => None,
                        }
                    } else {
                        None
                    };

                    if let Some(s) = shortcut {
                        let _ = forward_shortcut(app_key.clone(), s.to_string());
                        let _ = args.SetHandled(true);
                    }
                    Ok(())
                }));
            let mut key_token: i64 = 0;
            let _ = controller.add_AcceleratorKeyPressed(&key_handler, &mut key_token);

            // HTML fullscreen (e.g. YouTube's fullscreen button). Without this the
            // page fullscreens only inside the child webview's inset bounds, so the
            // chrome stays visible around it. On enter: put the main window into OS
            // fullscreen and let the child cover the whole window (the fullscreen
            // flag zeroes the bounds insets in apply_active_child_bounds and gates
            // the JS bounds-sync). On exit: reverse it.
            let app_fs = app.clone();
            let core_fs = core.clone();
            let label_fs = webview_label_for_tab(&tab_id);
            let fs_handler = ContainsFullScreenElementChangedEventHandler::create(Box::new(
                move |_sender, _args| {
                    let mut is_fs = windows_core::BOOL(0);
                    let _ = core_fs.ContainsFullScreenElement(&mut is_fs);
                    let entering = is_fs.as_bool();
                    let state = app_fs.state::<crate::BrowserState>();
                    // Record *which* tab owns fullscreen, so switching to another tab
                    // or closing this one can clear it — a global flag stayed stuck.
                    {
                        let mut fs = state
                            .fullscreen_tab
                            .lock()
                            .unwrap_or_else(|e| e.into_inner());
                        *fs = if entering {
                            Some(label_fs.clone())
                        } else {
                            None
                        };
                    }
                    if let Some(main) = app_fs.get_window("main") {
                        let _ = main.set_fullscreen(entering);
                        if let Ok(sz) = main.inner_size() {
                            let scale = main.scale_factor().unwrap_or(1.0);
                            crate::apply_active_child_bounds(
                                &app_fs,
                                sz.width as f64 / scale,
                                sz.height as f64 / scale,
                                false,
                            );
                        }
                    }
                    Ok(())
                },
            ));
            let mut fs_token: i64 = 0;
            let _ = core.add_ContainsFullScreenElementChanged(&fs_handler, &mut fs_token);
        }
    });
}
