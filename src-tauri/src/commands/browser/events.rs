// Tab title/favicon + in-page shortcut forwarding (native, no injected JS).
//
// Both used to be handled by injected JS calling back into Tauri IPC, which
// is silently rejected for every remote (https://) page — see the Inspector
// panel fix above. These go through native WebView2 events instead: no
// page-originated IPC, so no ACL to satisfy.

use super::{pwstr_to_string, webview_label_for_tab};
use crate::zynlex_log;
use std::collections::HashSet;
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Emitter, Manager};

// ─── Shortcut forwarding (global, not tab-specific) ──────────────────

/// Chords the frontend has bound to a command (src/lib/commands.ts), pushed
/// whenever bindings change. Only these are taken away from a focused page;
/// every other key combination still reaches it.
fn bound_shortcuts() -> &'static Mutex<HashSet<String>> {
    static BOUND: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    BOUND.get_or_init(Default::default)
}

#[tauri::command]
pub fn browser_set_shortcuts(chords: Vec<String>) {
    *bound_shortcuts().lock().unwrap_or_else(|e| e.into_inner()) = chords.into_iter().collect();
}

/// The key half of a chord, named exactly as `chordFromEvent` in
/// src/lib/commands.ts names it — the two must produce identical strings.
fn key_name(vkey: u32) -> Option<String> {
    let named = match vkey {
        0x41..=0x5A => return char::from_u32(vkey + 0x20).map(String::from),
        0x30..=0x39 => return char::from_u32(vkey).map(String::from),
        0x60..=0x69 => return char::from_u32(vkey - 0x30).map(String::from),
        0x70..=0x7B => return Some(format!("f{}", vkey - 0x6F)),
        0x25 => "left",
        0x26 => "up",
        0x27 => "right",
        0x28 => "down",
        0x09 => "tab",
        0x1B => "escape",
        0x20 => "space",
        0x0D => "enter",
        0x08 => "backspace",
        0x2E => "delete",
        0xBC => ",",
        0xBE => ".",
        0xBF | 0x6F => "/",
        0xDC => "\\",
        0xBB | 0x6B => "=",
        0xBD | 0x6D => "-",
        0xC0 => "`",
        0xBA => ";",
        0xDE => "'",
        0xDB => "[",
        0xDD => "]",
        _ => return None,
    };
    Some(named.to_string())
}

