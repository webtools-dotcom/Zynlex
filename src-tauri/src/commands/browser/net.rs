use super::pwstr_to_string;
use crate::zynlex_log;
use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicI32, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
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

/// A canned response for requests matching `pattern` (+ `method`). First
/// enabled match wins. Served from the WebResourceRequested handler via
/// `SetResponse`, so the request never reaches the network.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MockRule {
    pub pattern: String,
    /// Empty or `*` matches any method.
    #[serde(default)]
    pub method: String,
    pub status: u16,
    #[serde(default)]
    pub content_type: String,
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub delay_ms: u64,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

// Keyed by tabId, same reasoning as HEADER_RULES.
static MOCK_RULES: OnceLock<Mutex<HashMap<String, Vec<MockRule>>>> = OnceLock::new();

fn mock_rules() -> &'static Mutex<HashMap<String, Vec<MockRule>>> {
    MOCK_RULES.get_or_init(|| Mutex::new(HashMap::new()))
}

/// First enabled rule matching `method` + `uri`. A blank or bare-`*` pattern
/// never matches: unlike a header rule, a catch-all mock replaces the page's
/// own document and every script and stylesheet with the canned body.
fn find_mock<'a>(rules: &'a [MockRule], method: &str, uri: &str) -> Option<&'a MockRule> {
    rules.iter().find(|r| {
        let pattern = r.pattern.trim();
        r.enabled
            && !pattern.is_empty()
            && pattern != "*"
            && (r.method.is_empty() || r.method == "*" || r.method.eq_ignore_ascii_case(method))
            && url_matches(pattern, uri)
    })
}

fn resource_type_name(context: i32) -> &'static str {
    match context {
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
        _ => "other",
    }
}

/// Reads one request header, `None` when absent.
#[cfg(windows)]
unsafe fn request_header(
    request: &webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2WebResourceRequest,
    name: &str,
) -> Option<String> {
    let headers = request.Headers().ok()?;
    let mut value = windows::core::PWSTR::null();
    headers
        .GetHeader(&windows::core::HSTRING::from(name), &mut value)
        .ok()?;
    if value.is_null() {
        None
    } else {
        value.to_string().ok()
    }
}

/// `ICoreWebView2Deferral` is a COM pointer and not `Send`, but completing it
/// is only ever done back on the UI thread (via `run_on_main_thread`) — the
/// worker thread just carries it across the sleep.
#[cfg(windows)]
struct SendDeferral(webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Deferral);
#[cfg(windows)]
unsafe impl Send for SendDeferral {}
#[cfg(windows)]
impl SendDeferral {
    fn complete(self) {
        let _ = unsafe { self.0.Complete() };
    }
}

