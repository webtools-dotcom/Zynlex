use tauri::webview::{DownloadEvent, PageLoadEvent, WebviewBuilder};
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Position, Size, WebviewUrl};
use std::sync::{Mutex, OnceLock};
use std::sync::atomic::{AtomicI32, Ordering};
use std::collections::{HashMap, VecDeque};
use std::time::Instant;

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

use crate::BrowserState;
use crate::xevo_log;
use tauri_plugin_opener::OpenerExt;

// Keyed by "{tabId}:{uri}". A VecDeque (not a single slot) because two concurrent
// requests to the same URL are common (duplicate fetches, polling) — request order
// is preserved so the response handler pairs each response with its own request's
// start time via FIFO pop, instead of two concurrent requests overwriting each
// other's timing. Entries are popped on response and swept on tab close
// (browser_close_tab) so cancelled/aborted requests and closed tabs don't leak.
static NETWORK_REQUEST_META: OnceLock<Mutex<HashMap<String, VecDeque<(Instant, String)>>>> = OnceLock::new();

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct HeaderRule {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub pattern: String,
    pub name: String,
    pub value: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

fn default_true() -> bool { true }

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


// ─── Injected Scripts ────────────────────────────────────────────────

// ── CHROME_FEATURES_SCRIPT: find-in-page + bookmark shortcut + external link handler
const CHROME_FEATURES_SCRIPT: &str = r##"
// ── FIND IN PAGE ─────────────────────────────────────────────────
(function() {
  function reportFindResult(active, total) {
    try {
      if (window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke) {
        window.__TAURI_INTERNALS__.invoke("browser_find_callback", {
          activeMatch: active,
          totalMatches: total,
          finalUpdate: true
        }).catch(function() {});
      }
    } catch (e) {}
  }

  function clearFind() {
    var marks = document.querySelectorAll("mark.xevo-find-hit");
    for (var i = 0; i < marks.length; i++) {
      var mark = marks[i];
      var parent = mark.parentNode;
      if (!parent) continue;
      while (mark.firstChild) {
        parent.insertBefore(mark.firstChild, mark);
      }
      parent.removeChild(mark);
    }
    if (document.body) document.body.normalize();
  }

  function findAll(query) {
    if (!query) return [];
    var q = query.toLowerCase();
    var results = [];
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: function(node) {
        var p = node.parentNode;
        if (!p) return NodeFilter.FILTER_REJECT;
        var tag = p.nodeName ? p.nodeName.toLowerCase() : "";
        if (tag === "script" || tag === "style" || tag === "noscript") {
          return NodeFilter.FILTER_REJECT;
        }
        if (p.closest && p.closest("mark.xevo-find-hit")) {
          return NodeFilter.FILTER_REJECT;
        }
        if (!node.nodeValue || node.nodeValue.toLowerCase().indexOf(query) === -1) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var n;
    while ((n = walker.nextNode())) {
      var t = n.nodeValue;
      var lt = t.toLowerCase();
      var idx = 0;
      while ((idx = lt.indexOf(q, idx)) !== -1) {
        results.push({ node: n, offset: idx, length: query.length });
        idx += q.length;
      }
    }
    return results;
  }

  function highlightMatches(matches) {
    for (var i = 0; i < matches.length; i++) {
      var m = matches[i];
      var range = document.createRange();
      try {
        range.setStart(m.node, m.offset);
        range.setEnd(m.node, m.offset + m.length);
        var mark = document.createElement("mark");
        mark.className = "xevo-find-hit";
        mark.style.backgroundColor = "#fde047";
        mark.style.color = "#000";
        mark.style.padding = "0";
        range.surroundContents(mark);
      } catch (e) {}
    }
  }

  window.__xevoFind = function(query, forward) {
    clearFind();
    if (!query) {
      window.__xevoFindState = { query: "", matches: [], currentIndex: -1 };
      reportFindResult(0, 0);
      return;
    }
    var matches = findAll(query);
    highlightMatches(matches);
    var currentIndex = matches.length > 0 ? 0 : -1;
    window.__xevoFindState = {
      query: query,
      matches: matches,
      currentIndex: currentIndex
    };
    if (currentIndex >= 0) {
      scrollToCurrent();
    }
    reportFindResult(currentIndex >= 0 ? 1 : 0, matches.length);
  };

  window.__xevoFindNext = function(forward) {
    var s = window.__xevoFindState;
    if (!s || s.matches.length === 0) {
      if (s && s.query) {
        window.__xevoFind(s.query, forward);
      }
      return;
    }
    if (forward) {
      s.currentIndex = (s.currentIndex + 1) % s.matches.length;
    } else {
      s.currentIndex = (s.currentIndex - 1 + s.matches.length) % s.matches.length;
    }
    scrollToCurrent();
    reportFindResult(s.currentIndex + 1, s.matches.length);
  };

  window.__xevoClearFind = function() {
    clearFind();
    window.__xevoFindState = { query: "", matches: [], currentIndex: -1 };
    reportFindResult(0, 0);
  };

  function scrollToCurrent() {
    var s = window.__xevoFindState;
    if (!s || s.currentIndex < 0) return;
    var marks = document.querySelectorAll("mark.xevo-find-hit");
    var active = marks[s.currentIndex];
    if (active) {
      for (var i = 0; i < marks.length; i++) {
        marks[i].style.backgroundColor = "#fde047";
      }
      active.style.backgroundColor = "#f59e0b";
      active.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  document.addEventListener("DOMContentLoaded", function() {
    window.__xevoFindState = { query: "", matches: [], currentIndex: -1 };
  });
})();

// ── BOOKMARK SHORTCUT ────────────────────────────────────────────
(function() {
  function isEditableTarget(t) {
    if (!t) return false;
    var tag = (t.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return true;
    if (t.isContentEditable) return true;
    return false;
  }

  function onKeyDown(e) {
    var mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    if (e.shiftKey || e.altKey) return;
    if (e.key !== "d" && e.key !== "D") return;
    if (isEditableTarget(e.target)) return;

    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();

    try {
      if (window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke) {
        window.__TAURI_INTERNALS__.invoke("browser_bookmark_request")
          .catch(function() {});
      }
    } catch (err) {}
  }

  if (!window.__xevoBookmarkReady) {
    window.__xevoBookmarkReady = true;
    document.addEventListener("keydown", onKeyDown, true);
  }
})();
"##;

// ── JSON_VIEWER_SCRIPT: collapsible JSON viewer for application/json pages.
// Separated from the network script so it only needs to be parsed on JSON pages.
const JSON_VIEWER_SCRIPT: &str = r##"
(function() {
  function xevoRenderJson() {
    try {
      var ct = (document.contentType || "").toLowerCase();
      var isJsonPage = false;
      if (ct.indexOf("application/json") !== -1 || ct.indexOf("text/json") !== -1) {
        isJsonPage = true;
      } else if (ct === "text/html" || ct === "") {
        var headChildren = (document.head && document.head.children) ? document.head.children.length : 0;
        if (headChildren > 0) {
          return;
        }
        var text = (document.body && document.body.innerText) ? document.body.innerText.trim() : "";
        if (text.charAt(0) === "{" || text.charAt(0) === "[") {
          try { JSON.parse(text); isJsonPage = true; }
          catch (e) { isJsonPage = false; }
        }
      }
      if (!isJsonPage) return;

      var raw = (document.body && document.body.innerText) ? document.body.innerText : "";
      var parsed;
      try { parsed = JSON.parse(raw); }
      catch (e) { return; }

      function esc(s) {
        return String(s)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;");
      }
      function escAttr(s) {
        return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
      }
      function renderValue(val, depth) {
        if (val === null) return 'null';
        if (typeof val === "boolean") return String(val);
        if (typeof val === "number") return String(val);
        if (typeof val === "string") {
          var s = esc(val);
          if (/^https?:\/\//i.test(val)) {
            return '<a href="' + escAttr(val) + '">"' + s + '"</a>';
          }
          return '"' + s + '"';
        }
        if (Array.isArray(val)) {
          if (val.length === 0) return '[]';
          if (depth > 8) return '[deep array]';
          var openTag = depth < 1 ? ' open' : '';
          var max = Math.min(val.length, 500);
          var out = '<details' + openTag + '><summary><span class="xj-toggle">\u25BE</span>[</summary>';
          for (var i = 0; i < max; i++) {
            out += '\n' + '  '.repeat(depth) + renderValue(val[i], depth + 1);
            if (i < val.length - 1) out += ',';
          }
          if (val.length > 500) {
            out += '\n' + '  '.repeat(depth) + '...' + (val.length - 500) + ' more items';
          }
          out += ']</details>';
          return out;
        }
        if (typeof val === "object") {
          var keys = Object.keys(val);
          if (keys.length === 0) return '{}';
          if (depth > 8) return '{deep object}';
          var openTag2 = depth < 1 ? ' open' : '';
          var max2 = Math.min(keys.length, 500);
          var out2 = '<details' + openTag2 + '><summary><span class="xj-toggle">\u25BE</span>{</summary>';
          for (var j = 0; j < max2; j++) {
            out2 += '\n' + '  '.repeat(depth) + '<span class="xj-k">"' + esc(keys[j]) + '"</span>: ' + renderValue(val[keys[j]], depth + 1);
            if (j < keys.length - 1) out2 += ',';
          }
          if (keys.length > 500) {
            out2 += '\n' + '  '.repeat(depth) + '...' + (keys.length - 500) + ' more keys';
          }
          out2 += '}</details>';
          return out2;
        }
        return esc(String(val));
      }

      var css = "body{background:#0f0f0f;color:#e4e4e7;margin:0;padding:0;font-family:'SF Mono','Menlo','Cascadia Code','Fira Code','Consolas',monospace;font-size:13px;line-height:1.6;}"
        + ".xj-header{display:flex;align-items:center;justify-content:space-between;padding:6px 12px;border-bottom:1px solid #282828;font-size:11px;gap:12px;}"
        + ".xj-path{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}"
        + ".xj-copy{padding:3px 10px;background:#27272a;border:1px solid #3f3f46;border-radius:4px;color:inherit;cursor:pointer;font-size:11px;}"
        + ".xj-copy:hover{color:#fff;border-color:#52525b;}"
        + ".xj-k{color:#93c5fd;}"
        + ".xj-toggle{font-size:10px;margin-right:2px;user-select:none;}"
        + "details{display:inline;}"
        + "details>summary{list-style:none;display:inline;cursor:pointer;}"
        + "details>summary::-webkit-details-marker{display:none;}"
        + "a{color:inherit;}"
        + "pre{margin:0;padding:16px;white-space:pre-wrap;word-break:break-word;}";

      var fullUrl = window.location.href || "";
      var truncatedUrl = fullUrl.length > 80 ? fullUrl.slice(0, 80) + "\u2026" : fullUrl;

      document.head.innerHTML = '<title>JSON \u2014 XEVO</title><style>' + css + '</style>';
      document.body.innerHTML = '<div class="xj-header">'
        + '<span class="xj-path">' + esc(truncatedUrl) + '</span>'
        + '<button class="xj-copy" id="xj-copy-btn">Copy</button>'
        + '</div><pre>' + renderValue(parsed, 0) + '</pre>';

      var btn = document.getElementById("xj-copy-btn");
      if (btn) {
        btn.addEventListener("click", function() {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(raw).then(function() {
              btn.textContent = "Copied!";
              setTimeout(function() { btn.textContent = "Copy"; }, 2000);
            }).catch(function() {});
          }
        });
      }
    } catch (e) {}
  }
  document.addEventListener("DOMContentLoaded", xevoRenderJson);
})();
"##;

// ─── Helpers ─────────────────────────────────────────────────────────

fn webview_label_for_tab(tab_id: &str) -> String {
    format!("browser-{}", tab_id)
}

/// Resolve a tab/viewport webview by label: Tauri's own registry first, then
/// our persistent handle map (webviews whose strong refs we hold may not appear
/// in `app.webviews()` — Tauri #14843).
///
/// Every tab lookup routes through here, so the registry-then-map fallback that
/// used to be copy-pasted at ~25 call sites lives in exactly one place.
pub fn find_tab_webview(app: &AppHandle, label: &str) -> Option<tauri::Webview> {
    if let Some(wv) = app.get_webview(label) {
        return Some(wv);
    }
    let state = app.state::<BrowserState>();
    let guard = state.webviews.lock().unwrap_or_else(|e| e.into_inner());
    guard.get(label).cloned()
}

/// Hide all browser-* webviews EXCEPT the one with the given label.
/// This is the authoritative way to ensure exactly one webview is visible.
fn hide_all_browser_webviews_except(app: &AppHandle, state: &crate::BrowserState, except_label: &str) {
    // Hide via Tauri's built-in registry
    for (label, wv) in app.webviews() {
        if label.starts_with("browser-") && label != except_label {
            let _ = wv.hide();
        }
    }
    // Also hide via our persistent handle map — webviews whose strong refs
    // we hold may not appear in app.webviews() (Tauri #14843).
    if let Ok(webviews) = state.webviews.lock() {
        for (label, wv) in webviews.iter() {
            if label.starts_with("browser-") && label != except_label {
                let _ = wv.hide();
            }
        }
    }
}

/// Fullscreen belongs to exactly one tab at a time.
///
/// Returns `true` if `keep` *is* the fullscreen tab — the caller should leave its
/// bounds alone, since the fullscreen handler owns them. Otherwise leaves
/// fullscreen (clearing the flag and dropping the window out of OS fullscreen)
/// and returns `false`, so the caller proceeds normally.
///
/// Pass `keep: None` to unconditionally exit — used when the fullscreen tab is
/// being closed, which would otherwise strand the flag set forever (its
/// `ContainsFullScreenElementChanged` handler dies with the webview, so nothing
/// would ever clear it and every later show/bounds call would no-op).
fn exit_fullscreen_unless(
    app: &AppHandle,
    state: &crate::BrowserState,
    keep: Option<&str>,
) -> bool {
    let mut fs = state.fullscreen_tab.lock().unwrap_or_else(|e| e.into_inner());
    match fs.as_deref() {
        None => false,
        Some(current) if Some(current) == keep => true,
        Some(_) => {
            *fs = None;
            drop(fs);
            if let Some(main) = app.get_window("main") {
                let _ = main.set_fullscreen(false);
            }
            false
        }
    }
}

/// Poll until no webview is registered under `label`, in either Tauri's own
/// registry or our persistent handle map. `destroy()` on Windows is async — a
/// window can still be found for a few ms after we call it — so a caller that
/// just destroyed the old handle for this label needs to wait for it to
/// actually clear before treating "still present" as a real conflict.
async fn wait_until_absent(app: &AppHandle, state: &crate::BrowserState, label: &str) {
    for _ in 0..25 {
        let present = app.get_webview(label).is_some()
            || state.webviews.lock().unwrap_or_else(|e| e.into_inner()).contains_key(label);
        if !present {
            return;
        }
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }
}

fn is_ip_address(s: &str) -> bool {
    s.parse::<std::net::Ipv4Addr>().is_ok() || s.parse::<std::net::Ipv6Addr>().is_ok()
}

fn resolve_url(input: &str) -> String {
    let s = input.trim();
    if s.starts_with("http://") || s.starts_with("https://") {
        return s.to_string();
    }
    if s.starts_with("localhost") || s.starts_with("127.0.0.1") {
        return format!("http://{}", s);
    }
    let has_dot = s.contains('.');
    let has_space = s.contains(' ');
    let has_slash = s.starts_with('/');
    if has_dot && !has_space && !has_slash {
        if is_ip_address(s.split(':').next().unwrap_or("")) {
            return format!("http://{}", s);
        }
        return format!("https://{}", s);
    }
    format!(
        "https://www.google.com/search?q={}",
        urlencoding::encode(s)
    )
}

/// Build a child Webview for a tab. Injects per-tab __XEVO_TAB_ID plus
/// all shared init scripts (core, chrome features, JSON viewer).
///
/// Uses `Window::add_child`, NOT `WebviewWindowBuilder::parent()`. On Windows
/// `.parent()` creates an *owner* window (top-level, screen coordinates) which
/// the OS never moves with its owner — that is what forced the old JS
/// onMoved/onResized bounds-following. A child webview lives inside the main
/// window's HWND at window-relative coordinates, so it moves and clips for free.
///
/// Callers MUST be async: a sync `#[tauri::command]` runs on the main thread and
/// creating a webview needs to pump the event loop that thread is blocked on,
/// which deadlocks (the webview is created and hit-tests but never paints).
fn create_webview_for_tab(
    app: &AppHandle,
    tab_id: &str,
    url: &str,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    show_immediately: bool,
) -> Result<tauri::Webview, String> {
    let width = width.max(1.0);
    let height = height.max(1.0);
    let label = webview_label_for_tab(tab_id);
    let parsed = url
        .parse::<url::Url>()
        .map_err(|e| e.to_string())?;
    let target_url = parsed.clone();

    let tab_id_nav = tab_id.to_string();
    let app_for_nav = app.clone();
    let tab_id_load = tab_id.to_string();
    let app_for_load = app.clone();
    let app_for_new_window = app.clone();
    let tab_id_download = tab_id.to_string();
    let app_for_download = app.clone();

    // Per-tab init script that sets __XEVO_TAB_ID
    let tab_id_init = format!("window.__XEVO_TAB_ID = \"{}\";", tab_id);

    let state = app.state::<BrowserState>();
    let user_agent = state.user_agent.lock().unwrap_or_else(|e| e.into_inner()).clone();

    let main_window = app
        .get_window("main")
        .ok_or("main window not found")?;

    // decorations/resizable/inner_size/position are window concepts — a child
    // webview gets its geometry from add_child's position/size arguments below.
    // No .data_directory() — a data directory that differs from the main window's
    // spawns a second WebView2 environment, and with it a duplicate browser + GPU +
    // network process set. Sharing the default keeps every webview in one tree.
    let mut builder = WebviewBuilder::new(&label, WebviewUrl::External(url::Url::parse("about:blank").expect("about:blank must parse")))
        // Ctrl +/- and Ctrl+mousewheel zoom natively inside the page (WebView2
        // IsZoomControlEnabled). Builder attribute — only affects new webviews.
        .zoom_hotkeys_enabled(true)
        // Matches tauri.conf.json's backgroundColor (#0f0f0f). Without this,
        // WebView2's own default paints the strip newly exposed by a resize
        // before the page repaints it — a flash against the dark chrome.
        // Hardcoded to dark: in light theme this becomes a dark flash instead
        // of a light one — wiring it to the theme store is a separate change.
        .background_color(tauri::webview::Color(15, 15, 15, 255))
        .initialization_script(&tab_id_init)
        .initialization_script(CHROME_FEATURES_SCRIPT)
        .initialization_script(JSON_VIEWER_SCRIPT);

    if let Some(ref ua) = user_agent {
        builder = builder.user_agent(ua);
    }

    let builder = builder
            .on_navigation(move |nav_url| {
                let scheme = nav_url.scheme();
                let allowed = matches!(scheme, "http" | "https" | "" | "tauri");
                if !allowed {
                    return false;
                }
                let url_str = nav_url.to_string();
                let _ = app_for_nav.emit("browser://url-changed", serde_json::json!({
                    "tabId": tab_id_nav,
                    "url": url_str,
                }));
                true
            })
            .on_page_load(move |_webview, payload| {
                match payload.event() {
                    PageLoadEvent::Started => {
                        let _ = app_for_load.emit("browser://loading", serde_json::json!({
                            "tabId": tab_id_load,
                            "loading": true,
                        }));
                    }
                    PageLoadEvent::Finished => {
                        let _ = app_for_load.emit("browser://loading", serde_json::json!({
                            "tabId": tab_id_load,
                            "loading": false,
                        }));
                    }
                }
            })
            .on_new_window(move |url, _features| {
                let _ = app_for_new_window.emit("browser://open-new-tab", serde_json::json!({
                    "url": url.to_string()
                }));
                tauri::webview::NewWindowResponse::Deny
            })
            // Downloads go to the OS default destination. Tauri's DownloadEvent
            // exposes no progress callback, so the UI shows started → finished,
            // not a percentage.
            .on_download(move |_webview, event| {
                match event {
                    DownloadEvent::Requested { url, destination } => {
                        let _ = app_for_download.emit("xevo://download-started", serde_json::json!({
                            "tabId": tab_id_download,
                            "url": url.to_string(),
                            "destination": destination.to_string_lossy(),
                        }));
                    }
                    DownloadEvent::Finished { url, path, success } => {
                        let _ = app_for_download.emit("xevo://download-finished", serde_json::json!({
                            "url": url.to_string(),
                            "path": path.as_ref().map(|p| p.to_string_lossy().to_string()),
                            "success": success,
                        }));
                    }
                    _ => {}
                }
                true
            });

    // Position/size are relative to the main window's client area, not the
    // screen — this is what makes window moves free.
    let webview = main_window
        .add_child(
            builder,
            Position::Logical(LogicalPosition::new(x, y)),
            Size::Logical(LogicalSize::new(width, height)),
        )
        .map_err(|e| e.to_string())?;

    register_webview_network_capture(&webview, app, tab_id);
    register_webview_native_events(&webview, app, tab_id);

    // Adopt the current app theme immediately, so a page's prefers-color-scheme
    // matches from first paint instead of defaulting to the OS scheme.
    apply_color_scheme(&webview, state.preferred_dark.load(Ordering::SeqCst));

    // Navigate to the real URL now that network handlers are registered
    let _ = webview.navigate(target_url);

    if show_immediately {
        webview.show().map_err(|e| e.to_string())?;
    }
    Ok(webview)
}

// ─── Commands ────────────────────────────────────────────────────────

/// Create a new webview for a tab and show it. Hides the previously active
/// webview. Called on first navigation (when a URL is entered).
#[tauri::command]
pub async fn browser_create_tab(
    app: AppHandle,
    state: tauri::State<'_, BrowserState>,
    tab_id: String,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let resolved = resolve_url(&url);
    let label = webview_label_for_tab(&tab_id);

    // Destroy any stale handle in our persistent map for this label.
    // This catches orphaned OS windows from previous race conditions that
    // Tauri's internal registry dropped but the HWND survived (Windows).
    {
        let mut webviews = state.webviews.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(old_wv) = webviews.remove(&label) {
            xevo_log!("[XEVO-LIFECYCLE] browser_create_tab — closing stale handle for label={}", label);
            let _ = old_wv.close();
        }
    }

    // Close any orphan webview in Tauri's registry with this label.
    if let Some(orphan) = app.get_webview(&label) {
        xevo_log!("[XEVO-LIFECYCLE] browser_create_tab — closing orphan label={}", label);
        let _ = orphan.close();
    }

    // We just destroyed whatever was under this label above, but destroy() is
    // async on Windows — wait for it to actually clear rather than treating
    // "still present a moment later" as a legitimate pre-existing webview and
    // silently no-op'ing (that used to report success without creating
    // anything, leaving the tab permanently blank).
    wait_until_absent(&app, &state, &label).await;
    {
        let webviews = state.webviews.lock().unwrap_or_else(|e| e.into_inner());
        if app.get_webview(&label).is_some() || webviews.contains_key(&label) {
            xevo_log!("[XEVO-LIFECYCLE] browser_create_tab — label={} did not release after waiting, aborting", label);
            return Err(format!("webview for tab {} did not release in time", tab_id));
        }
    }

    xevo_log!("[XEVO-LIFECYCLE] browser_create_tab — creating label={} url={} x={} y={} w={} h={}", label, resolved, x, y, width, height);

    // Hide ALL other browser webviews — this is authoritative.
    // The old approach (hide only active_tab_label) missed webviews hidden
    // by the frontend without updating the backend, causing orphan floating
    // windows that became "stuck".
    hide_all_browser_webviews_except(&app, &state, &label);

    // A child webview is hidden and restored by the OS along with its parent
    // window, so minimize state no longer gates creation.
    let webview = create_webview_for_tab(
        &app, &tab_id, &resolved, x, y, width, height, true,
    )?;

    // Store a persistent strong reference to prevent the Webview
    // from being destroyed when this async function returns (Tauri #14843).
    // Without this, the handle drops and the OS window disappears, causing
    // browser_set_bounds to find only ["main"].
    {
        let mut webviews = state.webviews.lock().unwrap_or_else(|e| e.into_inner());
        // Race check: another call may have created this webview while we were
        // creating ours. If so, drop our duplicate to avoid orphaning theirs.
        if webviews.contains_key(&label) {
            xevo_log!("[XEVO-LIFECYCLE] browser_create_tab — RACE: label={} already in map, dropping duplicate", label);
            drop(webview);
            return Ok(());
        }
        webviews.insert(label.clone(), webview.clone());
    }

    // Track as active
    *state.active_tab_label.lock().unwrap_or_else(|e| e.into_inner()) = Some(webview.label().to_string());

    Ok(())
}

/// Close a tab's webview.
#[tauri::command]
pub async fn browser_close_tab(
    app: AppHandle,
    state: tauri::State<'_, BrowserState>,
    tab_id: String,
) -> Result<(), String> {
    let label = webview_label_for_tab(&tab_id);
    let exists = app.get_webview(&label).is_some();
    xevo_log!("[XEVO-LIFECYCLE] browser_close_tab — label={} tab_id={} exists_before={}", label, tab_id, exists);

    // If the tab being closed owns fullscreen, leave fullscreen now. Its
    // ContainsFullScreenElementChanged handler dies with the webview, so nothing
    // else would ever clear the flag — and while set, every later show/bounds
    // call no-ops, i.e. tab switching stops working permanently.
    exit_fullscreen_unless(&app, &state, None);
    // Remove from our persistent map FIRST — this is the authoritative source
    // of strong references. The handle will drop after removal, allowing the
    // OS window to be destroyed naturally (confirming the close on Rust's side).
    state.webviews.lock().unwrap_or_else(|e| e.into_inner()).remove(&label);
    if let Some(wv) = app.get_webview(&label) {
        wv.close().map_err(|e| e.to_string())?;
        xevo_log!("[XEVO-LIFECYCLE] browser_close_tab — label={} closed OK, still_exists={}", label, app.get_webview(&label).is_some());
    } else {
        xevo_log!("[XEVO-LIFECYCLE] browser_close_tab — label={} not found (already closed?)", label);
    }
    // If this was the active tab, clear the tracker
    let mut active = state.active_tab_label.lock().unwrap_or_else(|e| e.into_inner());
    if active.as_deref() == Some(&label) {
        *active = None;
    }
    drop(active);

    // Sweep any still-pending network request timing entries for this tab —
    // otherwise cancelled/in-flight requests from a closed tab leak forever.
    if let Some(store) = NETWORK_REQUEST_META.get() {
        if let Ok(mut map) = store.lock() {
            let prefix = format!("{}:", tab_id);
            map.retain(|k, _| !k.starts_with(&prefix));
        }
    }

    Ok(())
}

/// Navigate a specific tab's webview to a new URL.
#[tauri::command]
pub async fn browser_navigate_tab(
    app: AppHandle,
    tab_id: String,
    url: String,
) -> Result<(), String> {
    let label = webview_label_for_tab(&tab_id);
    let resolved = resolve_url(&url);
    if let Some(wv) = find_tab_webview(&app, &label) {
        wv.navigate(resolved.parse().map_err(|e: url::ParseError| e.to_string())?)
            .map_err(|e| {
                #[cfg(debug_assertions)]
                xevo_log!("[xevo] browser_navigate_tab failed: {e}");
                e.to_string()
            })?;
    }
    Ok(())
}

// ─── Bounds ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn browser_set_bounds(
    app: AppHandle,
    state: tauri::State<'_, crate::BrowserState>,
    tab_id: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let label = webview_label_for_tab(&tab_id);

    // While *this* tab is fullscreen (video) the child covers the whole window
    // and is owned by the fullscreen handler + native resize path, so ignore
    // JS-driven bounds pushes (from the ResizeObserver) that would shrink it back
    // to the inset content area. A push for any other tab is fine — unlike
    // browser_show_tab, a resize must not kick the user out of fullscreen.
    if state
        .fullscreen_tab
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_deref()
        == Some(label.as_str())
    {
        return Ok(());
    }
    xevo_log!("[XEVO-BOUNDS] browser_set_bounds called — label={} x={} y={} w={} h={}", label, x, y, width, height);
    // Try Tauri's registry first, then fallback to our persistent handle map
    let wv = find_tab_webview(&app, &label);
    if let Some(wv) = wv {
        // One set_bounds call instead of set_position + set_size: each of those is a
        // separate message to the wry event loop, processed on separate iterations,
        // so the webview visibly moved on one frame and resized on the next.
        // set_bounds does both in a single message.
        xevo_log!("[XEVO-BOUNDS] browser_set_bounds — webview found, calling set_bounds");
        let bounds = tauri::Rect {
            position: Position::Logical(LogicalPosition::new(x, y)),
            size: Size::Logical(LogicalSize::new(width.max(1.0), height.max(1.0))),
        };
        if let Err(e) = wv.set_bounds(bounds) {
            xevo_log!("[XEVO-BOUNDS] browser_set_bounds — set_bounds ERROR: {}", e);
            return Err(format!("set_bounds failed: {}", e));
        }
        xevo_log!("[XEVO-BOUNDS] browser_set_bounds — OK");

        // Cache the content-area insets so a native window resize can reposition
        // the active webview directly from Rust (see on_window_event in lib.rs),
        // without waiting on the JS ResizeObserver → rAF → IPC round trip.
        if let Some(main) = app.get_window("main") {
            if let Ok(win_size) = main.inner_size() {
                let scale = main.scale_factor().unwrap_or(1.0);
                let win_w = win_size.width as f64 / scale;
                let win_h = win_size.height as f64 / scale;
                let insets = (x, y, win_w - x - width, win_h - y - height);
                *state.content_insets.lock().unwrap_or_else(|e| e.into_inner()) = Some(insets);
            }
        }
    } else {
        xevo_log!("[XEVO-BOUNDS] browser_set_bounds — webview NOT FOUND for label: {}", label);
        // Diagnostic: dump all registered webview labels to understand why lookup failed
        let all_labels: Vec<String> = app.webviews()
            .iter()
            .map(|(l, _)| l.clone())
            .collect();
        xevo_log!("[XEVO-BOUNDS] browser_set_bounds — registered webview labels: {:?}", all_labels);
        let stored_labels: Vec<String> = state.webviews.lock().unwrap_or_else(|e| e.into_inner()).keys().cloned().collect();
        xevo_log!("[XEVO-BOUNDS] browser_set_bounds — stored webview labels: {:?}", stored_labels);
    }
    Ok(())
}

// ─── Navigation (per-tab) ────────────────────────────────────────────

#[tauri::command]
pub async fn browser_go_back(app: AppHandle, tab_id: String) -> Result<(), String> {
    let label = webview_label_for_tab(&tab_id);
    if let Some(wv) = find_tab_webview(&app, &label) {
        wv.eval("window.history.back()")
            .map_err(|e| format!("browser_go_back eval failed: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn browser_go_forward(app: AppHandle, tab_id: String) -> Result<(), String> {
    let label = webview_label_for_tab(&tab_id);
    if let Some(wv) = find_tab_webview(&app, &label) {
        wv.eval("window.history.forward()")
            .map_err(|e| format!("browser_go_forward eval failed: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn browser_reload(app: AppHandle, tab_id: String) -> Result<(), String> {
    let label = webview_label_for_tab(&tab_id);
    if let Some(wv) = find_tab_webview(&app, &label) {
        wv.eval("window.location.reload()")
            .map_err(|e| format!("browser_reload eval failed: {e}"))?;
    }
    Ok(())
}

/// Cache-bypassing reload (Ctrl+Shift+R).
///
/// Neither wry nor `ICoreWebView2::Reload()` offers an ignore-cache option, and
/// `location.reload(true)` has been a no-op in Chromium for years — so this goes
/// through the DevTools protocol, the same channel `browser_screenshot` uses.
/// Fire-and-forget: CDP reports completion, but there is nothing to report back.
#[tauri::command]
pub async fn browser_hard_reload(app: AppHandle, tab_id: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let label = webview_label_for_tab(&tab_id);
        let wv = match find_tab_webview(&app, &label) {
            Some(wv) => wv,
            None => return Ok(()),
        };
        wv.with_webview(move |platform| {
            #[cfg(windows)]
            unsafe {
                use webview2_com::CallDevToolsProtocolMethodCompletedHandler;
                use windows_core::HSTRING;
                let core = match platform.controller().CoreWebView2() {
                    Ok(c) => c,
                    Err(e) => {
                        xevo_log!("[xevo] hard reload: CoreWebView2 failed: {e:?}");
                        return;
                    }
                };
                let handler = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(
                    |_result: windows_core::Result<()>, _json: String| -> windows_core::Result<()> {
                        Ok(())
                    },
                ));
                let _ = core.CallDevToolsProtocolMethod(
                    &HSTRING::from("Page.reload"),
                    &HSTRING::from(r#"{"ignoreCache":true}"#),
                    &handler,
                );
            }
        })
        .map_err(|e| format!("browser_hard_reload failed: {e}"))?;
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, tab_id);
        Err("Hard reload is only supported on Windows".to_string())
    }
}

#[tauri::command]
pub async fn browser_set_zoom(app: AppHandle, tab_id: String, factor: f64) -> Result<(), String> {
    let label = webview_label_for_tab(&tab_id);
    if let Some(wv) = find_tab_webview(&app, &label) {
        wv.set_zoom(factor.clamp(0.25, 5.0))
            .map_err(|e| format!("browser_set_zoom failed: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn browser_stop_loading(app: AppHandle, tab_id: String) -> Result<(), String> {
    let label = webview_label_for_tab(&tab_id);
    if let Some(wv) = find_tab_webview(&app, &label) {
        wv.eval("window.stop()").map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ─── Bookmark & Shortcut forwarding (global, not tab-specific) ───────

#[tauri::command]
pub fn browser_bookmark_request(app: AppHandle) -> Result<(), String> {
    app.emit("browser://bookmark-request", ())
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn forward_shortcut(app: AppHandle, shortcut: String) -> Result<(), String> {
    app.emit("xevo://shortcut", shortcut)
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn open_external_url(app: AppHandle, url: String) -> Result<(), String> {
    app.opener()
        .open_url(&url, None::<&str>)
        .map_err(|e| e.to_string())
}

/// Open a downloaded file, or reveal it in the OS file manager.
#[tauri::command]
pub fn open_download(app: AppHandle, path: String, reveal: bool) -> Result<(), String> {
    let opener = app.opener();
    if reveal {
        opener.reveal_item_in_dir(&path).map_err(|e| e.to_string())
    } else {
        opener.open_path(&path, None::<&str>).map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn update_tab_info(
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

// ─── Find in Page (per-tab) ──────────────────────────────────────────

fn eval_find_script(app: &AppHandle, tab_id: &str, script_body: &str) -> Result<(), String> {
    let label = webview_label_for_tab(tab_id);
    let wv = find_tab_webview(app, &label)
        .ok_or_else(|| "browser webview not found for tab".to_string())?;
    // ponytail: script_body already JS-escaped via js_string_literal — no re-escaping needed
    let wrapped = format!("(function() {{ {} }})();", script_body);
    wv.eval(&wrapped).map_err(|e| {
        #[cfg(debug_assertions)]
        xevo_log!("[xevo] browser find eval failed: {e}");
        e.to_string()
    })
}

fn build_invoke_call(func_name: &str, args: Vec<String>) -> String {
    let args_js = args.join(", ");
    format!("window.{}({})", func_name, args_js)
}

fn js_string_literal(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for ch in s.chars() {
        match ch {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            '\u{2028}' => out.push_str("\\u2028"),
            '\u{2029}' => out.push_str("\\u2029"),
            c if (c as u32) < 0x20 => {
                out.push_str(&format!("\\u{:04x}", c as u32));
            }
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

#[tauri::command]
pub async fn browser_find(
    app: AppHandle,
    tab_id: String,
    query: String,
    forward: Option<bool>,
) -> Result<(), String> {
    if query.is_empty() {
        let script = build_invoke_call("__xevoClearFind", vec![]);
        return eval_find_script(&app, &tab_id, &script);
    }
    let fwd = forward.unwrap_or(true);
    let body = build_invoke_call(
        "__xevoFind",
        vec![js_string_literal(&query), format!("{}", fwd)],
    );
    eval_find_script(&app, &tab_id, &body)
}

#[tauri::command]
pub async fn browser_find_next(
    app: AppHandle,
    tab_id: String,
    forward: Option<bool>,
) -> Result<(), String> {
    let fwd = forward.unwrap_or(true);
    let body = build_invoke_call(
        "__xevoFindNext",
        vec![format!("{}", fwd)],
    );
    eval_find_script(&app, &tab_id, &body)
}

#[tauri::command]
pub async fn browser_stop_find(app: AppHandle, tab_id: String) -> Result<(), String> {
    let body = build_invoke_call("__xevoClearFind", vec![]);
    eval_find_script(&app, &tab_id, &body)
}

#[tauri::command]
pub fn browser_find_callback(
    app: AppHandle,
    active_match: u32,
    total_matches: u32,
    final_update: Option<bool>,
) -> Result<(), String> {
    let payload = serde_json::json!({
        "active_match": active_match,
        "total_matches": total_matches,
        "final_update": final_update.unwrap_or(true),
    });
    app.emit("browser://find-result", payload)
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ─── Theme (apply to all webviews) ───────────────────────────────────

/// Set a webview's preferred color scheme natively via WebView2's
/// `ICoreWebView2Profile::PreferredColorScheme`. This is what actually drives
/// the `prefers-color-scheme` media query that sites (Google, YouTube, …) use to
/// pick their theme. The old approach set `document.documentElement.style
/// .colorScheme` + a `<meta color-scheme>` via eval, which only affects UA
/// widget rendering — it never changed `prefers-color-scheme`, so pages stayed
/// dark regardless of the app theme.
pub fn apply_color_scheme(wv: &tauri::Webview, dark: bool) {
    let _ = wv.with_webview(move |platform| {
        #[cfg(windows)]
        unsafe {
            use webview2_com::Microsoft::Web::WebView2::Win32::{
                ICoreWebView2_13,
                COREWEBVIEW2_PREFERRED_COLOR_SCHEME_DARK,
                COREWEBVIEW2_PREFERRED_COLOR_SCHEME_LIGHT,
            };
            use windows_core::Interface;

            let core = match platform.controller().CoreWebView2() {
                Ok(c) => c,
                Err(e) => {
                    xevo_log!("[xevo] color-scheme: CoreWebView2() failed: {e:?}");
                    return;
                }
            };
            match core.cast::<ICoreWebView2_13>() {
                Ok(c13) => match c13.Profile() {
                    Ok(profile) => {
                        let scheme = if dark {
                            COREWEBVIEW2_PREFERRED_COLOR_SCHEME_DARK
                        } else {
                            COREWEBVIEW2_PREFERRED_COLOR_SCHEME_LIGHT
                        };
                        if let Err(e) = profile.SetPreferredColorScheme(scheme) {
                            xevo_log!("[xevo] SetPreferredColorScheme failed: {e:?}");
                        }
                    }
                    Err(e) => xevo_log!("[xevo] Profile() unavailable: {e:?}"),
                },
                Err(e) => xevo_log!("[xevo] ICoreWebView2_13 unavailable: {e:?}"),
            }
        }
        #[cfg(not(windows))]
        let _ = (platform, dark);
    });
}

#[tauri::command]
pub async fn browser_set_theme(app: AppHandle, theme: String) -> Result<(), String> {
    let dark = theme != "light";
    // Remember it so a tab created later adopts the current theme on creation.
    app.state::<BrowserState>()
        .preferred_dark
        .store(dark, Ordering::SeqCst);
    // Apply to ALL browser webviews (all labels starting with "browser-").
    for (_, wv) in app.webviews() {
        if wv.label().starts_with("browser-") {
            apply_color_scheme(&wv, dark);
        }
    }
    Ok(())
}

// ─── Hide/Show (for overlays) ────────────────────────────────────────

#[tauri::command]
pub async fn browser_hide_tab(
    app: AppHandle,
    state: tauri::State<'_, BrowserState>,
    tab_id: String,
) -> Result<(), String> {
    let label = webview_label_for_tab(&tab_id);
    xevo_log!("[XEVO-LIFECYCLE] browser_hide_tab — label={}", label);
    let wv = find_tab_webview(&app, &label);
    if let Some(wv) = wv {
        wv.hide().map_err(|e| format!("failed to hide tab: {e}"))?;
        xevo_log!("[XEVO-LIFECYCLE] browser_hide_tab — label={} hidden OK", label);
        // Clear active_tab_label if we just hid the tracked webview.
        // This prevents stale state where active_tab_label points to a
        // hidden webview — which causes orphan floating windows on restore.
        let mut active = state.active_tab_label.lock().unwrap_or_else(|e| e.into_inner());
        if active.as_deref() == Some(&label) {
            *active = None;
        }
    } else {
        xevo_log!("[XEVO-LIFECYCLE] browser_hide_tab — label={} not found", label);
    }
    Ok(())
}

#[tauri::command]
pub async fn browser_show_tab(
    app: AppHandle,
    state: tauri::State<'_, crate::BrowserState>,
    tab_id: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let label = webview_label_for_tab(&tab_id);

    // Fullscreen is owned by one tab. Showing *that* tab means leaving its
    // bounds alone (the fullscreen handler owns them). Showing a *different*
    // tab means leaving fullscreen first — same as Chrome/Edge, where switching
    // tabs exits fullscreen — otherwise this returned early and the new tab
    // never appeared at all.
    if exit_fullscreen_unless(&app, &state, Some(&label)) {
        return Ok(());
    }

    xevo_log!("[XEVO-BOUNDS] browser_show_tab called — label={}", label);
    // Try Tauri's registry first, then fallback to our persistent handle map
    let wv = find_tab_webview(&app, &label);
    if let Some(wv) = wv {
        wv.set_position(Position::Logical(LogicalPosition::new(x, y)))
            .map_err(|e| format!("failed to set position: {e}"))?;
        wv.set_size(Size::Logical(LogicalSize::new(width.max(1.0), height.max(1.0))))
            .map_err(|e| format!("failed to set size: {e}"))?;
        // Hide every other browser webview — authoritative, same as
        // browser_create_tab. Without this, `show` trusted the frontend to have
        // hidden the outgoing tab, so any missed or out-of-order hide left the
        // old page rendered over the new one ("tab switches, webview doesn't").
        // Hiding before show avoids a frame where both are visible.
        hide_all_browser_webviews_except(&app, &state, &label);
        wv.show().map_err(|e| format!("failed to show tab: {e}"))?;
        // browser_hide_tab clears active_tab_label when it hides the tracked
        // webview; the native resize path reads it to find the child to resize.
        *state.active_tab_label.lock().unwrap_or_else(|e| e.into_inner()) = Some(label.clone());
        xevo_log!("[XEVO-BOUNDS] browser_show_tab — restored active_tab_label to {}", label);
    } else {
        xevo_log!("[XEVO-BOUNDS] browser_show_tab — webview NOT FOUND for label: {}", label);
    }
    Ok(())
}

// ─── User Agent ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn browser_set_user_agent(
    app: AppHandle,
    user_agent: String,
) -> Result<(), String> {
    let state = app.state::<BrowserState>();
    let ua = if user_agent.is_empty() { None } else { Some(user_agent) };
    *state.user_agent.lock().unwrap_or_else(|e| e.into_inner()) = ua;
    Ok(())
}

// ─── Memory Target ────────────────────────────────────────────────

/// Set the memory usage target level for a specific tab's webview.
/// Best-effort — silently no-ops on non-Windows or older WebView2 runtimes,
/// but logs which step failed so it's debuggable.
pub fn apply_memory_target(wv: &tauri::Webview, low: bool) {
    let _ = wv.with_webview(move |platform| {
        #[cfg(windows)]
        unsafe {
            use webview2_com::Microsoft::Web::WebView2::Win32::{
                ICoreWebView2_19,
                COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW,
                COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
            };
            use windows_core::Interface;

            let level = if low {
                COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW
            } else {
                COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL
            };

            match platform.controller().CoreWebView2() {
                Ok(core) => match core.cast::<ICoreWebView2_19>() {
                    Ok(core19) => {
                        if let Err(e) = core19.SetMemoryUsageTargetLevel(level) {
                            xevo_log!("[xevo] SetMemoryUsageTargetLevel failed: {e:?}");
                        }
                    }
                    Err(e) => xevo_log!("[xevo] ICoreWebView2_19 unavailable: {e:?}"),
                },
                Err(e) => xevo_log!("[xevo] CoreWebView2() failed: {e:?}"),
            }
        }
    });
}

/// `low: true` hints WebView2 to reduce memory usage for background tabs.
/// `low: false` resets to normal memory target for the active tab.
#[tauri::command]
pub async fn browser_set_memory_target(
    app: AppHandle,
    tab_id: String,
    low: bool,
) -> Result<(), String> {
    let label = webview_label_for_tab(&tab_id);
    xevo_log!("[XEVO-LIFECYCLE] browser_set_memory_target — label={} low={}", label, low);
    let wv = find_tab_webview(&app, &label)
        .ok_or_else(|| {
            xevo_log!("[XEVO-LIFECYCLE] browser_set_memory_target — label={} NOT FOUND", label);
            format!("no webview for tab {}", tab_id)
        })?;
    apply_memory_target(&wv, low);
    Ok(())
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
                COREWEBVIEW2_WEB_RESOURCE_CONTEXT, COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL, ICoreWebView2_2,
            };
            use webview2_com::WebResourceRequestedEventHandler;
            use webview2_com::WebResourceResponseReceivedEventHandler;
            use webview2_com::WebResourceResponseViewGetContentCompletedHandler;
            use windows::core::PWSTR;
            use windows::core::HSTRING;
            use windows_core::BOOL;
            use windows_core::Interface;

            let core = match platform.controller().CoreWebView2() {
                Ok(core) => core,
                Err(e) => {
                    xevo_log!("[xevo] CoreWebView2() failed for network capture: {e:?}");
                    return;
                }
            };

            if let Err(e) = core.AddWebResourceRequestedFilter(
                windows::core::w!("*"),
                COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL,
            ) {
                xevo_log!("[xevo] AddWebResourceRequestedFilter failed: {e:?}");
                return;
            }

            let app_req = app.clone();
            let tab_id_req = tab_id.clone();
            let req_handler = WebResourceRequestedEventHandler::create(Box::new(move |_webview, args| {
                let args = match args {
                    Some(a) => a,
                    None => return Ok(()),
                };
                let request = match args.Request() {
                    Ok(r) => r,
                    Err(_) => return Ok(()),
                };

                let mut uri_ptr = PWSTR::null();
                let _ = request.Uri(&mut uri_ptr);
                let uri = if uri_ptr.is_null() { String::new() } else { uri_ptr.to_string().unwrap_or_default() };

                // ponytail: SetHeader before Method()/other COM reads.
                // Never inject into Tauri's own IPC/asset traffic — a `*` rule would break it.
                if !uri.starts_with("http://ipc.localhost") && !uri.starts_with("tauri://localhost") {
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
                                    let _ = req_headers.SetHeader(&HSTRING::from(&rule.name), &HSTRING::from(&rule.value));
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

                let mut method_ptr = PWSTR::null();
                let _ = request.Method(&mut method_ptr);
                let method = if method_ptr.is_null() { String::new() } else { method_ptr.to_string().unwrap_or_default() };

                let mut resource_context = COREWEBVIEW2_WEB_RESOURCE_CONTEXT(0);
                let _ = args.ResourceContext(&mut resource_context);
                let resource_type = match resource_context.0 {
                    1 => "document", 2 => "stylesheet", 3 => "image", 4 => "media",
                    5 => "font", 6 => "script", 7 => "xhr", 8 => "fetch",
                    9 => "texttrack", 10 => "eventsource", 11 => "websocket",
                    12 => "manifest", 13 => "signedexchange", 14 => "ping",
                    15 => "cspviolationreport", 16 => "other",
                    _ => "other",
                };

                let now = Instant::now();
                let meta_key = format!("{}:{}", tab_id_req, uri);
                let store = NETWORK_REQUEST_META.get_or_init(|| Mutex::new(HashMap::new()));
                if let Ok(mut map) = store.lock() {
                    map.entry(meta_key).or_default().push_back((now, resource_type.to_string()));
                }

                let _ = app_req.emit("browser://network-request", serde_json::json!({
                    "tabId": tab_id_req,
                    "method": method,
                    "url": uri,
                }));

                Ok(())
            }));

            let mut token: i64 = 0;
            match core.add_WebResourceRequested(&req_handler, &mut token) {
                Ok(()) => xevo_log!("[XEVO] WebResourceRequested handler registered — token={token}"),
                Err(e) => xevo_log!("[XEVO] WebResourceRequested handler FAILED: {e:?}"),
            }

            let core2: ICoreWebView2_2 = match core.cast() {
                Ok(c) => c,
                Err(e) => {
                    xevo_log!("[xevo] ICoreWebView2_2 cast failed: {e:?}");
                    return;
                }
            };

            let app_resp = app.clone();
            let tab_id_resp = tab_id.clone();
            let resp_handler = WebResourceResponseReceivedEventHandler::create(Box::new(move |_webview, args| {
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

                let mut method_ptr = PWSTR::null();
                let mut uri_ptr = PWSTR::null();
                let _ = request.Method(&mut method_ptr);
                let _ = request.Uri(&mut uri_ptr);
                let method = if method_ptr.is_null() { String::new() } else { method_ptr.to_string().unwrap_or_default() };
                let uri = if uri_ptr.is_null() { String::new() } else { uri_ptr.to_string().unwrap_or_default() };

                // Skip internal Tauri IPC calls — not useful in dev tools
                if uri.starts_with("http://ipc.localhost") || uri.starts_with("tauri://localhost") {
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
                        if value.is_null() { None } else { value.to_string().ok() }
                    })
                    .unwrap_or_default();

                let mut status_code: i32 = 0;
                let _ = response.StatusCode(&mut status_code);

                let mut reason_ptr = PWSTR::null();
                let _ = response.ReasonPhrase(&mut reason_ptr);
                let reason_phrase = if reason_ptr.is_null() { String::new() } else { reason_ptr.to_string().unwrap_or_default() };

                let mut headers: HashMap<String, String> = HashMap::new();
                if let Ok(headers_obj) = response.Headers() {
                    if let Ok(iter) = headers_obj.GetIterator() {
                        let mut has_current = BOOL(0);
                        loop {
                            if iter.HasCurrentHeader(&mut has_current).is_err() || has_current == BOOL(0) {
                                break;
                            }
                            let mut name = PWSTR::null();
                            let mut value = PWSTR::null();
                            if iter.GetCurrentHeader(&mut name, &mut value).is_ok() {
                                if !name.is_null() && !value.is_null() {
                                    if let (Ok(n), Ok(v)) = (name.to_string(), value.to_string()) {
                                        headers.insert(n, v);
                                    }
                                }
                            }
                            let mut has_next = BOOL(0);
                            if iter.MoveNext(&mut has_next).is_err() || has_next == BOOL(0) {
                                break;
                            }
                        }
                    }
                }

                let content_length: i64 = headers.get("Content-Length")
                    .or_else(|| headers.get("content-length"))
                    .and_then(|v| v.parse().ok())
                    .unwrap_or(-1);

                let now = Instant::now();
                let meta_key = format!("{}:{}", tab_id_resp, uri);
                let (duration_ms, resource_type) = if let Some(store) = NETWORK_REQUEST_META.get() {
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
                let body_handler = WebResourceResponseViewGetContentCompletedHandler::create(Box::new(move |_errorcode, stream| {
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
                    let _ = app_body.emit("browser://network-entry", serde_json::json!({
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
                    }));
                    Ok(())
                }));

                let _ = response.GetContent(&body_handler);
                Ok(())
            }));

            let mut resp_token: i64 = 0;
            let _ = core2.add_WebResourceResponseReceived(&resp_handler, &mut resp_token);
        }
    });
}

// ─── Tab title/favicon + in-page shortcut forwarding (native, no injected JS) ─
//
// Both used to be handled by injected JS calling back into Tauri IPC, which
// is silently rejected for every remote (https://) page — see the Inspector
// panel fix above. These go through native WebView2 events instead: no
// page-originated IPC, so no ACL to satisfy.

pub fn register_webview_native_events(wv: &tauri::Webview, app: &tauri::AppHandle, tab_id: &str) {
    let app = app.clone();
    let tab_id = tab_id.to_string();
    let _ = wv.with_webview(move |platform| {
        #[cfg(windows)]
        unsafe {
            use webview2_com::{AcceleratorKeyPressedEventHandler, ContainsFullScreenElementChangedEventHandler, DocumentTitleChangedEventHandler};
            use webview2_com::Microsoft::Web::WebView2::Win32::COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN;

            let core = match platform.controller().CoreWebView2() {
                Ok(core) => core,
                Err(e) => {
                    xevo_log!("[xevo] CoreWebView2() failed for native events: {e:?}");
                    return;
                }
            };

            let app_title = app.clone();
            let tab_id_title = tab_id.clone();
            let core_title = core.clone();
            let title_handler = DocumentTitleChangedEventHandler::create(Box::new(move |_webview, _args| {
                use windows::core::PWSTR;

                let mut title_ptr = PWSTR::null();
                let _ = core_title.DocumentTitle(&mut title_ptr);
                let title = if title_ptr.is_null() { String::new() } else { title_ptr.to_string().unwrap_or_default() };

                let mut url_ptr = PWSTR::null();
                let _ = core_title.Source(&mut url_ptr);
                let url = if url_ptr.is_null() { String::new() } else { url_ptr.to_string().unwrap_or_default() };

                let _ = update_tab_info(app_title.clone(), tab_id_title.clone(), title, url, None);
                Ok(())
            }));
            let mut title_token: i64 = 0;
            let _ = core.add_DocumentTitleChanged(&title_handler, &mut title_token);

            let app_key = app.clone();
            let controller = platform.controller();
            let key_handler = AcceleratorKeyPressedEventHandler::create(Box::new(move |_controller, args| {
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
                        "ctrl+shift+1", "ctrl+shift+2", "ctrl+shift+3",
                        "ctrl+shift+4", "ctrl+shift+5", "ctrl+shift+6",
                        "ctrl+shift+7", "ctrl+shift+8", "ctrl+shift+9",
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
            let fs_handler = ContainsFullScreenElementChangedEventHandler::create(Box::new(move |_sender, _args| {
                let mut is_fs = windows_core::BOOL(0);
                let _ = core_fs.ContainsFullScreenElement(&mut is_fs);
                let entering = is_fs.as_bool();
                let state = app_fs.state::<crate::BrowserState>();
                // Record *which* tab owns fullscreen, so switching to another tab
                // or closing this one can clear it — a global flag stayed stuck.
                {
                    let mut fs = state.fullscreen_tab.lock().unwrap_or_else(|e| e.into_inner());
                    *fs = if entering { Some(label_fs.clone()) } else { None };
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
            }));
            let mut fs_token: i64 = 0;
            let _ = core.add_ContainsFullScreenElementChanged(&fs_handler, &mut fs_token);
        }
    });
}

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
async fn eval_json(wv: &tauri::Webview, script: String) -> Result<serde_json::Value, String> {
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
                    if let Some(s) = tx_outer.lock().unwrap().take() {
                        let _ = s.send(Err(format!("CoreWebView2 failed: {:?}", e)));
                    }
                    return;
                }
            };

            let tx_inner = tx_outer.clone();
            let handler = ExecuteScriptCompletedHandler::create(Box::new(
                move |result: windows_core::Result<()>, json: String| -> windows_core::Result<()> {
                    let sender = tx_inner.lock().unwrap().take();
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
                if let Some(s) = tx_outer.lock().unwrap().take() {
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
    use windows::core::PWSTR;
    use windows_core::BOOL;

    unsafe fn read(f: impl FnOnce(*mut PWSTR)) -> String {
        let mut p = PWSTR::null();
        f(&mut p);
        if p.is_null() { String::new() } else { p.to_string().unwrap_or_default() }
    }

    let name = read(|p| { let _ = c.Name(p); });
    let value = read(|p| { let _ = c.Value(p); });
    let domain = read(|p| { let _ = c.Domain(p); });
    let path = read(|p| { let _ = c.Path(p); });

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

/// Sends `msg` as the (only) error response on a one-shot channel, if nothing
/// has claimed it yet. Shared by every WebView2 async COM call in this file
/// that bridges a completion handler back to an `async fn` via `oneshot`.
#[cfg(target_os = "windows")]
fn cookie_op_failed<T>(
    tx: &std::sync::Arc<Mutex<Option<tokio::sync::oneshot::Sender<Result<T, String>>>>>,
    msg: String,
) {
    if let Some(s) = tx.lock().unwrap().take() {
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
    use windows::core::PWSTR;
    use windows_core::Interface;

    let core = platform
        .controller()
        .CoreWebView2()
        .map_err(|e| format!("CoreWebView2 failed: {e:?}"))?;

    let mut url_ptr = PWSTR::null();
    let _ = core.Source(&mut url_ptr);
    let url = if url_ptr.is_null() { String::new() } else { url_ptr.to_string().unwrap_or_default() };

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
                if let Some(s) = tx_inner.lock().unwrap().take() {
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
                let sender = tx_inner.lock().unwrap().take();
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
            "meta" => r#"(function() {
  try {
    var metas = Array.from(document.querySelectorAll('meta')).map(function(m) {
      return {
        name: m.getAttribute('name') || m.getAttribute('property') || m.getAttribute('http-equiv') || '',
        content: m.getAttribute('content') || '',
        charset: m.getAttribute('charset'),
        httpEquiv: m.getAttribute('http-equiv')
      };
    });
    var canonical = (document.querySelector('link[rel="canonical"]') || {}).href || null;
    var ldJson = [];
    var ldScripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (var i = 0; i < ldScripts.length; i++) {
      try {
        ldJson.push(JSON.parse(ldScripts[i].textContent));
      } catch(e) {
        // skip invalid JSON-LD
      }
    }
    return {
      metas: metas,
      title: document.title,
      canonical: canonical,
      url: location.href,
      ldJson: ldJson.length > 0 ? ldJson : undefined
    };
  } catch(e) {
    return { error: String(e), metas: [], title: '', canonical: null, url: location.href };
  }
})()"#
                .to_string(),

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

// ─── Multi-Viewport Mode ──────────────────────────────────────────

/// Create a viewport webview at the specified position and size
#[tauri::command]
pub async fn create_viewport(
    app: AppHandle,
    label: String,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let parent = app
        .get_window("main")
        .ok_or("Main window not found")?;
    let parsed_url = url::Url::parse(&url).map_err(|e| e.to_string())?;

    if let Some(webview) = find_tab_webview(&app, &label) {
        // One set_bounds call instead of set_position + set_size — same fix as
        // browser_set_bounds: each was a separate wry event-loop message, so the
        // viewport webview visibly moved on one frame and resized on the next.
        let bounds = tauri::Rect {
            position: Position::Logical(LogicalPosition::new(x, y)),
            size: Size::Logical(LogicalSize::new(width.max(1.0), height.max(1.0))),
        };
        webview.set_bounds(bounds).map_err(|e| e.to_string())?;
        webview.show().map_err(|e| e.to_string())?;
        return Ok(());
    }

    parent
        .add_child(
            WebviewBuilder::new(&label, WebviewUrl::External(parsed_url))
                .transparent(true),
            Position::Logical(LogicalPosition::new(x, y)),
            Size::Logical(LogicalSize::new(width.max(1.0), height.max(1.0))),
        )
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Destroy a viewport webview
#[tauri::command]
pub async fn destroy_viewport(app: AppHandle, label: String) -> Result<(), String> {
    if let Some(webview) = find_tab_webview(&app, &label) {
        webview.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Resize and reposition a viewport webview
#[tauri::command]
pub async fn resize_viewport(
    app: AppHandle,
    label: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    if let Some(webview) = find_tab_webview(&app, &label) {
        // One set_bounds call, same reason as create_viewport: set_position +
        // set_size are two separate wry event-loop messages, so the viewport
        // visibly moved on one frame and resized on the next.
        let bounds = tauri::Rect {
            position: Position::Logical(LogicalPosition::new(x, y)),
            size: Size::Logical(LogicalSize::new(width.max(1.0), height.max(1.0))),
        };
        webview.set_bounds(bounds).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Emulate a device in a viewport webview: CDP `Emulation.*` for the device
/// characteristics, `set_zoom` for the on-screen scale.
///
/// The split is deliberate. Zoom alone (the old approach) squeezes the CSS width
/// but leaves `devicePixelRatio` at the monitor's, reports no touch and keeps the
/// desktop UA, so a "phone" got desktop layouts and 1x images — that's what CDP
/// fixes. But CDP's own `scale` field is documented as applying to the *resulting
/// view image*; a live WebView2 controller composites normally and ignores it, so
/// using it for display left the page rendering at full width and overflowing its
/// card by exactly 1/scale. `set_zoom` is the only thing that scales live output.
///
/// The two agree rather than fight: bounds are `preset × scale`, so the CSS width
/// the page sees is `bounds / zoom` = `preset`, the same value the metrics
/// override pins. Do not pass `scale` to setDeviceMetricsOverride.
#[tauri::command]
pub async fn emulate_viewport(
    app: AppHandle,
    label: String,
    width: u32,
    height: u32,
    device_scale_factor: f64,
    mobile: bool,
    touch: bool,
    scale: f64,
    user_agent: Option<String>,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let wv = match find_tab_webview(&app, &label) {
            Some(wv) => wv,
            None => return Ok(()),
        };
        // Display scale. Must be the zoom factor, not CDP's `scale` — see above.
        wv.set_zoom(scale.clamp(0.1, 1.0))
            .map_err(|e| format!("emulate_viewport zoom failed: {e}"))?;

        wv.with_webview(move |platform| {
            #[cfg(windows)]
            unsafe {
                use webview2_com::CallDevToolsProtocolMethodCompletedHandler;
                use windows_core::HSTRING;
                let core = match platform.controller().CoreWebView2() {
                    Ok(c) => c,
                    Err(e) => {
                        xevo_log!("[xevo] emulate_viewport: CoreWebView2 unavailable: {e:?}");
                        return;
                    }
                };

                let call = |method: &str, params: String| {
                    let handler = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(
                        |_r: windows_core::Result<()>, _json: String| -> windows_core::Result<()> {
                            Ok(())
                        },
                    ));
                    let _ = core.CallDevToolsProtocolMethod(
                        &HSTRING::from(method),
                        &HSTRING::from(params),
                        &handler,
                    );
                };

                call(
                    "Emulation.setDeviceMetricsOverride",
                    format!(
                        r#"{{"width":{width},"height":{height},"deviceScaleFactor":{dsf},"mobile":{mobile}}}"#,
                        dsf = device_scale_factor,
                    ),
                );
                call(
                    "Emulation.setTouchEmulationEnabled",
                    format!(r#"{{"enabled":{touch},"maxTouchPoints":{}}}"#, if touch { 5 } else { 0 }),
                );
                if let Some(ua) = &user_agent {
                    call(
                        "Emulation.setUserAgentOverride",
                        format!(r#"{{"userAgent":{}}}"#, serde_json::to_string(ua).unwrap_or_default()),
                    );
                }
            }
        })
        .map_err(|e| format!("emulate_viewport failed: {e}"))?;
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, label, width, height, device_scale_factor, mobile, touch, scale, user_agent);
        Err("Viewport emulation is only supported on Windows".to_string())
    }
}

/// Show a viewport webview
#[tauri::command]
pub async fn show_viewport(app: AppHandle, label: String) -> Result<(), String> {
    if let Some(webview) = find_tab_webview(&app, &label) {
        webview.show().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Hide a viewport webview
#[tauri::command]
pub async fn hide_viewport(app: AppHandle, label: String) -> Result<(), String> {
    if let Some(webview) = find_tab_webview(&app, &label) {
        webview.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Scroll a viewport to a relative position (0.0..1.0) for sync.
#[tauri::command]
pub async fn scroll_viewport(
    app: AppHandle,
    label: String,
    percent_x: f64,
    percent_y: f64,
) -> Result<(), String> {
    if let Some(webview) = find_tab_webview(&app, &label) {
        let script = format!(
            r#"(function() {{
  var el = document.scrollingElement || document.documentElement;
  if (!el) return;
  var maxX = Math.max(0, el.scrollWidth - el.clientWidth);
  var maxY = Math.max(0, el.scrollHeight - el.clientHeight);
  window.__xevoApplyingScrollSync = true;
  window.scrollTo(maxX * {}, maxY * {});
  setTimeout(function() {{ window.__xevoApplyingScrollSync = false; }}, 80);
}})();"#,
            percent_x.clamp(0.0, 1.0),
            percent_y.clamp(0.0, 1.0)
        );
        webview.eval(&script).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Click at a position in a viewport (for sync)
#[tauri::command]
pub async fn click_viewport(
    app: AppHandle,
    label: String,
    x: f64,
    y: f64,
) -> Result<(), String> {
    if let Some(webview) = find_tab_webview(&app, &label) {
        let script = format!(
            r#"(function() {{
  window.__xevoApplyingClickSync = true;
  var el = document.elementFromPoint({}, {});
  if (el && typeof el.click === "function") el.click();
  setTimeout(function() {{ window.__xevoApplyingClickSync = false; }}, 80);
}})();"#,
            x, y
        );
        webview.eval(&script).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Eval a raw JavaScript string into a browser or viewport webview.
#[tauri::command]
pub async fn browser_eval_raw(app: AppHandle, label: String, script: String) -> Result<(), String> {
    if let Some(wv) = find_tab_webview(&app, &label) {
        wv.eval(&script).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Result of a screenshot capture: PNG bytes + saved file path.
#[derive(serde::Serialize)]
pub struct ScreenshotResult {
    pub bytes: Vec<u8>,
    pub path: String,
}

/// Captures the active browser tab's page content as a PNG screenshot
/// using the DevTools Protocol via the WebView2 COM API.
/// Falls back to capturing the main window via PrintWindow if the
/// webview-based capture is unavailable.
#[tauri::command]
pub async fn browser_screenshot(
    app: AppHandle,
    window: tauri::WebviewWindow,
) -> Result<ScreenshotResult, String> {
    #[cfg(target_os = "windows")]
    {
        let active_label = app
            .state::<BrowserState>()
            .active_tab_label
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone();

        // Try DevTools Protocol on the active browser webview first
        let png_result = if let Some(ref label) = active_label {
            if let Some(browser_wv) = find_tab_webview(&app, label) {
                capture_browser_devtools(&browser_wv).await
            } else {
                Err("No browser webview found".to_string())
            }
        } else {
            Err("No active tab".to_string())
        };

        let png_bytes = match png_result {
            Ok(bytes) => bytes,
            Err(e) => {
                #[cfg(debug_assertions)]
                xevo_log!("[xevo] DevTools screenshot failed ({e}), falling back to PrintWindow");
                capture_main_window_printwindow(&window)?
            }
        };

        // ── Save to app screenshots directory ────────────────────────
        let screenshots_dir = app
            .path()
            .app_data_dir()
            .map_err(|e| e.to_string())?
            .join("screenshots");
        std::fs::create_dir_all(&screenshots_dir)
            .map_err(|e| format!("Failed to create screenshots dir: {e}"))?;

        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        let filename = format!("Xevo-{timestamp}.png");
        let filepath = screenshots_dir.join(&filename);

        std::fs::write(&filepath, &png_bytes)
            .map_err(|e| format!("Failed to save screenshot: {e}"))?;

        // ── Inject toast into active browser webview ─────────────────
        let toast_js = r##"(function(){
            var e=document.getElementById('__xevo_toast');
            if(e)e.remove();
            e=document.createElement('div');
            e.id='__xevo_toast';
            e.textContent='Screenshot saved';
            e.style.cssText='position:fixed;bottom:16px;right:16px;background:#1a1a2e;color:#e0e0e0;padding:10px 16px;border-radius:6px;z-index:999999;font-size:13px;font-family:monospace;box-shadow:0 4px 16px rgba(0,0,0,0.4);border:1px solid #2a2a4e;pointer-events:none;opacity:1;transition:opacity 0.2s ease';
            document.body.appendChild(e);
            setTimeout(function(){e.style.opacity='0';setTimeout(function(){if(e.parentNode)e.parentNode.removeChild(e)},200)},2500)
        })()"##;

        if let Some(label) = app
            .state::<BrowserState>()
            .active_tab_label
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
        {
            if let Some(wv) = find_tab_webview(&app, &label) {
                let _ = wv.eval(toast_js);
            }
        }

        let path_str = filepath.to_string_lossy().to_string();
        Ok(ScreenshotResult {
            bytes: png_bytes,
            path: path_str,
        })
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, window);
        Err("Screenshots are only supported on Windows".to_string())
    }
}

/// Capture the active browser webview content via Chrome DevTools Protocol.
/// Uses WebView2's `CallDevToolsProtocolMethod` to invoke `Page.captureScreenshot`
/// which returns a base64-encoded PNG.
#[cfg(target_os = "windows")]
async fn capture_browser_devtools(
    wv: &tauri::Webview,
) -> Result<Vec<u8>, String> {
    use std::sync::Arc;
    use tokio::sync::oneshot;
    use webview2_com::CallDevToolsProtocolMethodCompletedHandler;
    use base64::Engine;
    use windows_core::HSTRING;

    let (inner_tx, rx) = oneshot::channel::<Result<Vec<u8>, String>>();
    let tx = Arc::new(Mutex::new(Some(inner_tx)));
    let tx_outer = tx.clone();

    wv.with_webview(move |platform| {
        #[cfg(windows)]
        unsafe {
            let controller = platform.controller();
            let core_webview = match controller.CoreWebView2() {
                Ok(wv) => wv,
                Err(e) => {
                    if let Some(s) = tx_outer.lock().unwrap().take() {
                        let _ = s.send(Err(format!("CoreWebView2 failed: {:?}", e)));
                    }
                    return;
                }
            };

            let tx_inner = tx_outer.clone();
            let handler = CallDevToolsProtocolMethodCompletedHandler::create(
                Box::new(
                    move |result: windows_core::Result<()>, json: String|
                          -> windows_core::Result<()> {
                        let sender = tx_inner.lock().unwrap().take();
                        if let Some(s) = sender {
                            if let Err(e) = result {
                                let _ = s.send(Err(format!("DevTools failed: {:?}", e)));
                            } else {
                                match serde_json::from_str::<serde_json::Value>(&json) {
                                    Ok(v) => {
                                        if let Some(data) = v.get("data").and_then(|d| d.as_str()) {
                                            match base64::engine::general_purpose::STANDARD
                                                .decode(data)
                                            {
                                                Ok(bytes) => {
                                                    let _ = s.send(Ok(bytes));
                                                }
                                                Err(e) => {
                                                    let _ = s.send(Err(format!(
                                                        "base64 decode failed: {e}"
                                                    )));
                                                }
                                            }
                                        } else {
                                            let _ = s.send(Err(
                                                "No 'data' field in DevTools response".to_string(),
                                            ));
                                        }
                                    }
                                    Err(e) => {
                                        let _ = s.send(Err(format!(
                                            "JSON parse failed: {e}"
                                        )));
                                    }
                                }
                            }
                        }
                        Ok(())
                    },
                ),
            );

            let method = HSTRING::from("Page.captureScreenshot");
            let params =
                HSTRING::from(r#"{"format":"png","captureBeyondViewport":false,"fromSurface":true}"#);
            if let Err(e) = core_webview.CallDevToolsProtocolMethod(
                &method,
                &params,
                &handler,
            ) {
                if let Some(s) = tx_outer.lock().unwrap().take() {
                    let _ = s.send(Err(format!(
                        "CallDevToolsProtocolMethod failed: {:?}",
                        e
                    )));
                }
            }
        }
    })
    .map_err(|e| format!("with_webview error: {e}"))?;

    rx.await.map_err(|_| "Screenshot channel closed".to_string())?
}

/// Fallback: capture the main window via PrintWindow.
/// This captures the browser chrome but the webview area appears black
/// (DirectComposition limitation), so it's only used when DevTools capture fails.
#[cfg(target_os = "windows")]
fn capture_main_window_printwindow(
    window: &tauri::WebviewWindow,
) -> Result<Vec<u8>, String> {
    use raw_window_handle::HasWindowHandle;

    if window.is_minimized().unwrap_or(true) {
        return Err("Cannot screenshot a minimized window".to_string());
    }

    let handle = window.window_handle().map_err(|e| e.to_string())?;
    let hwnd_ptr = match handle.as_raw() {
        raw_window_handle::RawWindowHandle::Win32(w) => w.hwnd.get() as *mut std::ffi::c_void,
        _ => return Err("Not a Windows window".to_string()),
    };

    unsafe {
        let mut rect = RECT::default();
        if GetWindowRect(hwnd_ptr, &mut rect) == 0 {
            return Err("GetWindowRect failed".to_string());
        }

        let w = rect.right - rect.left;
        let h = rect.bottom - rect.top;

        if w <= 0 || h <= 0 {
            return Err("Window has zero or negative dimensions".to_string());
        }

        let bmi = BITMAPINFO {
            bmi_header: BITMAPINFOHEADER {
                bi_size: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                bi_width: w,
                bi_height: -h,
                bi_planes: 1,
                bi_bit_count: 32,
                bi_compression: 0,
                bi_size_image: 0,
                bi_x_pels_per_meter: 0,
                bi_y_pels_per_meter: 0,
                bi_clr_used: 0,
                bi_clr_important: 0,
            },
        };

        let screen_dc = GetDC(std::ptr::null_mut());
        if screen_dc.is_null() {
            return Err("GetDC failed".to_string());
        }

        let mem_dc = CreateCompatibleDC(screen_dc);
        if mem_dc.is_null() {
            ReleaseDC(std::ptr::null_mut(), screen_dc);
            return Err("CreateCompatibleDC failed".to_string());
        }

        let mut bits: *mut u8 = std::ptr::null_mut();
        let hbmp = CreateDIBSection(
            screen_dc,
            &bmi as *const BITMAPINFO,
            0,
            &mut bits,
            std::ptr::null_mut(),
            0,
        );

        if hbmp.is_null() || bits.is_null() {
            DeleteDC(mem_dc);
            ReleaseDC(std::ptr::null_mut(), screen_dc);
            return Err("CreateDIBSection failed".to_string());
        }

        let old_bmp = SelectObject(mem_dc, hbmp as *mut std::ffi::c_void);

        let print_ok = PrintWindow(hwnd_ptr, mem_dc, 0x03) != 0;

        SelectObject(mem_dc, old_bmp);  // restore before cleaning up

        if !print_ok {
            DeleteObject(hbmp as *mut std::ffi::c_void);
            DeleteDC(mem_dc);
            ReleaseDC(std::ptr::null_mut(), screen_dc);
            return Err("PrintWindow failed".to_string());
        }

        let pixel_count = (w * h * 4) as usize;
        let mut pixels = vec![0u8; pixel_count];
        std::ptr::copy_nonoverlapping(bits, pixels.as_mut_ptr(), pixel_count);

        for chunk in pixels.chunks_exact_mut(4) {
            chunk.swap(0, 2);
        }

        DeleteObject(hbmp as *mut std::ffi::c_void);
        DeleteDC(mem_dc);
        ReleaseDC(std::ptr::null_mut(), screen_dc);

        let img = image::RgbaImage::from_raw(w as u32, h as u32, pixels)
            .ok_or("Failed to create image from raw pixels")?;

        let mut buf = std::io::Cursor::new(Vec::new());
        img.write_to(&mut buf, image::ImageFormat::Png)
            .map_err(|e| e.to_string())?;

        Ok(buf.into_inner())
    }
}

// ── Win32 GDI FFI for screenshot capture ────────────────
#[cfg(target_os = "windows")]
#[repr(C)]
struct RECT {
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
}

#[cfg(target_os = "windows")]
impl Default for RECT {
    fn default() -> Self {
        Self {
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
        }
    }
}

#[cfg(target_os = "windows")]
#[repr(C)]
struct BITMAPINFOHEADER {
    bi_size: u32,
    bi_width: i32,
    bi_height: i32,
    bi_planes: u16,
    bi_bit_count: u16,
    bi_compression: u32,
    bi_size_image: u32,
    bi_x_pels_per_meter: i32,
    bi_y_pels_per_meter: i32,
    bi_clr_used: u32,
    bi_clr_important: u32,
}

#[cfg(target_os = "windows")]
#[repr(C)]
struct BITMAPINFO {
    bmi_header: BITMAPINFOHEADER,
}

#[cfg(target_os = "windows")]
extern "system" {
    fn GetWindowRect(
        hWnd: *mut std::ffi::c_void,
        lpRect: *mut RECT,
    ) -> i32;
    fn GetDC(hWnd: *mut std::ffi::c_void) -> *mut std::ffi::c_void;
    fn ReleaseDC(
        hWnd: *mut std::ffi::c_void,
        hDC: *mut std::ffi::c_void,
    ) -> i32;
    fn CreateCompatibleDC(
        hdc: *mut std::ffi::c_void,
    ) -> *mut std::ffi::c_void;
    fn SelectObject(
        hdc: *mut std::ffi::c_void,
        h: *mut std::ffi::c_void,
    ) -> *mut std::ffi::c_void;
    fn DeleteDC(hdc: *mut std::ffi::c_void) -> i32;
    fn DeleteObject(h: *mut std::ffi::c_void) -> i32;
    fn PrintWindow(
        hWnd: *mut std::ffi::c_void,
        hDCBlt: *mut std::ffi::c_void,
        nFlags: u32,
    ) -> i32;
    fn CreateDIBSection(
        hdc: *mut std::ffi::c_void,
        pbmi: *const BITMAPINFO,
        usage: u32,
        ppvBits: *mut *mut u8,
        hSection: *mut std::ffi::c_void,
        offset: u32,
    ) -> *mut std::ffi::c_void;
}

/// Called by a viewport webview's scroll listener to notify the frontend.
/// The frontend's useViewportSync hook then syncs other viewports.
#[tauri::command]
pub async fn notify_viewport_scroll(
    app: AppHandle,
    source_label: String,
    percent_x: f64,
    percent_y: f64,
) -> Result<(), String> {
    app.emit(
        "viewport://scroll",
        serde_json::json!({
            "sourceLabel": source_label,
            "percentX": percent_x,
            "percentY": percent_y,
        }),
    )
    .map_err(|e| e.to_string())
}

/// Called by a viewport webview's click listener to notify the frontend.
#[tauri::command]
pub async fn notify_viewport_click(
    app: AppHandle,
    source_label: String,
    x: f64,
    y: f64,
) -> Result<(), String> {
    app.emit(
        "viewport://click",
        serde_json::json!({
            "sourceLabel": source_label,
            "x": x,
            "y": y,
        }),
    )
    .map_err(|e| e.to_string())
}

/// Called by a viewport webview's input listener to notify the frontend.
/// The frontend's useViewportSync hook then mirrors input to other viewports.
#[tauri::command]
pub async fn notify_viewport_input(
    app: AppHandle,
    source_label: String,
    selector: String,
    value: String,
    checked: Option<bool>,
    input_type: String,
) -> Result<(), String> {
    app.emit(
        "viewport://input",
        serde_json::json!({
            "sourceLabel": source_label,
            "selector": selector,
            "value": value,
            "checked": checked,
            "inputType": input_type,
        }),
    )
    .map_err(|e| e.to_string())
}

/// Called by a viewport webview's metrics probe to notify the frontend.
#[tauri::command]
pub async fn notify_viewport_metrics(
    app: AppHandle,
    source_label: String,
    inner_width: f64,
    inner_height: f64,
    device_pixel_ratio: f64,
    touch: bool,
    user_agent: String,
) -> Result<(), String> {
    app.emit(
        "viewport://metrics",
        serde_json::json!({
            "sourceLabel": source_label,
            "innerWidth": inner_width,
            "innerHeight": inner_height,
            "devicePixelRatio": device_pixel_ratio,
            "touch": touch,
            "userAgent": user_agent,
        }),
    )
    .map_err(|e| e.to_string())
}

// ─── Tab State Save/Restore ────────────────────────────────────────

/// Ask a tab's webview to capture its state (scroll + forms).
/// The webview's init script will call browser_tab_state_saved back with the result.
#[tauri::command]
pub async fn browser_save_tab_state(
    app: AppHandle,
    tab_id: String,
) -> Result<(), String> {
    let label = webview_label_for_tab(&tab_id);
    let wv = find_tab_webview(&app, &label)
        .ok_or_else(|| format!("no webview for tab {}", tab_id))?;

    let capture_script = r#"(function() {
        try {
            var scrollX = window.scrollX || document.documentElement.scrollLeft || 0;
            var scrollY = window.scrollY || document.documentElement.scrollTop || 0;
            var inputs = document.querySelectorAll('input, textarea, select');
            var formState = [];
            for (var i = 0; i < inputs.length; i++) {
                var el = inputs[i];
                var s = { i: i, tag: el.tagName, type: el.type || '', name: el.name || '' };
                if (el.type === 'checkbox' || el.type === 'radio') {
                    s.checked = el.checked;
                } else if (el.tagName === 'SELECT') {
                    s.selectedIndex = el.selectedIndex;
                } else {
                    s.value = el.value;
                }
                if (el.isContentEditable) {
                    s.html = el.innerHTML;
                }
                formState.push(s);
            }
            var stateJson = JSON.stringify({ scrollX: scrollX, scrollY: scrollY, formState: formState });
            if (window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke) {
                window.__TAURI_INTERNALS__.invoke('browser_tab_state_saved', {
                    tabId: window.__XEVO_TAB_ID || '',
                    stateJson: stateJson
                }).catch(function(){});
            }
        } catch(e) {}
    })()"#;

    wv.eval(capture_script)
        .map_err(|e| format!("browser_save_tab_state eval failed: {}", e))?;

    Ok(())
}

/// Called by the webview's JS after capturing state.
/// Emits the state to the frontend for storage.
#[tauri::command]
pub fn browser_tab_state_saved(
    app: AppHandle,
    tab_id: String,
    state_json: String,
) -> Result<(), String> {
    app.emit("browser://tab-state-saved", serde_json::json!({
        "tabId": tab_id,
        "stateJson": state_json,
    }))
    .map_err(|e| e.to_string())
}

/// Restore a tab's scroll position and form input values from a JSON string.
#[tauri::command]
pub async fn browser_restore_tab_state(
    app: AppHandle,
    tab_id: String,
    state_json: String,
) -> Result<(), String> {
    let label = webview_label_for_tab(&tab_id);
    let wv = find_tab_webview(&app, &label)
        .ok_or_else(|| format!("no webview for tab {}", tab_id))?;

    // ponytail: state_json is already valid JSON — embed directly as JS expression, no string escaping
    let restore_script = format!(
        r#"(function() {{
            try {{
                var state = {state_json};
                if (state.scrollX || state.scrollY) {{
                    window.scrollTo(state.scrollX || 0, state.scrollY || 0);
                }}
                if (state.formState && state.formState.length > 0) {{
                    var inputs = document.querySelectorAll('input, textarea, select');
                    for (var j = 0; j < state.formState.length; j++) {{
                        var s = state.formState[j];
                        var el = inputs[s.i];
                        if (!el) continue;
                        if (s.type === 'checkbox' || s.type === 'radio') {{
                            el.checked = s.checked;
                        }} else if (s.tag === 'SELECT') {{
                            el.selectedIndex = s.selectedIndex;
                        }} else if (el.isContentEditable && s.html !== undefined) {{
                            el.innerHTML = s.html;
                        }} else {{
                            el.value = s.value;
                        }}
                        el.dispatchEvent(new Event('input', {{ bubbles: true }}));
                        el.dispatchEvent(new Event('change', {{ bubbles: true }}));
                    }}
                }}
            }} catch(e) {{
                console.warn('[xevo] restore state failed:', e);
            }}
        }})()"#
    );

    wv.eval(&restore_script)
        .map_err(|e| format!("browser_restore_tab_state eval failed: {}", e))?;

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
    use super::url_matches;

    #[test]
    fn glob_matching() {
        // the exact bug this fixes: the UI's default pattern is "*"
        assert!(url_matches("*", "http://localhost:3000/"));
        assert!(url_matches("", "http://localhost:3000/"));
        assert!(url_matches("  *  ", "http://localhost:3000/"));

        assert!(url_matches("localhost:3000/*", "http://localhost:3000/api/x"));
        assert!(url_matches("*/api/*", "http://localhost:3000/api/x"));
        assert!(url_matches("HTTP://LOCALHOST*", "http://localhost:3000/"));
        assert!(url_matches("http://localhost:3000/api", "http://localhost:3000/api"));
        // wildcard-free patterns are prefix matches — "this host" is the common intent
        assert!(url_matches("http://localhost:3000/api", "http://localhost:3000/api/x"));
        assert!(url_matches("localhost:5000", "http://localhost:5000/api"));

        assert!(!url_matches("localhost:3000/*", "http://example.com/"));
        assert!(!url_matches("*/api", "http://localhost:3000/api/x"));

        // the leak this closes: a pattern must not match a substring buried
        // in a foreign origin's query string
        assert!(!url_matches("localhost:5000", "https://evil.com/?next=localhost:5000"));
    }
}

