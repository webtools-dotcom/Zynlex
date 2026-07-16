use std::sync::{Mutex, OnceLock};
use serde::{Deserialize, Serialize};

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

#[tauri::command]
pub fn set_header_rules(rules: Vec<HeaderRule>) -> Result<(), String> {
    *header_rules().lock().map_err(|e| e.to_string())? = rules;
    Ok(())
}

#[tauri::command]
pub fn get_header_rules() -> Result<Vec<HeaderRule>, String> {
    header_rules().lock().map_err(|e| e.to_string()).map(|guard| guard.clone())
}
