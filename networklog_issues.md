# Network Log Feature — Postmortem

## Overview

The Network Log feature aimed to capture fetch/XHR requests made inside browser webviews (external URLs like `https://jsonplaceholder.typicode.com/`) and display them in a Network Panel UI. The feature was removed because a reliable IPC bridge from external URL pages to the Tauri backend could not be established.

---

## Architecture Attempted

### Data Flow (intended)

```
Page (external URL)
  ↓ monkeypatch intercepts fetch/XHR
  ↓ buffers entries in __xevoNetBuffer
  ↓ flushes every 500ms via __xevoScheduleFlush
  ↓ window.chrome.webview.postMessage({type:'network_entry', entry:...})
  ↓
COM WebMessageReceivedEventHandler (Rust)
  ↓ parses JSON, matches "network_entry" type
  ↓ app.emit("xevo://network-entry", entry)
  ↓
Frontend Tauri event listener
  ↓ useNetworkStore.addEntry(entry)
  ↓
NetworkPanel UI renders entry
```

### Components

| Component | Location | Purpose |
|-----------|----------|---------|
| `NETWORK_SCRIPT` | `browser.rs` (inline JS string) | Initialization script that monkeypatches `window.fetch` and `XMLHttpRequest`, buffers entries, and flushes via `chrome.webview.postMessage` |
| `register_webview_ipc` | `browser.rs` | Extracts `ICoreWebView2` from the webview, calls `webview_ipc::register` |
| `webview_ipc.rs` | `commands/webview_ipc.rs` | COM `WebMessageReceivedEventHandler` that listens for `postMessage` calls, parses `network_entry` type, emits Tauri event |
| `browser_set_network_capturing` | `browser.rs` | Toggle capturing on/off across all browser webviews |
| `onNetworkEntry` | `services/browser.ts` | Frontend listener for `xevo://network-entry` Tauri event |
| `setNetworkCapturing` | `services/browser.ts` | Invokes `browser_set_network_capturing` Tauri command |
| `useNetworkStore` | `stores/network.ts` | Zustand store with `entriesByTab`, filtering, capture toggle |
| `NetworkPanel.tsx` | `components/panels/` | React component displaying captured entries with method/URL filters, expandable request/response details |

---

## Attempts & Results

### Phase 1: Tauri Capability File (`browser.json`)

**Approach:** Add a Tauri capability file to allow `__TAURI_INTERNALS__.invoke()` from external URLs.

**Result:** FAILED. Tauri 2's security model intentionally blocks `__TAURI_INTERNALS__` on external URL origins. Capabilities cannot override this restriction.

### Phase 2: COM `WebMessageReceivedEventHandler` (via `webview2-com`)

**Approach:** Register a native COM handler on the `ICoreWebView2` to receive `window.chrome.webview.postMessage()` calls. This is the same mechanism wry/Tauri uses internally for IPC, and it bypasses the `__TAURI_INTERNALS__` restriction because it works at the WebView2 API level.

**Implementation details:**
- Used `webview2-com` crate's `WebMessageReceivedEventHandler` + `ICoreWebView2`
- Handler reads messages via `TryGetWebMessageAsString` with fallback to `WebMessageAsJson`
- Routes `"network_entry"` type messages to Tauri event `"xevo://network-entry"`
- Registered at webview creation via `platform.controller().CoreWebView2()` after `builder.build()`

**Result:** FAILED.

**Confirmed working:**
- `NETWORK_SCRIPT` loads as an initialization script ✅
- `window.__xevoNetBuffer` initialized ✅
- `window.fetch` monkeypatched ✅
- Entries pushed to `__xevoNetBuffer` ✅
- `window.chrome.webview.postMessage` is a function ✅
- COM handler registered successfully (`token=23`) ✅

**Confirmed broken:**
- `window.chrome.webview.postMessage({type:'network_entry', entry})` NEVER reaches the COM handler ❌
- No `handler FIRED` message in Rust terminal despite registration succeeding
- No `TryGetWebMessageAsString` or `WebMessageAsJson` output
- The handler's closure is simply never invoked

### Phase 3: Diagnostics

**Approach:** Added extensive `console.error` diagnostics throughout the pipeline:
- Entry/exit of NETWORK_SCRIPT IIFE
- Per-variable guard states
- Fetch response handler execution
- Buffered entry count checks

**Results confirmed:**
- NETWORK_SCRIPT IIFE runs to completion (all variables set)
- `capturing=true` when NetworkPanel is open
- Buffer receives entries (confirmed by disabling flush timer)
- Buffer entries are flushed after 500ms (confirmed by checking after timer)
- COM handler registered OK (token=23)
- But COM handler NEVER fires ⛔

