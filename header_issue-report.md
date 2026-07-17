# Header Injection — Complete Failure Report

**Date:** 2026-07-16
**Platform:** Windows 11, WebView2 (Chromium Edge), Tauri 2.11.2, webview2-com 0.38.2
**Status:** FAILED — all approaches produce `SetHeader` returning `Ok(())` at COM level but the header never reaches the destination server.

---

## 1. Goal

Build a sidebar panel where a developer defines rules like "on any request matching `localhost:3000/*`, add header `Authorization: Bearer <token>`". Rules are workspace-scoped, toggleable without deletion, and take effect immediately on the next request in any open tab without needing a page reload or tab recreation.

**Primary use case:** testing a locally running API without manually pasting an auth token into every request.

---

## 2. Architecture Context

### 2.1 Tab Creation Flow

Every browser tab gets its own `WebviewWindow` (label `browser-{tabId}`). The creation sequence in `create_webview_for_tab()` (`src-tauri/src/commands/browser.rs:494`) is critical:

```
1. WebviewWindowBuilder with URL = "about:blank"
2. Add initialization scripts
3. Build the webview
4. Register COM network handlers     ← handlers must go here
5. webview.navigate(real_url)         ← real navigation only after handlers are attached
```

This `about:blank` → register → navigate sequence was established by the Network Log feature to fix a bug where fast-resolving requests completed before handlers were attached.

### 2.2 Network Capture Handler (Working Reference)

`register_webview_network_capture()` (`browser.rs:1120`) is the confirmed-working reference. It:

1. Gets `CoreWebView2` from `platform.controller().CoreWebView2()`
2. Calls `AddWebResourceRequestedFilter("*", ALL)`
3. Creates and registers `WebResourceRequestedEventHandler` (for request timing)
4. Casts to `ICoreWebView2_2` and registers `WebResourceResponseReceivedEventHandler` (for response logging)
5. Stores correlation data in a global static `NETWORK_REQUEST_META: OnceLock<Mutex<HashMap<String, (Instant, String)>>>`

### 2.3 Global State Pattern

```rust
static NETWORK_REQUEST_META: OnceLock<Mutex<HashMap<String, (Instant, String)>>> = OnceLock::new();
```

The header injection code followed this exact pattern for rule storage:

```rust
// src-tauri/src/commands/headers.rs
static HEADER_RULES: OnceLock<Mutex<Vec<HeaderRule>>> = OnceLock::new();
```

### 2.4 Workspace → Tab Model

- Tabs have `workspaceId: string` property
- Workspaces store `tabIds: string[]` and `activeTabId: string | null`
- Frontend resolves active tab per workspace via `getLiveWorkspaceActiveTab()` from `src/lib/workspaceTabs.ts`
- Header rules are stored per workspace in Zustand (`rulesByWs: Record<string, HeaderRule[]>`)
- On workspace switch or rule change, a Zustand `subscribe` in `useWebviewBridge.ts` calls `set_header_rules()` to push the current workspace's rules to Rust

### 2.5 Panel/Store/Wiring Conventions

Modeled after the existing Network Log feature:

- **Store:** `src/stores/headers.ts` — Zustand with `persist`, following `src/stores/network.ts` pattern
- **Panel:** `src/components/panels/HeadersPanel.tsx` — Following `NetworkPanel.tsx` with rule list, add/toggle/delete
- **Sidebar:** `src/components/sidebar/Sidebar.tsx` — Lazy import + `PANELS` entry (`"headers"`, `Shield` icon, `"Header Injection"` label)
- **IPC:** `src/services/browser.ts` — `setHeaderRules()` and `getHeaderRules()` wrappers
- **Bridge:** `src/hooks/useWebviewBridge.ts` — `useEffect` on `activeWorkspaceId` + `useHeadersStore.subscribe` for auto-sync

---

## 3. Attempt #1 — Separate Handler Registration

### 3.1 What Was Done

A standalone function `register_webview_header_injection()` was added, following the exact structure of `register_webview_network_capture()`. It:

