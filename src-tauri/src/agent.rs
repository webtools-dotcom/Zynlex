// Local bridge for AI coding agents (see docs/agent-interface.md).
//
// `zynlex-mcp.exe` (src/bin/zynlex-mcp.rs) connects to a named pipe; each
// connection is one agent session. Requests are forwarded to the main window's
// dispatcher (src/lib/agent.ts), which answers from the stores via
// `agent_reply`. Nothing here reads a tab itself, and nothing is reachable from
// page content — the pipe is the only way in.
//
// Pipe access relies on the default named-pipe DACL: full control for the
// creating user, SYSTEM and Administrators, read-only for everyone else. A
// read-only client can't send a request, so only the current user (or an
// admin, who already owns the machine) can drive the browser. Remote clients
// are rejected outright.

use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::windows::named_pipe::{NamedPipeServer, ServerOptions};
use tokio::sync::{oneshot, watch};

use crate::zynlex_log;

/// Keep in sync with `PIPE` in src/bin/zynlex-mcp.rs.
const PIPE_NAME: &str = r"\\.\pipe\zynlex-agent";

/// How long a tool call may take in the frontend before the agent gets an error.
const REPLY_TIMEOUT: Duration = Duration::from_secs(30);

type Reply = Result<String, String>;

static NEXT_ID: AtomicU64 = AtomicU64::new(1);

/// Off after the user presses Stop, until they turn it back on. Connections
/// are still accepted while off, so the agent is told why instead of seeing
/// ZYNLEX as not running.
static ENABLED: AtomicBool = AtomicBool::new(true);

fn pending() -> &'static Mutex<HashMap<u64, oneshot::Sender<Reply>>> {
    static P: OnceLock<Mutex<HashMap<u64, oneshot::Sender<Reply>>>> = OnceLock::new();
    P.get_or_init(Default::default)
}

/// Session id -> client name ("claude-code", "codex", …), for the status bar.
fn sessions() -> &'static Mutex<HashMap<u64, String>> {
    static S: OnceLock<Mutex<HashMap<u64, String>>> = OnceLock::new();
    S.get_or_init(Default::default)
}

/// Bumped by the Stop button; every open session watches it and disconnects.
fn stop_signal() -> &'static watch::Sender<u64> {
    static W: OnceLock<watch::Sender<u64>> = OnceLock::new();
    W.get_or_init(|| watch::channel(0).0)
}

#[derive(serde::Serialize, Clone)]
pub struct AgentStatus {
    enabled: bool,
    /// Connected client names, sorted.
    clients: Vec<String>,
}

fn status() -> AgentStatus {
    let mut clients: Vec<String> = sessions()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .values()
        .cloned()
        .collect();
    clients.sort();
    AgentStatus {
        enabled: ENABLED.load(Ordering::Relaxed),
        clients,
    }
}

fn emit_status(app: &AppHandle) {
    let _ = app.emit_to("main", "agent://status", status());
}

/// Starts accepting agent connections. A second ZYNLEX instance can't claim
/// the pipe (`first_pipe_instance`) and simply runs without an agent bridge.
pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut first = true;
        loop {
            let server = match ServerOptions::new()
                .first_pipe_instance(first)
                .reject_remote_clients(true)
                .create(PIPE_NAME)
            {
                Ok(s) => s,
                Err(e) => {
                    zynlex_log!("[zynlex] agent pipe unavailable: {e}");
                    return;
                }
            };
            first = false;
            match server.connect().await {
                Ok(()) => {
                    tauri::async_runtime::spawn(session(app.clone(), server));
                }
                Err(e) => {
                    zynlex_log!("[zynlex] agent pipe connect failed: {e}");
                    tokio::time::sleep(Duration::from_millis(200)).await;
                }
            }
        }
    });
}

