use std::collections::HashMap;
use std::time::Instant;

/// The API Tester panel used to call the main window's `fetch()`, which is
/// bound by the app's own CSP (`connect-src ... http://localhost:*`) and by
/// CORS — so it could only ever reach local dev servers. Routing the request
/// through Rust bypasses both: this is a real HTTP client, not a webview.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiFetchRequest {
    pub method: String,
    pub url: String,
    pub headers: HashMap<String, String>,
    pub body: Option<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiFetchResponse {
    pub status: u16,
    pub status_text: String,
    pub headers: HashMap<String, String>,
    pub body: String,
    pub duration_ms: u64,
}

#[tauri::command]
pub async fn api_fetch(req: ApiFetchRequest) -> Result<ApiFetchResponse, String> {
    let method = reqwest::Method::from_bytes(req.method.as_bytes()).map_err(|e| e.to_string())?;
    let mut builder = reqwest::Client::new().request(method, &req.url);
    for (k, v) in &req.headers {
        builder = builder.header(k, v);
    }
    if let Some(body) = req.body {
        builder = builder.body(body);
    }

    let started = Instant::now();
    let resp = builder.send().await.map_err(|e| e.to_string())?;
    let duration_ms = started.elapsed().as_millis() as u64;

    let status = resp.status().as_u16();
    let status_text = resp
        .status()
        .canonical_reason()
        .unwrap_or("")
        .to_string();
    let headers = resp
        .headers()
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
        .collect();
    let body = resp.text().await.map_err(|e| e.to_string())?;

    Ok(ApiFetchResponse {
        status,
        status_text,
        headers,
        body,
        duration_ms,
    })
}
