use std::sync::{Mutex, OnceLock};
use serde::{Deserialize, Serialize};
use tauri::Manager;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HeaderRule {
    pub id: String,
    pub pattern: String,
    pub name: String,
    pub value: String,
    pub enabled: bool,
}

static HEADER_RULES: OnceLock<Mutex<Vec<HeaderRule>>> = OnceLock::new();

fn header_rules() -> &'static Mutex<Vec<HeaderRule>> {
    HEADER_RULES.get_or_init(|| Mutex::new(Vec::new()))
}

// ponytail: expose rules as JSON so the browser init script can inline them
// without an extra round-trip across the Tauri bridge.
pub fn current_rules_json() -> String {
    let rules = header_rules()
        .lock()
        .map_or_else(|_| Vec::new(), |guard| guard.clone());
    serde_json::to_string(&rules).unwrap_or_else(|_| "[]".to_string())
}

#[tauri::command]
pub fn set_header_rules(
    app: tauri::AppHandle,
    rules: Vec<HeaderRule>,
) -> Result<(), String> {
    *header_rules().lock().map_err(|e| e.to_string())? = rules.clone();

    // ponytail: push rules to every open browser tab immediately; no separate
    // sync command or state machine needed because the source-of-truth lives here.
    let js = format!(
        "window.__XEVO_HEADER_RULES = {};",
        serde_json::to_string(&rules).map_err(|e| e.to_string())?
    );
    for (label, wv) in app.webview_windows() {
        if label.starts_with("browser-") {
            let _ = wv.eval(&js);
        }
    }

    Ok(())
}

#[tauri::command]
pub fn get_header_rules() -> Result<Vec<HeaderRule>, String> {
    header_rules().lock().map_err(|e| e.to_string()).map(|guard| guard.clone())
}
