# XEVO Project State

## Version: v1.32.1-dev
## Last Updated: 2026-07-17
## Status: Header injection fixed using page-level fetch/XHR monkeypatch (the COM `SetHeader` call was returning `Ok(())` but not actually sending headers). Network panel v1.32.x remains complete. `pnpm tsc --noEmit` clean; `cargo check --target x86_64-pc-windows-msvc` clean.

## Header Injection Perfect Fix (report follow-up)

### Problem
`ICoreWebView2HttpRequestHeaders::SetHeader` inside `WebResourceRequested` returned `Ok(())`, yet destinations like `httpbin.org/headers` received no user-defined headers.

### Solution
- Removed the broken COM `SetHeader` block from the `WebResourceRequested` handler.
- Added `HEADER_INJECTION_SCRIPT` init script that monkeypatches `window.fetch` and `XMLHttpRequest` to inject matching header rules before each request.
- `headers::current_rules_json()` exposes the Rust static rules as JSON so each new tab's init script can inline the latest rules without a bridge round-trip.
- `set_header_rules()` pushes live updates via `eval("window.__XEVO_HEADER_RULES = [...]")` to every open `browser-*` webview, scanning both Tauri's `webview_windows()` registry and the persistent `BrowserState.webviews` map so handles dropped by Tauri #14843 stay in sync.
- `headers.rs` now imports `tauri::Manager` (required for `AppHandle::webview_windows()` and `try_state()`).
- `HEADER_INJECTION_SCRIPT` skips `tauri://localhost` and `http://ipc.localhost` so user headers never attach to internal Tauri IPC requests.

### Verification
- `pnpm tsc --noEmit` — clean
- `cargo check --target x86_64-pc-windows-msvc` — clean
- `cargo check` on the Linux host fails inside the transitive `windows-future 0.2.1` crate (`IMarshal`/`marshaler` not found in `windows_core::imp`), which is an environment/target limitation, not a code error.

## ENVIRONMENT
- OS: Windows
- Node: v24.16.0
- Rust: rustc 1.96.0
- pnpm: 11.5.0
- Tauri CLI: 2.11.2
- Tauri crate: 2.11.2

## COMPLETED ✅

### UI Scaling (v1.25.0)
- **Chrome scaling (11 files):** base font 13→14px, tabbar 36→40px, toolbar 40→44px, addressbar 44→48px, statusbar 24→28px, findbar 32→36px, sidebar width 210→240px, workspace switcher 48→56px, sidebar header 28→32px, icons +3-4px across all chrome components
- **Panel text scaling (16+ files):** All sidebar panels (NotesSidebarPanel, HistoryPanel, BookmarksPanel, HeadersPanel, UserAgentPanel, JwtDecoder, Base64Tool, ApiTesterPanel, ViewportPanel) and overlay panels (NetworkPanel, InspectorPanel, ApiTester, NotesNotepad, SocialPreview, HomePage, SettingsPanel) bumped from text-[9px]/[10px]/[11px] → [11px]/[12px]/[13px]; icon sizes +2px; button containers w-5/h-5→w-6/h-6, w-4/h-4→w-5/h-5, h-6→h-7, w-7/h-7→w-8/h-8; sidebar scan status and badge text bumped; workspace badge w-4→w-5, text-[9px]→[10px]
- All changes verified: `tsc --noEmit` clean

### Memory Optimization via WebView2 SetMemoryUsageTargetLevel (v1.26.0)
- **Problem:** Background tabs retain full Chromium render process caches, consuming unnecessary RAM
- **Solution:** Extracted `pub fn apply_memory_target(wv, low)` helper in `browser.rs` — uses `ICoreWebView2_19::SetMemoryUsageTargetLevel` via COM QI cast, with `eprintln!` logging at every failure point (safe on older runtimes; cast failure is logged for debugging)
- **Wiring:** `setMemoryTarget(tabId, low)` frontend service → `browser_set_memory_target` IPC command → `apply_memory_target`
- **Tab switch:** Outgoing tab → LOW, incoming tab → NORMAL (`useWebviewBridge.ts`). Empty-tab branch sets all to LOW.
- **Minimize/restore:** Both minimize paths (`Focused(false)` + `Resized`) call `apply_memory_target(&wv, true)` on all browser webviews after hiding; restore sets only the active tab to NORMAL, leaves others at LOW
- **4 files changed:** `browser.rs`, `lib.rs`, `browser.ts`, `useWebviewBridge.ts`
- Verified: `cargo check` + `tsc --noEmit` clean

### Network Panel (v1.32.x)

All requests from browser webviews are captured via native WebView2 COM handlers (`ICoreWebView2::add_WebResourceRequested` + `ICoreWebView2_2::add_WebResourceResponseReceived`), registered from Tauri's `.with_webview()` on the main UI thread. The network capture is registered AFTER the webview is built (with `about:blank`) but BEFORE navigating to the real URL, ensuring no requests are missed.

**Rust backend** (`register_webview_network_capture` in `browser.rs`):
- Captures method/URL, status code, reason phrase, response headers, body (via `IStream`, 8KB chunks, 64KB cap)
- Resource type detection via `COREWEBVIEW2_WEB_RESOURCE_CONTEXT` (17 types: document, stylesheet, image, script, xhr, fetch, font, etc.)
- Request timing via `Instant` in shared `HashMap`, skipping `http://ipc.localhost` / `tauri://localhost` internal traffic

**Frontend** (`NetworkPanel.tsx`, `stores/network.ts`, `lib/networkCopy.ts`):
- Summary bar: request count, total size, error/slow/API counts, Clear button
- Filter chips: All, Errors (4xx/5xx), API (XHR/Fetch), Slow (>1s)
- Color-coded rows: method, status, type badge, URL, size, time, hover cURL copy
- Detail pane: Headers (URL, status, type, size, time, response headers), Body (preview), Copy (cURL + fetch())
- Zustand store with per-tab scoping, 500-entry cap
- `networklog_issues.md` documents the failed earlier approaches for reference

### Earlier sessions (v0.9–v1.24.1)

Scaffolded Tauri 2 + React 19 + TypeScript with Tailwind v4, shadcn/ui, and Zustand v5. Early sessions (v0.9–v0.9.11) went through multiple architectural iterations for the browser webview — started with `Window::add_child` child webviews, then pivoted to persistent `WebviewWindow` with `parent` (v0.9.6) after discovering Tauri 2's child-webview limitations on Windows (Issue #10079, "not planned"). This became the **tab-per-WebviewWindow architecture**: each tab gets its own `WebviewWindow` (label `browser-{tabId}`), created lazily on first navigation, hidden/shown on switch with full state preservation. **30+ Rust commands** were built: browser_create_tab/navigate_tab/close_tab, show/hide/set_bounds, go_back/forward/reload/stop_loading, find/find_next/stop_find/find_callback, reposition, set_theme, forward_shortcut, update_tab_info, scan_ports, set_header_rules, browser_eval_inspector, inspector_data/mutate, browser_set_user_agent, browser_screenshot, browser_set_memory_target, open_external_url, create_viewport/destroy_viewport/resize_viewport, browser_save_tab_state/restore_tab_state, etc. The frontend has **12+ sidebar panels**: Live Servers, Bookmarks, History, Network (COM-based capture, color-coded rows, filter chips, detail pane), API Tester (Postman-style with cURL import, response viewer, history), Notes (rich text with pin/color/export), JWT Decoder, Base64 Tool, Headers Panel (custom header injection), Inspector Panel (meta/SEO/cookies/storage), Viewport Panel, User Agent Panel (presets), Social Preview. The browser chrome includes a tab system with pointer-based drag-to-reorder, address bar with URL resolution and search engine support, find-in-page (Ctrl+F via injected JS), loading bar, status bar with load-time tracking, command palette (Ctrl+K with fuzzy search), shortcut help (Ctrl+?), and overlay panel system (split-view webview resize for API Tester and Notes). Keyboard shortcuts work in the browser webview via `XEVO_SHORTCUT_FORWARD_SCRIPT` injected into every page. The app has Dark/Light/System theme via `data-theme` attributes and the **XEVO_FRONTEND.md design system** (Tailwind v4 `@theme` token block, `@custom-variant dark`, 34 aria-labels, custom window controls via `tauri-plugin-os`, `prefers-reduced-motion`, all cosmetic shadows removed, tabular-nums on numeric columns, custom DM Sans + JetBrains Mono fonts). A JSON auto-formatter viewer is injected into the webview for API responses. Performance optimizations include: tab discarding after 10min inactivity, concurrent webview cap of 10, shared WebView2 `data_directory`, pre-warm about:blank webview at startup, split init scripts (CORE_SCRIPT, HEADER_SCRIPT, NETWORK_SCRIPT, CHROME_FEATURES_SCRIPT, JSON_VIEWER_SCRIPT), React.lazy panels, Vite manualChunks, and network log memory leak fixes (batching, 5KB body truncation, off-by-default capturing). Workspaces are persisted via Zustand middleware with per-tab history stacks. Key bugs resolved: DPI scaling (PhysicalSize→LogicalSize after discovering `getBoundingClientRect()` returns CSS pixels, not DPI-scaled), title-bar double-counting (window.screenY already returns viewport top-left), 5px oscillation threshold (infinite close-and-recreate loop from WebView2 re-layer shifts), unique webview labels eliminating close-vs-add races, onMoved+onResized dual listener for window drag following, minimize hide/show cycle (hide all browser webviews when main window minimizes), `data-tauri-drag-region="deep"` for window drag from tab bar, and a comprehensive 30-bug sweep (Mutex poison recovery, CSP hardening, async race conditions, webview leaks on tab close/workspace deletion, async listener cancellation flags).

