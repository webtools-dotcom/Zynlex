use std::sync::OnceLock;
use std::time::{Duration, Instant};

/// Total time for a request, including reading the body. Without this the panel
/// hangs forever on a server that accepts the connection and never replies —
/// there is no cancel button, so the only way out was restarting the app.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

/// Cap on the response body held in memory. An API tester gets pointed at file
/// downloads and streaming endpoints by accident; without a cap that is an OOM.
const MAX_BODY_BYTES: usize = 10 * 1024 * 1024;

/// One shared client, built once. `Client::new()` per request meant no connection
/// pooling and a fresh TLS setup on every send.
fn client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(REQUEST_TIMEOUT)
            .connect_timeout(CONNECT_TIMEOUT)
            .build()
            .expect("reqwest client with rustls should always build")
    })
}

/// The API Tester panel used to call the main window's `fetch()`, which is
/// bound by the app's own CSP (`connect-src ... http://localhost:*`) and by
/// CORS — so it could only ever reach local dev servers. Routing the request
/// through Rust bypasses both: this is a real HTTP client, not a webview.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiFetchRequest {
    pub method: String,
    pub url: String,
    pub headers: std::collections::HashMap<String, String>,
    pub body: Option<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiFetchResponse {
    pub status: u16,
    pub status_text: String,
    /// A list, not a map: repeated headers are the point. `Set-Cookie` arrives
    /// once per cookie and a map would show only the last one.
    pub headers: Vec<(String, String)>,
    /// Empty when `binary` is true — there is nothing useful to show as text.
    pub body: String,
    /// The response was not valid UTF-8. `byte_length` still reports its size.
    pub binary: bool,
    /// The body hit `MAX_BODY_BYTES` and what is here is the leading slice.
    pub truncated: bool,
    /// Bytes actually received (after truncation), not the length of `body`.
    pub byte_length: u64,
    pub duration_ms: u64,
}

fn describe(e: &reqwest::Error) -> String {
    if e.is_timeout() {
        format!("Request timed out after {}s", REQUEST_TIMEOUT.as_secs())
    } else {
        e.to_string()
    }
}

#[tauri::command]
pub async fn api_fetch(req: ApiFetchRequest) -> Result<ApiFetchResponse, String> {
    let method = reqwest::Method::from_bytes(req.method.as_bytes()).map_err(|e| e.to_string())?;
    let mut builder = client().request(method, &req.url);
    for (k, v) in &req.headers {
        builder = builder.header(k, v);
    }
    if let Some(body) = req.body {
        builder = builder.body(body);
    }

    let started = Instant::now();
    let mut resp = builder.send().await.map_err(|e| describe(&e))?;

    let status = resp.status().as_u16();
    let status_text = resp.status().canonical_reason().unwrap_or("").to_string();
    let headers: Vec<(String, String)> = resp
        .headers()
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
        .collect();

    // Streamed rather than `resp.text()`, so the cap applies to what is read
    // instead of to what has already been buffered.
    let mut bytes: Vec<u8> = Vec::new();
    let mut truncated = false;
    while let Some(chunk) = resp.chunk().await.map_err(|e| describe(&e))? {
        if bytes.len() + chunk.len() > MAX_BODY_BYTES {
            bytes.extend_from_slice(&chunk[..MAX_BODY_BYTES - bytes.len()]);
            truncated = true;
            break;
        }
        bytes.extend_from_slice(&chunk);
    }

    // Measured after the body, not after the headers: a response that takes ten
    // seconds to stream is not a fast response.
    let duration_ms = started.elapsed().as_millis() as u64;
    let byte_length = bytes.len() as u64;

    let (body, binary) = match String::from_utf8(bytes) {
        Ok(s) => (s, false),
        Err(e) => {
            let valid_up_to = e.utf8_error().valid_up_to();
            let bytes = e.into_bytes();
            // Truncation can cut a multi-byte character in half. That is a text
            // body missing its last character, not a binary one — but only if the
            // invalid bytes are at the very end. Anything that goes bad earlier is
            // genuinely not text.
            if truncated && bytes.len() - valid_up_to <= 3 {
                (String::from_utf8_lossy(&bytes).into_owned(), false)
            } else {
                (String::new(), true)
            }
        }
    };

    Ok(ApiFetchResponse {
        status,
        status_text,
        headers,
        body,
        binary,
        truncated,
        byte_length,
        duration_ms,
    })
}