1. Got `CoreWebView2` from the controller
2. Called `AddWebResourceRequestedFilter("*", ALL)` (second registration)
3. Created a new `WebResourceRequestedEventHandler` that hardcoded `X-Xevo-Test: phase1-proof`
4. Called `add_WebResourceRequested` (second registration, token=24)

Both functions were called sequentially in `create_webview_for_tab()`:

```rust
register_webview_network_capture(&webview, app, tab_id);  // token=23
register_webview_header_injection(&webview, app, tab_id);  // token=24
```

### 3.2 The Handler Code (Attempt #1)

```rust
pub fn register_webview_header_injection(wv: &tauri::WebviewWindow, _app: &tauri::AppHandle, _tab_id: &str) {
    let _ = wv.with_webview(move |platform| {
        #[cfg(windows)]
        unsafe {
            use webview2_com::Microsoft::Web::WebView2::Win32::{
                COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL,
            };
            use webview2_com::WebResourceRequestedEventHandler;
            use windows::core::HSTRING;

            let core = match platform.controller().CoreWebView2() {
                Ok(core) => core,
                Err(e) => {
                    eprintln!("[XEVO] CoreWebView2() failed for header injection: {e:?}");
                    return;
                }
            };

            if let Err(e) = core.AddWebResourceRequestedFilter(
                windows::core::w!("*"),
                COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL,
            ) {
                eprintln!("[XEVO] AddWebResourceRequestedFilter failed for header injection: {e:?}");
                return;
            }

            let handler = WebResourceRequestedEventHandler::create(Box::new(move |_webview, args| {
                let args = match args {
                    Some(a) => a,
                    None => return Ok(()),
                };

                let request = match args.Request() {
                    Ok(r) => r,
                    Err(_) => return Ok(()),
                };

                let mut uri_ptr = windows::core::PWSTR::null();
                let _ = request.Uri(&mut uri_ptr);
                let uri = if uri_ptr.is_null() { String::new() } else { uri_ptr.to_string().unwrap_or_default() };

                eprintln!("[XEVO-HEADERS] handler fired for URI: {}", uri);

                if let Ok(headers) = request.Headers() {
                    let name = HSTRING::from("X-Xevo-Test");
                    let value = HSTRING::from("phase1-proof");
                    match headers.SetHeader(&name, &value) {
                        Ok(()) => eprintln!("[XEVO-HEADERS] SetHeader succeeded for URI: {}", uri),
                        Err(e) => eprintln!("[XEVO-HEADERS] SetHeader FAILED: {e:?}"),
                    }
                }

                Ok(())
            }));

            let mut token: i64 = 0;
            match core.add_WebResourceRequested(&handler, &mut token) {
                Ok(()) => eprintln!("[XEVO-HEADERS] WebResourceRequested handler registered — token={token}"),
                Err(e) => eprintln!("[XEVO-HEADERS] WebResourceRequested handler FAILED: {e:?}"),
            }
        }
    });
}
```

### 3.3 Symptom

**Terminal logs show:**

```
[XEVO] WebResourceRequested handler registered — token=23
[XEVO-HEADERS] WebResourceRequested handler registered — token=24
[XEVO-HEADERS] handler fired for URI: https://httpbin.org/headers
[XEVO-HEADERS] SetHeader succeeded for URI: https://httpbin.org/headers
```

`SetHeader` returns `Ok(())` every time on every request.

**httpbin.org/headers response:**

```json
{
  "headers": {}
}
```

Absolutely empty. Not even standard browser headers (`User-Agent`, `Accept`, `Host`, etc.) appeared. The `X-Xevo-Test: phase1-proof` header was also absent.

### 3.4 Additional Symptoms