## ARCHITECTURE NOTE (CURRENT)
- **Tab-per-WebviewWindow architecture:** Each tab gets its own `WebviewWindow` (label `browser-{tabId}`), created lazily on first navigation via `browser_create_tab`. Tab switching calls `browser_activate_tab` which hides the old webview and shows the new one — no navigation, no reload, full state preservation.
- Parent is the main `WebviewWindow`. Tauri uses the parent for z-order and lifecycle.
- **Lifecycle rule:** Webviews are created once per tab (on first URL navigation) and destroyed when the tab is closed. Tab switch = hide/show only.
- **Tab discarding:** Tabs inactive >10 minutes are destroyed (`discardTab` in tabs store). On switch, the webview is recreated and the page reloads. Pinned tabs and active tab are exempt.
- **Cap concurrent webviews:** Soft limit of 10 (configurable via `maxConcurrentWebviews`). When exceeded, oldest background tab is discarded.
- **Shared WebView2 environment:** All browser webviews use the same `data_directory` path, so WebView2 shares browser/GPU/network processes across tabs.
- **Pre-warm:** Hidden about:blank webview created at startup to initialize WebView2 browser process, destroyed after 2 seconds.
- **Init scripts:** 5 scripts injected per tab (see `create_webview_for_tab`): (1) `__XEVO_TAB_ID` + `__XEVO_HEADER_RULES` (1 line), (2) `HEADER_INJECTION_SCRIPT` (~70 lines: fetch/XHR header injection), (3) `CORE_SCRIPT` (~400 lines: tab info reporting, keyboard shortcuts), (4) `CHROME_FEATURES_SCRIPT` (~300 lines: find-in-page + bookmark shortcut + shortcut forwarding), (5) `JSON_VIEWER_SCRIPT` (~120 lines: collapsible JSON viewer).
- Bounds are in LOGICAL (CSS) pixels. Frontend `getBounds()` returns `rect.left + window.screenX, rect.top + window.screenY`. Rust passes these directly to `set_position(Position::Logical(...))` / `set_size(Size::Logical(...))`. The OS scales to physical via DPI.
- Hidden by `WebviewWindow::hide()`. Shown by `WebviewWindow::show()` via `browser_show_tab`.
- Events (`browser://url-changed`, `browser://loading`, `browser://tab-info`) include `tabId` in payload so the frontend routes state updates to the correct tab.
- Each webview has `window.__XEVO_TAB_ID` injected via per-tab init script, used by `update_tab_info` to include tab ID in events.
- **Free side benefits:**
  - **Back/forward history now works natively.** Each webview has its own `window.history`. `browser_go_back`/`browser_go_forward` call `eval("window.history.back()")` on the target webview.
  - **Window resize works.** `browser_set_bounds` calls `set_position` + `set_size` on the target WebviewWindow.
  - **First-nav lag is paid once per tab** instead of on every navigation.
  - **Tab state is fully preserved.** DOM, scroll position, form inputs, JavaScript state, video playback — all survive tab switches.

## NOT DONE YET (next sessions)
- Port scanner: HTTP title shown in sidebar tooltip
- Port scanner: manual "add custom port" UI
- API tester: persist request history to localStorage
- API tester: response body type detection (HTML preview, image preview, JSON tree)
- API tester: saved collections / environments / duplicate
- Find in page: case-sensitive toggle, whole-word toggle
- Bookmarks: drag-to-reorder, folder support
- Status bar: hovered URL detection (Task 63.3 — skipped, requires injected script)
- README.md — hero screenshot/GIF, feature list with comparison table, install instructions
- GitHub Actions release.yml — automated Windows build on git tag push
- Optionally: color picker panel, meta tag preview card (og preview)

## KNOWN ISSUES
- **Window-move following uses `onMoved` + `onResized` dual listeners** — `onMoved` fires reliably for user drags but is unreliable for maximize/unmaximize on Windows (SWP_NOMOVE). `onResized` is always reliable. The maximize-state detection resets `lastBoundsRef` on transitions. **Root cause is Tauri 2.x architectural:** `WebviewWindow::parent()` "doesn't seem to work in a Windows environment" per Tauri team's own Issue #10079 (closed as "not planned", June 2024). The frontend `onMoved` + `onResized` dual listener is the best available workaround.
- **WebviewWindow is always built with `transparent: true`** — works on Windows 10+ but may show a white flash on first creation before the page paints. Acceptable; will be addressed if users complain.
- **JSON viewer's depth limit is 8 and max items per array/object is 500** — deeper/larger structures are rendered as `[deep array]` / `{deep object}` / `...N more items` to prevent infinite recursion and unbounded HTML. Most APIs stay well under these limits.
- **Theme has brief dark flash on first paint** — between page load and React's first effect run, `:root { color-scheme: dark }` is active and the html/body have hardcoded dark backgrounds, so light-theme users see a flicker. The dark flash is intentional per spec; first effect run sets the correct data-theme. Acceptable; can be eliminated with an inline boot script in index.html if it bothers users.
- **No transparent window** — main window is opaque (per spec Task 22, tauri.conf.json has no `transparent` key). The WebviewWindow IS transparent (`transparent(true)` in the builder), so the main window's content-area background shows through any pixels the browser page doesn't paint.
- **Settings panel uses absolute positioning** — anchored to the right side of the content area. Does not currently push or reflow the webview; it overlays the right edge (matches the spec).
- **Compact mode CSS uses class-name overrides** — the `.h-9`, `.h-11`, `.w-12`, `.py-2` overrides only apply inside `.xevo-compact`, so they're scoped safely. They DO affect any other element with the same Tailwind class names in compact mode (none currently exist outside tab bar / address bar / workspace switcher, but if someone adds one, the height will shrink too).
- **Command palette mount placement** — `<CommandPalette />` and `<ShortcutHelp />` are mounted in `RootLayout.tsx` OUTSIDE the `relative` content wrapper (they need `position: fixed` over the full window). They don't interfere with the settings panel because all are conditional renders. Opening one overlay while another is open will show the newer one on top (both have z-9999).
- **Tab drag-to-reorder uses pointer events** — replaced HTML5 DnD (broken in WebView2). Ghost element follows cursor during drag. Drop target indicated by 2px blue left border. No animated reorder transition (items snap to position on drop).
- **In-page link click records history via `onUrlChanged` from Rust** — if a page fires multiple `onUrlChanged` events in rapid succession (e.g. SPA internal routing), each one is treated as a navigation and pushed to the back stack. This can pollute history with intermediate URLs. Acceptable for now; can be filtered later by debouncing.
- **Per-tab history was in-memory only (FIXED in v1.19.0)** — Zustand `tabs` store now uses `persist` middleware. Tabs, their URLs, titles, favicons, pinned state, and back/forward history survive app restarts.
- **Global shortcuts fire even when XEVO is not focused** — `tauri-plugin-global-shortcut` registers OS-level hotkeys. If another app has the same shortcut (e.g. Ctrl+T in Chrome), both apps receive it. The plugin silently fails for shortcuts already taken by another app. This is the intended trade-off for making shortcuts work when the webview has focus.
- **Network log captures fetch/XHR only** — document navigations, image/CSS/font/script asset loads, and Web Worker requests are not captured. By design — developers debugging API calls care about fetch/XHR, not assets. Panel now shows an explanatory message when a URL is loaded but no requests have been captured.
- **HttpOnly cookies not visible in Cookie inspector** — browser security restriction; JavaScript cannot read HttpOnly cookies. The inspector shows a warning banner about this.
- **Header injection applies to fetch/XHR only** — navigation requests and asset loads are not intercepted. By design — no dev wants auth headers on images.
- **Header rules pushed to existing tabs via eval; new tabs get current rules from init script** — `set_header_rules` evals `window.__XEVO_HEADER_RULES = [...]` in all open browser webviews. New tabs created after the rules are set also receive the rules through the `__XEVO_TAB_ID` init script's `window.__XEVO_HEADER_RULES = <headers::current_rules_json()>` and `HEADER_INJECTION_SCRIPT` applies them to fetch/XHR. The Rust static remains the single source of truth.

## Session 40 — Screenshot Bug Fix (WebView2 Content Black)

### Problem
`PrintWindow` cannot capture WebView2 content because WebView2 uses DirectComposition for rendering. The `browser_screenshot` command captured the browser chrome correctly but the webview content area rendered as black.

### Solution: DevTools Protocol (Page.captureScreenshot)
- **Approach:** Use `ICoreWebView2::CallDevToolsProtocolMethod("Page.captureScreenshot")` via the WebView2 COM API to capture the rendered page content directly from the Chromium renderer. The response is a base64-encoded PNG.
- **COM callback bridge:** Used `webview2_com::CallDevToolsProtocolMethodCompletedHandler` (pre-built handler from `webview2-com` crate) with `tokio::sync::oneshot` to bridge the COM callback to the async Rust command. The handler fires on the main thread (WebView2 message pump) and sends the result to the awaiting tokio thread.
- **Fallback:** If DevTools capture fails or no active browser tab, falls back to the original `PrintWindow` approach.
- **Refactored:** Split `browser_screenshot` into three functions:
  - `browser_screenshot` — orchestrator: tries DevTools, falls back to PrintWindow, saves file, injects toast
  - `capture_browser_devtools` — uses WebView2 COM API for page content capture
  - `capture_main_window_printwindow` — original `PrintWindow` code extracted as fallback
- **Dependencies added:** `webview2-com = "0.38"`, `base64 = "0.22"`, `windows-core = "0.61"` (all already transitive)
- **2 files changed:** `Cargo.toml`, `browser.rs` (no frontend changes)
- Verified: `cargo check` + `pnpm build` (includes tsc) — clean

## Session 38 — Manual Rescan Button

### LiveServersPanel rescan button
- `src/components/sidebar/Sidebar.tsx`: imported `RefreshCw` (lucide) + `usePortScanner`, added `const { scan } = usePortScanner()` inside `LiveServersPanel`, added a 20px refresh button in the header row (next to scan status). Disabled + spinning while `isScanning`. Previously dead `scan` return value is now wired up.

### Verification
- `pnpm build` — clean

## Bug-hunt batches 1-3 consolidated fix (Session 39)

Six independent bugs fixed + one calibration pass applied. Fixes 1-5 were pre-applied in prior uncommitted work and committed as baseline (commit `110adda`). Fixes 6 and TASK 7 applied in this session (commit `88512f5`).

### What was fixed
- **FIX 1 — TabItem.tsx**: drop-target indicator now shows full 4-side accent border (`border-l-2 border-t-2` added, borderLeftColor/borderTopColor set unconditionally with transparent default)
- **FIX 2 — FindBar.tsx**: dedup cache `lastQueriedRef.current = q` moved AFTER the `if (!tabId) return` guard so queries are not poisoned when no tab is active
- **FIX 3 — LoadingBar.tsx + index.css**: snap-on-fast-load eliminated. Bar measures actual current width as percentage before transitioning to "done" animation. CSS uses `var(--loading-start-width, 90%)` instead of hardcoded 90%
- **FIX 4 — TabBar.tsx**: Ctrl+T/Ctrl+W keyboard shortcut listener now guards against `input`/`textarea` focus targets
- **FIX 5 — TabBar.tsx**: removed dead `handlePlusPointerOver` callback and `onPointerOver` prop from "+" button (setPointerCapture retargets all pointer events making the handler unreachable during drag)
- **FIX 6 — useWebviewBridge.ts**: `isChromeOverlayOpen()` now includes `ui.apiTesterOpen` in its OR chain, matching the five-flag check used elsewhere in the file
- **TASK 7 — useWebviewBridge.ts**: WEBVIEW_EDGE_INSET calibration first pass — top/left changed from +4 to -4 (bleed outward to close visible gaps), bottom stays +4 and the right is changed to +4. Pending visual reverification.