/// "ctrl+alt+shift+key", modifiers always in that order.
fn chord(ctrl: bool, alt: bool, shift: bool, vkey: u32) -> Option<String> {
    let key = key_name(vkey)?;
    let mut s = String::new();
    for (held, name) in [(ctrl, "ctrl+"), (alt, "alt+"), (shift, "shift+")] {
        if held {
            s.push_str(name);
        }
    }
    s.push_str(&key);
    Some(s)
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

/// Called from the native HistoryChanged handler — never exposed as an IPC
/// command, since it would let any page lie about another tab's nav state.
fn update_history_state(
    app: AppHandle,
    tab_id: String,
    can_go_back: bool,
    can_go_forward: bool,
) -> Result<(), String> {
    app.emit(
        "browser://history-state",
        serde_json::json!({
            "tabId": tab_id,
            "canGoBack": can_go_back,
            "canGoForward": can_go_forward,
        }),
    )
    .map_err(|e| e.to_string())
}

pub fn register_webview_native_events(wv: &tauri::Webview, app: &tauri::AppHandle, tab_id: &str) {
    let app = app.clone();
    let tab_id = tab_id.to_string();
    let _ = wv.with_webview(move |platform| {
        unsafe {
            use webview2_com::Microsoft::Web::WebView2::Win32::{
                COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN, COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_DOWN,
            };
            use webview2_com::{
                AcceleratorKeyPressedEventHandler, ContainsFullScreenElementChangedEventHandler,
                DocumentTitleChangedEventHandler, HistoryChangedEventHandler,
                NavigationCompletedEventHandler, StatusBarTextChangedEventHandler,
            };
            use windows_core::Interface;

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

            // DocumentTitleChanged only fires when the title differs, but a navigation
            // resets the tab's title to its URL (useWebviewBridge). A page titled like
            // the last one (staging → local) would keep showing the URL, so send the
            // title again once each navigation completes.
            let app_nav = app.clone();
            let tab_id_nav = tab_id.clone();
            let core_nav = core.clone();
            let nav_handler =
                NavigationCompletedEventHandler::create(Box::new(move |_webview, _args| {
                    let title = pwstr_to_string(|p| {
                        let _ = core_nav.DocumentTitle(p);
                    });
                    let url = pwstr_to_string(|p| {
                        let _ = core_nav.Source(p);
                    });
                    let _ = update_tab_info(app_nav.clone(), tab_id_nav.clone(), title, url, None);
                    Ok(())
                }));
            let mut nav_token: i64 = 0;
            let _ = core.add_NavigationCompleted(&nav_handler, &mut nav_token);

            // Back/forward state, straight from the webview. The app used to keep
            // its own URL stack and infer this from url-changed events, which
            // cannot distinguish a back navigation from a forward one — so going
            // back cleared the forward stack and Forward could never enable.
            // WebView2 tracks pushState, redirects and subframes correctly; we
            // only mirror its answer.
            let app_hist = app.clone();
            let tab_id_hist = tab_id.clone();
            let core_hist = core.clone();
            let hist_handler =
                HistoryChangedEventHandler::create(Box::new(move |_webview, _args| {
                    let mut can_back = windows_core::BOOL(0);
                    let mut can_forward = windows_core::BOOL(0);
                    let _ = core_hist.CanGoBack(&mut can_back);
                    let _ = core_hist.CanGoForward(&mut can_forward);
                    let _ = update_history_state(
                        app_hist.clone(),
                        tab_id_hist.clone(),
                        can_back.as_bool(),
                        can_forward.as_bool(),
                    );
                    Ok(())
                }));
            let mut hist_token: i64 = 0;
            let _ = core.add_HistoryChanged(&hist_handler, &mut hist_token);

            // WebView2 exposes the resolved target URL whenever the pointer moves
            // onto or off a link. Using the native event avoids page-originated IPC,
            // which remote pages are not allowed to invoke.
            if let Ok(core12) =
                core.cast::<webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_12>()
            {
                let app_hover = app.clone();
                let tab_id_hover = tab_id.clone();
                let core_hover = core12.clone();
                let hover_handler =
                    StatusBarTextChangedEventHandler::create(Box::new(move |_webview, _args| {
                        let hovered_url = pwstr_to_string(|p| {
                            let _ = core_hover.StatusBarText(p);
                        });
                        let _ = app_hover.emit(
                            "zynlex://hovered-url",
                            serde_json::json!({
                                "tabId": tab_id_hover,
                                "url": if hovered_url.is_empty() {
                                    None
                                } else {
                                    Some(hovered_url)
                                },
                            }),
                        );
                        Ok(())
                    }));
                let mut hover_token: i64 = 0;
                if let Err(e) = core12.add_StatusBarTextChanged(&hover_handler, &mut hover_token) {
                    zynlex_log!("[zynlex] StatusBarTextChanged registration failed: {e:?}");
                }
            }

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
                    if kind != COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN
                        && kind != COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_DOWN
                    {
                        // Alt combinations arrive as SYSTEM_KEY_DOWN, not KEY_DOWN.
                        return Ok(());
                    }
                    let mut vkey: u32 = 0;
                    let _ = args.VirtualKey(&mut vkey);

                    let ctrl = windows::Win32::UI::Input::KeyboardAndMouse::GetKeyState(
                        windows::Win32::UI::Input::KeyboardAndMouse::VK_CONTROL.0 as i32,
                    ) < 0;
                    let shift = windows::Win32::UI::Input::KeyboardAndMouse::GetKeyState(
                        windows::Win32::UI::Input::KeyboardAndMouse::VK_SHIFT.0 as i32,
                    ) < 0;
                    let alt = windows::Win32::UI::Input::KeyboardAndMouse::GetKeyState(
                        windows::Win32::UI::Input::KeyboardAndMouse::VK_MENU.0 as i32,
                    ) < 0;

                    let Some(s) = chord(ctrl, alt, shift, vkey) else {
                        return Ok(());
                    };
                    // Escape is observed, never consumed: always forwarded, never
                    // SetHandled. SetHandled(true) stops WebView2 delivering the key
                    // to the page, and the app only wants Escape in two narrow cases
                    // (close the find bar, stop a load) — so suppressing it meant no
                    // page could ever see an Escape keydown. Every bound chord is a
                    // browser accelerator the page is not entitled to.
                    if s == "escape" {
                        let _ = forward_shortcut(app_key.clone(), s);
                    } else if bound_shortcuts()
                        .lock()
                        .unwrap_or_else(|e| e.into_inner())
                        .contains(&s)
                    {
                        let _ = forward_shortcut(app_key.clone(), s);
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
                        // Apply bounds here as well as in lib.rs's Resized handler,
                        // and do NOT remove this as redundant — it is the only path
                        // that runs when the window's size does not change.
                        //
                        // `Resized` fires on a size *change*. A window that is
                        // already the size of the screen — maximized with the
                        // taskbar hidden, or still fullscreen from a previous video
                        // — transitions without changing size, so no event arrives,
                        // nothing re-applies the bounds, and the child webview stays
                        // pinned to the inset content area: the page goes fullscreen
                        // inside a box with the tab bar and sidebar still around it.
                        //
                        // The size read here can be the pre-transition one when the
                        // size *is* changing, which is what makes the Resized
                        // handler the authority in that case. The two cases are
                        // disjoint, so both are needed.
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

#[cfg(test)]
mod tests {
    use super::chord;

    // Must match chordFromEvent in src/lib/commands.ts (see commands.test.ts).
    #[test]
    fn chord_names_match_the_frontend() {
        assert_eq!(chord(true, false, false, 0x4B).as_deref(), Some("ctrl+k"));
        assert_eq!(
            chord(true, false, true, 0x31).as_deref(),
            Some("ctrl+shift+1")
        );
        assert_eq!(
            chord(true, false, true, 0xBF).as_deref(),
            Some("ctrl+shift+/")
        );
        assert_eq!(chord(true, false, false, 0x6B).as_deref(), Some("ctrl+="));
        assert_eq!(chord(true, false, false, 0x60).as_deref(), Some("ctrl+0"));
        assert_eq!(chord(false, true, false, 0x25).as_deref(), Some("alt+left"));
        assert_eq!(
            chord(true, true, true, 0x7B).as_deref(),
            Some("ctrl+alt+shift+f12")
        );
        assert_eq!(chord(false, false, false, 0x1B).as_deref(), Some("escape"));
        // Modifier keys on their own are not chords.
        assert_eq!(chord(true, false, false, 0x11), None);
    }
}
