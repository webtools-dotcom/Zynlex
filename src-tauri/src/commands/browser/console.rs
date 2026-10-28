// Per-tab console capture: JS exceptions, console.error/warn and Chromium's own
// log (failed requests, CSP, mixed content), read through the DevTools protocol.
//
// Release builds have no console a developer would otherwise see, so these feed
// the tab's error badge and the Console panel. Rust-initiated CDP subscriptions,
// like everything else that reads from a tab — no page-originated IPC.

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

/// Longest message forwarded. A minified bundle's error can carry a huge
/// one-line stack; the panel only needs enough to recognise it.
const MAX_TEXT: usize = 2000;

fn truncate(s: &str) -> String {
    match s.char_indices().nth(MAX_TEXT) {
        Some((i, _)) => format!("{}…", &s[..i]),
        None => s.to_string(),
    }
}

/// Turns one CDP event into a console entry, or None for what the badge and
/// panel don't show (info/debug logs, verbose violations).
///
/// `source` is "exception", "console" or Chromium's Log source ("network",
/// "security", "javascript", …). The frontend counts level "error" with source
/// "network" as a failed request.
fn console_entry(event: &str, p: &Value) -> Option<Value> {
    let (level, source, text, url, line) = match event {
        "Runtime.exceptionThrown" => {
            let d = &p["exceptionDetails"];
            // description carries the message and stack; text alone is just
            // "Uncaught" for most thrown Errors.
            let text = d["exception"]["description"]
                .as_str()
                .or(d["text"].as_str())
                .unwrap_or("Uncaught exception");
            (
                "error",
                "exception",
                text.to_string(),
                &d["url"],
                &d["lineNumber"],
            )
        }
        "Runtime.consoleAPICalled" => {
            let level = match p["type"].as_str()? {
                "error" | "assert" => "error",
                "warning" => "warning",
                _ => return None,
            };
            let text = p["args"]
                .as_array()
                .map(|args| {
                    args.iter()
                        .map(|a| {
                            a["value"]
                                .as_str()
                                .map(str::to_string)
                                .or_else(|| a["description"].as_str().map(str::to_string))
                                .unwrap_or_else(|| a["value"].to_string())
                        })
                        .collect::<Vec<_>>()
                        .join(" ")
                })
                .unwrap_or_default();
            let frame = &p["stackTrace"]["callFrames"][0];
            (level, "console", text, &frame["url"], &frame["lineNumber"])
        }
        "Log.entryAdded" => {
            let e = &p["entry"];
            let level = match e["level"].as_str()? {
                "error" => "error",
                "warning" => "warning",
                _ => return None,
            };
            let source = e["source"].as_str().unwrap_or("other");
            let url = e["url"].as_str().unwrap_or_default();
            // The browser's own favicon probe. Chrome's console hides it, and
            // counting it would light the badge on every dev server without one.
            if source == "network" && url.split(['?', '#']).next()?.ends_with("/favicon.ico") {
                return None;
            }
            let text = e["text"].as_str().unwrap_or_default().to_string();
            return Some(json!({
                "level": level,
                "source": source,
                "text": truncate(&text),
                "url": url,
                "line": e["lineNumber"].as_u64().map(|n| n + 1),
            }));
        }
        _ => return None,
    };
    Some(json!({
        "level": level,
        "source": source,
        "text": truncate(&text),
        "url": url.as_str().unwrap_or_default(),
        // CDP lines are 0-based; editors and stack traces show 1-based.
        "line": line.as_u64().map(|n| n + 1),
    }))
}

const EVENTS: [&str; 3] = [
    "Runtime.exceptionThrown",
    "Runtime.consoleAPICalled",
    "Log.entryAdded",
];