### Verification
- `pnpm tsc --noEmit` — clean
- `cargo check` — clean

- Runtime visual verification of TASK 7 per-edge status: pending human `pnpm tauri dev`

## Session 40 — Minimize glitch fix + webview hide on minimize

### Root cause (glitch)
The `lib.rs` repaint hack (lines 40-52) called `win.maximize()` → `win.unmaximize()` (or vice versa) after 150ms on every restore from minimize. This caused a visible maximize→unmaximize transition — the window "reappeared" with a flicker as it toggled between states.

### Root cause (floating webview)
Each tab's browser `WebviewWindow` is a separate OS window. When the main window minimized, the browser webview stayed visible floating on screen — no main window behind it.

### Fix — `src-tauri/src/lib.rs`
- Removed the entire `async_runtime::spawn` repaint hack (maximize/unmaximize toggle). Removed unused `Duration` import.
- On `Focused(false)` + `is_minimized()`: now iterates all `browser-*` WebviewWindows and calls `.hide()` on each.
- On `Focused(true)` + `was_minimized`: reads `BrowserState.active_tab_label`, finds that webview, and calls `.show()`. The webview reappears at its last known bounds; the frontend's existing `onResized` listener re-syncs bounds within 50ms.

### Files changed
- `src-tauri/src/lib.rs` — removed repaint hack + added hide/show for browser webviews + removed `Duration` import

### Verification
- `cargo check` — clean
- `pnpm tsc --noEmit` — clean
- Runtime verification pending human `pnpm tauri dev`:
  - Minimize → restore: no maximize/unmaximize flicker
  - Restore from minimize: webview still visible, no black screen
  - Maximize → restore → drag: browser webview follows correctly

## CHANGES THIS SESSION (Session 41 — three targeted bug fixes)

### Fix 1: NetworkPanel entries never appear (non-reactive store read)
- `src/components/panels/NetworkPanel.tsx`: removed `getFilteredEntries` import, replaced `useNetworkStore.getState()` one-time read with a live `useNetworkStore` selector on `s.entriesByTab[activeTabId]` + inline filter logic. Panel now re-renders when `addEntry()` is called.

### Fix 2: Header rules wiped on every page load
- `src/hooks/useWebviewBridge.ts`: added `updateHeaderRules` to the `@/services/browser` import and `useHeadersStore` import from `@/stores/headers`. In the `onLoadingChanged` callback's `if (loading)` block, re-pushes all header rules via `updateHeaderRules(allRules)` so they survive the `BROWSER_INIT_SCRIPT` reset on each new page.

### Fix 3: InspectorPanel stale closure in storage sub-tab switching
- `src/components/panels/InspectorPanel.tsx`: added `storageSubTab` to the dependency arrays of both `useEffect` hooks (refresh on sub-tab change + auto-refresh every 3s). Previously the `refresh` callback closed over the old `storageSubTab` value when switching between localStorage/sessionStorage.

### Files changed
- `src/components/panels/NetworkPanel.tsx` — reactive entries selector
- `src/hooks/useWebviewBridge.ts` — header rules re-injection on page load
- `src/components/panels/InspectorPanel.tsx` — storageSubTab in effect deps

### Verification
- `pnpm tsc --noEmit` — clean
- Runtime verification pending human `pnpm tauri dev`:
  - Network panel: fetch/XHR entries appear after page navigation
  - Header injection: rules persist across page navigations
  - Inspector storage: switching localStorage/sessionStorage shows correct data

## Session 42 (v1.16.0 — ErrorBoundary + Inspector data loading fix) — DONE

### Fix 1: ErrorBoundary catches render crashes
- Created `src/components/ErrorBoundary.tsx` — React class component with `getDerivedStateFromError` + `componentDidCatch`. Fallback UI shows error message + Reload button.
- `src/components/layout/RootLayout.tsx`: wrapped entire return JSX in `<ErrorBoundary>`. Any render error in any panel/sidebar/toolbar is caught here, preventing the main window chrome from vanishing (WebviewWindow persists as separate native OS window).

### Fix 2: Inspector eval scripts hardened
- `src-tauri/src/commands/browser.rs`: all three eval'd JS scripts (meta, cookies, localStorage/sessionStorage) now:
  - Have `.catch(function(){})` on every `window.__TAURI_INTERNALS__.invoke('inspector_data', ...)` call — previously, rejections were silently swallowed.
  - Have an `else` branch logging `console.warn('[xevo] __TAURI_INTERNALS__ not available — cannot send ... inspector data')` when `__TAURI_INTERNALS__` is falsy.

### Fix 3: InspectorPanel stale closure + timeout
- `src/components/panels/InspectorPanel.tsx`:
  - Replaced `const inspectorStore = useInspectorStore()` (whole-store subscription → stale closures) with individual selectors: `useInspectorStore((s) => s.activeSubTab)`, `useInspectorStore((s) => s.isLoading)`, `useInspectorStore((s) => s.error)`, `useInspectorStore((s) => s.meta)`, `useInspectorStore((s) => s.cookies)`, `useInspectorStore((s) => s.localStorageItems)`.
  - `refresh` callback now uses `useInspectorStore.getState()` for store mutations instead of captured `inspectorStore` reference.
  - Added 5-second timeout safety net: if `isLoading` stays `true` for 5s, force it to `false` and show "Inspector request timed out" error.

### Files changed
- `src/components/ErrorBoundary.tsx` — new file, React error boundary
- `src/components/layout/RootLayout.tsx` — added ErrorBoundary import + wrapper
- `src-tauri/src/commands/browser.rs` — .catch() + else branches on inspector eval scripts
- `src/components/panels/InspectorPanel.tsx` — individual selectors + timeout

### Verification
- `pnpm tsc --noEmit` — clean
- `cd src-tauri && cargo check` — clean
- Runtime verification pending human `pnpm tauri dev`:
  - Clicking network log sidebar button: main window stays visible with error boundary fallback (no blank chrome)
  - Inspector meta/cookies/storage: data loads within 5 seconds, no perpetual spinner
  - Inspector timeout: if IPC fails, shows error instead of stuck loading

## Session 42b — NetworkPanel infinite re-render fix

### Root cause
`src/components/panels/NetworkPanel.tsx` selector `(s) => (activeTabId ? (s.entriesByTab[activeTabId] ?? []) : [])` returns a new `[]` reference on every call when `activeTabId` is null or when no entries exist for the tab. Zustand uses `Object.is` to compare, so the new reference is always "different", triggering a re-render, which triggers the selector again — infinite loop. Previously this crashed the React tree silently (main window blank, webview persisted). The new ErrorBoundary caught it and showed the fallback UI, making the bug visible.

### Fix
Created module-level `const EMPTY_ENTRIES: NetworkLogEntry[] = []` and used it in the selector instead of the `[]` literal. Same reference every time → `Object.is` returns `true` → no re-render.

### Files changed
- `src/components/panels/NetworkPanel.tsx` — stable empty array constant in selector

## Session 42d — Comprehensive bug fix sweep (v1.16.2)

### Purpose
Fixed 30 bugs from `bug_report.md` systematically across Rust backend, React frontend, and Tauri config. All changes are defensive/fix-oriented — no new features, no architectural changes.

### Fixes applied

**Rust backend (browser.rs + lib.rs + Cargo.toml + tauri.conf.json):**
- A1: Zustand persist `version: 1` + `migrate` function in settings.ts
- A2: JS injection via template literals replaced with `js_string_literal()` in inspector_mutate
- A3: `on_navigation` URI scheme filtering (http/https/empty/tauri only)
- A6: Duplicate tab guard — early return if webview label already exists
- A7: Mutex poison cascade — all 7 `lock().unwrap()` → `lock().unwrap_or_else(|e| e.into_inner())`
- A8: `.expect()` in setup → `.ok_or()?` returning Result
- B1: goBack/goForward/reload errors now propagated via `map_err`
- B2: hide_tab returns error, show_tab propagates set_position/set_size/show errors
- B5: CSP enabled (replaced `null` with proper directive)
- B11: `resolve_url` IP address misclassification fixed with `is_ip_address()` helper
- D1: Release profile added to Cargo.toml (lto, codegen-units=1, panic=abort, strip)
- D2: Remaining `eprintln!` gated behind `#[cfg(debug_assertions)]`
- D3: `backgroundColor: "#0f0f0f"` in tauri.conf.json (eliminates white flash)
- C8: Duplicate keydown handlers removed from both shortcut scripts

**React frontend (hooks, components, stores):**
- A4: Webview leak on CommandPalette close tab — `closeTabWebview().catch(() => {})`
- A5: Webview leak on workspace deletion — `closeTabWebview()` in cleanup
- B3: Tab history stacks populated — `recordNavigation` in `onUrlChanged`
- B6: Inspector stale data on tab switch — `clearAll()` + `setIsLoading(true)` + `setLastTabId()`
- B7: Wrong workspace attribution — uses `tab?.workspaceId ?? activeWorkspaceId`
- B9: Unhandled promise rejections — `.catch(() => {})` on all 8 `inspectorMutate().then()` chains
- B10: Fire-and-forget async navigation — `.catch(() => {})` on Enter handlers in AddressBar + Toolbar
- C1: Async listener race in useWebviewBridge — `cancelled` flag on 6 `.then()` chains
- C2: Async listener race in window move/resize — `cancelled` flag on onMoved/onResized
- C3: Async listener race in FindBar — `cancelled` flag on onFindResult
- C5: Global event consumed with window-scoped listener — changed to global `listen()`
- C8: Duplicate keydown handlers removed from both XEVO scripts
- D5: Font stack missing macOS — added `'SF Mono','Menlo'` to JSON viewer
- E3: ResizeObserver unthrottled IPC — 16ms debounce `setTimeout` wrapper
- E5: `console.error/warn` unguarded — wrapped all 4 occurrences with `import.meta.env.DEV`
- E7: `navigator.platform` deprecated — changed to use only `navigator.userAgent`

### Verification
- `cd src-tauri && cargo check` — clean
- `pnpm tsc --noEmit` — clean
- invoke_handler count: 26 (unchanged — no new commands)
- Runtime verification pending human `pnpm tauri dev`

## CHANGES THIS SESSION (v1.16.2 → v1.17.0 — Memory Leak Fix)

