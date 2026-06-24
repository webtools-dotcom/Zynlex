use std::time::Duration;
use tauri::webview::{PageLoadEvent, WebviewWindowBuilder};
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Position, Size, WebviewUrl,
    WebviewWindow,
};

use crate::BrowserState;

// ─── Injected Scripts ────────────────────────────────────────────────

const XEVO_FIND_SCRIPT: &str = r##"
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

  function countMatches(text, query) {
    if (!query) return 0;
    var q = query.toLowerCase();
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
        if (!node.nodeValue || node.nodeValue.indexOf(query) === -1) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var count = 0;
    var n;
    while ((n = walker.nextNode())) {
      var t = n.nodeValue.toLowerCase();
      var idx = 0;
      while ((idx = t.indexOf(q, idx)) !== -1) {
        count++;
        idx += q.length;
      }
    }
    return count;
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
"##;

const XEVO_BOOKMARK_SCRIPT: &str = r##"
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

  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("DOMContentLoaded", function() {
    document.addEventListener("keydown", onKeyDown, true);
  });
})();
"##;

const XEVO_SHORTCUT_FORWARD_SCRIPT: &str = r##"
(function() {
  var SHORTCUTS = {
    "k": "ctrl+k",
    "t": "ctrl+t",
    "w": "ctrl+w",
    "b": "ctrl+b",
    ",": "ctrl+,",
    "l": "ctrl+l",
    "1": "ctrl+1",
    "2": "ctrl+2",
    "3": "ctrl+3",
    "4": "ctrl+4",
    "5": "ctrl+5",
    "6": "ctrl+6",
    "7": "ctrl+7",
    "8": "ctrl+8",
    "9": "ctrl+9"
  };

  function isEditableTarget(t) {
    if (!t) return false;
    var tag = (t.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return true;
    if (t.isContentEditable) return true;
    return false;
  }

  function forward(shortcut) {
    try {
      if (window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke) {
        window.__TAURI_INTERNALS__.invoke("forward_shortcut", { shortcut: shortcut })
          .catch(function() {});
      }
    } catch (err) {}
  }

  function blockEvent(e) {
    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
  }

  function onKeyDown(e) {
    if (e.key === "Escape") {
      blockEvent(e);
      forward("escape");
      return;
    }

    if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      if (e.key === "ArrowLeft") {
        blockEvent(e);
        forward("alt+left");
        return;
      }
      if (e.key === "ArrowRight") {
        blockEvent(e);
        forward("alt+right");
        return;
      }
    }

    if (!(e.ctrlKey || e.metaKey)) return;

    if (e.shiftKey && !e.altKey && (e.key === "T" || e.key === "t")) {
      blockEvent(e);
      forward("ctrl+shift+t");
      return;
    }

    if (e.shiftKey && !e.altKey && e.key === "Tab") {
      blockEvent(e);
      forward("ctrl+shift+tab");
      return;
    }

    if (e.shiftKey && !e.altKey && (e.key === "?" || e.key === "/")) {
      blockEvent(e);
      forward("ctrl+?");
      return;
    }

    if (isEditableTarget(e.target)) return;
    if (e.shiftKey || e.altKey) return;

    var mapping = SHORTCUTS[(e.key || "").toLowerCase()];
    if (mapping) {
      blockEvent(e);
      forward(mapping);
    }
  }

  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("DOMContentLoaded", function() {
    document.addEventListener("keydown", onKeyDown, true);
  });
})();
"##;

// BROWSER_INIT_SCRIPT — JSON viewer + tab info reporting.
// Now reads window.__XEVO_TAB_ID (injected per-webview) to include
// the tab ID in update_tab_info calls so events are routed correctly.
const BROWSER_INIT_SCRIPT: &str = r#"
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

      var css = "body{background:#0f0f0f;color:#e4e4e7;margin:0;padding:0;font-family:'Cascadia Code','Fira Code','Consolas',monospace;font-size:13px;line-height:1.6;}"
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
    var obs = new MutationObserver(function() {
      xevoSendPageInfo();
    });
    obs.observe(titleEl, { characterData: true, childList: true });
  }
})();
"#;

// ─── Helpers ─────────────────────────────────────────────────────────

fn webview_label_for_tab(tab_id: &str) -> String {
    format!("browser-{}", tab_id)
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
        return format!("https://{}", s);
    }
    format!(
        "https://www.google.com/search?q={}",
        urlencoding::encode(s)
    )
}