- The `favicon.ico` request also showed the same empty response
- Network panel in the browser also showed entries (the logging part of the handler worked)
- Some console errors about `index.html` 404 appeared (unrelated — likely httpbin.org's own page loading)

### 3.5 Root Cause Hypothesis

With TWO independent `WebResourceRequestedEventHandler` instances registered on the same `CoreWebView2`, both fired for the same request event. Each handler received its own `args` object and called `args.Request()` independently. The second handler's `request.Headers()` likely returned a **disconnected COM object** — a copy that `SetHeader` could modify successfully but whose changes had no effect on the real request on the wire.

This matches the class of bug documented in Microsoft WebView2Feedback issue #259 (2020), where `args.Request()` returned a fresh disconnected object on every call. While Microsoft claims to have fixed that bug in SDK 0.9.628-prerelease, the same pattern may manifest with hander coexistence where each handler gets its own isolated view of the request.

---

## 4. Attempt #2 — Merged Handler (SetHeader First)

### 4.1 What Was Done

Deleted the separate `register_webview_header_injection()` function entirely and spliced the header injection logic into the TOP of the existing `WebResourceRequestedEventHandler` callback inside `register_webview_network_capture()`.

The critical design decision: SetHeader is called on the SAME `request` reference that the network logging code uses, before any `Method()` / `Uri()` / `ResourceContext()` reads are performed on it.

### 4.2 The Merged Handler Code

```rust
let req_handler = WebResourceRequestedEventHandler::create(Box::new(move |_webview, args| {
    let args = match args {
        Some(a) => a,
        None => return Ok(()),
    };
    let request = match args.Request() {
        Ok(r) => r,
        Err(_) => return Ok(()),
    };

    // ── Header injection: set headers on the canonical request reference ──
    // Must happen FIRST, before any other reads on `request`, to ensure
    // modifications land on the real COM object (not a disconnected copy).
    if let Ok(req_headers) = request.Headers() {
        let name = HSTRING::from("X-Xevo-Test");
        let value = HSTRING::from("phase1-proof");
        let _ = req_headers.SetHeader(&name, &value);
    }

    let mut method_ptr = PWSTR::null();
    let mut uri_ptr = PWSTR::null();
    let _ = request.Method(&mut method_ptr);
    let _ = request.Uri(&mut uri_ptr);
    // ... rest of network logging unchanged
}));
```

### 4.3 Symptom

**Same as Attempt #1.** `SetHeader` returns `Ok(())`, httpbin.org/headers shows `"headers": {}`. No change. The `X-Xevo-Test` header never reaches the server.

### 4.4 Terminal Output (Attempt #2)

```
[XEVO] WebResourceRequested handler registered — token=23
[XEVO-LIFECYCLE] browser_create_tab — label=browser-tab-... is_minimized=false show_immediately=true
[XEVO-HEADERS] handler fired for URI: https://httpbin.org/headers      ← removed in attempt 2 but illustrates
[XEVO-HEADERS] SetHeader succeeded for URI: https://httpbin.org/headers ← same pattern
```

Only one registration token (23) — no second handler.

### 4.5 Conclusion

Handler coexistence was NOT the root cause. The issue is more fundamental. Even with a SINGLE handler, operating on a SINGLE `request` reference, `SetHeader` returns `Ok(())` but the mutation doesn't survive to the actual HTTP request sent to the server.

---

## 5. What Also Works Correctly (Unrelated to the Failure)

The following was fully built and compiles cleanly:

### 5.1 Backend (Rust)

**`src-tauri/src/commands/headers.rs`:**

```rust
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
```

Registered in `src-tauri/src/lib.rs` invoke handler.

### 5.2 Frontend

**`src/stores/headers.ts`** — Zustand store with `persist` middleware, storing `rulesByWs: Record<string, HeaderRule[]>`.

**`src/components/panels/HeadersPanel.tsx`** — Panel component with:
- `AddRuleForm` (pattern, header name, value inputs + submit button)
- `RuleRow` (enabled/disabled toggle, pattern display, header name:value display, delete button)
- `EMPTY_RULES` constant to avoid infinite re-render loop from unstable array references

**`src/components/sidebar/Sidebar.tsx`** — Lazy import + `PANELS` entry `{ id: "headers", Icon: Shield, label: "Header Injection" }` + conditional render.

**`src/services/browser.ts`** — `setHeaderRules()` and `getHeaderRules()` IPC wrappers.

**`src/hooks/useWebviewBridge.ts`** — `useEffect` on `activeWorkspaceId` + `useHeadersStore.subscribe` for auto-sync on rule changes.

### 5.3 TypeScript

`PanelId` union type in `src/types/index.ts:69` already includes `"headers"`.

### 5.4 Build Status

- `cargo check` — passes with 1 pre-existing warning (`src/lib.rs:130` — unused assignment of `active_label`)
- `npx tsc --noEmit` — passes clean (0 errors)

---

## 6. Files Created/Modified (Complete Manifest)

### New Files
| File | Purpose |
|------|---------|
| `src-tauri/src/commands/headers.rs` | Rust commands + `HeaderRule` struct + `HEADER_RULES` static |
| `src/stores/headers.ts` | Zustand store with persist, rules per workspace |
| `src/components/panels/HeadersPanel.tsx` | Panel UI: rule list, add/toggle/delete |
| `header_issue-report.md` | This document |

### Modified Files
| File | Changes |
|------|---------|
| `src-tauri/src/commands/browser.rs` | Added `SetHeader` call in existing `WebResourceRequestedEventHandler` (then removed standalone function) |
| `src-tauri/src/commands/mod.rs` | Added `pub mod headers;` |
| `src-tauri/src/lib.rs` | Registered `set_header_rules`, `get_header_rules` commands |
| `src/components/sidebar/Sidebar.tsx` | Added `Shield` icon import, `HeadersPanel` lazy import, `PANELS` entry, conditional render |
| `src/services/browser.ts` | Added `HeaderRulePayload` interface, `setHeaderRules()`, `getHeaderRules()` |
| `src/hooks/useWebviewBridge.ts` | Added `useHeadersStore` import, `setHeaderRules` import, sync `useEffect` + `subscribe` |

---

## 7. Evidence in Detail

### 7.1 The httpbin.org Test

The verification endpoint `https://httpbin.org/headers` is a public HTTP service that echoes back all request headers it received from the client. This is the correct verification method — NOT reading the header back off the COM `Request` object, because the COM readback can lie.

**Expected response (when headers were injected):**

```json
{
  "headers": {
    "X-Xevo-Test": "phase1-proof",
    "Accept": "text/html,application/xhtml+xml,...",
    "Accept-Encoding": "gzip, deflate, br",
    "Accept-Language": "...",
    "Host": "httpbin.org",
    "Sec-Fetch-Mode": "navigate",
    "User-Agent": "...",
    ...
  }
}
```

**Actual response (both attempts):**

```json
{
  "headers": {}
}
```

This response is highly unusual — even without header injection, a normal browser request to httpbin.org should include many standard headers. The fact that `"headers": {}` is returned at all suggests either:
1. The httpbin.org response was cached/empty for some unrelated reason
2. The WebView2 network stack itself is sending requests with no headers (very unlikely)
3. The handler's modifications corrupted the request in a way that stripped all headers

### 7.2 Concurrent Features

- Network Log continues to work — entries appear correctly for all requests
- Basic browser functionality (navigation, page load) works normally
- The `X-Xevo-Test` header's absence has no apparent side effects on page rendering

### 7.3 Frontend Bug Fixed

An infinite re-render occurred on first launch because:

```tsx
// BUG — creates new [] reference every render
const rules = useHeadersStore((s) => s.rulesByWs[activeWorkspaceId] ?? []);

// FIX — stable reference
const EMPTY_RULES: HeaderRule[] = [];
const rulesByWs = useHeadersStore((s) => s.rulesByWs);
const rules = useMemo(() => rulesByWs[activeWorkspaceId] ?? EMPTY_RULES, [rulesByWs, activeWorkspaceId]);
```

The `?? []` pattern in a Zustand selector returns a new empty array on every render when the workspace has no rules, causing React to detect a changed value and re-render infinitely.

---

## 8. Root Cause Hypotheses

### H1: Disconnected COM Headers Object (Most Likely)

The `request.Headers()` method in the webview2-com 0.38 binding may return a **new, disconnected copy** of the `ICoreWebView2HttpRequestHeaders` object, rather than a reference to the request's actual headers. `SetHeader` would then succeed on the copy but have no effect on the real request.

**This is the same class of bug as Microsoft WebView2Feedback issue #259.** That issue was about `args.Request()` returning disconnected objects (fixed in SDK 0.9.628). This could be a variant where `request.Headers()` has a similar problem.

**Diagnostic test:** After calling `SetHeader`, immediately call `GetHeader` on the same `req_headers` object:

```rust
if let Ok(req_headers) = request.Headers() {
    let name = HSTRING::from("X-Xevo-Test");
    let value = HSTRING::from("phase1-proof");
    let _ = req_headers.SetHeader(&name, &value);
    // READ BACK: verify it stuck
    let mut readback = PWSTR::null();
    if let Ok(()) = req_headers.GetHeader(&name, &mut readback) {
        let val = if readback.is_null() { "NULL" } else { readback.to_string().unwrap_or("ERR") };
        eprintln!("[XEVO] Readback after SetHeader: {val}");
    }
}
```

- If readback returns `"phase1-proof"` → COM object IS the real one, issue is deeper in WebView2 pipeline
- If readback returns empty/NULL → COM object is disconnected, need different API approach

### H2: webview2-com 0.38 Binding Bug

The `webview2-com` crate (v0.38) provides Rust COM bindings for the WebView2 API. If the binding for `ICoreWebView2HttpRequestHeaders::SetHeader` doesn't properly forward the mutation to the underlying native COM object, the Rust `Ok(())` return would be misleading.

**Diagnostic test:** Test with the raw `windows` crate API directly instead of through webview2-com:

```rust
use windows::Win32::Web::WebView2::{
    ICoreWebView2, ICoreWebView2_2, ICoreWebView2WebResourceRequest,
    ICoreWebView2HttpRequestHeaders,
};
```

### H3: WebView2 Runtime Version

The WebView2 runtime auto-updates. If the installed runtime has a regression in the `ICoreWebView2HttpRequestHeaders::SetHeader` implementation, headers would silently fail to apply.

**Diagnostic test:** Check `webview2_loader::get_available_core_webview2_browser_version_info()` for the installed runtime version.

### H4: Pipeline Ordering (Deferral Needed)

Despite the brief's research that Deferral is unnecessary for synchronous SetHeader, the actual WebView2 implementation on this specific system may require it. Without a Deferral, the request may be dispatched before the handler returns.

**Diagnostic test:** Add a `GetDeferral` call and hold it until after `SetHeader`, then complete it:

```rust
let deferral = args.GetDeferral()?;
// ... SetHeader ...
deferral.Complete();
```

### H5: Network Stack Stripping

Chromium's network stack may strip "unsafe" headers even when set via the COM interception layer. Microsoft's documentation contains this caveat: *"The WebView2 network stack can add more headers (for example, can add cookies and authorization headers)"* — suggesting the stack may also REMOVE headers it doesn't expect.

However, this is unlikely for a custom header like `X-Xevo-Test` which has no special meaning to Chromium.

---

## 9. Key Microsoft Documentation References

### WebView2Feedback Issue #1973 (Confirmed Working)
> A developer successfully injects a Bearer/CSRF token header via the `ICoreWebView2HttpRequestHeaders::SetHeader` mechanism inside a `WebResourceRequested` handler. This is the primary evidence that the mechanism is supposed to work.

### WebView2Feedback Issue #259 (Bug — Fixed)
> Every call to `args.Request()` returned a fresh, disconnected object, so `SetHeader` mutations landed on a throwaway. Fixed in WebView2 SDK 0.9.628-prerelease (2020). WebView2 runtime auto-updates independently of the app.

### Microsoft Docs: SetHeader
> `ICoreWebView2HttpRequestHeaders::SetHeader` — Sets the header value. Sets or overwrites the header value for the name. The name is the header name, and the value is the header value.

### Microsoft Docs: No Deferral = Synchronous
> A `WebResourceRequested` handler that does not take a Deferral automatically holds the request until the handler function returns. As long as `SetHeader` is called before the handler returns, the modification is guaranteed to be applied before the request proceeds.

---

## 10. Future Debugging Recommendations (Ordered by Likelihood)

### Step 1: Readback Verification
Add `GetHeader` readback immediately after `SetHeader` to confirm the COM object is the real one. This is the single most important diagnostic.

### Step 2: Deferral Test
Add `GetDeferral` + hold + `Complete` pattern to rule out timing issues:

```rust
if let Ok(deferral) = args.GetDeferral() {
    // SetHeader ...
    deferral.Complete();
}
```

### Step 3: Raw Windows Crate API
Bypass webview2-com and use the raw `windows` crate API for `SetHeader` to rule out a binding bug:

```rust
use windows::Win32::Web::WebView2::ICoreWebView2;
let raw: ICoreWebView2 = core.cast()?;
```

### Step 4: Standalone WebView2 Sample (Non-Tauri)
Create a minimal Win32 C++ or C# application that uses WebView2 directly (no Tauri, no webview2-com), and test `SetHeader` there. This isolates whether the issue is in the Tauri+webview2-com stack or in the WebView2 runtime itself.

### Step 5: Alternative: CDP (Chrome DevTools Protocol)
If COM interception genuinely cannot inject headers, the Chrome DevTools Protocol's `Network.setExtraHTTPHeaders` can inject headers into ALL requests from a WebView2 instance:

```rust
use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_14;
use windows::core::HSTRING;

// Phase 5 approach: CallDevToolsProtocolMethod
let method = HSTRING::from("Network.enable");
core14.CallDevToolsProtocolMethod(&method, &params, &handler);
```

This is a fundamentally different approach that bypasses the `WebResourceRequested` handler entirely. It's more reliable but applies headers globally (not per-request) and may have its own limitations.

### Step 6: Future Frontend Work (If Backend Works)
If the COM approach eventually works (via any of the above fixes), the frontend is already fully built:

1. Add the `wildcard_match` / `url_matches` helper in Rust (ported from the removed MITM approach)
2. Replace hardcoded `X-Xevo-Test` with rule iteration from `HEADER_RULES`
3. Enable the panel's UI to add/toggle/delete rules

---

## 11. Deleted Code (For Reference If Reviving This Feature)

The following was built and then removed during the two attempts. If any future attempt revisits header injection via a working mechanism, this code serves as a reference for the rule engine and frontend:

### Removed (Attempt #2): The standalone handler function
```rust
pub fn register_webview_header_injection(...) { ... }
```

### Frontend (still present, functional, ready to use):
- `src/stores/headers.ts`
- `src/components/panels/HeadersPanel.tsx`
- PANELS entry in `src/components/sidebar/Sidebar.tsx`
- `setHeaderRules`/`getHeaderRules` in `src/services/browser.ts`
- Sync logic in `src/hooks/useWebviewBridge.ts`
- `src-tauri/src/commands/headers.rs`

---

## 12. Session Summary

| Phase | Description | Result |
|-------|-------------|--------|
| 0 | Investigated codebase patterns, confirmed architecture | ✓ Done |
| 1 | Hardcoded SetHeader in separate handler | ❌ SetHeader returns Ok, header doesn't reach server |
| 2 | Merged handler with SetHeader first | ❌ Same failure |
| 3 | Frontend panel + store + wiring built | ✓ Works (no infinite loops), ready when backend works |
| 4 | Rule engine + Tauri commands | ✓ Built, compiles, ready to use |

The core technical question remains unanswered: **why does `ICoreWebView2HttpRequestHeaders::SetHeader` return `Ok(())` but not actually modify the request?** Until this is resolved, no amount of frontend or rule-engine work will make header injection functional.

---

*End of report. Last updated: 2026-07-16.*
