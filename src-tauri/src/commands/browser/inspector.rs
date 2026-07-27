use tauri::{AppHandle, Emitter};
use std::sync::Mutex;
use super::{find_tab_webview, webview_label_for_tab, pwstr_to_string, js_string_literal};

// ─── Inspector ────────────────────────────────────────────────────

/// Runs `script` in the tab's webview via WebView2 `ExecuteScript` and parses
/// its result as JSON. Used instead of injected-JS-calls-back-into-Tauri
/// because remote (https://) pages are rejected by the IPC ACL — this reads
/// the result directly through the native COM API, no page-originated IPC at all.
///
/// ponytail: ExecuteScript returns the whole result as one JSON string, so a
/// multi-megabyte localStorage dump could be slow to marshal. Upgrade path:
/// chunk large stores if this becomes a real complaint.
#[cfg(target_os = "windows")]
pub(super) async fn eval_json(wv: &tauri::Webview, script: String) -> Result<serde_json::Value, String> {
    use std::sync::Arc;
    use tokio::sync::oneshot;
    use webview2_com::ExecuteScriptCompletedHandler;
    use windows_core::HSTRING;

    let (inner_tx, rx) = oneshot::channel::<Result<serde_json::Value, String>>();
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
            let handler = ExecuteScriptCompletedHandler::create(Box::new(
                move |result: windows_core::Result<()>, json: String| -> windows_core::Result<()> {
                    let sender = tx_inner.lock().unwrap_or_else(|e| e.into_inner()).take();
                    if let Some(s) = sender {
                        if let Err(e) = result {
                            let _ = s.send(Err(format!("ExecuteScript failed: {:?}", e)));
                        } else {
                            match serde_json::from_str::<serde_json::Value>(&json) {
                                Ok(v) => {
                                    let _ = s.send(Ok(v));
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

            if let Err(e) = core_webview.ExecuteScript(&HSTRING::from(script.as_str()), &handler) {
                if let Some(s) = tx_outer.lock().unwrap_or_else(|e| e.into_inner()).take() {
                    let _ = s.send(Err(format!("ExecuteScript call failed: {:?}", e)));
                }
            }
        }
    })
    .map_err(|e| format!("with_webview error: {e}"))?;

    rx.await.map_err(|_| "Inspector eval channel closed".to_string())?
}

/// Marshal one WebView2 cookie into JSON. Must be called on the UI thread —
/// COM interface pointers are not `Send`, so every field is read out here and
/// only the plain JSON crosses the channel.
#[cfg(target_os = "windows")]
unsafe fn cookie_to_json(
    c: &webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Cookie,
) -> serde_json::Value {
    use windows_core::BOOL;

    let name = pwstr_to_string(|p| { let _ = c.Name(p); });
    let value = pwstr_to_string(|p| { let _ = c.Value(p); });
    let domain = pwstr_to_string(|p| { let _ = c.Domain(p); });
    let path = pwstr_to_string(|p| { let _ = c.Path(p); });

    let mut expires: f64 = -1.0;
    let _ = c.Expires(&mut expires);

    let mut http_only = BOOL(0);
    let _ = c.IsHttpOnly(&mut http_only);
    let mut secure = BOOL(0);
    let _ = c.IsSecure(&mut secure);
    let mut session = BOOL(0);
    let _ = c.IsSession(&mut session);

    let mut same_site = Default::default();
    let _ = c.SameSite(&mut same_site);
    let same_site = match same_site.0 {
        0 => "None",
        1 => "Lax",
        2 => "Strict",
        _ => "",
    };

    serde_json::json!({
        "name": name,
        "value": value,
        "domain": domain,
        "path": path,
        "expires": expires,
        "httpOnly": http_only.as_bool(),
        "secure": secure.as_bool(),
        "session": session.as_bool(),
        "sameSite": same_site,
    })
}

/// The shared slot every WebView2 async COM call in this file uses to bridge
/// a completion handler back to an `async fn` via `oneshot`.
#[cfg(target_os = "windows")]
type OneshotSlot<T> = std::sync::Arc<Mutex<Option<tokio::sync::oneshot::Sender<Result<T, String>>>>>;

/// Sends `msg` as the (only) error response on a one-shot channel, if nothing
/// has claimed it yet.
#[cfg(target_os = "windows")]
fn cookie_op_failed<T>(tx: &OneshotSlot<T>, msg: String) {
    if let Some(s) = tx.lock().unwrap_or_else(|e| e.into_inner()).take() {
        let _ = s.send(Err(msg));
    }
}

/// Resolves the tab's `ICoreWebView2CookieManager` plus its current URL.
/// Shared setup for every cookie read/write — `read_cookies` and
/// `mutate_cookies` differ only in what they do with the manager once they
/// have it.
#[cfg(target_os = "windows")]
unsafe fn get_cookie_manager(
    platform: &tauri::webview::PlatformWebview,
) -> Result<
    (
        webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2CookieManager,
        String,
    ),
    String,
> {
    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_2;
    use windows_core::Interface;

    let core = platform
        .controller()
        .CoreWebView2()
        .map_err(|e| format!("CoreWebView2 failed: {e:?}"))?;

    let url = pwstr_to_string(|p| { let _ = core.Source(p); });

    let core2: ICoreWebView2_2 = core.cast().map_err(|e| format!("ICoreWebView2_2 unavailable: {e:?}"))?;
    let manager = core2.CookieManager().map_err(|e| format!("CookieManager unavailable: {e:?}"))?;

    Ok((manager, url))
}

/// Read every cookie applicable to the tab's current URL via the native
/// `ICoreWebView2CookieManager`.
///
/// Deliberately not `document.cookie`: that hides HttpOnly cookies entirely
/// (the ones that matter most when debugging auth) and exposes no domain/path,
/// which made precise deletion impossible.
#[cfg(target_os = "windows")]
async fn read_cookies(wv: &tauri::Webview) -> Result<serde_json::Value, String> {
    use std::sync::Arc;
    use tokio::sync::oneshot;
    use webview2_com::GetCookiesCompletedHandler;
    use windows::core::HSTRING;

    let (inner_tx, rx) = oneshot::channel::<Result<serde_json::Value, String>>();
    let tx = Arc::new(Mutex::new(Some(inner_tx)));
    let tx_outer = tx.clone();

    wv.with_webview(move |platform| {
        #[cfg(windows)]
        unsafe {
            let (manager, url) = match get_cookie_manager(&platform) {
                Ok(v) => v,
                Err(e) => return cookie_op_failed(&tx_outer, e),
            };

            let tx_inner = tx_outer.clone();
            let url_for_handler = url.clone();
            let handler = GetCookiesCompletedHandler::create(Box::new(move |result, list| {
                if let Some(s) = tx_inner.lock().unwrap_or_else(|e| e.into_inner()).take() {
                    if let Err(e) = result {
                        let _ = s.send(Err(format!("GetCookies failed: {e:?}")));
                        return Ok(());
                    }
                    let mut cookies = Vec::new();
                    if let Some(list) = list {
                        let mut count: u32 = 0;
                        let _ = list.Count(&mut count);
                        for i in 0..count {
                            if let Ok(c) = list.GetValueAtIndex(i) {
                                cookies.push(cookie_to_json(&c));
                            }
                        }
                    }
                    let _ = s.send(Ok(serde_json::json!({
                        "cookies": cookies,
                        "url": url_for_handler,
                    })));
                }
                Ok(())
            }));

            if let Err(e) = manager.GetCookies(&HSTRING::from(url.as_str()), &handler) {
                cookie_op_failed(&tx_outer, format!("GetCookies call failed: {e:?}"));
            }
        }
    })
    .map_err(|e| format!("with_webview error: {e}"))?;

    rx.await.map_err(|_| "Cookie read channel closed".to_string())?
}

/// Cookie writes through the native cookie manager, so domain/path are exact
/// rather than guessed. `document.cookie` could only ever expire a host-only
/// `path=/` cookie, which silently no-opped on every `Domain=.example.com` one.
///
/// Always reads the cookie list first so an edit can mutate the real cookie
/// object — that preserves httpOnly/secure/expires/sameSite across a value
/// change instead of replacing it with a bare duplicate.
#[cfg(target_os = "windows")]
async fn mutate_cookies(
    wv: &tauri::Webview,
    operation: String,
    params: serde_json::Value,
) -> Result<(), String> {
    use std::sync::Arc;
    use tokio::sync::oneshot;
    use webview2_com::GetCookiesCompletedHandler;
    use windows::core::HSTRING;

    let (inner_tx, rx) = oneshot::channel::<Result<(), String>>();
    let tx = Arc::new(Mutex::new(Some(inner_tx)));
    let tx_outer = tx.clone();

    wv.with_webview(move |platform| {
        #[cfg(windows)]
        unsafe {
            let (manager, url) = match get_cookie_manager(&platform) {
                Ok(v) => v,
                Err(e) => return cookie_op_failed(&tx_outer, e),
            };
            let host = url
                .parse::<url::Url>()
                .ok()
                .and_then(|u| u.host_str().map(|h| h.to_string()))
                .unwrap_or_default();

            let tx_inner = tx_outer.clone();
            let manager_inner = manager.clone();
            let handler = GetCookiesCompletedHandler::create(Box::new(move |result, list| {
                let sender = tx_inner.lock().unwrap_or_else(|e| e.into_inner()).take();
                let Some(s) = sender else { return Ok(()) };
                let manager = &manager_inner;
                if let Err(e) = result {
                    let _ = s.send(Err(format!("GetCookies failed: {e:?}")));
                    return Ok(());
                }

                let name = params["name"].as_str().unwrap_or("");
                let want_domain = params["domain"].as_str().unwrap_or("");
                let want_path = params["path"].as_str().unwrap_or("");

                let mut all = Vec::new();
                if let Some(list) = list {
                    let mut count: u32 = 0;
                    let _ = list.Count(&mut count);
                    for i in 0..count {
                        if let Ok(c) = list.GetValueAtIndex(i) {
                            all.push(c);
                        }
                    }
                }

                // A name alone can match several cookies (same name, different
                // domain/path), so domain/path narrow it when the panel supplies
                // them. Not needed for clear-cookies, which targets everything.
                let matched: Vec<_> = if operation == "clear-cookies" {
                    Vec::new()
                } else {
                    all.iter()
                        .filter(|c| {
                            let j = cookie_to_json(c);
                            j["name"].as_str() == Some(name)
                                && (want_domain.is_empty() || j["domain"].as_str() == Some(want_domain))
                                && (want_path.is_empty() || j["path"].as_str() == Some(want_path))
                        })
                        .cloned()
                        .collect()
                };

                let outcome = match operation.as_str() {
                    "delete-cookie" | "clear-cookies" => {
                        // clear-cookies targets everything visible to the page —
                        // NOT DeleteAllCookies(), which would wipe every site in
                        // the shared profile.
                        let victims = if operation == "clear-cookies" { &all } else { &matched };
                        victims
                            .iter()
                            .try_for_each(|c| manager.DeleteCookie(c))
                            .map_err(|e| format!("DeleteCookie failed: {e:?}"))
                    }

                    "set-cookie" => {
                        let value = params["value"].as_str().unwrap_or("");
                        if let Some(existing) = matched.first() {
                            existing
                                .SetValue(&HSTRING::from(value))
                                .and_then(|_| manager.AddOrUpdateCookie(existing))
                                .map_err(|e| format!("AddOrUpdateCookie failed: {e:?}"))
                        } else {
                            let domain = if want_domain.is_empty() { host.as_str() } else { want_domain };
                            let path = if want_path.is_empty() { "/" } else { want_path };
                            manager
                                .CreateCookie(
                                    &HSTRING::from(name),
                                    &HSTRING::from(value),
                                    &HSTRING::from(domain),
                                    &HSTRING::from(path),
                                )
                                .and_then(|c| manager.AddOrUpdateCookie(&c))
                                .map_err(|e| format!("CreateCookie failed: {e:?}"))
                        }
                    }

                    other => Err(format!("Unknown cookie operation: {other}")),
                };

                let _ = s.send(outcome);
                Ok(())
            }));

            if let Err(e) = manager.GetCookies(&HSTRING::from(url.as_str()), &handler) {
                cookie_op_failed(&tx_outer, format!("GetCookies call failed: {e:?}"));
            }
        }
    })
    .map_err(|e| format!("with_webview error: {e}"))?;

    rx.await.map_err(|_| "Cookie mutate channel closed".to_string())?
}

#[tauri::command]
pub async fn browser_eval_inspector(
    app: AppHandle,
    tab_id: String,
    inspector_type: String,
) -> Result<(), String> {
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, tab_id, inspector_type);
        return Err("Inspector requires WebView2".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        let label = webview_label_for_tab(&tab_id);
        let wv = find_tab_webview(&app, &label)
            .ok_or_else(|| format!("No webview for tab {}", tab_id))?;

        // Cookies come from the native cookie manager, not injected JS — see
        // `read_cookies`. Same event contract, so the frontend is unaffected.
        if inspector_type == "cookies" {
            let data = read_cookies(&wv).await?;
            return app
                .emit(
                    "xevo://inspector-data",
                    serde_json::json!({
                        "tabId": tab_id,
                        "dataType": inspector_type,
                        "data": data,
                    }),
                )
                .map_err(|e| e.to_string());
        }

        let script = match inspector_type.as_str() {
            "meta" => include_str!("scripts/meta_scrape.js").to_string(),

            "localStorage" | "sessionStorage" => {
                let store = if inspector_type == "localStorage" {
                    "localStorage"
                } else {
                    "sessionStorage"
                };
                format!(
                    r#"(function() {{
  try {{
    var store = window.{};
    var items = [];
    var totalSize = 0;
    for (var i = 0; i < store.length; i++) {{
      var key = store.key(i);
      var value = store.getItem(key) || '';
      totalSize += key.length + value.length;
      items.push({{ key: key, value: value }});
    }}
    return {{ items: items, totalSize: totalSize, url: location.href }};
  }} catch(e) {{
    return {{ items: [], totalSize: 0, url: location.href, error: String(e) }};
  }}
}})()"#,
                    store
                )
            }

            _ => return Err(format!("Unknown inspector type: {}", inspector_type)),
        };

        let data = eval_json(&wv, script).await?;
        app.emit(
            "xevo://inspector-data",
            serde_json::json!({
                "tabId": tab_id,
                "dataType": inspector_type,
                "data": data,
            }),
        )
        .map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub async fn inspector_mutate(
    app: AppHandle,
    tab_id: String,
    operation: String,
    params: serde_json::Value,
) -> Result<(), String> {
    let label = webview_label_for_tab(&tab_id);
    let wv = find_tab_webview(&app, &label)
        .ok_or_else(|| format!("No webview for tab {}", tab_id))?;

    #[cfg(target_os = "windows")]
    if matches!(operation.as_str(), "set-cookie" | "delete-cookie" | "clear-cookies") {
        return mutate_cookies(&wv, operation, params).await;
    }

    let script = match operation.as_str() {
        "set-storage" => {
            let store = params["storeType"].as_str().unwrap_or("localStorage");
            let key = js_string_literal(params["key"].as_str().unwrap_or(""));
            let value = js_string_literal(params["value"].as_str().unwrap_or(""));
            let store_var = if store == "sessionStorage" {
                "sessionStorage"
            } else {
                "localStorage"
            };
            format!("window.{}.setItem({}, {});", store_var, key, value)
        }
        "delete-storage" => {
            let store = params["storeType"].as_str().unwrap_or("localStorage");
            let key = js_string_literal(params["key"].as_str().unwrap_or(""));
            let store_var = if store == "sessionStorage" {
                "sessionStorage"
            } else {
                "localStorage"
            };
            format!("window.{}.removeItem({});", store_var, key)
        }
        "clear-storage" => {
            let store = params["storeType"].as_str().unwrap_or("localStorage");
            let store_var = if store == "sessionStorage" {
                "sessionStorage"
            } else {
                "localStorage"
            };
            format!("window.{}.clear();", store_var)
        }
        _ => return Err(format!("Unknown mutation operation: {}", operation)),
    };

    wv.eval(&script).map_err(|e| e.to_string())
}