/// Build a WebviewWindow for a tab. Injects per-tab __XEVO_TAB_ID plus
/// all shared init scripts (JSON viewer, find, bookmark, shortcut forward).
fn create_webview_for_tab(
    app: &AppHandle,
    main_window: &WebviewWindow,
    tab_id: &str,
    url: &str,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<WebviewWindow, String> {
    let width = width.max(1.0);
    let height = height.max(1.0);
    let label = webview_label_for_tab(tab_id);
    let parsed = url
        .parse::<url::Url>()
        .map_err(|e| e.to_string())?;

    let tab_id_nav = tab_id.to_string();
    let app_for_nav = app.clone();
    let tab_id_load = tab_id.to_string();
    let app_for_load = app.clone();

    // Per-tab init script that sets __XEVO_TAB_ID
    let tab_id_init = format!("window.__XEVO_TAB_ID = \"{}\";", tab_id);

    let webview =
        WebviewWindowBuilder::new(app, &label, WebviewUrl::External(parsed))
            .parent(main_window)
            .map_err(|e| e.to_string())?
            .decorations(false)
            .resizable(false)
            .inner_size(width, height)
            .position(x, y)
            .initialization_script(&tab_id_init)
            .initialization_script(BROWSER_INIT_SCRIPT)
            .initialization_script(XEVO_FIND_SCRIPT)
            .initialization_script(XEVO_BOOKMARK_SCRIPT)
            .initialization_script(XEVO_SHORTCUT_FORWARD_SCRIPT)
            .on_navigation(move |nav_url| {
                let url_str = nav_url.to_string();
                let _ = app_for_nav.emit("browser://url-changed", serde_json::json!({
                    "tabId": tab_id_nav,
                    "url": url_str,
                }));
                true
            })
            .on_page_load(move |webview, payload| {
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

                        let title_script = format!(
                            r#"(function() {{
  try {{
    var title = document.title || "";
    var url = location.href || "";
    var favicon = null;
    var sels = [
      'link[rel="icon"][href]',
      'link[rel="shortcut icon"][href]',
      'link[rel="apple-touch-icon"][href]'
    ];
    for (var i = 0; i < sels.length; i++) {{
      var el = document.querySelector(sels[i]);
      if (el && el.href) {{ favicon = el.href; break; }}
    }}
    var tabId = window.__XEVO_TAB_ID || "{}";
    if (window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke) {{
      window.__TAURI_INTERNALS__.invoke("update_tab_info", {{
        tabId: tabId,
        title: title,
        url: url,
        favicon: favicon
      }}).catch(function() {{}});
    }}
  }} catch (e) {{}}
}})();"#,
                            tab_id_load
                        );
                        let _ = webview.eval(&title_script);

                        let wv_for_later = webview.clone();
                        tauri::async_runtime::spawn(async move {
                            tokio::time::sleep(Duration::from_millis(500)).await;
                            let _ = wv_for_later.eval(&title_script);
                            tokio::time::sleep(Duration::from_millis(1000)).await;
                            let _ = wv_for_later.eval(&title_script);
                        });
                    }
                }
            })
            .build()
            .map_err(|e| e.to_string())?;

    webview.show().map_err(|e| e.to_string())?;
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

    // Hide the previously active webview
    let prev_label = state.active_tab_label.lock().unwrap().clone();
    if let Some(prev) = prev_label {
        if let Some(wv) = app.get_webview_window(&prev) {
            let _ = wv.hide();
        }
    }

    // Create the new webview
    let webview = create_webview_for_tab(
        &app, &window, &tab_id, &resolved, x, y, width, height,
    )?;

    // Track as active
    *state.active_tab_label.lock().unwrap() = Some(webview.label().to_string());

    Ok(())
}

