use super::{find_tab_webview, webview_label_for_tab};
use crate::zynlex_log;
use tauri::AppHandle;

/// Match counts for the find bar.
///
/// Returned directly from the command rather than pushed as an event: the page
/// cannot invoke IPC back into the app (see docs/architecture.md#security-model),
/// so the old `browser_find_callback` round trip was silently rejected on every
/// https:// page and the counter never updated.
#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FindResult {
    pub active_match: u32,
    pub total_matches: u32,
}

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

/// Run a find expression and read its return value back through WebView2's
/// `ExecuteScript` (via `eval_json`), instead of asking the page to call us.
///
/// The wrapper normalises anything unexpected — an undefined `__zynlexFind`
/// (init script not yet injected, or an about:blank tab), a thrown exception —
/// to a zero result, so the caller never has to distinguish "no matches" from
/// "the page wasn't ready".
#[cfg(target_os = "windows")]
async fn run_find_script(
    app: &AppHandle,
    tab_id: &str,
    script_body: &str,
) -> Result<FindResult, String> {
    let label = webview_label_for_tab(tab_id);
    let wv = find_tab_webview(app, &label)
        .ok_or_else(|| "browser webview not found for tab".to_string())?;
    let script = format!(
        "(function() {{ try {{ var r = {script_body}; \
         return {{ activeMatch: (r && r.activeMatch) || 0, \
         totalMatches: (r && r.totalMatches) || 0 }}; }} \
         catch (e) {{ return {{ activeMatch: 0, totalMatches: 0 }}; }} }})()"
    );
    let value = super::eval_json(&wv, script).await?;
    serde_json::from_value(value).map_err(|e| {
        zynlex_log!("[zynlex] browser find result parse failed: {e}");
        e.to_string()
    })
}

#[tauri::command]
pub async fn browser_find(
    app: AppHandle,
    tab_id: String,
    query: String,
) -> Result<FindResult, String> {
    #[cfg(target_os = "windows")]
    {
        let body = if query.is_empty() {
            "window.__zynlexClearFind()".to_string()
        } else {
            format!("window.__zynlexFind({})", js_string_literal(&query))
        };
        run_find_script(&app, &tab_id, &body).await
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, tab_id, query);
        Err("Find in page is only supported on Windows".to_string())
    }
}

#[tauri::command]
pub async fn browser_find_next(
    app: AppHandle,
    tab_id: String,
    forward: Option<bool>,
) -> Result<FindResult, String> {
    #[cfg(target_os = "windows")]
    {
        let body = format!("window.__zynlexFindNext({})", forward.unwrap_or(true));
        run_find_script(&app, &tab_id, &body).await
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, tab_id, forward);
        Err("Find in page is only supported on Windows".to_string())
    }
}

#[tauri::command]
pub async fn browser_stop_find(app: AppHandle, tab_id: String) -> Result<(), String> {
    eval_find_script(&app, &tab_id, "window.__zynlexClearFind()")
}
