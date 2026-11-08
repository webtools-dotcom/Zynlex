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

    // One connection, not two. The liveness check used to connect, drop the
    // socket, and let http_get_title dial the same port again — doubling the
    // connect rate of a scan that repeats every 10 seconds for the life of the
    // app, and doubling the noise in the logs of whatever is listening.
    let stream = match timeout(Duration::from_millis(350), TcpStream::connect(&addr)).await {
        Ok(Ok(stream)) => stream,
        _ => {
            return ScannedPort {
                port,
                alive: false,
                protocol: "http".to_string(),
                title: None,
                status: None,
            }
        }
    };

    match timeout(Duration::from_millis(800), http_get_title(stream, port)).await {
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
/// Takes an already-connected stream — the caller's liveness probe opened it.
async fn http_get_title(
    mut stream: TcpStream,
    port: u16,
) -> Result<(u16, Option<String>, bool), String> {
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
    // `to_ascii_lowercase`, not `to_lowercase`: the byte offsets found here index
    // back into `html`, and a full Unicode lowering can change a string's byte
    // length (U+0130 becomes two chars), which would make those offsets wrong —
    // and slicing `html` on a non-boundary panics. ASCII-only lowering is
    // byte-for-byte, and tag names are ASCII anyway.
    let lower = html.to_ascii_lowercase();
    // Match the tag, not the exact string `<title>` — a server emitting
    // `<title lang="en">` showed no title at all. The closing tag is searched
    // from the opening one so a stray `</title` earlier in the document cannot
    // produce a backwards range.
    let open = lower.find("<title")?;
    let start = lower[open..].find('>')? + open + 1;
    let end = lower[start..].find("</title")? + start;
    if start < end {
        let raw = html[start..end].trim();
        // Decode common HTML entities. `&amp;` goes last: decoding it first turns
        // a literal `&amp;lt;` into `&lt;` and then into `<` — a double decode.
        let decoded = raw
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&quot;", "\"")
            .replace("&#39;", "'")
            .replace("&amp;", "&");
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
    // Each port costs two tasks and two sockets (one per loopback family), and
    // the list arrives from the frontend where custom ports are never validated.
    // Spawning the whole list at once could exhaust sockets, so cap the list and
    // run it in bounded waves rather than all at once.
    const MAX_PORTS: usize = 256;
    const PORTS_IN_FLIGHT: usize = 32;

    // Deduplicate ports
    let mut unique_ports = ports;
    unique_ports.sort_unstable();
    unique_ports.dedup();
    unique_ports.truncate(MAX_PORTS);

    let mut results = Vec::with_capacity(unique_ports.len());
    for wave in unique_ports.chunks(PORTS_IN_FLIGHT) {
        let handles: Vec<_> = wave
            .iter()
            .map(|&port| tokio::spawn(async move { scan_single_port(port).await }))
            .collect();
        for handle in handles {
            // A panicked task is skipped — the port is just left unreported.
            if let Ok(result) = handle.await {
                results.push(result);
            }
        }
    }

    // Sort by port number for consistent UI ordering
    results.sort_by_key(|r| r.port);
    Ok(results)
}

/// A process listening on a loopback port, so an agent can tell its own
/// project's dev server from a stale one on a nearby port. Read only:
/// nothing here stops a process.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortOwner {
    pub port: u16,
    pub pid: u32,
    /// Executable file name ("node.exe"); empty when the process can't be opened.
    pub name: String,
    pub exe: Option<String>,
    /// Its working directory: for a dev server, usually the project folder.
    pub cwd: Option<String>,
    /// When it started, in ms since the Unix epoch.
    pub started_ms: Option<u64>,
}

/// Owners of the given ports; a port with no listener is left out. Two
/// processes can hold one port (one on IPv4, one on IPv6): both are listed.
#[tauri::command]
pub async fn port_owners(ports: Vec<u16>) -> Vec<PortOwner> {
    owners_of(&ports)
}

fn owners_of(ports: &[u16]) -> Vec<PortOwner> {
    let listeners = listening_pids();
    let mut out = Vec::new();
    for &port in ports {
        // One process often holds a port on both IPv4 and IPv6: list it once.
        let mut pids: Vec<u32> = Vec::new();
        for &(p, pid) in &listeners {
            if p == port && !pids.contains(&pid) {
                pids.push(pid);
            }
        }
        out.extend(pids.into_iter().map(|pid| owner(port, pid)));
    }
    out
}

