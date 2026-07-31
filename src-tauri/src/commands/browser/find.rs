use super::{find_tab_webview, webview_label_for_tab};
use crate::zynlex_log;
use tauri::{AppHandle, Emitter};

fn eval_find_script(app: &AppHandle, tab_id: &str, script_body: &str) -> Result<(), String> {
    let label = webview_label_for_tab(tab_id);
    let wv = find_tab_webview(app, &label)
        .ok_or_else(|| "browser webview not found for tab".to_string())?;
    // ponytail: script_body already JS-escaped via js_string_literal — no re-escaping needed
    let wrapped = format!("(function() {{ {} }})();", script_body);
    wv.eval(&wrapped).map_err(|e| {
        zynlex_log!("[zynlex] browser find eval failed: {e}");
        e.to_string()
    })
}

/// A JSON string literal is a valid JS string literal (U+2028/U+2029 have
/// been legal inside JS strings since ES2019, and serde_json escapes control
/// characters/quotes/backslashes the same way), so this is safe to embed
/// directly into an `eval`'d script.
pub(super) fn js_string_literal(s: &str) -> String {
    serde_json::to_string(s).unwrap_or_default()
}

#[tauri::command]
pub async fn browser_find(app: AppHandle, tab_id: String, query: String) -> Result<(), String> {
    if query.is_empty() {
        return eval_find_script(&app, &tab_id, "window.__zynlexClearFind()");
    }
    let body = format!("window.__zynlexFind({})", js_string_literal(&query));
    eval_find_script(&app, &tab_id, &body)
}

#[tauri::command]
pub async fn browser_find_next(
    app: AppHandle,
    tab_id: String,
    forward: Option<bool>,
) -> Result<(), String> {
    let fwd = forward.unwrap_or(true);
    let body = format!("window.__zynlexFindNext({})", fwd);
    eval_find_script(&app, &tab_id, &body)
}

#[tauri::command]
pub async fn browser_stop_find(app: AppHandle, tab_id: String) -> Result<(), String> {
    eval_find_script(&app, &tab_id, "window.__zynlexClearFind()")
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
