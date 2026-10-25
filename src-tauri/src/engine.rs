//! Chromium switches for the shared WebView2 environment. They only take effect
//! when the browser process starts, so they are read once at startup from
//! `engine.json` in the app config dir. Settings > Memory writes the file and
//! the user restarts to apply it.
//!
//! Every webview (main window, tabs, viewport) must be created with the
//! identical string: WebView2 shares one browser process set only between
//! environments with identical options, and refuses to create a webview whose
//! options differ from the running browser process's.
//!
//! Measurements behind each switch: D:\PROJECT-TESTINGS\webview2-ram-tuning.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct EngineOptions {
    /// Run the GPU stack inside the browser process instead of its own process.
    /// Saves ~100-200 MB private (the separate GPU process is mostly fixed
    /// overhead). Trade-off: a GPU driver crash takes down the whole browser
    /// process (every webview) instead of Chromium restarting the GPU process.
    pub in_process_gpu: bool,
    /// No site isolation, at most 2 renderer processes. Saves ~330-570 MB with
    /// 10 tabs (nothing with 1-3). Trade-off: weaker cross-site protection
    /// (Spectre-class leaks between sites in one process), and one heavy tab
    /// can slow the others. Opt-in.
    pub low_memory_process_model: bool,
}

impl Default for EngineOptions {
    fn default() -> Self {
        Self {
            in_process_gpu: true,
            low_memory_process_model: false,
        }
    }
}

/// Setting any arguments replaces wry's defaults, so they are restated first:
/// no mini-menu/PDF OOUI or SmartScreen, and autoplay without a gesture.
pub fn browser_args(o: &EngineOptions) -> String {
    let mut s = String::from(
        "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection \
         --autoplay-policy=no-user-gesture-required",
    );
    if o.in_process_gpu {
        s.push_str(" --in-process-gpu");
    }
    if o.low_memory_process_model {
        s.push_str(" --disable-site-isolation-trials --renderer-process-limit=2");
    }
    s
}

fn options_path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|d| d.join("engine.json"))
}

/// Missing or unreadable file = defaults.
pub fn load(app: &AppHandle) -> EngineOptions {
    options_path(app)
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

#[tauri::command]
pub fn get_engine_options(app: AppHandle) -> EngineOptions {
    load(&app)
}

/// Saved for the next start; the running browser process keeps its switches.
#[tauri::command]
pub fn set_engine_options(app: AppHandle, options: EngineOptions) -> Result<(), String> {
    let path = options_path(&app).ok_or("no app config dir")?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(&options).map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn args_per_option() {
        let base = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection \
                    --autoplay-policy=no-user-gesture-required";
        let none = EngineOptions {
            in_process_gpu: false,
            low_memory_process_model: false,
        };
        assert_eq!(browser_args(&none), base);
        assert_eq!(
            browser_args(&EngineOptions::default()),
            format!("{base} --in-process-gpu")
        );
        let all = EngineOptions {
            in_process_gpu: true,
            low_memory_process_model: true,
        };
        assert_eq!(
            browser_args(&all),
            format!("{base} --in-process-gpu --disable-site-isolation-trials --renderer-process-limit=2")
        );
    }

    #[test]
    fn partial_or_bad_file_falls_back_to_defaults() {
        let partial: EngineOptions = serde_json::from_str(r#"{"lowMemoryProcessModel":true}"#).unwrap();
        assert!(partial.in_process_gpu && partial.low_memory_process_model);
        assert!(serde_json::from_str::<EngineOptions>("not json").is_err());
    }
}