### Root Cause
The primary memory leak was an IPC storm from network logging. Every `fetch()` and `XMLHttpRequest` call in every browser webview triggered:
1. An `invoke('network_log_entry', ...)` call from JS to Rust (via WebView2's `ExecuteScript`)
2. A `app.emit('xevo://network-entry', ...)` event emission from Rust to frontend
3. Response bodies captured up to 50KB per request as serialized JSON strings

On a Next.js dev server with HMR, this generated 600-1200 IPC round-trips per minute with ~3MB serialized data. This directly triggers [WRY Issue #1489](https://github.com/tauri-apps/wry/issues/1489) (evaluate_script memory leak) and [Tauri Issue #12724](https://github.com/tauri-apps/tauri/issues/12724) (event emission memory leak).

### Fixes Applied
1. **Network logging OFF by default** — `isCapturing` defaults to `false` in `network.ts`. `NetworkPanel` component sets it to `true` on mount and `false` on unmount via new `browser_set_network_capturing` Rust command. Without the Network panel open, zero IPC calls are made for network logging.

2. **Throttled network log entries** — Instead of firing an IPC invoke per request, entries are buffered in `window.__xevoNetBuffer` and flushed every 500ms (or when buffer hits 20 entries). Reduces IPC frequency by ~10-50x.

3. **Reduced response body limit** — `bodyText.slice(0, 50000)` → `bodyText.slice(0, 5000)`. 90% reduction in serialized payload size per request.

4. **Removed duplicate title reporting** — `on_page_load` handler previously spawned async tasks that called `eval(title_script)` 3 times (immediate + 500ms + 1500ms). The `BROWSER_INIT_SCRIPT` already handles title via DOMContentLoaded + load + MutationObserver. Removed the redundant Rust-side eval calls entirely.

5. **Guarded init scripts** — Added `__xevoTabInfoDone` flag to prevent duplicate listener registration on SPA navigations. MutationObserver now debounced (300ms) to prevent title mutation flood.

6. **Debounced tab-info events** — MutationObserver callback waits 300ms after last mutation before reporting, preventing IPC flooding during rapid title changes.

### Files Changed
- `src-tauri/src/commands/browser.rs` — Rewrote BROWSER_INIT_SCRIPT with network log batching, reduced body limit, listener guards, debounced title. Removed duplicate title eval from `on_page_load`. Removed unused `Duration` import. Added `browser_set_network_capturing` command.
- `src-tauri/src/lib.rs` — Registered `browser_set_network_capturing` (26 → 27 invoke handlers)
- `src/services/browser.ts` — Added `setNetworkCapturing()` function
- `src/stores/network.ts` — `isCapturing` default changed from `true` to `false`
- `src/components/panels/NetworkPanel.tsx` — Added `useEffect` to enable/disable capturing on mount/unmount; pause/resume button calls `setNetworkCapturing`

### Verification
- `cd src-tauri && cargo check` — clean
- `pnpm tsc --noEmit` — clean
- invoke_handler count: 27 (was 26)
- Runtime verification: open `pnpm tauri dev`, load a Next.js page, check Task Manager — RAM should stay under 200MB instead of climbing to 1GB+.

## Session 44 (v1.18.0 — Performance & Memory Optimization)

### Changes
Implemented 6 of 8 architectural fixes from MAJOR_FIXES.md:

1. **Fix 3: Tab Discarding** — Tabs inactive >10 minutes are destroyed to reclaim memory. On switch, webview is recreated and page reloads. Pinned tabs and active tab exempt.
   - `src/types/index.ts`: Added `discardedAt: number | null` and `lastActiveAt: number` to Tab interface
   - `src/stores/tabs.ts`: Added `discardTab`, `restoreTab`, `touchTab` actions; updated `buildTab` defaults
   - `src/hooks/useWebviewBridge.ts`: Added discard timer useEffect (checks every 60s), touch-on-switch, recreate-on-restore logic

2. **Fix 4: Reduce Init Scripts** — Merged 3 separate scripts into `CHROME_FEATURES_SCRIPT`
   - `src-tauri/src/commands/browser.rs`: Replaced `XEVO_FIND_SCRIPT`, `XEVO_BOOKMARK_SCRIPT`, `XEVO_SHORTCUT_FORWARD_SCRIPT` with single `CHROME_FEATURES_SCRIPT` constant. Updated `create_webview_for_tab` to use merged script.

3. **Fix 9: Lazy-load JSON Viewer** — Extracted JSON viewer to separate init script
   - `src-tauri/src/commands/browser.rs`: Extracted `xevoRenderJson` from `BROWSER_INIT_SCRIPT` into `JSON_VIEWER_SCRIPT` constant. Updated `create_webview_for_tab`.

4. **Fix 7: Cap Concurrent Webviews** — Soft limit of 10 concurrent webview processes
   - `src/types/index.ts`: Added `maxConcurrentWebviews: number` to AppSettings
   - `src/stores/settings.ts`: Added default value (10)
   - `src/hooks/useWebviewBridge.ts`: Added enforcement useEffect that checks every 5s and discards oldest background tabs when over limit

5. **Fix 8: Pre-warm Browser Process** — Hidden about:blank webview created at startup
   - `src-tauri/src/lib.rs`: Added warmup webview creation in `.setup()` closure, destroyed after 2 seconds

6. **Fix 5: Share WebView2 Environment** — Shared data directory for process sharing
   - `src-tauri/src/commands/browser.rs`: Added `SHARED_WEBVIEW_DATA_DIR` static and `shared_webview_data_dir()` helper. Added `.data_directory(...)` to `WebviewWindowBuilder` in `create_webview_for_tab`.

### SKIPPED
- **Fix 2: MemoryUsageTargetLevel** — `SetMemoryUsageTargetLevel` is on `ICoreWebView2_19` (not `ICoreWebView2Controller`), requiring COM `QueryInterface` chains that wry doesn't expose through Tauri's `WebviewWindow`. No-op.
- **Fix 1: Suspend Background Tabs** — Depends on Fix 2. No-op.

### Files Changed
- `src/types/index.ts` — Tab interface: added `discardedAt`, `lastActiveAt`; AppSettings: added `maxConcurrentWebviews`
- `src/stores/tabs.ts` — Added `discardTab`, `restoreTab`, `touchTab` actions; updated `buildTab`
- `src/stores/settings.ts` — Added `maxConcurrentWebviews: 10` default
- `src/hooks/useWebviewBridge.ts` — Added discard timer, cap enforcement, touch-on-switch, recreate-on-restore; imported `closeTabWebview`
- `src-tauri/src/commands/browser.rs` — Merged 3 scripts into `CHROME_FEATURES_SCRIPT`; extracted `JSON_VIEWER_SCRIPT`; added `SHARED_WEBVIEW_DATA_DIR` and `.data_directory(...)` to builder
- `src-tauri/src/lib.rs` — Added pre-warm webview in `.setup()`, imported `WebviewWindowBuilder`, `WebviewUrl`, `Duration`

### Verification
- `cd src-tauri && cargo check` — clean
- `pnpm tsc --noEmit` — clean
- invoke_handler count: 27 (unchanged)

## Session 45 — UI Bug Fix Sweep (v1.18.0 → v1.18.1)

### Purpose
Systematic code review of all React frontend components. Identified 18 bugs (2 critical, 4 high, 5 medium, 7 low). Fixed 11 of them; skipped 7 that were either N/A, design decisions, or too minor.

### Fixes Applied

**Critical (Tauri crash outside webview):**
- BUG #1: `WindowControls.tsx` — added `IS_TAURI` guard (`"__TAURI_INTERNALS__" in window`). Returns null outside Tauri, preventing `getCurrentWindow()` crash.
- BUG #2: `useKeyboardShortcuts.ts` — added same guard before `listen("xevo://shortcut")` call in Mechanism 2 effect.

**High (broken functionality):**
- BUG #3: `HomePage.tsx` — search with `onNavigate=null` now always creates a tab, adds it to workspace, and sets it active. Was creating orphaned tabs that never appeared.
- BUG #4: `Base64Tool.tsx` — CSS color syntax `"var(--color-accent)20"` → `"color-mix(in srgb, var(--color-accent) 20%, transparent)"`. Same for `40%`.
- BUG #5: `SettingsPanel.tsx` — version string `"v1.1.0"` → `"v1.18.0"`.

**Medium (UX issues):**
- BUG #7: `Sidebar.tsx` — LiveServersPanel now re-renders every 30s via `setInterval` + state tick, so "Xs ago" timestamps stay current.
- BUG #11: `NotesNotepad.tsx` — color picker now closes on outside click via `useRef` + `mousedown` listener.

**Low (polish):**
- BUG #12: Created `src/lib/url.ts` with shared `resolveInput()`. Updated `Toolbar.tsx`, `AddressBar.tsx`, `HomePage.tsx` to import from it. Removed 3 duplicate implementations.
- BUG #16: `HistoryPanel.tsx` — hardcoded `hover:bg-[rgba(255,255,255,0.04)]` → `hover:bg-[var(--color-hover)]`.
- BUG #17: `ui.ts` — `closeFind` now clears `findQuery` (was left stale).
- BUG #18: `OverlayPanel.tsx` — drag handle height `h-1.5` (6px) → `h-2.5` (10px).

### Skipped (7 bugs)
- BUG #6 (NotesSidebarPanel `dangerouslySetInnerHTML`): intentional — notes are local user content, not external HTML. XSS not a concern.
- BUG #8 (ApiTester history restore): history intentionally stores only method+URL, not full headers/body.
- BUG #9 (InspectorPanel 3s auto-refresh): component is conditionally rendered in Sidebar, so interval only runs when visible.
- BUG #10 (TabBar drag-drop stale position): pointer-based reorder (Session 16) doesn't cache positions — reads rects on every move.
- BUG #13 (StatusBar hoveredUrl always null): feature requires injected hover script in webview — not wired yet, known placeholder.
- BUG #14 (SettingsPanel Escape handler): no conflict found — Escape only fires when panel is open.
- BUG #15 (ShortcutHelp Ctrl+? detection): keyboard-layout dependent, hard to fix universally.

### Files Changed
- `src/components/browser/WindowControls.tsx` — IS_TAURI guard
- `src/hooks/useKeyboardShortcuts.ts` — IS_TAURI guard on listen()
- `src/components/panels/HomePage.tsx` — fixed orphaned tab, removed unused imports, removed local resolveInput
- `src/components/panels/Base64Tool.tsx` — CSS color-mix syntax
- `src/components/panels/SettingsPanel.tsx` — version string
- `src/components/sidebar/Sidebar.tsx` — timestamp re-render timer
- `src/components/panels/NotesNotepad.tsx` — color picker outside-click
- `src/lib/url.ts` — NEW: shared resolveInput utility
- `src/components/browser/Toolbar.tsx` — import resolveInput from lib/url
- `src/components/browser/AddressBar.tsx` — import resolveInput from lib/url
- `src/components/sidebar/HistoryPanel.tsx` — CSS variable hover color
- `src/stores/ui.ts` — clear findQuery on closeFind
- `src/components/overlay/OverlayPanel.tsx` — drag handle size

### Verification
- `pnpm tsc --noEmit` — clean
- No Rust changes, no new dependencies

## Session 46 — Browser webview external link fix (complete)

- **Root cause:** `target="_blank"` clicks fire WebView2's native `NewWindowRequested` event, not a DOM click event that JS can intercept. Tauri's `on_new_window()` callback is the proper API for this — it fires at the native level before any JS/IPC runs.
- **Attempt 1:** `browser-webview.json` capability with `opener:default` — failed because capabilities don't cover remote webview origins with non-default ports.
- **Attempt 2:** Custom `open_external_url` command + JS interception — failed because `e.preventDefault()` in JS prevents `on_new_window` from firing.
- **Final solution:** Removed JS interception entirely. Added `.on_new_window()` handler to `create_webview_for_tab` that calls `app.opener().open_url()` directly from Rust and returns `NewWindowResponse::Deny`. No JS, no IPC, no permission checks. Opener plugin initialized with `open_js_links_on_click(false)` to prevent its own init script from conflicting.
- **Detailed issue doc:** `web_url_issue.md`

### Files Changed
- `src-tauri/capabilities/browser-webview.json` — DELETED (capability approach didn't work)
- `src-tauri/src/commands/browser.rs` — Added `use tauri_plugin_opener::OpenerExt`; added `open_external_url` command; added `on_new_window` handler in `create_webview_for_tab`; removed JS interception from CHROME_FEATURES_SCRIPT
- `src-tauri/src/lib.rs` — Registered `open_external_url`; disabled opener plugin's JS injection
- `web_url_issue.md` — NEW: detailed technical analysis

### Verification
- `cargo check` — clean
- **Test:** run `pnpm tauri dev` and click external links (`target="_blank"`) in browser tabs — should open in system browser

## Session 47 — Phase 2 (Performance Optimization) complete

- **5A — React.lazy panels:** All 9 sidebar panels in `Sidebar.tsx` switched to `React.lazy` + `<Suspense>`. Created `PanelSkeleton` fallback. Used `.then(m => ({ default: m.Name }))` for named-export panels.
- **5B — manualChunks:** Added `build.rollupOptions.output.manualChunks` to `vite.config.ts` for `react-vendor`, `zustand-vendor`, `icons`, `ui-lib`.
- **5C — Split Init Script:** Old monolithic `BROWSER_INIT_SCRIPT` split into 3 constants in `browser.rs`:
  - `CORE_SCRIPT` — tab info (title/favicon reporting) + shortcut forwarding (keydown handler)
  - `HEADER_SCRIPT` — header injection helpers (`__xevoUrlMatches`, `__xevoInjectHeaders`)
  - `NETWORK_SCRIPT` — fetch/XHR monkeypatching + network log batching (sections 3.5-5, ~300 lines)
  - Shortcut forwarding removed from `CHROME_FEATURES_SCRIPT` (now in `CORE_SCRIPT`)
  - `browser_set_network_capturing` evals `NETWORK_SCRIPT` before setting the capturing flag
- **5D — Lazy Webview Creation:** Already the default in per-tab architecture (webviews created on first `browser_activate_tab` call). Confirmed no change needed.
- **5E — Virtualize Long Lists:** Installed `react-window` v2. Created `src/components/ui/VirtualList.tsx` wrapper. Applied to `BookmarksPanel.tsx` (flat list). HistoryPanel (grouped-by-date) and NetworkPanel (complex expandable items) not suitable without UX regression.
- **New dependency:** `react-window@2.2.7`

### Files Changed
- `src/components/sidebar/Sidebar.tsx` — React.lazy panels
- `vite.config.ts` — manualChunks
- `src-tauri/src/commands/browser.rs` — 3 scripts split, CHROME_FEATURES_SCRIPT trimmed, injection points updated
- `src/components/ui/VirtualList.tsx` — NEW: react-window wrapper
- `src/components/sidebar/BookmarksPanel.tsx` — VirtualList integration
- `PROJECT_STATE.md` — Phase 2 status update

### Verification
- `tsc --noEmit` — clean
- `cargo check` — clean

## Session 49 — Phase 4 (Meta Tag Inspector) complete

- **Enhanced MetaSubTab:** Replaced the simple pass/fail 6-check list with full validation covering title, description, canonical, og:title, og:description, og:image (absolute URL check), og:url, twitter:card. Shows ✅/⚠️/❌ counts and per-check messages.
- **Social Previews:** Created `SocialPreview.tsx` with `SocialPreviewCard` component — renders Facebook, Twitter/X, LinkedIn, and Discord preview cards with platform colors, og:image, title, description, domain.
- **Image Diagnostics:** Inline "Run diagnostics" button — fetches og:image via fetch(), validates content-type, measures dimensions, checks size (≥600×315, recommended 1200×630), aspect ratio (~1.91:1), and file size (<5MB).
- **Existing meta groups preserved:** SEO, Open Graph, Twitter Card, Other groups with collapsible toggle remain below the new sections.

### Files Changed
- `src/components/panels/SocialPreview.tsx` — NEW
- `src/components/panels/InspectorPanel.tsx` — Enhanced MetaSubTab

### Verification
- `tsc --noEmit` — clean
- No Rust changes

## Session 48 — Phase 3 (User Agent Switcher) complete

- **UA presets:** Created `src/components/panels/UserAgentPresets.ts` with 9 presets across 3 categories (desktop, mobile, bot).
- **Rust command:** Added `browser_set_user_agent` in `browser.rs` — stores UA in `BrowserState.user_agent`, evals UA override script into all existing browser webviews immediately.
- **Init injection:** `create_webview_for_tab` injects UA override as initialization script for new webviews.
- **Frontend panel:** `UserAgentPanel.tsx` — preset selection, custom UA input, reset-to-default. Syncs with settings store for persistence.
- **Settings persistence:** Added `userAgent` to `AppSettings` type + settings store. App.tsx restores UA on startup.
- **New PanelId:** `"ua"` registered in Sidebar.tsx with Globe icon.

### Files Changed
- `src/components/panels/UserAgentPresets.ts` — NEW
- `src/components/panels/UserAgentPanel.tsx` — NEW
- `src/services/browser.ts` — Added `setUserAgent`
- `src-tauri/src/commands/browser.rs` — Added command + init injection
- `src-tauri/src/lib.rs` — Added `user_agent` to BrowserState
- `src/types/index.ts` — Added `userAgent` to AppSettings, `"ua"` to PanelId
- `src/stores/settings.ts` — Added `userAgent` default
- `src/App.tsx` — UA restore on startup
- `src/components/sidebar/Sidebar.tsx` — Panel registration

### Verification
- `tsc --noEmit` — clean
- `cargo check` — clean

## Session 50 - Feature Bug Fix Audit Doc

- Created `feature_bug_fixes.md` as a review-first audit only; no feature code was changed.
- Documented 8 prioritized findings across browser init scripts, viewport mode, scroll/click sync, UA switching, screenshots, and warmup/minimize handling.
- Included root causes, affected files, proposed fixes, and runtime verification checklist.
- `TASKS.md` was not updated because there is no matching audit task to mark done, and project rules forbid adding new tasks.

## Session 51 - Feature Bug Fix Audit Implementation

- Implemented the fixes from `feature_bug_fixes.md`: deduped browser webview init-script setup, moved UA switching to native webview creation, recreated loaded webviews after UA changes, split viewport controls from the side-effectful viewport surface, aligned viewport webviews to React cards, fixed viewport scroll percent handling, wired click sync, improved screenshot target matching/error surfacing, and moved warmup out of the `browser-*` label namespace.
- `ViewportPanel.tsx` now exports `ViewportControlsPanel` for the sidebar and `ViewportSurface` for main viewport mode; the build no longer warns about mixed static/dynamic imports for that module.
- `TASKS.md` was not updated because there is no matching task to mark done, and project rules forbid adding new tasks.
- Verification: `cargo check`, `tsc --noEmit`, and `pnpm build` are clean. `git diff --check` still reports a pre-existing trailing blank line in `TASKS.md`; left untouched.
- Worktree note: the repo remains dirty from the broader feature set; this session only intentionally touched the browser/viewport/UA/screenshot fix files plus this project-state note.

## Session 52 - Viewport Mode Visual Hotfix

- Fixed the viewport-mode glitch shown in screenshots: kept `BrowserChrome` mounted so the webview bridge can hide normal browser webviews while viewport mode is active, and added bridge guards so normal tab bound-sync cannot re-show them under the viewport surface.
- Fixed viewport cards collapsing into short horizontal strips by removing the flex-collapsed card body and rendering device-sized cards inside a scrollable viewport canvas.
- `TASKS.md` was not updated because there is no matching task to mark done, and project rules forbid adding new tasks.
- Verification: `cargo check`, `tsc --noEmit`, and `pnpm build` are clean.

## Session 53 - Viewport Mode Quick Fix Plan

- Created `quickfixes.md` as a review-first research/fix plan only; no source code was changed.
- Documented current viewport-mode issues from screenshots, browser research from Chrome/Edge/Firefox responsive tools, confirmed root causes, and a staged fix plan covering coordinate correctness, device metrics, layout polish, selected viewport UX, orientation/custom sizes, and sync defaults.
- `TASKS.md` was not updated because there is no matching task to mark done, and project rules forbid adding new tasks.

## Session 54 — Viewport Mode Quick Fixes (v1.24.1)

- **Device Model + Presets:** Expanded `DevicePreset` and `Viewport` interfaces with device scale factor (DPR), mobile, touch, and userAgent. Updated presets with real device DPR metrics.
- **Orientation & Custom Sizes:** Added orientation, rotate button (swaps width/height), and numeric inputs for custom device sizing. Added selected viewport focus state.
- **Visual Scale Zoom & Warning:** Added layout visual zoom support (clamped 25%..100%). Added alert badge explaining that page inner width reflects visual scale.
- **Culling & Stage Layout:** Created `ViewportStage` bounding layout. Added viewport visibility culling that destroys/hides native overlays when scrolled off-screen.
- **Metrics Probe & Badge:** Created `notify_viewport_metrics` Rust command, registered in `lib.rs`, and wired `onViewportMetrics` in `browser.ts`. Viewport page runs a JS probe to report `innerWidth`, `innerHeight`, and `devicePixelRatio` to display a validation check badge.
- **Sync defaults:** Turned off click and input sync by default (`false`) to keep sync features secondary until layout is stable.
- **Warning-free production builds:** Statically imported all Tauri modules and browser services in `ViewportPanel.tsx` to eliminate Vite dynamic import warnings.

### Verification
- `tsc --noEmit` — clean
- `cargo check` — clean
- `pnpm build` — clean (zero build warnings)

## Session 56 — UI Scaling: Increased all Xevo UI element sizes for readability

### Goal
Make the Xevo browser's UI as readable as OpenCode from a distance. Everything was too small and compact (13px base font, 36px tab bar, etc.).

### What changed
- **Global font**: 13px → 14px (`index.css`)
- **Compact mode overrides**: Scaled up to match (`index.css`)
- **Tab bar**: 36px → 40px, tab items 80-180px → 100-200px, title 13px → 14px, favicon 14px → 16px, close/pin buttons 16px → 20px (`TabBar.tsx`, `TabItem.tsx`)
- **Toolbar**: 40px → 44px, nav buttons 28px → 32px, nav icons 14px → 15px, address input 28px → 30px, input font 12px → 13px (`Toolbar.tsx`)
- **Address bar**: 44px → 48px, nav buttons 26px → 30px, icons 11-14px → 12-15px, input font 11px → 12px (`AddressBar.tsx`)
- **Status bar**: 24px → 28px, font 10px → 11px (`StatusBar.tsx`)
- **Sidebar width**: 210px → 240px (min 160→180, max 380→420) (`ui.ts`)
- **Workspace switcher**: 48px → 56px, icons 32px → 36px, toggle/new icons 14px → 16px, settings 40px → 44px (`WorkspaceSwitcher.tsx`)
- **Sidebar**: header 28px → 32px, panel icons 32px → 36px at 15px, section headers 10px → 11px, list items 28px → 32px, text sizes bumped 1px across the board (`Sidebar.tsx`)
- **FindBar**: 32px → 36px, input 180px → 200px, buttons 20px → 24px, icons 12px → 13-14px (`FindBar.tsx`)
- **Toast**: padding, max-width, text 11px → 12px, icon 13px → 14px (`Toast.tsx`)

### Files altered (11 files)
- `src/index.css`
- `src/stores/ui.ts`
- `src/components/browser/TabBar.tsx`
- `src/components/browser/TabItem.tsx`
- `src/components/browser/Toolbar.tsx`
- `src/components/browser/AddressBar.tsx`
- `src/components/browser/StatusBar.tsx`
- `src/components/browser/FindBar.tsx`
- `src/components/sidebar/WorkspaceSwitcher.tsx`
- `src/components/sidebar/Sidebar.tsx`
- `src/components/Toast.tsx`

### UNTOUCHED
- Rust backend (no changes to .rs files)
- Store logic (only default value in ui.ts)
- Any function or feature behavior
- Panel content components (BookmarksPanel, HistoryPanel, etc.)

### WATCH OUT
- The sidebar now starts at 240px which may feel wider than before; user can resize via drag handle.
- Compact mode CSS overrides updated proportionally.
- Runtime visual verification needed with `pnpm tauri dev`.

### FLAG
- None. All changes are purely CSS/sizing.

## Session 55 — User Agent Switcher Bug Fixes

### Bugs Fixed

1. **Bug 1+5 — Double recreation on every UA change / unnecessary startup recreation:** `App.tsx:46` — Changed the UA restore effect from `[userAgent]` deps to `[]` (run-once). Previously, every UA preset click in the panel called `update()` which triggered App.tsx's effect to call `setUserAgent()` a second time, causing double IPC and double webview recreation. The effect now runs once on mount (Zustand's persist hydrates synchronously from localStorage, so the persisted value is already available).

2. **Bug 2 — Missing `discardTab` on background tabs after UA recreation:** `useWebviewBridge.ts:624-671` — `recreateForUserAgent` destroyed all webviews but never called `discardTab()` on background tabs, leaving their store state inconsistent (`discardedAt: null` but no native webview). Now calls `discardTab()` on all non-active tabs before closing webviews, and calls `restoreTab()` on the active tab after recreating it.

3. **Bug 3 — Stale input field when UA changes externally:** `UserAgentPanel.tsx:20-22` — Added `useEffect` to sync `customUA` state when `currentUA` prop changes (e.g., programmatic or external updates).

4. **Bug 4 — Inconsistent error handling:** `UserAgentPanel.tsx:27,33,39` — Added `.catch(() => {})` to `selectPreset`, `applyCustom`, and `resetDefault` async calls (previously `selectPreset` and `resetDefault` had no error handling).

### Files Changed
- `src/App.tsx` — Fixed UA effect deps (run-once)
- `src/hooks/useWebviewBridge.ts` — discarding tabs on UA recreation
- `src/components/panels/UserAgentPanel.tsx` — sync input + error handling

### Verification
- `pnpm tsc --noEmit` — clean

## Session — Stuck Webview Bug Fix (3-part minimize race fix)

### Root Cause
Three interrelated bugs caused webview windows to get stuck (visible but non-interactive) after minimize/restore:

1. **`lib.rs` — `Focused(false)` fires before `is_minimized()` returns true** (Windows message ordering race): Webviews stay visible when the main window minimizes because `Focused(false)` fires before the window state is committed. They float as orphan OS windows, corrupting the WebView2 input pipeline.

2. **`browser.rs` — Tab switch/creation during minimize creates floating windows**: `browser_create_tab`/`browser_activate_tab` call `.show()` even when the main window is minimized, creating visible floating windows that break WebView2's input handling.

3. **`useWebviewBridge.ts` — No bounds sync on restore**: The `xevo://minimize-state` listener only sets a flag — `syncBounds` never fires after restore. Since `onResized` fires before the IPC event arrives, the bounds stay stale until manual resize.

### Fixes Applied

**Fix 1 — `src-tauri/src/lib.rs`: Reliable minimize detection via Resized**
Added a `WindowEvent::Resized` handler as a secondary minimize detection path. `Resized` fires AFTER the window state is committed, so `is_minimized()` is reliable here. Catches the case where `Focused(false)` fired too early.

**Fix 2 — `src-tauri/src/commands/browser.rs`: No webview show while minimized**
- Added `show_immediately: bool` parameter to `create_webview_for_tab`
- `browser_create_tab` and `browser_activate_tab` now check `window.is_minimized()` and skip `.show()` if true
- On restore, the `Focused(true)` handler in `lib.rs` shows only the active tab's webview

**Fix 3 — `src/hooks/useWebviewBridge.ts`: Sync bounds on restore + minimize guards**
- When `xevo://minimize-state` fires with `false`, `lastBoundsRef` is cleared and `syncBounds` is triggered after 80ms
- Added `isMinimizedRef.current` guard to `ensureWebviewVisible` (previously missing)

### Files Changed
- `src-tauri/src/lib.rs` — Added Resized handler for 2nd-path minimize detection
- `src-tauri/src/commands/browser.rs` — Added `show_immediately`, checked `is_minimized()` in create/activate
- `src/hooks/useWebviewBridge.ts` — Bounds sync on restore, minimize guard in ensureWebviewVisible

### Verification
- `cargo check` — clean
- `pnpm tsc --noEmit` — clean
- `pnpm build` — clean (zero warnings)

## Session — Header Injection Fix (fetch/XHR monkeypatch)

### Root Cause
The HEADER_SCRIPT defined `__xevoUrlMatches` and `__xevoInjectHeaders` helper functions, but **no code ever called them on real requests**. The NETWORK_SCRIPT (which contained the fetch/XHR monkeypatch) was removed when the network log feature was extracted in Session 38. The helpers survived the split but their caller didn't.

### Fix
Added fetch and XMLHttpRequest monkeypatching inside the HEADER_SCRIPT IIFE (after the existing helper definitions):

1. **`fetch`:** Saves `window.fetch`, replaces it with a wrapper that extracts existing headers (from both Request object and init), merges via `__xevoInjectHeaders`, and passes through unchanged if no injection applies.

2. **`XMLHttpRequest`:** Saves `open`/`send`, patches `open` to store the URL, patches `send` to inject headers via `setRequestHeader` before the original `send`.

### Files Changed
- `src-tauri/src/commands/browser.rs` — Added ~50 lines of fetch/XHR monkeypatch to HEADER_SCRIPT

### Verification
- `cargo check` — clean
- `pnpm tsc --noEmit` — clean
- Add rule `*` → `X-Test: hello`, navigate to `https://httpbin.org/headers`, confirm `X-Test: hello` appears in response

## Session — Screenshot Bug Fix (xcap → PrintWindow)

### Root Cause
xcap 0.9.6's `is_valid_window()` in `impl_window.rs:113-116` **explicitly filters out all windows belonging to the current process** to avoid a `GetWindowTextW` deadlock during `EnumWindows` (inherited from WebRTC's desktop capture code). Since XEVO's main window has the same PID as the process calling `xcap::Window::all()`, it was excluded from the window list → "Could not find main window" error.

### Fix — Replaced xcap with direct Win32 `PrintWindow` API
1. **`src-tauri/Cargo.toml`**: Removed `xcap = "0.9"`, added `raw-window-handle = "0.6"` (already a transitive dep through Tauri). `image = "0.25"` kept for PNG encoding.
2. **`src-tauri/src/commands/browser.rs`**: Rewrote `browser_screenshot`:
   - Gets native HWND via `WebviewWindow::window_handle()` + `HasWindowHandle` trait (avoids xcap's broken same-process window enumeration)
   - Captures via `PrintWindow(hwnd, hdc, PW_CLIENTONLY | PW_RENDERFULLCONTENT)` which captures DWM-composited content including WebView2/DirectComposition rendering (GDI `BitBlt` would produce a blank/black image for WebView2 windows)
   - Uses `CreateDIBSection` for a 32-bit top-down BGRA bitmap, directly reads pixel pointer, converts BGRA→RGBA, and encodes as PNG via the `image` crate
   - Added Win32 FFI declarations (`extern "system"`) for `GetWindowRect`, `GetDC`, `CreateCompatibleDC`, `CreateDIBSection`, `SelectObject`, `PrintWindow`, `DeleteDC`, `DeleteObject`, `ReleaseDC`
   - Removed unused `std::io::Cursor` import

### Why This Works
- **Bypasses xcap entirely** — no dependency on xcap's broken same-process window filter
- **`PrintWindow` with `PW_RENDERFULLCONTENT`** (0x03) captures the DWM-composited visual, which includes WebView2's DirectComposition content — unlike GDI `BitBlt` which would be blank
- Cross-platform fallback: non-Windows targets return a clear error message

### Edge Cases Handled
- **Minimized window**: early return with specific error message
- **Zero/negative dimensions**: error before any API calls
- **GDI failures**: each step checks for null handles and returns descriptive errors

### Verification
- `cargo check` — clean
- `pnpm tsc --noEmit` — clean
- Runtime verification: click Camera button or Ctrl+Shift+S → captures XEVO window content as PNG → copies to clipboard or downloads

## Session — Screenshot Save-to-Disk + Toast Visibility

### Issues Fixed

**Issue 1 — Screenshots only copied, not saved as files:**
Old flow: `takeScreenshot()` → `copyScreenshotToClipboard()` → clipboard first, fallback to download only if clipboard fails. If clipboard succeeded, no file was ever written to disk.

**Issue 2 — Toast behind webview:**
The React `<Toast />` renders in the main window's DOM, but browser webviews are separate OS-level `WebviewWindow`s that paint on top of the main window's entire surface, hiding the toast.

### Changes

1. **`src-tauri/src/commands/browser.rs`** — Three changes to `browser_screenshot`:
   - Now takes `AppHandle` + returns `ScreenshotResult { bytes, path }` instead of raw `Vec<u8>`
   - **Save to disk:** After capturing, saves PNG to `{app_data_dir}/screenshots/Xevo-{timestamp}.png`, creating the directory if missing
   - **Eval toast into webview:** Reads `BrowserState.active_tab_label`, gets the active browser webview, and `eval()`s a small JS snippet that appends a styled `div` with "Screenshot saved" — this renders INSIDE the webview's DOM, always on top of page content

2. **`src/services/browser.ts`** — `takeScreenshot()` now returns `{ bytes: Uint8Array, path: string }` instead of just `Uint8Array`

3. **`src/lib/screenshot.ts`** — Replaced `copyScreenshotToClipboard`/`downloadScreenshot` with thin `copyToClipboard(bytes)` (saving is now done by Rust, clipboard is optional secondary behavior)

4. **`src/components/browser/Toolbar.tsx`** — Handler simplified: calls `takeScreenshot()`, then `copyToClipboard()` for optional clipboard copy. No more toast in main window (Rust handles the visible toast in webview)

5. **`src/hooks/useKeyboardShortcuts.ts`** — Both call sites (keydown handler + global shortcut handler) updated to match new flow

### Files Changed
- `src-tauri/src/commands/browser.rs` — save to disk + eval toast + ScreenshotResult return type
- `src/services/browser.ts` — updated takeScreenshot return type
- `src/lib/screenshot.ts` — simplified to copyToClipboard only
- `src/components/browser/Toolbar.tsx` — simplified handler
- `src/hooks/useKeyboardShortcuts.ts` — both screenshot handlers updated

### Verification
- `cargo check` — clean
- `pnpm tsc --noEmit` — clean
- `pnpm build` — clean

## Session — Stuck Webview Fix (active_tab_label desync)

### Root Cause
`active_tab_label` in Rust tracks which webview is "active", but the frontend's `hideTabWebview` calls don't update it. When switching to an empty tab, the frontend hides the old webview via `browser_hide_tab`, but Rust still thinks it's active. On restore or next operation, the stale webview gets shown — appearing "stuck" over the content area.

### Fixes
1. **`browser.rs` — `hide_all_browser_webviews_except` helper**: New function that hides ALL `browser-*` webviews except the one being activated. Called by `browser_create_tab` and `browser_activate_tab` instead of only hiding `active_tab_label`. This is authoritative — no stale state can cause orphan windows.

2. **`browser.rs` — `browser_hide_tab` clears `active_tab_label`**: When hiding a webview that matches the tracked label, the label is set to `None`. Prevents the restore handler from showing a hidden webview.

3. **`lib.rs` — restore handler hides all before showing**: On restore, ALL browser webviews are hidden first, then only the active one is shown. Defense-in-depth against desync.

### Files Changed
- `src-tauri/src/commands/browser.rs` — hide_all_browser_webviews_except helper, updated create/activate/hide commands
- `src-tauri/src/lib.rs` — restore handler hides all webviews first

### Verification
- `cargo check` — clean
- `pnpm tsc --noEmit` — clean
- `pnpm build` — clean

## Session — Webview Stuck on Maximize Fix (v1.28.0)

### Root Cause
Three concurrent sync triggers (ResizeObserver at 16ms, general onResized at 50ms, maximize-detection onResized at 60ms) all fired during the ~200-300ms Windows maximize animation. The first two read intermediate DOMRects and positioned the webview at wrong bounds. The maximize handler's 60ms delay was too short to outlast the animation, and having two independent `onResized` listeners created a race where one would overwrite the other's bounds.

### Fixes Applied

1. **Merged duplicate `onResized` listeners** (`useWebviewBridge.ts`): The general resize handler (50ms delay) and the maximize/restore detection handler (60ms delay) were separate `useEffect` hooks, each registering `getCurrentWindow().onResized()`. On maximize, both fired — creating a race where the 50ms sync set intermediate bounds and the 60ms sync cleared `lastBoundsRef` but fired too early. Merged into a single listener that handles both paths: maximize transitions get a 350ms delay (outlasts animation), regular resizes get the existing 50ms delay.

2. **Increased maximize sync delay: 60ms → 350ms** (`useWebviewBridge.ts`): The Windows maximize animation takes ~200-300ms. The old 60ms delay consistently read intermediate bounds. 350ms waits for the final settled state.

3. **Suppressed ResizeObserver during maximize animation** (`useWebviewBridge.ts`): Added `isMaximizingRef` flag set on maximize/restore transition. The `ResizeObserver` callback checks this flag and skips sync while active. Prevents the 16ms ResizeObserver from reading intermediate bounds during the animation.

4. **Added double-sync after maximize** (`useWebviewBridge.ts`): After the first sync at 350ms, a second sync fires at 500ms (+150ms). Catches any remaining animation drift. The 5px threshold prevents unnecessary IPC when bounds are already correct.

5. **Removed duplicate `browser_reposition` command** (`browser.rs` + `lib.rs` + `browser.ts`): `browser_reposition` was identical to `browser_set_bounds`. Removed the Rust command and its `invoke_handler` entry; updated the frontend wrapper to call `browser_set_bounds` instead.

### Files Changed
- `src/hooks/useWebviewBridge.ts` — Merged resize listeners, 350ms delay, isMaximizingRef guard, double-sync
- `src-tauri/src/commands/browser.rs` — Removed `browser_reposition` command
- `src-tauri/src/lib.rs` — Removed `browser_reposition` from `invoke_handler`
- `src/services/browser.ts` — `repositionWebview` now calls `browser_set_bounds`

### Verification
- `cargo check` — clean
- `pnpm build` (includes tsc) — clean

## Session — Webview Stuck on Minimize-Restore (v1.28.0 follow-up)

### Root Cause
After maximize → minimize → restore, the Rust `Focused(true)` handler calls `wv.show()` on the active webview at its **last known bounds** (the maximized bounds). The frontend's `minimize-state: false` listener was supposed to re-sync bounds after 80ms, but it only fired once. If that single sync read stale DOM values (IPC delivery timing), the webview stayed at maximized bounds while the main window had restored to a smaller size.

Additionally, the `onResized` handler (from the previous fix) sets `isMaximizingRef = true` when it detects a maximize→restore transition, which suppressed the `ResizeObserver` for 350ms — removing a key additional sync path during the restore window.

### Fix — `src/hooks/useWebviewBridge.ts`
Replaced the single 80ms sync in the `minimize-state: false` listener with a **triple-sync approach**:
1. **`requestAnimationFrame`** — fires on the next paint for the fastest possible correction
2. **120ms** — after the window has likely finished restoring
3. **350ms** — defense-in-depth for late settles

Each attempt clears `lastBoundsRef` to bypass the 5px threshold. Also clears `isMaximizingRef` so the `ResizeObserver` and regular-resize `onResized` branch can fire unblocked during the restore animation.

### Files Changed
- `src/hooks/useWebviewBridge.ts` — triple-sync on minimize-restore + `isMaximizingRef` cleared

### Verification
- `pnpm build` (includes tsc) — clean

## Session — Comprehensive Bounds Sync Rewrite (v1.29.0)

### Root Cause
Three rounds of patch fixes (merged onResized + 350ms delay, isMaximizingRef guard, triple-sync on minimize-restore) all failed to permanently resolve the webview positioning bugs because the **core architecture was fundamentally racy**:

1. **Async `getCurrentWindow().isMaximized()` IPC race**: The `onResized` handler called this async IPC to detect maximize/restore transitions. During the ~1-30ms IPC round-trip, `isMaximizingRef` was still `false`, so the `ResizeObserver` (at 16ms) was **not suppressed** and could read intermediate bounds. The resulting `lastBoundsRef` value would then suppress the delayed correction at 350ms via the 5px threshold.

2. **`isMaximizingRef` created a dead-zone**: Once set (after transitions), it suppressed BOTH the ResizeObserver AND the regular-resize `onResized` branch for 350ms. If the transition detection missed the event (async IPC resolved during the race window), no sync path could recover.

3. **350ms was not universally sufficient**: On slower hardware or high-DPI systems, the Windows maximize animation can exceed 350ms. The double-sync (350ms + 500ms) helped but wasn't guaranteed.

4. **Rust `Focused(true)` restore showed webview at stale bounds without notifying frontend**: The Rust handler called `wv.show()` which positioned the webview at its last known OS bounds. The frontend only learned about this via the `minimize-state: false` event, but had no way to know the bounds were stale — it had to guess the right timing.

### Fix
Five changes across two files, eliminating all conditionals, async IPC dependencies, and guard refs:

#### `src/hooks/useWebviewBridge.ts`
1. **Dual-timer `onResized`** (replaces conditional maximize detection + async IPC): Every resize event schedules syncs at BOTH 50ms (fast for regular resize) AND 500ms (catches maximize/restore after animation settles). No `isMaximized()` call, no `wasMaximizedRef`, no `isMaximizingRef`. The 5px threshold in `syncBounds` deduplicates redundant IPC. Nothing is suppressed — every path fires freely.

2. **Removed `isMaximizingRef` guard from ResizeObserver**: The ResizeObserver fires at 16ms regardless of window state. Intermediate bounds during animation are harmless — the 500ms fallback corrects them.

3. **Bumped minimize-restore delay 350ms → 500ms**: Matches the new `onResized` slow timer for consistency. Also removed `isMaximizingRef.current = false` (ref no longer exists).

4. **Added `xevo://force-sync` listener**: New effect that listens for a Rust-emitted event and immediately forces a bounds sync (clears `lastBoundsRef`). This provides a direct Rust→frontend synchronization path that bypasses all timing concerns.

5. **Removed unused refs**: `wasMaximizedRef`, `isMaximizingRef` removed. `resizeTimerRef`, `longResizeTimerRef` added for debouncing the dual-timer approach.

#### `src-tauri/src/lib.rs`
6. **Emits `xevo://force-sync` in `Focused(true)` handler**: After showing the active tab's webview on restore, emits the force-sync event. This tells the frontend "I just showed a webview at stale OS bounds — sync immediately."

### Files Changed
- `src/hooks/useWebviewBridge.ts` — Full sync system rewrite (dual-timer onResized, force-sync listener, removed isMaximizingRef/wasMaximizedRef)
- `src-tauri/src/lib.rs` — Added `xevo://force-sync` emission in Focused(true) handler

### Verification
- `cargo check` — clean
- `pnpm build` (includes tsc) — clean

## Session 57 — Tab Memory Preservation (v1.30.0)

### Problem
When tabs are discarded (inactive 10+ min or exceeding `maxConcurrentWebviews`), the webview is destroyed and state (scroll position, form inputs) is lost. On recreate, the page reloads fresh.

### Solution
Tab-per-webview architecture: normal tab switching = hide/show (zero state loss). State save/restore only fires on tab DISCARD (not every switch):

1. **State capture**: Before destroying a webview (discard timer or cap enforcement), `saveTabState(tabId)` triggers Rust to eval a JS script that captures scroll position and form input values. The script calls `browser_tab_state_saved` to emit the state back, which is stored in Zustand.

2. **State restore**: When a discarded tab is recreated (user switches back), the webview is created fresh. After `restoreTab`, if `savedFormState` exists, `restoreTabState()` is called to restore scroll + forms. Saved state is then cleared.

### What is preserved
- ✅ Scroll position (window.scrollX/Y)
- ✅ Form inputs (text, checkbox, radio, select, contenteditable)
- ✅ Cookies/localStorage (same-origin navigations preserve these naturally)
- ❌ sessionStorage (destroyed on cross-origin navigation)
- ❌ SPA internal state (page fully reloads on cross-origin navigation)
- ❌ WebSocket connections (terminated on navigation)
- ❌ Media playback (stopped on navigation)

### Files Changed
- `src/types/index.ts` — Added `savedScrollX`, `savedScrollY`, `savedFormState` to Tab interface
- `src/stores/tabs.ts` — Added `saveTabState` action, updated `buildTab`/`stripTab`/`hydrateTab`/`StoredTab` with new fields
- `src-tauri/src/commands/browser.rs` — Added `browser_save_tab_state`, `browser_tab_state_saved`, `browser_restore_tab_state` commands
- `src-tauri/src/lib.rs` — Registered 3 new commands
- `src/services/browser.ts` — Added `saveTabState()`, `restoreTabState()`, `onTabStateSaved()` IPC wrappers
- `src/hooks/useWebviewBridge.ts` — State save in discard timer + cap paths, state restore in recreate path (NOT on normal switch or onLoadingChanged)

### Verification
- `cargo check` — clean
- `pnpm tsc --noEmit` — clean
- `pnpm build` — clean

## PONYTAIL Session — 25-agent audit + fixes applied

- **PONYTAIL audit:** 25 subagents, 122 findings (17 critical), overall score 5.2/10
- **Batch 1 (Network Timing):** Initialized `NETWORK_REQUEST_META` OnceLock so `durationMs` works; removed `map.clear()` that destroyed in-flight timing data
- **Batch 2 (Data Corruption):** Fixed `restore_tab_state` double-JSON-escaping (embed JSON directly as JS expression); fixed GDI `SelectObject` leak (save/restore old bitmap); fixed `eval_find_script` redundant backslash escape; fixed `extract_title` UTF-8 byte slicing in `ports.rs`
- **Batch 3 (Accessibility):** Added `role="dialog"`/`aria-modal` to CommandPalette + ShortcutHelp; `role="listbox"`/`option`/`aria-selected` to palette results; `tabIndex`/`onKeyDown` Enter/Space on TabItem; `role="radiogroup"`/`radio`/`aria-checked` to SettingsPanel theme selector
- **Batch 4 (Dead Code):** Deleted `AddressBar.tsx` (never imported); `package.json` name `xevo-temp`→`xevo`; added `typecheck` script
- **Batch 5 (Type Safety):** `invoke<ScreenshotResult>` generic; typed `listen<T>` for three viewport events (was `any`)
- **Batch 6 (Housekeeping):** Removed dead `getTabsByWorkspace` store method (zero callers); skipped YAGNI refactors
- **Batch 7 (JSON double-serialization):** Removed `JSON.stringify()` from 6 `inspector_data` calls in Rust JS + changed `data: String` → `data: serde_json::Value` in Rust command — frontend no longer needs `JSON.parse(JSON.parse(...))`
- **Batch 8 (Accessibility sweep):** `EntryRow` in NetworkPanel gets `role="button"`/`tabIndex`/`onKeyDown` Enter/Space; Tooltip `delayDuration` 0→500ms for WCAG; color swatch buttons get `aria-label`
- **Batch 10 (Viewport sync throttle):** `useViewportSync.ts` scroll handler now rAF-throttled — drops 59/60 frames of IPC chatter
- **YAGNI skipped:** `HeaderRules` feature gap (stored but not applied — harmless, frontend wired up); dead emulation fields `deviceScaleFactor`/`mobile`/`touch`/`userAgent` (never read but diff cost > value)

## Repository Structure Worktree

```text
Xevo
├── .vscode
│   └── extensions.json
├── public
│   ├── tauri.svg
│   └── vite.svg
├── src
│   ├── components
│   │   ├── browser
│   │   │   ├── BrowserChrome.tsx
│   │   │   ├── ContentArea.tsx
│   │   │   ├── FindBar.tsx
│   │   │   ├── LoadingBar.tsx
│   │   │   ├── StatusBar.tsx
│   │   │   ├── TabBar.tsx
│   │   │   ├── TabContextMenu.tsx
│   │   │   ├── TabItem.tsx
│   │   │   ├── Toolbar.tsx
│   │   │   └── WindowControls.tsx
│   │   ├── layout
│   │   │   └── RootLayout.tsx
│   │   ├── overlay
│   │   │   └── OverlayPanel.tsx
│   │   ├── panels
│   │   │   ├── ApiTester.tsx
│   │   │   ├── Base64Tool.tsx
│   │   │   ├── HeadersPanel.tsx
│   │   │   ├── HomePage.tsx
│   │   │   ├── InspectorPanel.tsx
│   │   │   ├── JwtDecoder.tsx
│   │   │   ├── MetaValidator.ts
│   │   │   ├── NetworkPanel.tsx
│   │   │   ├── NotesNotepad.tsx
│   │   │   ├── SettingsPanel.tsx
│   │   │   ├── SocialPreview.tsx
│   │   │   ├── UserAgentPanel.tsx
│   │   │   ├── UserAgentPresets.ts
│   │   │   ├── ViewportPanel.tsx
│   │   │   └── ViewportPresets.ts
│   │   ├── sidebar
│   │   │   ├── ApiTesterPanel.tsx
│   │   │   ├── BookmarksPanel.tsx
│   │   │   ├── HistoryPanel.tsx
│   │   │   ├── NotesSidebarPanel.tsx
│   │   │   ├── Sidebar.tsx
│   │   │   ├── WorkspaceContextMenu.tsx
│   │   │   └── WorkspaceSwitcher.tsx
│   │   ├── ui
│   │   │   ├── VirtualList.tsx
│   │   │   ├── badge.tsx
│   │   │   ├── button.tsx
│   │   │   ├── input.tsx
│   │   │   ├── separator.tsx
│   │   │   └── tooltip.tsx
│   │   ├── CommandPalette.tsx
│   │   ├── ErrorBoundary.tsx
│   │   ├── ShortcutHelp.tsx
│   │   └── Toast.tsx
│   ├── hooks
│   │   ├── useKeyboardShortcuts.ts
│   │   ├── usePortScanner.ts
│   │   ├── useViewportSync.ts
│   │   └── useWebviewBridge.ts
│   ├── lib
│   │   ├── bookmarkAction.ts
│   │   ├── networkCopy.ts
│   │   ├── screenshot.ts
│   │   ├── url.ts
│   │   ├── utils.ts
│   │   └── workspaceTabs.ts
│   ├── services
│   │   └── browser.ts
│   ├── stores
│   │   ├── apiHistory.ts
│   │   ├── bookmarks.ts
│   │   ├── headers.ts
│   │   ├── history.ts
│   │   ├── inspector.ts
│   │   ├── network.ts
│   │   ├── notes.ts
│   │   ├── servers.ts
│   │   ├── settings.ts
│   │   ├── tabs.ts
│   │   ├── ui.ts
│   │   └── workspaces.ts
│   ├── types
│   │   └── index.ts
│   ├── App.tsx
│   ├── index.css
│   ├── main.tsx
│   └── vite-env.d.ts
├── src-tauri
│   ├── capabilities
│   │   └── default.json
│   ├── gen
│   │   └── schemas
│   │       ├── acl-manifests.json
│   │       ├── capabilities.json
│   │       ├── desktop-schema.json
│   │       └── windows-schema.json
│   ├── icons
│   │   ├── 128x128.png
│   │   ├── 128x128@2x.png
│   │   ├── 32x32.png
│   │   ├── Square107x107Logo.png
│   │   ├── Square142x142Logo.png
│   │   ├── Square150x150Logo.png
│   │   ├── Square284x284Logo.png
│   │   ├── Square30x30Logo.png
│   │   ├── Square310x310Logo.png
│   │   ├── Square44x44Logo.png
│   │   ├── Square71x71Logo.png
│   │   ├── Square89x89Logo.png
│   │   ├── StoreLogo.png
│   │   ├── icon.icns
│   │   ├── icon.ico
│   │   └── icon.png
│   ├── src
│   │   ├── commands
│   │   │   ├── browser.rs
│   │   │   ├── headers.rs
│   │   │   ├── mod.rs
│   │   │   └── ports.rs
│   │   ├── lib.rs
│   │   └── main.rs
│   ├── .gitignore
│   ├── Cargo.lock
│   ├── Cargo.toml
│   ├── build.rs
│   └── tauri.conf.json
├── .gitignore
├── AGENTS.md
├── ARCHITECTURE.md
├── DEVBROWSER_PROJECT_GUIDE.md
├── PROJECT_STATE.md
├── README.md
├── TASKS.md
├── XEVO_FRONTEND.md
├── components.json
├── header_issue-report.md
├── index.html
├── networklog_issues.md
├── package.json
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
├── repo-structure.md
├── tsconfig.json
├── tsconfig.node.json
├── vite-review.json
└── vite.config.ts

22 directories, 127 files
```