pub fn register_webview_console_capture(wv: &tauri::Webview, app: &AppHandle, tab_id: &str) {
    let app = app.clone();
    let tab_id = tab_id.to_string();
    let _ = super::with_core(wv, "console capture", move |core| unsafe {
        use super::pwstr_to_string;
        use webview2_com::DevToolsProtocolEventReceivedEventHandler;
        use windows_core::HSTRING;

        for event in EVENTS {
            let Ok(receiver) = core.GetDevToolsProtocolEventReceiver(&HSTRING::from(event)) else {
                continue;
            };
            let app = app.clone();
            let tab_id = tab_id.clone();
            let handler =
                DevToolsProtocolEventReceivedEventHandler::create(Box::new(move |_wv, args| {
                    let Some(args) = args else { return Ok(()) };
                    let raw = pwstr_to_string(|p| {
                        let _ = args.ParameterObjectAsJson(p);
                    });
                    let Ok(params) = serde_json::from_str::<Value>(&raw) else {
                        return Ok(());
                    };
                    if let Some(mut entry) = console_entry(event, &params) {
                        entry["tabId"] = json!(tab_id);
                        let _ = app.emit("browser://console", entry);
                    }
                    Ok(())
                }));
            let mut token: i64 = 0;
            let _ = receiver.add_DevToolsProtocolEventReceived(&handler, &mut token);
        }
        // Subscribe first, enable second: enabling replays messages already
        // logged by the current page, and those should not be missed.
        super::cdp(&core, "Runtime.enable", "{}");
        super::cdp(&core, "Log.enable", "{}");
    });
}

#[cfg(test)]
mod tests {
    use super::console_entry;
    use serde_json::json;

    #[test]
    fn exception_uses_description_and_one_based_line() {
        let e = console_entry(
            "Runtime.exceptionThrown",
            &json!({"exceptionDetails": {"text": "Uncaught", "url": "http://x/a.js", "lineNumber": 9,
                "exception": {"description": "TypeError: x is undefined\n    at f (a.js:10)"}}}),
        )
        .unwrap();
        assert_eq!(e["level"], "error");
        assert_eq!(e["source"], "exception");
        assert!(e["text"].as_str().unwrap().starts_with("TypeError"));
        assert_eq!(e["line"], 10);
    }

    #[test]
    fn console_keeps_errors_and_warnings_only() {
        let call = |t: &str| {
            console_entry(
                "Runtime.consoleAPICalled",
                &json!({"type": t, "args": [{"type": "string", "value": "boom"}, {"type": "number", "value": 2}]}),
            )
        };
        assert_eq!(call("error").unwrap()["text"], "boom 2");
        assert_eq!(call("warning").unwrap()["level"], "warning");
        assert!(call("log").is_none());
        assert!(call("info").is_none());
    }

    #[test]
    fn network_log_entries_pass_through() {
        let e = console_entry(
            "Log.entryAdded",
            &json!({"entry": {"source": "network", "level": "error",
                "text": "Failed to load resource: the server responded with a status of 500 ()",
                "url": "http://localhost:3000/api/orders"}}),
        )
        .unwrap();
        assert_eq!(e["source"], "network");
        assert_eq!(e["url"], "http://localhost:3000/api/orders");
        assert!(console_entry("Log.entryAdded", &json!({"entry": {"level": "verbose"}})).is_none());
    }

    #[test]
    fn favicon_misses_are_not_failed_requests() {
        let miss = |url: &str| {
            console_entry(
                "Log.entryAdded",
                &json!({"entry": {"source": "network", "level": "error", "text": "404", "url": url}}),
            )
        };
        assert!(miss("http://localhost:5173/favicon.ico").is_none());
        assert!(miss("http://localhost:5173/favicon.ico?v=2").is_none());
        assert!(miss("http://localhost:5173/static/favicon.ico.map").is_some());
    }

    #[test]
    fn long_messages_are_cut() {
        let long = "x".repeat(5000);
        let e = console_entry(
            "Runtime.consoleAPICalled",
            &json!({"type": "error", "args": [{"type": "string", "value": long}]}),
        )
        .unwrap();
        assert_eq!(e["text"].as_str().unwrap().chars().count(), 2001);
    }
}
