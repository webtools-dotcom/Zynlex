use tauri::webview::{PageLoadEvent, WebviewWindowBuilder};
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Position, Size, WebviewUrl, WebviewWindow};
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::collections::HashMap;
use std::time::Instant;

use crate::BrowserState;
use tauri_plugin_opener::OpenerExt;

// Shared data directory for all browser webviews. WebView2 automatically shares
// browser/GPU/network processes when webviews use the same data directory.
static SHARED_WEBVIEW_DATA_DIR: OnceLock<PathBuf> = OnceLock::new();

static NETWORK_REQUEST_META: OnceLock<Mutex<HashMap<String, (Instant, String)>>> = OnceLock::new();

fn shared_webview_data_dir(app: &AppHandle) -> PathBuf {
    SHARED_WEBVIEW_DATA_DIR
        .get_or_init(|| {
            let mut path = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| PathBuf::from("."));
            path.push("webview-data");
            path
        })
        .clone()
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

// ── CORE_SCRIPT: tab info + shortcut forwarding. Injected into EVERY tab.
// Small (~50 lines) — always present so titles/favicons work and keyboard
// shortcuts reach the frontend even from within the webview.
const CORE_SCRIPT: &str = r##"
(function() {

// ── TAB INFO (title / favicon) ───────────────────────────────────
if (!window.__xevoTabInfoDone) {
  window.__xevoTabInfoDone = true;

  function xevoSendPageInfo() {
    try {
      var title = document.title || "";
      var url = window.location.href || "";
      var favicon = null;
      var selectors = [
        'link[rel="icon"][href]',
        'link[rel="shortcut icon"][href]',
        'link[rel="apple-touch-icon"][href]'
      ];
      for (var i = 0; i < selectors.length; i++) {
        var el = document.querySelector(selectors[i]);
        if (el && el.href) { favicon = el.href; break; }
      }
      var tabId = window.__XEVO_TAB_ID || "";
      if (window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke) {
        window.__TAURI_INTERNALS__.invoke("update_tab_info", {
          tabId: tabId,
          title: title,
          url: url,
          favicon: favicon
        }).catch(function() {});
      }
    } catch (e) {}
  }

  document.addEventListener("DOMContentLoaded", xevoSendPageInfo);
  window.addEventListener("load", xevoSendPageInfo);

  var titleEl = document.querySelector("title");
  if (titleEl) {
    var titleDebounceTimer = null;
    var obs = new MutationObserver(function() {
      if (titleDebounceTimer) clearTimeout(titleDebounceTimer);
      titleDebounceTimer = setTimeout(function() {
        titleDebounceTimer = null;
        xevoSendPageInfo();
      }, 300);
    });
    obs.observe(titleEl, { characterData: true, childList: true });
  }
}

// ── SHORTCUT FORWARDING ──────────────────────────────────────────
var SHORTCUTS = {
  "k": "ctrl+k", "t": "ctrl+t", "w": "ctrl+w", "b": "ctrl+b",
  ",": "ctrl+,", "l": "ctrl+l", "1": "ctrl+1", "2": "ctrl+2",
  "3": "ctrl+3", "4": "ctrl+4", "5": "ctrl+5", "6": "ctrl+6",
  "7": "ctrl+7", "8": "ctrl+8", "9": "ctrl+9"
};

function isEditableTarget(t) {
  if (!t) return false;
  var tag = (t.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if (t.isContentEditable) return true;
  return false;
}

function forwardShortcut(shortcut) {
  try {
    if (window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke) {
      window.__TAURI_INTERNALS__.invoke("forward_shortcut", { shortcut: shortcut }).catch(function() {});
    }
  } catch (err) {}
}

function blockEvent(e) {
  e.preventDefault();
  e.stopPropagation();
  if (e.stopImmediatePropagation) e.stopImmediatePropagation();
}

document.addEventListener("keydown", function(e) {
  if (e.key === "Escape") { blockEvent(e); forwardShortcut("escape"); return; }
  if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
    if (e.key === "ArrowLeft") { blockEvent(e); forwardShortcut("alt+left"); return; }
    if (e.key === "ArrowRight") { blockEvent(e); forwardShortcut("alt+right"); return; }
  }
  if (!(e.ctrlKey || e.metaKey)) return;
  if (e.shiftKey && !e.altKey && (e.key === "T" || e.key === "t")) { blockEvent(e); forwardShortcut("ctrl+shift+t"); return; }
  if (e.shiftKey && !e.altKey && e.key === "Tab") { blockEvent(e); forwardShortcut("ctrl+shift+tab"); return; }
  if (e.shiftKey && !e.altKey && (e.key === "?" || e.key === "/")) { blockEvent(e); forwardShortcut("ctrl+?"); return; }
  if (isEditableTarget(e.target)) return;
  if (e.shiftKey || e.altKey) return;
  var mapping = SHORTCUTS[(e.key || "").toLowerCase()];
  if (mapping) { blockEvent(e); forwardShortcut(mapping); }
}, true);

})();
"##;

