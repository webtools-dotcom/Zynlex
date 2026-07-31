use super::pwstr_to_string;
use crate::zynlex_log;
use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicI32, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Instant;
use tauri::Emitter;

/// Gates the network-capture work inside the WebResourceRequested/Received
/// handlers. The handlers stay registered per tab, but do capture work only
/// while the Network panel is mounted — incremented on mount, decremented on
/// unmount (`browser_set_network_capture`). A ref-count, not a bool: the panel
/// remounts on every tab switch (key={activeTabId}), so mount/unmount fire as
/// two independent, unordered async IPC calls — a bool could land false-after-true
/// and get stuck off. Increment/decrement commute regardless of arrival order.
/// Header-rule injection is NOT gated by this: it is a separate always-on
/// feature sharing the request handler.
static NETWORK_CAPTURE_ACTIVE: AtomicI32 = AtomicI32::new(0);

/// Per-request start time + resource type, keyed by "{tabId}:{uri}".
type RequestMetaMap = HashMap<String, VecDeque<(Instant, String)>>;

// Keyed by "{tabId}:{uri}". A VecDeque (not a single slot) because two concurrent
// requests to the same URL are common (duplicate fetches, polling) — request order
// is preserved so the response handler pairs each response with its own request's
// start time via FIFO pop, instead of two concurrent requests overwriting each
// other's timing. Entries are popped on response and swept on tab close
// (browser_close_tab) so cancelled/aborted requests and closed tabs don't leak.
pub(super) static NETWORK_REQUEST_META: OnceLock<Mutex<RequestMetaMap>> = OnceLock::new();

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct HeaderRule {
    #[serde(default)]
    pub pattern: String,
    pub name: String,
    pub value: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

fn default_true() -> bool {
    true
}

// Keyed by tabId — each tab only ever sees its own workspace's rules. The
// frontend resolves workspace -> rules and hands us a finished per-tab map,
// so switching the active workspace can never leak another workspace's
// still-alive background tabs into the wrong rule set.
static HEADER_RULES: OnceLock<Mutex<HashMap<String, Vec<HeaderRule>>>> = OnceLock::new();

fn header_rules() -> &'static Mutex<HashMap<String, Vec<HeaderRule>>> {
    HEADER_RULES.get_or_init(|| Mutex::new(HashMap::new()))
}

fn strip_scheme(s: &str) -> &str {
    match s.find("://") {
        Some(i) => &s[i + 3..],
        None => s,
    }
}

/// Case-insensitive match, anchored to the URL with scheme stripped so a
/// pattern can't match a substring buried in a foreign origin's query string
/// (e.g. pattern `localhost:5000` must not match `evil.com/?next=localhost:5000`).
/// A wildcard-free pattern is a prefix match (the common case: "this host").
/// `*` acts as a glob wildcard when present.
fn url_matches(pattern: &str, uri: &str) -> bool {
    let pattern = pattern.trim();
    if pattern.is_empty() || pattern == "*" {
        return true;
    }
    let (pattern, uri) = (pattern.to_lowercase(), uri.to_lowercase());
    let (pattern, uri) = (strip_scheme(&pattern), strip_scheme(&uri));

    if !pattern.contains('*') {
        return uri.starts_with(pattern);
    }

    let mut rest = uri;
    let mut trailing_star = false;
    for (i, part) in pattern.split('*').enumerate() {
        if part.is_empty() {
            trailing_star = true;
            continue;
        }
        trailing_star = false;
        if i == 0 {
            match rest.strip_prefix(part) {
                Some(r) => rest = r,
                None => return false,
            }
        } else {
            match rest.find(part) {
                Some(j) => rest = &rest[j + part.len()..],
                None => return false,
            }
        }
    }
    trailing_star || rest.is_empty()
}

// ─── Network Capture ──────────────────────────────────────────────

/// Toggled by the Network panel on mount/unmount. See `NETWORK_CAPTURE_ACTIVE`.
#[tauri::command]
pub fn browser_set_network_capture(active: bool) {
    if active {
        NETWORK_CAPTURE_ACTIVE.fetch_add(1, Ordering::Relaxed);
    } else {
        NETWORK_CAPTURE_ACTIVE.fetch_sub(1, Ordering::Relaxed);
    }
}