/// One connected agent. Line-delimited JSON: `{"hello": "<client>"}` once,
/// then `{"tool": "...", "args": {...}}` per call, each answered with
/// `{"ok": bool, "text": "..."}`.
async fn session(app: AppHandle, pipe: NamedPipeServer) {
    let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    let (read, mut write) = tokio::io::split(pipe);
    let mut lines = BufReader::new(read).lines();
    let mut stop = stop_signal().subscribe();

    sessions()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .insert(id, "agent".into());
    emit_status(&app);
    // Record full requests (headers, bodies) while an agent is connected, not
    // just while the Network panel is open.
    crate::commands::browser::browser_set_network_capture(true);

    loop {
        let line = tokio::select! {
            l = lines.next_line() => match l {
                Ok(Some(l)) => l,
                _ => break,
            },
            _ = stop.changed() => break,
        };
        let Ok(req) = serde_json::from_str::<Value>(&line) else {
            break;
        };
        if let Some(name) = req["hello"].as_str() {
            sessions()
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .insert(id, name.chars().take(40).collect());
            emit_status(&app);
            continue;
        }
        let tool = req["tool"].as_str().unwrap_or_default();
        let reply = if ENABLED.load(Ordering::Relaxed) {
            forward(&app, tool, req["args"].clone()).await
        } else {
            Err("The user turned off agent access in ZYNLEX (status bar). Ask them to turn it back on.".into())
        };
        let out = match reply {
            Ok(text) => json!({ "ok": true, "text": text }),
            Err(text) => json!({ "ok": false, "text": text }),
        };
        if write
            .write_all(format!("{out}\n").as_bytes())
            .await
            .is_err()
        {
            break;
        }
    }

    crate::commands::browser::browser_set_network_capture(false);
    sessions()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .remove(&id);
    emit_status(&app);
}

async fn forward(app: &AppHandle, tool: &str, args: Value) -> Reply {
    let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    let (tx, rx) = oneshot::channel();
    pending()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .insert(id, tx);
    let _ = app.emit_to(
        "main",
        "agent://request",
        json!({ "id": id, "tool": tool, "args": args }),
    );
    match tokio::time::timeout(REPLY_TIMEOUT, rx).await {
        Ok(Ok(reply)) => reply,
        _ => {
            pending()
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .remove(&id);
            Err("ZYNLEX didn't answer within 30s".into())
        }
    }
}

/// The dispatcher's answer to one `agent://request`.
#[tauri::command]
pub fn agent_reply(id: u64, ok: bool, text: String) {
    let tx = pending()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .remove(&id);
    if let Some(tx) = tx {
        let _ = tx.send(if ok { Ok(text) } else { Err(text) });
    }
}

/// Un-minimizes the main window when an agent brings a tab forward: a
/// minimized window has no content area to lay a new tab out in, and the user
/// should be able to watch what the agent does. Doesn't take focus, so typing
/// in their editor carries on — except for a window minimized from maximized,
/// which Windows can only restore as maximized by activating it.
#[tauri::command]
pub fn agent_reveal_window(app: AppHandle) -> Result<(), String> {
    use tauri::Manager;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowPlacement, IsIconic, ShowWindow, SW_RESTORE, SW_SHOWNOACTIVATE, WINDOWPLACEMENT,
        WPF_RESTORETOMAXIMIZED,
    };
    let win = app.get_window("main").ok_or("no main window")?;
    let hwnd = win.hwnd().map_err(|e| e.to_string())?;
    unsafe {
        if !IsIconic(hwnd).as_bool() {
            return Ok(());
        }
        let mut wp = WINDOWPLACEMENT {
            length: std::mem::size_of::<WINDOWPLACEMENT>() as u32,
            ..Default::default()
        };
        let maximized =
            GetWindowPlacement(hwnd, &mut wp).is_ok() && wp.flags.contains(WPF_RESTORETOMAXIMIZED);
        let _ = ShowWindow(
            hwnd,
            if maximized {
                SW_RESTORE
            } else {
                SW_SHOWNOACTIVATE
            },
        );
    }
    Ok(())
}

/// For a frontend that (re)loaded after agents connected.
#[tauri::command]
pub fn agent_status() -> AgentStatus {
    status()
}

/// Stop (`false`) disconnects every agent and refuses further calls until the
/// user turns access back on (`true`).
#[tauri::command]
pub fn agent_set_enabled(app: AppHandle, enabled: bool) {
    ENABLED.store(enabled, Ordering::Relaxed);
    if !enabled {
        stop_signal().send_modify(|g| *g += 1);
    }
    emit_status(&app);
}