// ── HEADER_INJECTION_SCRIPT: fetch/XHR header injection.
// ponytail: done at the page level because WebView2 COM SetHeader in the
// WebResourceRequested handler returns Ok without actually sending the header.
const HEADER_INJECTION_SCRIPT: &str = r##"
(function() {
  if (window.__xevoHeaderInjectionDone) return;
  window.__xevoHeaderInjectionDone = true;

  function xevoGetRules() { return window.__XEVO_HEADER_RULES || []; }

  function xevoUrlMatches(pattern, url) {
    if (!pattern || pattern === '*') return true;
    try {
      var re = new RegExp(pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*'));
      return re.test(url);
    } catch (e) { return false; }
  }

  function xevoHeadersForUrl(url) {
    var headers = {};
    var rules = xevoGetRules();
    for (var i = 0; i < rules.length; i++) {
      var r = rules[i];
      if (r && r.enabled && xevoUrlMatches(r.pattern, url)) headers[r.name] = r.value;
    }
    return headers;
  }

  var origFetch = window.fetch;
  window.fetch = function(input, init) {
    try {
      var url = null;
      if (typeof input === 'string') url = new URL(input, window.location.href).href;
      else if (input && typeof input.href === 'string') url = input.href;
      else if (input && typeof input.url === 'string') url = input.url;

      if (url) {
        var toAdd = xevoHeadersForUrl(url);
        var names = Object.keys(toAdd);
        if (names.length) {
          var baseHeaders = (init && init.headers) ? init.headers : (input && typeof input.headers === 'object' ? input.headers : {});
          var h = new Headers(baseHeaders);
          for (var i = 0; i < names.length; i++) h.set(names[i], toAdd[names[i]]);
          init = Object.assign({}, init, { headers: h });
        }
      }
    } catch (e) {}
    return origFetch.call(this, input, init);
  };

  var origOpen = XMLHttpRequest.prototype.open;
  var origSend = XMLHttpRequest.prototype.send;
  var xhrUrlMap = new WeakMap();

  XMLHttpRequest.prototype.open = function(method, url) {
    try { xhrUrlMap.set(this, new URL(url, window.location.href).href); } catch (e) {}
    return origOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function() {
    try {
      var url = xhrUrlMap.get(this);
      if (url) {
        var toAdd = xevoHeadersForUrl(url);
        for (var name in toAdd) this.setRequestHeader(name, toAdd[name]);
      }
    } catch (e) {}
    return origSend.apply(this, arguments);
  };
})();
"##;

// ─── Helpers ─────────────────────────────────────────────────────────

fn webview_label_for_tab(tab_id: &str) -> String {
    format!("browser-{}", tab_id)
}

/// Hide all browser-* webviews EXCEPT the one with the given label.
/// This is the authoritative way to ensure exactly one webview is visible.
/// Called before showing a new webview to prevent orphan floating windows.
fn hide_all_browser_webviews_except(app: &AppHandle, state: &crate::BrowserState, except_label: &str) {
    // Hide via Tauri's built-in registry
    for (label, wv) in app.webview_windows() {
        if label.starts_with("browser-") && label != except_label {
            let _ = wv.hide();
        }
    }
    // Also hide via our persistent handle map — webviews whose strong refs
    // we hold may not appear in app.webview_windows() (Tauri #14843).
    if let Ok(webviews) = state.webviews.lock() {
        for (label, wv) in webviews.iter() {
            if label.starts_with("browser-") && label != except_label {
                let _ = wv.hide();
            }
        }
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

/// Build a WebviewWindow for a tab. Injects per-tab __XEVO_TAB_ID plus
/// all shared init scripts (core, chrome features, JSON viewer).
fn create_webview_for_tab(
    app: &AppHandle,
    main_window: &WebviewWindow,
    tab_id: &str,
    url: &str,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    show_immediately: bool,
) -> Result<WebviewWindow, String> {
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

    // Per-tab init script that sets __XEVO_TAB_ID and active header rules.
    let rules_json = crate::commands::headers::current_rules_json();
    let tab_id_init = format!("window.__XEVO_TAB_ID = \"{}\"; window.__XEVO_HEADER_RULES = {};", tab_id, rules_json);

    let state = app.state::<BrowserState>();
    let user_agent = state.user_agent.lock().unwrap_or_else(|e| e.into_inner()).clone();

    let mut builder = WebviewWindowBuilder::new(app, &label, WebviewUrl::External(url::Url::parse("about:blank").expect("about:blank must parse")))
        .parent(main_window)
        .map_err(|e| e.to_string())?
        .decorations(false)
        .resizable(false)
        .inner_size(width, height)
        .position(x, y)
        .data_directory(shared_webview_data_dir(app))
        .initialization_script(&tab_id_init)
        .initialization_script(HEADER_INJECTION_SCRIPT)
        .initialization_script(CORE_SCRIPT)
        .initialization_script(CHROME_FEATURES_SCRIPT)
        .initialization_script(JSON_VIEWER_SCRIPT);

    if let Some(ref ua) = user_agent {
        builder = builder.user_agent(ua);
    }

    let webview = builder
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
            .build()
            .map_err(|e| e.to_string())?;

    register_webview_network_capture(&webview, app, tab_id);

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
    window: tauri::WebviewWindow,
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
            eprintln!("[XEVO-LIFECYCLE] browser_create_tab — destroying stale handle for label={}", label);
            let _ = old_wv.destroy();
        }
    }

    // Destroy any orphan webview in Tauri's registry with this label.
    if let Some(orphan) = app.get_webview_window(&label) {
        eprintln!("[XEVO-LIFECYCLE] browser_create_tab — destroying orphan label={}", label);
        let _ = orphan.destroy();
    }

    // Guard: if a webview with this label now exists in Tauri OR in our
    // persistent map, no-op.
    {
        let webviews = state.webviews.lock().unwrap_or_else(|e| e.into_inner());
        if app.get_webview_window(&label).is_some() || webviews.contains_key(&label) {
            eprintln!("[XEVO-LIFECYCLE] browser_create_tab — label={} already exists, no-op", label);
            return Ok(());
        }
    }

    eprintln!("[XEVO-LIFECYCLE] browser_create_tab — creating label={} url={} x={} y={} w={} h={}", label, resolved, x, y, width, height);

    // Hide ALL other browser webviews — this is authoritative.
    // The old approach (hide only active_tab_label) missed webviews hidden
    // by the frontend without updating the backend, causing orphan floating
    // windows that became "stuck".
    hide_all_browser_webviews_except(&app, &state, &label);

    // Don't show the webview if the main window is minimized.
    // The Focused(true) restore handler in lib.rs will show it on restore.
    let is_minimized = window.is_minimized().unwrap_or(false);
    eprintln!("[XEVO-LIFECYCLE] browser_create_tab — label={} is_minimized={} show_immediately={}", label, is_minimized, !is_minimized);

    let webview = create_webview_for_tab(
        &app, &window, &tab_id, &resolved, x, y, width, height, !is_minimized,
    )?;

    // Store a persistent strong reference to prevent the WebviewWindow
    // from being destroyed when this async function returns (Tauri #14843).
    // Without this, the handle drops and the OS window disappears, causing
    // browser_set_bounds to find only ["main"].
    {
        let mut webviews = state.webviews.lock().unwrap_or_else(|e| e.into_inner());
        // Race check: another call may have created this webview while we were
        // creating ours. If so, drop our duplicate to avoid orphaning theirs.
        if webviews.contains_key(&label) {
            eprintln!("[XEVO-LIFECYCLE] browser_create_tab — RACE: label={} already in map, dropping duplicate", label);
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
    let exists = app.get_webview_window(&label).is_some();
    eprintln!("[XEVO-LIFECYCLE] browser_close_tab — label={} tab_id={} exists_before={}", label, tab_id, exists);
    // Remove from our persistent map FIRST — this is the authoritative source
    // of strong references. The handle will drop after removal, allowing the
    // OS window to be destroyed naturally (confirming the close on Rust's side).
    state.webviews.lock().unwrap_or_else(|e| e.into_inner()).remove(&label);
    if let Some(wv) = app.get_webview_window(&label) {
        wv.close().map_err(|e| e.to_string())?;
        eprintln!("[XEVO-LIFECYCLE] browser_close_tab — label={} closed OK, still_exists={}", label, app.get_webview_window(&label).is_some());
    } else {
        eprintln!("[XEVO-LIFECYCLE] browser_close_tab — label={} not found (already closed?)", label);
    }
    // If this was the active tab, clear the tracker
    let mut active = state.active_tab_label.lock().unwrap_or_else(|e| e.into_inner());
    if active.as_deref() == Some(&label) {
        *active = None;
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
    if let Some(wv) = app.get_webview_window(&label) {
        wv.navigate(resolved.parse().map_err(|e: url::ParseError| e.to_string())?)
            .map_err(|e| {
                #[cfg(debug_assertions)]
                eprintln!("[xevo] browser_navigate_tab failed: {e}");
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
    eprintln!("[XEVO-BOUNDS] browser_set_bounds called — label={} x={} y={} w={} h={}", label, x, y, width, height);
    // Try Tauri's registry first, then fallback to our persistent handle map
    let wv = app.get_webview_window(&label)
        .or_else(|| state.webviews.lock().unwrap_or_else(|e| e.into_inner()).get(&label).cloned());
    if let Some(wv) = wv {
        eprintln!("[XEVO-BOUNDS] browser_set_bounds — webview found, calling set_position");
        if let Err(e) = wv.set_position(Position::Logical(LogicalPosition::new(x, y))) {
            eprintln!("[XEVO-BOUNDS] browser_set_bounds — set_position ERROR: {}", e);
            return Err(format!("set_position failed: {}", e));
        }
        eprintln!("[XEVO-BOUNDS] browser_set_bounds — set_position OK, calling set_size");
        if let Err(e) = wv.set_size(Size::Logical(LogicalSize::new(width.max(1.0), height.max(1.0)))) {
            eprintln!("[XEVO-BOUNDS] browser_set_bounds — set_size ERROR: {}", e);
            return Err(format!("set_size failed: {}", e));
        }
        eprintln!("[XEVO-BOUNDS] browser_set_bounds — both OK");
    } else {
        eprintln!("[XEVO-BOUNDS] browser_set_bounds — webview NOT FOUND for label: {}", label);
        // Diagnostic: dump all registered webview labels to understand why lookup failed
        let all_labels: Vec<String> = app.webview_windows()
            .iter()
            .map(|(l, _)| l.clone())
            .collect();
        eprintln!("[XEVO-BOUNDS] browser_set_bounds — registered webview labels: {:?}", all_labels);
        let stored_labels: Vec<String> = state.webviews.lock().unwrap_or_else(|e| e.into_inner()).keys().cloned().collect();
        eprintln!("[XEVO-BOUNDS] browser_set_bounds — stored webview labels: {:?}", stored_labels);
    }
    Ok(())
}

// ─── Navigation (per-tab) ────────────────────────────────────────────

#[tauri::command]
pub async fn browser_go_back(app: AppHandle, tab_id: String) -> Result<(), String> {
    let label = webview_label_for_tab(&tab_id);
    if let Some(wv) = app.get_webview_window(&label) {
        wv.eval("window.history.back()")
            .map_err(|e| format!("browser_go_back eval failed: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn browser_go_forward(app: AppHandle, tab_id: String) -> Result<(), String> {
    let label = webview_label_for_tab(&tab_id);
    if let Some(wv) = app.get_webview_window(&label) {
        wv.eval("window.history.forward()")
            .map_err(|e| format!("browser_go_forward eval failed: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn browser_reload(app: AppHandle, tab_id: String) -> Result<(), String> {
    let label = webview_label_for_tab(&tab_id);
    if let Some(wv) = app.get_webview_window(&label) {
        wv.eval("window.location.reload()")
            .map_err(|e| format!("browser_reload eval failed: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn browser_stop_loading(app: AppHandle, tab_id: String) -> Result<(), String> {
    let label = webview_label_for_tab(&tab_id);
    if let Some(wv) = app.get_webview_window(&label) {
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
    let wv = app
        .get_webview_window(&label)
        .ok_or_else(|| "browser webview not found for tab".to_string())?;
    // ponytail: script_body already JS-escaped via js_string_literal — no re-escaping needed
    let wrapped = format!("(function() {{ {} }})();", script_body);
    wv.eval(&wrapped).map_err(|e| {
        #[cfg(debug_assertions)]
        eprintln!("[xevo] browser find eval failed: {e}");
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

#[tauri::command]
pub async fn browser_set_theme(app: AppHandle, theme: String) -> Result<(), String> {
    let scheme = if theme == "light" { "light" } else { "dark" };
    let script = format!(
        r#"(function() {{
  try {{
    var t = "{scheme}";
    document.documentElement.style.colorScheme = t;
    var meta = document.querySelector('meta[name="color-scheme"]');
    if (!meta) {{
      meta = document.createElement("meta");
      meta.name = "color-scheme";
      if (document.head) document.head.appendChild(meta);
    }}
    meta.content = t;
  }} catch (e) {{}}
}})();"#
    );
    // Apply to ALL browser webviews (all labels starting with "browser-")
    for (_, wv) in app.webview_windows() {
        if wv.label().starts_with("browser-") {
            if let Err(e) = wv.eval(&script) {
                #[cfg(debug_assertions)]
                eprintln!("[xevo] theme eval failed for {}: {}", wv.label(), e);
            }
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
    eprintln!("[XEVO-LIFECYCLE] browser_hide_tab — label={}", label);
    let wv = app.get_webview_window(&label)
        .or_else(|| state.webviews.lock().unwrap_or_else(|e| e.into_inner()).get(&label).cloned());
    if let Some(wv) = wv {
        wv.hide().map_err(|e| format!("failed to hide tab: {e}"))?;
        eprintln!("[XEVO-LIFECYCLE] browser_hide_tab — label={} hidden OK", label);
        // Clear active_tab_label if we just hid the tracked webview.
        // This prevents stale state where active_tab_label points to a
        // hidden webview — which causes orphan floating windows on restore.
        let mut active = state.active_tab_label.lock().unwrap_or_else(|e| e.into_inner());
        if active.as_deref() == Some(&label) {
            *active = None;
        }
    } else {
        eprintln!("[XEVO-LIFECYCLE] browser_hide_tab — label={} not found", label);
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
    eprintln!("[XEVO-BOUNDS] browser_show_tab called — label={}", label);
    // Try Tauri's registry first, then fallback to our persistent handle map
    let wv = app.get_webview_window(&label)
        .or_else(|| state.webviews.lock().unwrap_or_else(|e| e.into_inner()).get(&label).cloned());
    if let Some(wv) = wv {
        wv.set_position(Position::Logical(LogicalPosition::new(x, y)))
            .map_err(|e| format!("failed to set position: {e}"))?;
        wv.set_size(Size::Logical(LogicalSize::new(width.max(1.0), height.max(1.0))))
            .map_err(|e| format!("failed to set size: {e}"))?;
        wv.show().map_err(|e| format!("failed to show tab: {e}"))?;
        // Restore active_tab_label after showing — browser_hide_tab may have
        // cleared it, which causes the Focused(true) restore handler in lib.rs
        // to skip showing the webview on minimize-restore.
        *state.active_tab_label.lock().unwrap_or_else(|e| e.into_inner()) = Some(label.clone());
        eprintln!("[XEVO-BOUNDS] browser_show_tab — restored active_tab_label to {}", label);
    } else {
        eprintln!("[XEVO-BOUNDS] browser_show_tab — webview NOT FOUND for label: {}", label);
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
pub fn apply_memory_target(wv: &tauri::WebviewWindow, low: bool) {
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
                            eprintln!("[xevo] SetMemoryUsageTargetLevel failed: {e:?}");
                        }
                    }
                    Err(e) => eprintln!("[xevo] ICoreWebView2_19 unavailable: {e:?}"),
                },
                Err(e) => eprintln!("[xevo] CoreWebView2() failed: {e:?}"),
            }
        }
    });
}

/// `low: true` hints WebView2 to reduce memory usage for background tabs.
/// `low: false` resets to normal memory target for the active tab.
#[tauri::command]
pub async fn browser_set_memory_target(
    app: AppHandle,
    state: tauri::State<'_, crate::BrowserState>,
    tab_id: String,
    low: bool,
) -> Result<(), String> {
    let label = webview_label_for_tab(&tab_id);
    eprintln!("[XEVO-LIFECYCLE] browser_set_memory_target — label={} low={}", label, low);
    let wv = app.get_webview_window(&label)
        .or_else(|| state.webviews.lock().unwrap_or_else(|e| e.into_inner()).get(&label).cloned())
        .ok_or_else(|| {
            eprintln!("[XEVO-LIFECYCLE] browser_set_memory_target — label={} NOT FOUND", label);
            format!("no webview for tab {}", tab_id)
        })?;
    apply_memory_target(&wv, low);
    Ok(())
}

// ─── Network Capture ──────────────────────────────────────────────

pub fn register_webview_network_capture(wv: &tauri::WebviewWindow, app: &tauri::AppHandle, tab_id: &str) {
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
            use windows_core::BOOL;
            use windows_core::Interface;

            let core = match platform.controller().CoreWebView2() {
                Ok(core) => core,
                Err(e) => {
                    eprintln!("[xevo] CoreWebView2() failed for network capture: {e:?}");
                    return;
                }
            };

            if let Err(e) = core.AddWebResourceRequestedFilter(
                windows::core::w!("*"),
                COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL,
            ) {
                eprintln!("[xevo] AddWebResourceRequestedFilter failed: {e:?}");
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

                // ponytail: header injection lives in HEADER_INJECTION_SCRIPT
                // (page-level fetch/XHR patch) because COM SetHeader returns Ok
                // here but the destination server still receives no headers.

                let mut method_ptr = PWSTR::null();
                let mut uri_ptr = PWSTR::null();
                let _ = request.Method(&mut method_ptr);
                let _ = request.Uri(&mut uri_ptr);

                let method = if method_ptr.is_null() { String::new() } else { method_ptr.to_string().unwrap_or_default() };
                let uri = if uri_ptr.is_null() { String::new() } else { uri_ptr.to_string().unwrap_or_default() };

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
                    map.insert(meta_key, (now, resource_type.to_string()));
                    // ponytail: entries removed on response — no cap needed
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
                Ok(()) => eprintln!("[XEVO] WebResourceRequested handler registered — token={token}"),
                Err(e) => eprintln!("[XEVO] WebResourceRequested handler FAILED: {e:?}"),
            }

            let core2: ICoreWebView2_2 = match core.cast() {
                Ok(c) => c,
                Err(e) => {
                    eprintln!("[xevo] ICoreWebView2_2 cast failed: {e:?}");
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
                        if let Some((req_time, rt)) = map.remove(&meta_key) {
                            let dur = now.duration_since(req_time);
                            (dur.as_millis() as u64, rt)
                        } else {
                            (0, "other".to_string())
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

// ─── Inspector ────────────────────────────────────────────────────

#[tauri::command]
pub async fn browser_eval_inspector(
    app: AppHandle,
    tab_id: String,
    inspector_type: String,
) -> Result<(), String> {
    let label = webview_label_for_tab(&tab_id);
    let wv = app
        .get_webview_window(&label)
        .ok_or_else(|| format!("No webview for tab {}", tab_id))?;

    let script = match inspector_type.as_str() {
        "meta" => format!(
            r#"(function() {{
  try {{
    var metas = Array.from(document.querySelectorAll('meta')).map(function(m) {{
      return {{
        name: m.getAttribute('name') || m.getAttribute('property') || m.getAttribute('http-equiv') || '',
        content: m.getAttribute('content') || '',
        charset: m.getAttribute('charset'),
        httpEquiv: m.getAttribute('http-equiv')
      }};
    }});
    var canonical = (document.querySelector('link[rel="canonical"]') || {{}}).href || null;
    var ldJson = [];
    var ldScripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (var i = 0; i < ldScripts.length; i++) {{
      try {{
        ldJson.push(JSON.parse(ldScripts[i].textContent));
      }} catch(e) {{
        // skip invalid JSON-LD
      }}
    }}
    var result = {{
      metas: metas,
      title: document.title,
      canonical: canonical,
      url: location.href,
      ldJson: ldJson.length > 0 ? ldJson : undefined
    }};
    if (window.__TAURI_INTERNALS__) {{
      window.__TAURI_INTERNALS__.invoke('inspector_data', {{
        tabId: '{}',
        dataType: 'meta',
        data: result
      }}).catch(function() {{}});
    }} else {{
      console.warn('[xevo] __TAURI_INTERNALS__ not available — cannot send meta inspector data');
    }}
  }} catch(e) {{
    if (window.__TAURI_INTERNALS__) {{
      window.__TAURI_INTERNALS__.invoke('inspector_data', {{
        tabId: '{}',
        dataType: 'meta',
        data: {{ error: String(e), metas: [], title: '', canonical: null, url: location.href }}
      }}).catch(function() {{}});
    }}
  }}
}})();
"#,
            tab_id, tab_id
        ),

        "cookies" => format!(
            r#"(function() {{
  try {{
    var cookieStr = document.cookie;
    var cookies = [];
    if (cookieStr.trim()) {{
      cookies = cookieStr.split(';').map(function(c) {{
        var eqIdx = c.indexOf('=');
        if (eqIdx < 0) return null;
        return {{
          name: c.slice(0, eqIdx).trim(),
          value: c.slice(eqIdx + 1).trim()
        }};
      }}).filter(Boolean);
    }}
    if (window.__TAURI_INTERNALS__) {{
      window.__TAURI_INTERNALS__.invoke('inspector_data', {{
        tabId: '{}',
        dataType: 'cookies',
        data: {{ cookies: cookies, url: location.href }}
      }}).catch(function() {{}});
    }} else {{
      console.warn('[xevo] __TAURI_INTERNALS__ not available — cannot send cookies inspector data');
    }}
  }} catch(e) {{
    if (window.__TAURI_INTERNALS__) {{
      window.__TAURI_INTERNALS__.invoke('inspector_data', {{
        tabId: '{}',
        dataType: 'cookies',
        data: {{ cookies: [], url: location.href, error: String(e) }}
      }}).catch(function() {{}});
    }}
  }}
}})();
"#,
            tab_id, tab_id
        ),

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
    if (window.__TAURI_INTERNALS__) {{
      window.__TAURI_INTERNALS__.invoke('inspector_data', {{
        tabId: '{}',
        dataType: '{}',
        data: {{ items: items, totalSize: totalSize, url: location.href }}
      }}).catch(function() {{}});
    }} else {{
      console.warn('[xevo] __TAURI_INTERNALS__ not available — cannot send storage inspector data');
    }}
  }} catch(e) {{
    if (window.__TAURI_INTERNALS__) {{
      window.__TAURI_INTERNALS__.invoke('inspector_data', {{
        tabId: '{}',
        dataType: '{}',
        data: {{ items: [], totalSize: 0, url: location.href, error: String(e) }}
      }}).catch(function() {{}});
    }}
  }}
}})();
"#,
                store, tab_id, inspector_type, tab_id, inspector_type
            )
        }

        _ => return Err(format!("Unknown inspector type: {}", inspector_type)),
    };

    wv.eval(&script).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn inspector_data(
    app: AppHandle,
    tab_id: String,
    data_type: String,
    data: serde_json::Value,
) -> Result<(), String> {
    let payload = serde_json::json!({
        "tabId": tab_id,
        "dataType": data_type,
        "data": data,
    });
    app.emit("xevo://inspector-data", payload)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn inspector_mutate(
    app: AppHandle,
    tab_id: String,
    operation: String,
    params: serde_json::Value,
) -> Result<(), String> {
    let label = webview_label_for_tab(&tab_id);
    let wv = app
        .get_webview_window(&label)
        .ok_or_else(|| format!("No webview for tab {}", tab_id))?;

    let script = match operation.as_str() {
        "set-cookie" => {
            let name = js_string_literal(params["name"].as_str().unwrap_or(""));
            let value = js_string_literal(params["value"].as_str().unwrap_or(""));
            format!("document.cookie = {} + '=' + {} + '; path=/';", name, value)
        }
        "delete-cookie" => {
            let name = js_string_literal(params["name"].as_str().unwrap_or(""));
            format!(
                "document.cookie = {} + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';",
                name
            )
        }
        "clear-cookies" => {
            r#"document.cookie.split(';').forEach(function(c) {
  var name = c.split('=')[0].trim();
  if (name) document.cookie = name + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
});"#
                .to_string()
        }
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
        .get_webview_window("main")
        .ok_or("Main window not found")?;
    let parsed_url = url::Url::parse(&url).map_err(|e| e.to_string())?;

    if let Some(webview) = app.get_webview_window(&label) {
        webview
            .set_position(Position::Logical(LogicalPosition::new(x, y)))
            .map_err(|e| e.to_string())?;
        webview
            .set_size(Size::Logical(LogicalSize::new(width.max(1.0), height.max(1.0))))
            .map_err(|e| e.to_string())?;
        webview.show().map_err(|e| e.to_string())?;
        return Ok(());
    }

    WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(parsed_url))
        .parent(&parent)
        .map_err(|e| e.to_string())?
        .initialization_script(CORE_SCRIPT)
        .position(x, y)
        .inner_size(width.max(1.0), height.max(1.0))
        .decorations(false)
        .resizable(false)
        .transparent(true)
        .build()
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Destroy a viewport webview
#[tauri::command]
pub async fn destroy_viewport(app: AppHandle, label: String) -> Result<(), String> {
    if let Some(webview) = app.get_webview_window(&label) {
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
    if let Some(webview) = app.get_webview_window(&label) {
        webview
            .set_position(Position::Logical(LogicalPosition::new(x, y)))
            .map_err(|e| e.to_string())?;
        webview
            .set_size(Size::Logical(LogicalSize::new(width.max(1.0), height.max(1.0))))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Show a viewport webview
#[tauri::command]
pub async fn show_viewport(app: AppHandle, label: String) -> Result<(), String> {
    if let Some(webview) = app.get_webview_window(&label) {
        webview.show().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Hide a viewport webview
#[tauri::command]
pub async fn hide_viewport(app: AppHandle, label: String) -> Result<(), String> {
    if let Some(webview) = app.get_webview_window(&label) {
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
    if let Some(webview) = app.get_webview_window(&label) {
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
    if let Some(webview) = app.get_webview_window(&label) {
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
    if let Some(wv) = app.get_webview_window(&label) {
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
            if let Some(browser_wv) = app.get_webview_window(label) {
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
                eprintln!("[xevo] DevTools screenshot failed ({e}), falling back to PrintWindow");
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
            if let Some(wv) = app.get_webview_window(&label) {
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
    wv: &tauri::WebviewWindow,
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
    state: tauri::State<'_, crate::BrowserState>,
    tab_id: String,
) -> Result<(), String> {
    let label = webview_label_for_tab(&tab_id);
    let wv = app.get_webview_window(&label)
        .or_else(|| state.webviews.lock().unwrap_or_else(|e| e.into_inner()).get(&label).cloned())
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
    state: tauri::State<'_, crate::BrowserState>,
    tab_id: String,
    state_json: String,
) -> Result<(), String> {
    let label = webview_label_for_tab(&tab_id);
    let wv = app.get_webview_window(&label)
        .or_else(|| state.webviews.lock().unwrap_or_else(|e| e.into_inner()).get(&label).cloned())
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