pub fn register_webview_network_capture(wv: &tauri::Webview, app: &tauri::AppHandle, tab_id: &str) {
    let app = app.clone();
    let tab_id = tab_id.to_string();
    let _ = wv.with_webview(move |platform| {
        #[cfg(windows)]
        unsafe {
            use webview2_com::Microsoft::Web::WebView2::Win32::{
                ICoreWebView2_2, COREWEBVIEW2_WEB_RESOURCE_CONTEXT,
                COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL,
            };
            use webview2_com::WebResourceRequestedEventHandler;
            use webview2_com::WebResourceResponseReceivedEventHandler;
            use webview2_com::WebResourceResponseViewGetContentCompletedHandler;
            use windows::core::HSTRING;
            use windows::core::PWSTR;
            use windows_core::Interface;
            use windows_core::BOOL;

            let core = match platform.controller().CoreWebView2() {
                Ok(core) => core,
                Err(e) => {
                    zynlex_log!("[zynlex] CoreWebView2() failed for network capture: {e:?}");
                    return;
                }
            };

            if let Err(e) = core.AddWebResourceRequestedFilter(
                windows::core::w!("*"),
                COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL,
            ) {
                zynlex_log!("[zynlex] AddWebResourceRequestedFilter failed: {e:?}");
                return;
            }

            let tab_id_req = tab_id.clone();
            let req_handler =
                WebResourceRequestedEventHandler::create(Box::new(move |_webview, args| {
                    let args = match args {
                        Some(a) => a,
                        None => return Ok(()),
                    };
                    let request = match args.Request() {
                        Ok(r) => r,
                        Err(_) => return Ok(()),
                    };

                    let uri = pwstr_to_string(|p| {
                        let _ = request.Uri(p);
                    });

                    // ponytail: SetHeader before Method()/other COM reads.
                    // Never inject into Tauri's own IPC/asset traffic — a `*` rule would break it.
                    if !uri.starts_with("http://ipc.localhost")
                        && !uri.starts_with("tauri://localhost")
                    {
                        // Clone out of the lock — don't hold a mutex across COM calls on the UI thread.
                        let rules: Vec<HeaderRule> = header_rules()
                            .lock()
                            .map(|m| {
                                m.get(&tab_id_req)
                                    .map(|v| v.iter().filter(|r| r.enabled).cloned().collect())
                                    .unwrap_or_default()
                            })
                            .unwrap_or_default();

                        if !rules.is_empty() {
                            if let Ok(req_headers) = request.Headers() {
                                for rule in &rules {
                                    if url_matches(&rule.pattern, &uri) {
                                        let _ = req_headers.SetHeader(
                                            &HSTRING::from(&rule.name),
                                            &HSTRING::from(&rule.value),
                                        );
                                    }
                                }
                            }
                        }
                    }

                    // Network-capture work below is rent the Network panel pays for
                    // only while it's open — skip it entirely otherwise.
                    if NETWORK_CAPTURE_ACTIVE.load(Ordering::Relaxed) <= 0 {
                        return Ok(());
                    }

                    let mut resource_context = COREWEBVIEW2_WEB_RESOURCE_CONTEXT(0);
                    let _ = args.ResourceContext(&mut resource_context);
                    let resource_type = match resource_context.0 {
                        1 => "document",
                        2 => "stylesheet",
                        3 => "image",
                        4 => "media",
                        5 => "font",
                        6 => "script",
                        7 => "xhr",
                        8 => "fetch",
                        9 => "texttrack",
                        10 => "eventsource",
                        11 => "websocket",
                        12 => "manifest",
                        13 => "signedexchange",
                        14 => "ping",
                        15 => "cspviolationreport",
                        16 => "other",
                        _ => "other",
                    };

                    let now = Instant::now();
                    let meta_key = format!("{}:{}", tab_id_req, uri);
                    let store = NETWORK_REQUEST_META.get_or_init(|| Mutex::new(HashMap::new()));
                    if let Ok(mut map) = store.lock() {
                        map.entry(meta_key)
                            .or_default()
                            .push_back((now, resource_type.to_string()));
                    }

                    Ok(())
                }));

            let mut token: i64 = 0;
            match core.add_WebResourceRequested(&req_handler, &mut token) {
                Ok(()) => {
                    zynlex_log!("[ZYNLEX] WebResourceRequested handler registered — token={token}")
                }
                Err(e) => zynlex_log!("[ZYNLEX] WebResourceRequested handler FAILED: {e:?}"),
            }

            let core2: ICoreWebView2_2 = match core.cast() {
                Ok(c) => c,
                Err(e) => {
                    zynlex_log!("[zynlex] ICoreWebView2_2 cast failed: {e:?}");
                    return;
                }
            };

            let app_resp = app.clone();
            let tab_id_resp = tab_id.clone();
            let resp_handler =
                WebResourceResponseReceivedEventHandler::create(Box::new(move |_webview, args| {
                    let args = match args {
                        Some(a) => a,
                        None => return Ok(()),
                    };

                    let request = match args.Request() {
                        Ok(r) => r,
                        Err(_) => return Ok(()),
                    };
                    let response = match args.Response() {
                        Ok(r) => r,
                        Err(_) => return Ok(()),
                    };

                    let method = pwstr_to_string(|p| {
                        let _ = request.Method(p);
                    });
                    let uri = pwstr_to_string(|p| {
                        let _ = request.Uri(p);
                    });

                    // Skip internal Tauri IPC calls — not useful in dev tools
                    if uri.starts_with("http://ipc.localhost")
                        || uri.starts_with("tauri://localhost")
                    {
                        return Ok(());
                    }

                    // The expensive part of this handler — header iteration and a full
                    // GetContent body read — is rent the Network panel pays for only
                    // while it's open.
                    if NETWORK_CAPTURE_ACTIVE.load(Ordering::Relaxed) <= 0 {
                        return Ok(());
                    }

                    // ICoreWebView2WebResourceRequest exposes no initiator/originator —
                    // only the request headers. So the panel's column is the Referer
                    // header, labelled "Referrer", not a true initiator chain.
                    let referrer = request
                        .Headers()
                        .ok()
                        .and_then(|h| {
                            let mut value = PWSTR::null();
                            h.GetHeader(&HSTRING::from("Referer"), &mut value).ok()?;
                            if value.is_null() {
                                None
                            } else {
                                value.to_string().ok()
                            }
                        })
                        .unwrap_or_default();

                    let mut status_code: i32 = 0;
                    let _ = response.StatusCode(&mut status_code);

                    let reason_phrase = pwstr_to_string(|p| {
                        let _ = response.ReasonPhrase(p);
                    });

                    let mut headers: HashMap<String, String> = HashMap::new();
                    if let Ok(headers_obj) = response.Headers() {
                        if let Ok(iter) = headers_obj.GetIterator() {
                            let mut has_current = BOOL(0);
                            loop {
                                if iter.HasCurrentHeader(&mut has_current).is_err()
                                    || has_current == BOOL(0)
                                {
                                    break;
                                }
                                let mut name = PWSTR::null();
                                let mut value = PWSTR::null();
                                if iter.GetCurrentHeader(&mut name, &mut value).is_ok()
                                    && !name.is_null()
                                    && !value.is_null()
                                {
                                    if let (Ok(n), Ok(v)) = (name.to_string(), value.to_string()) {
                                        headers.insert(n, v);
                                    }
                                }
                                let mut has_next = BOOL(0);
                                if iter.MoveNext(&mut has_next).is_err() || has_next == BOOL(0) {
                                    break;
                                }
                            }
                        }
                    }

                    let content_length: i64 = headers
                        .get("Content-Length")
                        .or_else(|| headers.get("content-length"))
                        .and_then(|v| v.parse().ok())
                        .unwrap_or(-1);

                    let now = Instant::now();
                    let meta_key = format!("{}:{}", tab_id_resp, uri);
                    let (duration_ms, resource_type) =
                        if let Some(store) = NETWORK_REQUEST_META.get() {
                            if let Ok(mut map) = store.lock() {
                                // FIFO pop — pairs with the oldest still-pending request to this
                                // exact URL, so concurrent same-URL requests don't clobber timing.
                                let popped = map.get_mut(&meta_key).and_then(|q| q.pop_front());
                                if map.get(&meta_key).is_some_and(|q| q.is_empty()) {
                                    map.remove(&meta_key);
                                }
                                match popped {
                                    Some((req_time, rt)) => {
                                        let dur = now.duration_since(req_time);
                                        (dur.as_millis() as u64, rt)
                                    }
                                    None => (0, "other".to_string()),
                                }
                            } else {
                                (0, "other".to_string())
                            }
                        } else {
                            (0, "other".to_string())
                        };

                    let app_body = app_resp.clone();
                    let tab_id_body = tab_id_resp.clone();
                    let body_handler = WebResourceResponseViewGetContentCompletedHandler::create(
                        Box::new(move |_errorcode, stream| {
                            let mut body_bytes: Vec<u8> = Vec::new();
                            if let Some(stream) = stream {
                                let mut buffer = vec![0u8; 8192];
                                loop {
                                    let mut bytes_read: u32 = 0;
                                    let hr = stream.Read(
                                        buffer.as_mut_ptr() as *mut _,
                                        buffer.len() as u32,
                                        Some(&mut bytes_read),
                                    );
                                    if !hr.is_ok() || bytes_read == 0 {
                                        break;
                                    }
                                    body_bytes.extend_from_slice(&buffer[..bytes_read as usize]);
                                    if body_bytes.len() > 65536 {
                                        body_bytes.truncate(65536);
                                        break;
                                    }
                                }
                            }

                            let body_str = String::from_utf8_lossy(&body_bytes).into_owned();
                            let _ = app_body.emit(
                                "browser://network-entry",
                                serde_json::json!({
                                    "tabId": tab_id_body,
                                    "method": method,
                                    "url": uri,
                                    "statusCode": status_code,
                                    "reasonPhrase": reason_phrase,
                                    "resourceType": resource_type,
                                    "durationMs": duration_ms,
                                    "contentLength": content_length,
                                    "referrer": referrer,
                                    "headers": headers,
                                    "body": body_str,
                                }),
                            );
                            Ok(())
                        }),
                    );

                    let _ = response.GetContent(&body_handler);
                    Ok(())
                }));

            let mut resp_token: i64 = 0;
            let _ = core2.add_WebResourceResponseReceived(&resp_handler, &mut resp_token);
        }
    });
}