/// (port, pid) for every listening TCP socket, IPv4 first, then IPv6.
fn listening_pids() -> Vec<(u16, u32)> {
    use windows::Win32::NetworkManagement::IpHelper::{
        GetExtendedTcpTable, MIB_TCP6TABLE_OWNER_PID, MIB_TCPTABLE_OWNER_PID,
        TCP_TABLE_OWNER_PID_LISTENER,
    };
    use windows::Win32::Networking::WinSock::{AF_INET, AF_INET6};

    // dwLocalPort holds the port in network byte order, in its low 16 bits.
    let port_of = |dw: u32| u16::from_be(dw as u16);
    let mut out = Vec::new();
    for af in [AF_INET.0 as u32, AF_INET6.0 as u32] {
        // The table can grow between the size query and the read; retry.
        let mut size = 0u32;
        let mut buf: Vec<u64> = Vec::new();
        let mut ok = false;
        for _ in 0..3 {
            // u64s: the table's rows want 8-byte alignment at most.
            buf.resize((size as usize).div_ceil(8), 0);
            let ptr = (!buf.is_empty()).then(|| buf.as_mut_ptr().cast());
            let rc = unsafe {
                GetExtendedTcpTable(ptr, &mut size, false, af, TCP_TABLE_OWNER_PID_LISTENER, 0)
            };
            if rc == 0 && !buf.is_empty() {
                ok = true;
                break;
            }
        }
        if !ok {
            continue;
        }
        // SAFETY: GetExtendedTcpTable filled `buf` with a table of this class
        // and family: a row count followed by that many rows.
        unsafe {
            if af == AF_INET.0 as u32 {
                let t = &*(buf.as_ptr() as *const MIB_TCPTABLE_OWNER_PID);
                let rows = std::slice::from_raw_parts(t.table.as_ptr(), t.dwNumEntries as usize);
                out.extend(rows.iter().map(|r| (port_of(r.dwLocalPort), r.dwOwningPid)));
            } else {
                let t = &*(buf.as_ptr() as *const MIB_TCP6TABLE_OWNER_PID);
                let rows = std::slice::from_raw_parts(t.table.as_ptr(), t.dwNumEntries as usize);
                out.extend(rows.iter().map(|r| (port_of(r.dwLocalPort), r.dwOwningPid)));
            }
        }
    }
    out
}

/// A process handle, closed on drop.
struct Process(windows::Win32::Foundation::HANDLE);

impl Process {
    fn open(
        pid: u32,
        access: windows::Win32::System::Threading::PROCESS_ACCESS_RIGHTS,
    ) -> Option<Self> {
        unsafe { windows::Win32::System::Threading::OpenProcess(access, false, pid) }
            .ok()
            .map(Process)
    }
}

impl Drop for Process {
    fn drop(&mut self) {
        let _ = unsafe { windows::Win32::Foundation::CloseHandle(self.0) };
    }
}

fn owner(port: u16, pid: u32) -> PortOwner {
    use windows::Win32::System::Threading::PROCESS_QUERY_LIMITED_INFORMATION;
    let limited = Process::open(pid, PROCESS_QUERY_LIMITED_INFORMATION);
    let exe = limited.as_ref().and_then(image_path);
    let name = match (&exe, pid) {
        (Some(p), _) => std::path::Path::new(p)
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default(),
        (None, 4) => "System".into(),
        _ => String::new(),
    };
    PortOwner {
        port,
        pid,
        name,
        exe,
        cwd: working_dir(pid),
        started_ms: limited.as_ref().and_then(start_time),
    }
}

fn image_path(p: &Process) -> Option<String> {
    use windows::Win32::System::Threading::{QueryFullProcessImageNameW, PROCESS_NAME_WIN32};
    let mut buf = [0u16; 1024];
    let mut len = buf.len() as u32;
    unsafe {
        QueryFullProcessImageNameW(
            p.0,
            PROCESS_NAME_WIN32,
            windows::core::PWSTR(buf.as_mut_ptr()),
            &mut len,
        )
    }
    .ok()?;
    Some(String::from_utf16_lossy(&buf[..len as usize]))
}

fn start_time(p: &Process) -> Option<u64> {
    use windows::Win32::Foundation::FILETIME;
    let (mut created, mut exited, mut kernel, mut user) = (
        FILETIME::default(),
        FILETIME::default(),
        FILETIME::default(),
        FILETIME::default(),
    );
    unsafe {
        windows::Win32::System::Threading::GetProcessTimes(
            p.0,
            &mut created,
            &mut exited,
            &mut kernel,
            &mut user,
        )
    }
    .ok()?;
    // 100 ns ticks since 1601 → ms since 1970.
    let ticks = ((created.dwHighDateTime as u64) << 32) | created.dwLowDateTime as u64;
    (ticks / 10_000).checked_sub(11_644_473_600_000)
}

/// Copies a `T` out of another process's memory.
unsafe fn read_remote<T: Copy>(p: &Process, addr: usize) -> Option<T> {
    let mut value = std::mem::MaybeUninit::<T>::uninit();
    let mut read = 0usize;
    windows::Win32::System::Diagnostics::Debug::ReadProcessMemory(
        p.0,
        addr as *const _,
        value.as_mut_ptr().cast(),
        std::mem::size_of::<T>(),
        Some(&mut read),
    )
    .ok()?;
    (read == std::mem::size_of::<T>()).then(|| value.assume_init())
}

