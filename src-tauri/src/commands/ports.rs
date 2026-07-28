use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::time::{timeout, Duration};

/// Result of scanning a single port.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ScannedPort {
    pub port: u16,
    pub alive: bool,
    pub protocol: String,
    pub title: Option<String>,
    pub status: Option<u16>,
}

fn loopback_addr(host: &str, port: u16) -> String {
    if host.contains(':') {
        format!("[{}]:{}", host, port)
    } else {
        format!("{}:{}", host, port)
    }
}

fn score_result(result: &ScannedPort) -> u8 {
    if !result.alive {
        0
    } else {
        let mut score = 1;
        if result.protocol == "http" {
            score += 2;
        }
        if result.title.is_some() {
            score += 1;
        }
        if result.status.is_some() {
            score += 1;
        }
        score
    }
}

/// Scan a single port across both loopback families.
async fn scan_single_port(port: u16) -> ScannedPort {
    let ipv4 = tokio::spawn(scan_single_host(port, "127.0.0.1"));
    let ipv6 = tokio::spawn(scan_single_host(port, "::1"));

    let mut results = Vec::with_capacity(2);
    if let Ok(result) = ipv4.await {
        results.push(result);
    }
    if let Ok(result) = ipv6.await {
        results.push(result);
    }

    results
        .into_iter()
        .max_by_key(score_result)
        .unwrap_or(ScannedPort {
            port,
            alive: false,
            protocol: "http".to_string(),
            title: None,
            status: None,
        })
}

/// Scan one loopback host for a port: TCP connect + optional HTTP title fetch.
async fn scan_single_host(port: u16, host: &'static str) -> ScannedPort {
    let addr = loopback_addr(host, port);

    // Step 1: TCP connect with 350ms timeout
    let tcp_result = timeout(Duration::from_millis(350), TcpStream::connect(&addr)).await;

    let alive = matches!(tcp_result, Ok(Ok(_)));

    if !alive {
        return ScannedPort {
            port,
            alive: false,
            protocol: "http".to_string(),
            title: None,
            status: None,
        };
    }

    // Step 2: HTTP GET to check status + extract title (800ms total timeout)
    let http_result = timeout(Duration::from_millis(800), http_get_title(host, port)).await;

    match http_result {
        Ok(Ok((status, title, is_tls))) => ScannedPort {
            port,
            alive: true,
            protocol: if is_tls {
                "https".to_string()
            } else {
                "http".to_string()
            },
            title,
            status: Some(status),
        },
        _ => ScannedPort {
            port,
            alive: true,
            // Alive (TCP worked) but HTTP didn't respond — might be non-HTTP
            protocol: "tcp".to_string(),
            title: None,
            status: None,
        },
    }
}

/// A plaintext HTTP/1.0 GET sent to a TLS-only server elicits a TLS alert or
/// handshake record instead of an HTTP response. TLS record types 20-23 (0x14-0x17)
/// followed by a 0x03 version-major byte are the giveaway — cheap to detect without
/// a TLS client library, which a full handshake would require.
fn looks_like_tls_record(buf: &[u8]) -> bool {
    buf.len() >= 2 && matches!(buf[0], 0x14..=0x17) && buf[1] == 0x03
}

/// Send a basic HTTP GET and return (status_code, Option<title>, looks_like_tls).
async fn http_get_title(host: &str, port: u16) -> Result<(u16, Option<String>, bool), String> {
    let addr = loopback_addr(host, port);
    let mut stream = TcpStream::connect(&addr).await.map_err(|e| e.to_string())?;

    // Send minimal HTTP/1.0 GET request
    let request = format!(
        "GET / HTTP/1.0\r\nHost: localhost:{}\r\nConnection: close\r\n\r\n",
        port
    );
    stream
        .write_all(request.as_bytes())
        .await
        .map_err(|e| e.to_string())?;

    // Read up to 8KB (enough for headers + title tag)
    let mut buf = vec![0u8; 8192];
    let mut total = 0usize;
    loop {
        match stream.read(&mut buf[total..]).await {
            Ok(0) => break,
            Ok(n) => {
                total += n;
                if total >= buf.len() {
                    break;
                }
            }
            Err(_) => break,
        }
    }

    let is_tls = looks_like_tls_record(&buf[..total]);
    let response = String::from_utf8_lossy(&buf[..total]);
    let response_str = response.as_ref();

    // Parse HTTP status code from first line: "HTTP/1.x 200 OK"
    let status: u16 = response_str
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|code| code.parse().ok())
        .unwrap_or(0);

    // Extract <title>...</title> from body
    let title = extract_title(response_str);

    Ok((status, title, is_tls))
}

/// Extract text content of <title> tag from HTML string.
fn extract_title(html: &str) -> Option<String> {
    let lower = html.to_lowercase();
    let start = lower.find("<title>")? + 7;
    let end = lower.find("</title>")?;
    if start < end {
        let raw = html[start..end].trim();
        // Decode common HTML entities
        let decoded = raw
            .replace("&amp;", "&")
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&quot;", "\"")
            .replace("&#39;", "'");
        if decoded.is_empty() {
            None
        } else {
            Some(decoded)
        }
    } else {
        None
    }
}

/// Scan a list of localhost ports concurrently.
/// Returns all results including dead ports (alive: false).
/// Typically completes in ~400ms regardless of list size.
#[tauri::command]
pub async fn scan_ports(ports: Vec<u16>) -> Result<Vec<ScannedPort>, String> {
    // Deduplicate ports
    let mut unique_ports = ports;
    unique_ports.sort_unstable();
    unique_ports.dedup();

    // Spawn all scans concurrently
    let mut handles = Vec::with_capacity(unique_ports.len());
    for port in unique_ports {
        handles.push(tokio::spawn(async move { scan_single_port(port).await }));
    }

    // Collect results
    let mut results = Vec::with_capacity(handles.len());
    for handle in handles {
        // A panicked task is skipped — the port is just left unreported.
        if let Ok(result) = handle.await {
            results.push(result);
        }
    }

    // Sort by port number for consistent UI ordering
    results.sort_by_key(|r| r.port);
    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::looks_like_tls_record;

    #[test]
    fn tls_record_detection() {
        // TLS alert (21) and handshake (22) records, version 3.x — the shapes a
        // TLS-only server sends back when it receives our plaintext HTTP GET.
        assert!(looks_like_tls_record(&[0x15, 0x03, 0x03, 0x00, 0x02]));
        assert!(looks_like_tls_record(&[0x16, 0x03, 0x01, 0x00, 0x50]));
        // A normal HTTP response must not be misdetected as TLS.
        assert!(!looks_like_tls_record(b"HTTP/1.1 200 OK\r\n"));
        // Too short to inspect.
        assert!(!looks_like_tls_record(&[0x16]));
        assert!(!looks_like_tls_record(&[]));
    }
}