#[tauri::command]
pub async fn browser_set_header_rules(
    rules_by_tab: HashMap<String, Vec<HeaderRule>>,
) -> Result<(), String> {
    *header_rules().lock().map_err(|e| e.to_string())? = rules_by_tab;
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::url_matches;

    #[test]
    fn glob_matching() {
        // the exact bug this fixes: the UI's default pattern is "*"
        assert!(url_matches("*", "http://localhost:3000/"));
        assert!(url_matches("", "http://localhost:3000/"));
        assert!(url_matches("  *  ", "http://localhost:3000/"));

        assert!(url_matches(
            "localhost:3000/*",
            "http://localhost:3000/api/x"
        ));
        assert!(url_matches("*/api/*", "http://localhost:3000/api/x"));
        assert!(url_matches("HTTP://LOCALHOST*", "http://localhost:3000/"));
        assert!(url_matches(
            "http://localhost:3000/api",
            "http://localhost:3000/api"
        ));
        // wildcard-free patterns are prefix matches — "this host" is the common intent
        assert!(url_matches(
            "http://localhost:3000/api",
            "http://localhost:3000/api/x"
        ));
        assert!(url_matches("localhost:5000", "http://localhost:5000/api"));

        assert!(!url_matches("localhost:3000/*", "http://example.com/"));
        assert!(!url_matches("*/api", "http://localhost:3000/api/x"));

        // the leak this closes: a pattern must not match a substring buried
        // in a foreign origin's query string
        assert!(!url_matches(
            "localhost:5000",
            "https://evil.com/?next=localhost:5000"
        ));
    }
}