/// The process's current directory, read from its PEB: Windows has no API
/// for another process's working directory. Needs PROCESS_VM_READ, so a
/// process of another user or an elevated one gives None. The offsets are
/// the 64-bit layout (PEB.ProcessParameters at 0x20,
/// RTL_USER_PROCESS_PARAMETERS.CurrentDirectory.DosPath at 0x38), unchanged
/// since Windows XP x64 and what every process explorer reads. ponytail: a
/// 32-bit (WOW64) process reports its 64-bit PEB's copy, which may be stale.
fn working_dir(pid: u32) -> Option<String> {
    use windows::Wdk::System::Threading::{NtQueryInformationProcess, ProcessBasicInformation};
    use windows::Win32::System::Threading::{
        PROCESS_BASIC_INFORMATION, PROCESS_QUERY_INFORMATION, PROCESS_VM_READ,
    };
    let p = Process::open(pid, PROCESS_QUERY_INFORMATION | PROCESS_VM_READ)?;
    // SAFETY: plain data; all zeroes is a valid value.
    let mut info: PROCESS_BASIC_INFORMATION = unsafe { std::mem::zeroed() };
    let mut len = 0u32;
    unsafe {
        NtQueryInformationProcess(
            p.0,
            ProcessBasicInformation,
            (&mut info as *mut PROCESS_BASIC_INFORMATION).cast(),
            std::mem::size_of::<PROCESS_BASIC_INFORMATION>() as u32,
            &mut len,
        )
    }
    .ok()
    .ok()?;
    let peb = info.PebBaseAddress as usize;
    if peb == 0 {
        return None;
    }
    unsafe {
        let params: usize = read_remote(&p, peb + 0x20)?;
        // UNICODE_STRING: Length (bytes), MaximumLength, padding, Buffer.
        let length: u16 = read_remote(&p, params + 0x38)?;
        let buffer: usize = read_remote(&p, params + 0x38 + 8)?;
        if length == 0 || length > 2048 || buffer == 0 {
            return None;
        }
        let mut wide = vec![0u16; length as usize / 2];
        let mut read = 0usize;
        windows::Win32::System::Diagnostics::Debug::ReadProcessMemory(
            p.0,
            buffer as *const _,
            wide.as_mut_ptr().cast(),
            length as usize,
            Some(&mut read),
        )
        .ok()?;
        let dir = String::from_utf16_lossy(&wide[..read / 2]);
        // "C:\work\shop\" → "C:\work\shop", but "C:\" stays.
        Some(match dir.strip_suffix('\\') {
            Some(d) if !d.ends_with(':') => d.to_string(),
            _ => dir,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::looks_like_tls_record;

    #[test]
    fn finds_who_listens_on_a_port() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let owners = super::owners_of(&[port]);
        let me = owners
            .iter()
            .find(|o| o.pid == std::process::id())
            .expect("this test process owns the port");
        let lower = |s: &str| s.to_lowercase();
        assert_eq!(
            me.exe.as_deref().map(lower),
            Some(lower(&std::env::current_exe().unwrap().to_string_lossy()))
        );
        assert!(me.name.ends_with(".exe"));
        assert_eq!(
            me.cwd.as_deref().map(lower),
            Some(lower(&std::env::current_dir().unwrap().to_string_lossy()))
        );
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;
        let started = me.started_ms.expect("start time");
        assert!(started <= now && now - started < 3_600_000);
        // Nobody listens on port 1 on a dev machine.
        assert!(super::owners_of(&[1]).is_empty());

        // The same process on IPv4 and IPv6 is listed once.
        if let Ok(_v6) = std::net::TcpListener::bind(("::1", port)) {
            let mine = super::owners_of(&[port])
                .into_iter()
                .filter(|o| o.pid == std::process::id())
                .count();
            assert_eq!(mine, 1);
        }
    }

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

    #[test]
    fn title_with_attributes() {
        use super::extract_title;
        assert_eq!(
            extract_title("<html><head><title>Vite App</title></head>"),
            Some("Vite App".to_string())
        );
        // The bug: an attribute on the tag meant no title at all.
        assert_eq!(
            extract_title("<title lang=\"en\">Docs</title>"),
            Some("Docs".to_string())
        );
        assert_eq!(
            extract_title("<TITLE>Shouty</TITLE>"),
            Some("Shouty".to_string())
        );
        assert_eq!(
            extract_title("<title>  Trimmed  </title>"),
            Some("Trimmed".to_string())
        );
        assert_eq!(
            extract_title("<title>&amp;co</title>"),
            Some("&co".to_string())
        );
        // Non-ASCII before the tag: the offsets index back into the original
        // string, so a full Unicode lowering here would slice at a bad boundary.
        assert_eq!(
            extract_title("<!-- café İstanbul --><title>Ok</title>"),
            Some("Ok".to_string())
        );
        // Decoded once, not twice.
        assert_eq!(
            extract_title("<title>&amp;lt;b&amp;gt;</title>"),
            Some("&lt;b&gt;".to_string())
        );
        assert_eq!(extract_title("<title></title>"), None);
        assert_eq!(extract_title("no title here"), None);
    }
}
