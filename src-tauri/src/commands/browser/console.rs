// Per-tab console capture: JS exceptions, console.error/warn and Chromium's own
// log (failed requests, CSP, mixed content), read through the DevTools protocol.
//
// Release builds have no console a developer would otherwise see, so these feed
// the tab's error badge and the Console panel. Rust-initiated CDP subscriptions,
// like everything else that reads from a tab — no page-originated IPC.

use serde_json::{json, Value};
use std::sync::atomic::{AtomicI32, Ordering};
use tauri::{AppHandle, Emitter};

/// While above zero, console.log/info (and Chromium's info log) are forwarded
/// too, for an agent's `errors level=…`. Raised for each connected agent
/// (src/agent.rs), like network capture: a ref-count, so two agents connecting
/// and disconnecting in any order can't leave it stuck. Never counted in the
/// badges (src/stores/console.ts keeps them apart).
static CONSOLE_VERBOSE: AtomicI32 = AtomicI32::new(0);

pub fn set_console_verbose(active: bool) {
    if active {
        CONSOLE_VERBOSE.fetch_add(1, Ordering::Relaxed);
    } else {
        CONSOLE_VERBOSE.fetch_sub(1, Ordering::Relaxed);
    }
}

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
/// panel don't show (verbose violations; log/info/debug unless `verbose`).
///
/// `source` is "exception", "console" or Chromium's Log source ("network",
/// "security", "javascript", …). The frontend counts level "error" with source
/// "network" as a failed request.
fn console_entry(event: &str, p: &Value, verbose: bool) -> Option<Value> {
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
                "info" if verbose => "info",
                "log" | "debug" | "dir" | "table" | "trace" if verbose => "log",
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
                "info" if verbose => "info",
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

const EVENTS: [&str; 5] = [
    "Runtime.exceptionThrown",
    "Runtime.consoleAPICalled",
    "Log.entryAdded",
    // Not console output, but the same per-tab subscription: an agent has to
    // know when alert/confirm/prompt has paused the page (src/lib/agent.ts).
    "Page.javascriptDialogOpening",
    "Page.javascriptDialogClosed",
];

/// A dialog event as the frontend wants it: `open` with type and message, or
/// closed.
fn dialog_event(event: &str, p: &Value) -> Option<Value> {
    match event {
        "Page.javascriptDialogOpening" => Some(json!({
            "open": true,
            "type": p["type"].as_str().unwrap_or("alert"),
            "message": truncate(p["message"].as_str().unwrap_or_default()),
            "defaultPrompt": p["defaultPrompt"].as_str().unwrap_or_default(),
        })),
        "Page.javascriptDialogClosed" => Some(json!({ "open": false })),
        _ => None,
    }
}

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
                    let verbose = CONSOLE_VERBOSE.load(Ordering::Relaxed) > 0;
                    if let Some(mut entry) = console_entry(event, &params, verbose) {
                        entry["tabId"] = json!(tab_id);
                        let _ = app.emit("browser://console", entry);
                    } else if let Some(mut dialog) = dialog_event(event, &params) {
                        dialog["tabId"] = json!(tab_id);
                        let _ = app.emit("browser://dialog", dialog);
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
        super::cdp(&core, "Page.enable", "{}");
    });
}

#[cfg(test)]
mod tests {
    use super::{console_entry, dialog_event};
    use serde_json::json;

    #[test]
    fn dialog_events() {
        let open = dialog_event(
            "Page.javascriptDialogOpening",
            &json!({"type": "confirm", "message": "Delete \"Buy milk\"?", "url": "http://x/"}),
        )
        .unwrap();
        assert_eq!(open["open"], true);
        assert_eq!(open["type"], "confirm");
        assert_eq!(open["message"], "Delete \"Buy milk\"?");
        assert_eq!(
            dialog_event("Page.javascriptDialogClosed", &json!({"result": true})).unwrap()["open"],
            false
        );
        assert!(dialog_event("Runtime.consoleAPICalled", &json!({})).is_none());
    }

    #[test]
    fn exception_uses_description_and_one_based_line() {
        let e = console_entry(
            "Runtime.exceptionThrown",
            &json!({"exceptionDetails": {"text": "Uncaught", "url": "http://x/a.js", "lineNumber": 9,
                "exception": {"description": "TypeError: x is undefined\n    at f (a.js:10)"}}}),
            false,
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
                false,
            )
        };
        assert_eq!(call("error").unwrap()["text"], "boom 2");
        assert_eq!(call("warning").unwrap()["level"], "warning");
        assert!(call("log").is_none());
        assert!(call("info").is_none());
    }

    #[test]
    fn verbose_adds_log_and_info() {
        let call = |t: &str| {
            console_entry(
                "Runtime.consoleAPICalled",
                &json!({"type": t, "args": [{"type": "string", "value": "hi"}]}),
                true,
            )
        };
        assert_eq!(call("log").unwrap()["level"], "log");
        assert_eq!(call("debug").unwrap()["level"], "log");
        assert_eq!(call("info").unwrap()["level"], "info");
        assert_eq!(call("error").unwrap()["level"], "error");
        let info = console_entry(
            "Log.entryAdded",
            &json!({"entry": {"source": "other", "level": "info", "text": "x"}}),
            true,
        );
        assert_eq!(info.unwrap()["level"], "info");
        let verbose = json!({"entry": {"level": "verbose", "text": "x"}});
        assert!(console_entry("Log.entryAdded", &verbose, true).is_none());
    }

    #[test]
    fn network_log_entries_pass_through() {
        let e = console_entry(
            "Log.entryAdded",
            &json!({"entry": {"source": "network", "level": "error",
                "text": "Failed to load resource: the server responded with a status of 500 ()",
                "url": "http://localhost:3000/api/orders"}}),
            false,
        )
        .unwrap();
        assert_eq!(e["source"], "network");
        assert_eq!(e["url"], "http://localhost:3000/api/orders");
        assert!(console_entry(
            "Log.entryAdded",
            &json!({"entry": {"level": "verbose"}}),
            false
        )
        .is_none());
    }

    #[test]
    fn favicon_misses_are_not_failed_requests() {
        let miss = |url: &str| {
            console_entry(
                "Log.entryAdded",
                &json!({"entry": {"source": "network", "level": "error", "text": "404", "url": url}}),
                false,
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
            false,
        )
        .unwrap();
        assert_eq!(e["text"].as_str().unwrap().chars().count(), 2001);
    }
}