---

## Root Cause Analysis

### Theories Eliminated

1. ❌ **`__TAURI_INTERNALS__` blocked** — bypassed via COM handler approach
2. ❌ **Capability file missing** — not applicable to COM handler approach
3. ❌ **Race condition with init scripts** — eliminated by switching from single `__xevoNetBatchInited` guard to per-variable guards
4. ❌ **`IsWebMessageEnabled` disabled** — confirmed default `true`, never changed by wry/Tauri
5. ❌ **Timing (handler registered too late)** — confirmed `CoreWebView2()` returns valid interface after `build()`
6. ❌ **Message format (object vs string)** — COM handler tries both `TryGetWebMessageAsString` and `WebMessageAsJson`, but handler never fires at all (doesn't reach either method)

### Remaining Unknown

The `ICoreWebView2::add_WebMessageReceived` returns `token=23` (success) but the registered handler is NEVER called when `window.chrome.webview.postMessage()` is invoked. Possible explanations (unconfirmed):

1. **WebView2 runtime version quirk** — The user's installed WebView2 runtime may have a bug or behavior difference where `postMessage` from pages loaded via `WebviewUrl::External` does not trigger registered COM handlers, even though `IsWebMessageEnabled` is `true`.

2. **Security boundary** — WebView2 may isolate `postMessage` delivery to only the handler registered by the webview's original creator (wry), ignoring additional handlers registered later via `add_WebMessageReceived`. This would be a COM event source behavior difference rather than a documented security feature.

3. **COM interface version mismatch** — The `ICoreWebView2` interface obtained from `controller.CoreWebView2()` may be a different COM pointer than what wry uses internally, and the event source might delegate to specific implementations.

4. **Tauri/wry environment interception** — wry may intercept `window.chrome.webview.postMessage` before it reaches the CoreWebView2 event system, consuming the message without propagating to other COM handlers.

---

## Key Lessons for Future Implementation

1. **Do NOT use `__TAURI_INTERNALS__` for external URLs.** It is blocked by design in Tauri 2 and no capability file can override it.

2. **COM `WebMessageReceivedEventHandler` registers successfully** but may not receive messages from external URL pages. This approach requires deeper WebView2/sys-level debugging.

3. **Alternative approaches to consider:**
   - **WebView2 `AddScriptToExecuteOnDocumentCreated` + `ExecuteScript` round-trip:** Inject a script that uses `window.fetch` directly (like a service worker or a proxy), bypassing the page's native fetch entirely.
   - **Proxy server approach:** Route all network traffic through a local proxy (e.g., a Rust HTTP proxy baked into the app), capturing traffic at the HTTP level rather than the JS level.
   - **Tauri plugin for WebView2:** Write a Tauri plugin that wraps lower-level WebView2 APIs directly (bypassing wry's abstraction) to register message handlers with the correct COM interface.
   - **`window.external.notify` or `window.external.SendMessage`:** Older WebView2 interop APIs that may behave differently from `chrome.webview.postMessage`.
   - **URL scheme interception:** Register a custom URL scheme handler in WebView2 that captures requests at the browser engine level.

4. **Diagnostic tools that helped:**
   - `console.error` with `'[xevo]'` prefix for filtering DevTools output
   - `eprintln!` in Rust for COM handler tracing
   - `window.__xevoScheduleFlush = function(){}` to disable flush timer for buffer inspection
   - Per-variable guards instead of composite guards for race-condition-safe initialization

---

## Files Removed/Cleaned Up

| File | Action |
|------|--------|
| `src-tauri/src/commands/webview_ipc.rs` | Deleted (109 lines) |
| `src/components/panels/NetworkPanel.tsx` | Deleted (454 lines) |
| `src/stores/network.ts` | Deleted (102 lines) |
| `src-tauri/src/commands/mod.rs` | Removed `pub mod webview_ipc;` |
| `src-tauri/src/commands/browser.rs` | Removed `NETWORK_SCRIPT` (~270 lines), `register_webview_ipc`, `browser_set_network_capturing`, `is_capturing`-related code, `__xevoNetCapturing` evals |
| `src-tauri/src/lib.rs` | Removed `is_capturing` from `BrowserState`, removed `browser_set_network_capturing` from handler registration |
| `src/types/index.ts` | Removed `NetworkLogEntry` interface and `"network"` from `PanelId` |
| `src/services/browser.ts` | Removed `onNetworkEntry` and `setNetworkCapturing` |
| `src/hooks/useWebviewBridge.ts` | Removed network entry listener setup and cleanup |
| `src/components/sidebar/Sidebar.tsx` | Removed lazy import, panel entry, and conditional render for `NetworkPanel` |