/// Activate a tab: hide the current webview and show + reposition the target.
/// If the target webview doesn't exist yet, creates it.
#[tauri::command]
pub async fn browser_activate_tab(
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
    let label = webview_label_for_tab(&tab_id);

    // Hide the currently active webview (if different)
    let prev_label = state.active_tab_label.lock().unwrap().clone();
    if let Some(ref prev) = prev_label {
        if prev != &label {
            if let Some(wv) = app.get_webview_window(prev) {
                let _ = wv.hide();
            }
        }
    }

    // If target already exists, just show + reposition
    if let Some(webview) = app.get_webview_window(&label) {
        webview
            .set_position(Position::Logical(LogicalPosition::new(x, y)))
            .map_err(|e| e.to_string())?;
        webview
            .set_size(Size::Logical(LogicalSize::new(width.max(1.0), height.max(1.0))))
            .map_err(|e| e.to_string())?;
        webview.show().map_err(|e| e.to_string())?;
        *state.active_tab_label.lock().unwrap() = Some(label);
        return Ok(());
    }

    // Target doesn't exist — create it
    let resolved = resolve_url(&url);
    let webview = create_webview_for_tab(
        &app, &window, &tab_id, &resolved, x, y, width, height,
    )?;
    *state.active_tab_label.lock().unwrap() = Some(webview.label().to_string());

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
    if let Some(wv) = app.get_webview_window(&label) {
        wv.close().map_err(|e| e.to_string())?;
    }
    // If this was the active tab, clear the tracker
    let mut active = state.active_tab_label.lock().unwrap();
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
    tab_id: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let label = webview_label_for_tab(&tab_id);
    if let Some(wv) = app.get_webview_window(&label) {
        wv.set_position(Position::Logical(LogicalPosition::new(x, y)))
            .map_err(|e| e.to_string())?;
        wv.set_size(Size::Logical(LogicalSize::new(width.max(1.0), height.max(1.0))))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn browser_reposition(
    app: AppHandle,
    tab_id: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let label = webview_label_for_tab(&tab_id);
    if let Some(wv) = app.get_webview_window(&label) {
        wv.set_position(Position::Logical(LogicalPosition::new(x, y)))
            .map_err(|e| e.to_string())?;
        wv.set_size(Size::Logical(LogicalSize::new(width.max(1.0), height.max(1.0))))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ─── Navigation (per-tab) ────────────────────────────────────────────

#[tauri::command]
pub async fn browser_go_back(app: AppHandle, tab_id: String) -> Result<(), String> {
    let label = webview_label_for_tab(&tab_id);
    if let Some(wv) = app.get_webview_window(&label) {
        if let Err(err) = wv.eval("window.history.back()") {
            eprintln!("[xevo] browser_go_back eval failed: {err}");
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn browser_go_forward(app: AppHandle, tab_id: String) -> Result<(), String> {
    let label = webview_label_for_tab(&tab_id);
    if let Some(wv) = app.get_webview_window(&label) {
        if let Err(err) = wv.eval("window.history.forward()") {
            eprintln!("[xevo] browser_go_forward eval failed: {err}");
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn browser_reload(app: AppHandle, tab_id: String) -> Result<(), String> {
    let label = webview_label_for_tab(&tab_id);
    if let Some(wv) = app.get_webview_window(&label) {
        if let Err(err) = wv.eval("window.location.reload()") {
            eprintln!("[xevo] browser_reload eval failed: {err}");
        }
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

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct FindResultPayload {
    pub active_match: u32,
    pub total_matches: u32,
    pub final_update: bool,
}

fn eval_find_script(app: &AppHandle, tab_id: &str, script_body: &str) -> Result<(), String> {
    let label = webview_label_for_tab(tab_id);
    let wv = app
        .get_webview_window(&label)
        .ok_or_else(|| "browser webview not found for tab".to_string())?;
    let wrapped = format!(
        "(function() {{ {} }})();",
        script_body.replace('\\', "\\\\").replace('`', "\\`")
    );
    wv.eval(&wrapped).map_err(|e| {
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
    let payload = FindResultPayload {
        active_match,
        total_matches,
        final_update: final_update.unwrap_or(true),
    };
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
            let _ = wv.eval(&script);
        }
    }
    Ok(())
}

// ─── Hide/Show (for overlays) ────────────────────────────────────────

#[tauri::command]
pub async fn browser_hide_tab(app: AppHandle, tab_id: String) -> Result<(), String> {
    let label = webview_label_for_tab(&tab_id);
    if let Some(wv) = app.get_webview_window(&label) {
        let _ = wv.hide();
    }
    Ok(())
}

#[tauri::command]
pub async fn browser_show_tab(
    app: AppHandle,
    tab_id: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let label = webview_label_for_tab(&tab_id);
    if let Some(wv) = app.get_webview_window(&label) {
        let _ = wv.set_position(Position::Logical(LogicalPosition::new(x, y)));
        let _ = wv.set_size(Size::Logical(LogicalSize::new(width.max(1.0), height.max(1.0))));
        let _ = wv.show();
    }
    Ok(())
}