/// Answer the request from `tab_id`'s mock rules, if one matches. Returns true
/// when the request was served here.
///
/// Also answers the CORS preflight for a mocked cross-origin request: the page
/// at localhost:3000 calling a mocked localhost:8000 API would otherwise have
/// its preflight go to a server that may not exist (or not allow the origin),
/// and the real request would never be sent to be mocked.
#[cfg(windows)]
unsafe fn try_mock(
    app: &tauri::AppHandle,
    env: &webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Environment,
    args: &webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2WebResourceRequestedEventArgs,
    request: &webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2WebResourceRequest,
    tab_id: &str,
    uri: &str,
) -> bool {
    use webview2_com::Microsoft::Web::WebView2::Win32::COREWEBVIEW2_WEB_RESOURCE_CONTEXT;
    use windows::core::HSTRING;
    use windows::Win32::UI::Shell::SHCreateMemStream;

    let rules: Vec<MockRule> = match mock_rules().lock() {
        Ok(m) => match m.get(tab_id) {
            Some(v) if !v.is_empty() => v.clone(),
            _ => return false,
        },
        Err(_) => return false,
    };

    let method = pwstr_to_string(|p| {
        let _ = request.Method(p);
    });
    let origin = request_header(request, "Origin");
    let cors = |extra: &str| {
        match &origin {
        Some(o) => format!(
            "Access-Control-Allow-Origin: {o}\r\nAccess-Control-Allow-Credentials: true\r\nVary: Origin\r\n{extra}"
        ),
        None => String::new(),
    }
    };

    if method.eq_ignore_ascii_case("OPTIONS") {
        if let Some(wanted) = request_header(request, "Access-Control-Request-Method") {
            if find_mock(&rules, &wanted, uri).is_some() {
                let allow_headers = request_header(request, "Access-Control-Request-Headers")
                    .map(|h| format!("Access-Control-Allow-Headers: {h}\r\n"))
                    .unwrap_or_default();
                let headers = cors(&format!(
                    "Access-Control-Allow-Methods: {wanted}\r\n{allow_headers}Access-Control-Max-Age: 600\r\nX-Zynlex-Mock: 1\r\n"
                ));
                if let Ok(resp) = env.CreateWebResourceResponse(
                    None,
                    204,
                    &HSTRING::from("No Content"),
                    &HSTRING::from(headers),
                ) {
                    return args.SetResponse(&resp).is_ok();
                }
            }
        }
    }

    let Some(rule) = find_mock(&rules, &method, uri) else {
        return false;
    };

    let content_type = if rule.content_type.trim().is_empty() {
        "application/json"
    } else {
        rule.content_type.trim()
    };
    let headers = format!(
        "Content-Type: {content_type}\r\n{}X-Zynlex-Mock: 1\r\n",
        cors("Access-Control-Expose-Headers: *\r\n")
    );
    let reason = reqwest::StatusCode::from_u16(rule.status)
        .ok()
        .and_then(|s| s.canonical_reason())
        .unwrap_or("");
    let stream = if rule.body.is_empty() {
        None
    } else {
        SHCreateMemStream(Some(rule.body.as_bytes()))
    };
    let resp = match env.CreateWebResourceResponse(
        stream.as_ref(),
        rule.status as i32,
        &HSTRING::from(reason),
        &HSTRING::from(headers.as_str()),
    ) {
        Ok(r) => r,
        Err(e) => {
            zynlex_log!("[zynlex] mock CreateWebResourceResponse failed: {e:?}");
            return false;
        }
    };
    if args.SetResponse(&resp).is_err() {
        return false;
    }

    // A delay holds the response back with a deferral, completed from the UI
    // thread once the sleep is over.
    if rule.delay_ms > 0 {
        if let Ok(deferral) = args.GetDeferral() {
            let deferral = SendDeferral(deferral);
            let app = app.clone();
            let ms = rule.delay_ms.min(60_000);
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(ms));
                let _ = app.run_on_main_thread(move || deferral.complete());
            });
        }
    }

    // The response handler skips X-Zynlex-Mock responses (if WebView2 raises
    // it at all for a SetResponse), so the log entry is emitted here.
    if NETWORK_CAPTURE_ACTIVE.load(Ordering::Relaxed) > 0 {
        let mut ctx = COREWEBVIEW2_WEB_RESOURCE_CONTEXT(0);
        let _ = args.ResourceContext(&mut ctx);
        let mut body = rule.body.clone();
        let truncated = body.len() > 65536;
        if truncated {
            let mut cut = 65536;
            while !body.is_char_boundary(cut) {
                cut -= 1;
            }
            body.truncate(cut);
        }
        let _ = app.emit(
            "browser://network-entry",
            serde_json::json!({
                "tabId": tab_id,
                "method": method,
                "url": uri,
                "statusCode": rule.status,
                "reasonPhrase": reason,
                "resourceType": resource_type_name(ctx.0),
                "durationMs": rule.delay_ms,
                "contentLength": rule.body.len(),
                "referrer": request_header(request, "Referer").unwrap_or_default(),
                "headers": [["Content-Type", content_type], ["X-Zynlex-Mock", "1"]],
                "body": body,
                "bodyTruncated": truncated,
                "mocked": true,
            }),
        );
    }
    true
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

    // Anchored, not greedily-leftmost. The segment before the first `*` is a
    // prefix and the segment after the last `*` is a suffix; only the ones in
    // between are "find the next occurrence". Searching for the final segment
    // instead of anchoring it meant `*a` failed against `abca` — it matched the
    // first `a`, then demanded the rest be empty — so a rule like
    // `*api.example.com` silently never fired on `staging.api.example.com`.
    let parts: Vec<&str> = pattern.split('*').filter(|p| !p.is_empty()).collect();
    if parts.is_empty() {
        // Pattern was nothing but wildcards.
        return true;
    }
    let anchored_start = !pattern.starts_with('*');
    let anchored_end = !pattern.ends_with('*');

    let mut rest = uri;

    if anchored_start {
        match rest.strip_prefix(parts[0]) {
            Some(r) => rest = r,
            None => return false,
        }
    }

    let mut middle: &[&str] = if anchored_start {
        &parts[1..]
    } else {
        &parts[..]
    };

    if anchored_end {
        if let Some((last, head)) = middle.split_last() {
            if !rest.ends_with(last) {
                return false;
            }
            // `ends_with` matched, so this is a valid char boundary.
            rest = &rest[..rest.len() - last.len()];
            middle = head;
        }
    }

    for part in middle {
        match rest.find(part) {
            Some(j) => rest = &rest[j + part.len()..],
            None => return false,
        }
    }
    true
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
    let _ = super::with_core(wv, "network capture", move |core| {
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

            if let Err(e) = core.AddWebResourceRequestedFilter(
                windows::core::w!("*"),
                COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL,
            ) {
                zynlex_log!("[zynlex] AddWebResourceRequestedFilter failed: {e:?}");
                return;
            }

            // Needed to build mock responses. A runtime too old for
            // ICoreWebView2_2 simply gets no mocking.
            let env = core
                .cast::<ICoreWebView2_2>()
                .and_then(|c| c.Environment())
                .ok();
            let app_req = app.clone();
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

                        if let Some(env) = &env {
                            if try_mock(&app_req, env, &args, &request, &tab_id_req, &uri) {
                                return Ok(());
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
                    let resource_type = resource_type_name(resource_context.0);

                    let now = Instant::now();
                    let meta_key = format!("{}:{}", tab_id_req, uri);
                    let store = NETWORK_REQUEST_META.get_or_init(|| Mutex::new(HashMap::new()));
                    if let Ok(mut map) = store.lock() {
                        map.entry(meta_key)
                            .or_default()
                            .push_back((now, resource_type.to_string()));

                        // Sweep on insert. A request that never produces a response —
                        // aborted fetch, abandoned navigation, WebSocket upgrade,
                        // blocked request — leaves its entry here forever, and the
                        // only other cleanup is a full wipe on tab close. Nothing
                        // legitimately waits a minute between request and response,
                        // so anything older than that is never going to be claimed.
                        if map.len() > 512 {
                            map.retain(|_, queue| {
                                queue.retain(|(t, _)| {
                                    now.duration_since(*t) < Duration::from_secs(60)
                                });
                                !queue.is_empty()
                            });
                        }
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
                    let referrer = request_header(&request, "Referer").unwrap_or_default();

                    let mut status_code: i32 = 0;
                    let _ = response.StatusCode(&mut status_code);

                    let reason_phrase = pwstr_to_string(|p| {
                        let _ = response.ReasonPhrase(p);
                    });

                    // A list, not a map: repeated headers are the point. Set-Cookie
                    // arrives once per cookie and a map showed only the last one.
                    let mut headers: Vec<(String, String)> = Vec::new();
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
                                        headers.push((n, v));
                                    }
                                }
                                let mut has_next = BOOL(0);
                                if iter.MoveNext(&mut has_next).is_err() || has_next == BOOL(0) {
                                    break;
                                }
                            }
                        }
                    }

                    // Mocked responses were already logged by try_mock.
                    if headers
                        .iter()
                        .any(|(k, _)| k.eq_ignore_ascii_case("x-zynlex-mock"))
                    {
                        return Ok(());
                    }

                    // Case-insensitive: WebView2 hands back whatever casing the
                    // server sent, so matching two hardcoded spellings missed
                    // `Content-length` and showed no size at all.
                    let content_length: i64 = headers
                        .iter()
                        .find(|(k, _)| k.eq_ignore_ascii_case("content-length"))
                        .and_then(|(_, v)| v.parse().ok())
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
                    let binary = matches!(resource_type.as_str(), "image" | "media" | "font");
                    let emit = move |body: String, body_truncated: bool| {
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
                                "body": body,
                                "bodyTruncated": body_truncated,
                            }),
                        );
                    };

                    // Binary bodies are never shown — the panel would render them as
                    // lossy-UTF-8 garbage — so don't pay for a GetContent read (which
                    // buffers the whole response) or ship 64 KB of noise over IPC.
                    if binary {
                        emit(String::new(), false);
                        return Ok(());
                    }

                    let body_handler = WebResourceResponseViewGetContentCompletedHandler::create(
                        Box::new(move |_errorcode, stream| {
                            let mut body_bytes: Vec<u8> = Vec::new();
                            let mut body_truncated = false;
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
                                        body_truncated = true;
                                        break;
                                    }
                                }
                            }

                            emit(
                                String::from_utf8_lossy(&body_bytes).into_owned(),
                                body_truncated,
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
pub async fn browser_set_mock_rules(
    rules_by_tab: HashMap<String, Vec<MockRule>>,
) -> Result<(), String> {
    *mock_rules().lock().map_err(|e| e.to_string())? = rules_by_tab;
    Ok(())
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
    use super::{find_mock, url_matches, MockRule};

    fn mock(pattern: &str, method: &str) -> MockRule {
        MockRule {
            pattern: pattern.into(),
            method: method.into(),
            status: 200,
            content_type: String::new(),
            body: String::new(),
            delay_ms: 0,
            enabled: true,
        }
    }

    #[test]
    fn mock_matching() {
        let rules = vec![mock("localhost:8000/api/users", "GET"), mock("*/api/*", "")];
        // Method-specific rule wins when it comes first.
        assert_eq!(
            find_mock(&rules, "get", "http://localhost:8000/api/users").map(|r| &r.method[..]),
            Some("GET")
        );
        // Falls through to the any-method rule.
        assert_eq!(
            find_mock(&rules, "POST", "http://localhost:8000/api/users").map(|r| &r.method[..]),
            Some("")
        );
        assert!(find_mock(&rules, "GET", "http://localhost:8000/index.html").is_none());

        // A catch-all would replace the page itself — never matches.
        assert!(find_mock(&[mock("", ""), mock(" * ", "")], "GET", "http://x/").is_none());

        let mut off = mock("*/api/*", "");
        off.enabled = false;
        assert!(find_mock(&[off], "GET", "http://x/api/y").is_none());
    }

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

    #[test]
    fn glob_anchors_the_last_segment() {
        // The bug: the final segment was searched for rather than anchored, so a
        // pattern matched its own first occurrence and then demanded the rest be
        // empty.
        assert!(url_matches("*a", "abca"));
        assert!(url_matches("*/api", "http://x/api/api"));
        assert!(url_matches(
            "*api.example.com*",
            "https://staging.api.example.com/v1"
        ));

        // Anchored at both ends.
        assert!(url_matches("a*c", "abc"));
        assert!(url_matches("a*c", "abxyzc"));
        assert!(!url_matches("a*c", "abcd"));

        // The wildcard may match nothing at all.
        assert!(url_matches("a*a", "aa"));
        assert!(!url_matches("a*a", "a"));

        // Nothing but wildcards matches everything.
        assert!(url_matches("**", "http://localhost:3000/"));

        // Middle segments still have to appear in order.
        assert!(url_matches("*/api/*/users", "http://x/api/v2/users"));
        assert!(!url_matches("*/api/*/users", "http://x/users/v2/api"));
    }
}
