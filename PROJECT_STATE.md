# XEVO Project State

## Version: v1.13.1
## Last Updated: 2026-06-26
## Status: Session 38 complete — Added manual "rescan now" button to LiveServersPanel header. Wired the previously dead `scan` return from `usePortScanner` into a RefreshCw icon button with spin animation during scan. `pnpm build` clean.

## ENVIRONMENT
- OS: Windows
- Node: v24.16.0
- Rust: rustc 1.96.0
- pnpm: 11.5.0
- Tauri CLI: 2.11.2
- Tauri crate: 2.11.2

## COMPLETED ✅
- Tauri 2 + React 19 + TypeScript scaffolded
- Tailwind v4 + shadcn/ui + Zustand v5
- Layout: WorkspaceSwitcher + Sidebar + BrowserChrome
- Tab system: open (Ctrl+T), close (Ctrl+W), switch tabs
- Address bar: URL input, navigation, Ctrl+L shortcut
- Workspace persistence via zustand/persist
- Port scanner Rust: scan_ports (concurrent TCP, ~400ms for 23 ports)
- Port scanner frontend: stores/servers.ts, hooks/usePortScanner.ts
- Live Servers sidebar: real scan results, auto-refresh every 10s
- Clicking server in sidebar: opens URL in new tab
- **True embedded child webview via add_child (Tauri unstable feature)**
  - Cargo.toml: `tauri = { version = "2", features = ["unstable"] }`
  - browser.rs uses `WebviewBuilder::new(...).initialization_script(...).on_navigation(...).on_page_load(...)` then `app.get_window("main").add_child(builder, pos, size)` (via AppHandle, not WebviewWindow)
  - Webview is now a child of the main window — cannot escape parent bounds, z-order is always correct
- **Webview z-order correct** — child webview lives inside main window, no separate OS window to drift
- **browser_show signature** — takes `(x, y, width, height)` and restores from off-screen (-9999, -9999, 1, 1) hidden state
- **update_tab_info Rust command** — sync (not async), emits "browser://tab-info" with `{title, url, favicon}` JSON payload
- **BROWSER_INIT_SCRIPT** — IIFE-wrapped JS that reads `document.title`, `window.location.href`, and favicon; fires on DOMContentLoaded, load, and title MutationObserver
- **Rust-side title extraction fallback** — `on_page_load` PageLoadEvent::Finished re-evals title script + 500ms + 1.5s delayed retries for late SPA titles
- **Tab titles and favicons** — real `document.title` + `<link rel="icon">` (Globe icon fallback via onError)
- **Keyboard shortcuts hook** — `useKeyboardShortcuts(bridge)` centralizes Alt+←/→, Ctrl+R, Ctrl+1-9, Ctrl+Tab/Ctrl+Shift+Tab, Ctrl+,, Ctrl+K, Ctrl+?
- **Tab context menu** — right-click on any tab → fixed-position portal menu (Reload, Duplicate, Pin/Unpin, Close, Close Others)
- **Loading progress bar** — thin 2px blue bar under the address bar (pure CSS keyframes)
- **Navigation uses eval() on existing child webview (NOT .navigate())** — `browser_navigate`'s "already exists" branch calls `webview.eval("window.location.href = <json-string-url>")` with `serde_json::to_string` for safe escaping. `grep '\.navigate\('` returns zero matches in src-tauri.
- **Infinite re-render loop fixed: bridge ref stabilized + port scanner skips no-change updates**
  - `useWebviewBridge.ts`: the returned `{ navigate, goBack, goForward, reload, syncBounds }` is now wrapped in `useMemo` so its reference is stable across renders
  - `useWebviewBridge.ts`: destructured Zustand calls replaced with primitive selectors
  - `BrowserChrome.tsx`: same primitive-selector refactor
  - `usePortScanner.ts`: before calling `updateFromScan`, compares new results against `useServersStore.getState().servers`; only updates when port count or any port's `alive` flag actually changed
- **Webview bounds fixed: ResizeObserver observes documentElement + 50ms initial show delay**
  - `useWebviewBridge.ts`: `ResizeObserver` now observes both `contentAreaRef.current` and `document.documentElement` so window resizes propagate to the native child webview
  - `useWebviewBridge.ts`: tab-switch `navigateWebview + showWebview` call is wrapped in `setTimeout(..., 50)` to allow the content area to finish laying out
- **Settings panel: theme toggle, search engine selector, port scan interval slider, compact mode toggle**
- **Command palette: Ctrl+K opens VS Code-style centered overlay with fuzzy search**
- **Navigation truly fixed: `navigate()` in useWebviewBridge now calls `browser_show` after `browser_navigate` so webview is always moved to screen position**
- **Pin icon visual: TabItem shows a Pin icon when `tab.isPinned` is true**
- **Compact mode: `xevo-compact` class on document root + CSS overrides in index.css**
- **Keyboard shortcut help overlay: Ctrl+? opens ShortcutHelp modal**
- **PhysicalPosition/PhysicalSize fix in browser.rs (was Logical — caused webview to overflow window on Windows with DPI scaling)**
  - `src-tauri/src/commands/browser.rs`: every `LogicalPosition`/`LogicalSize` replaced with `PhysicalPosition<i32>`/`PhysicalSize<u32>`. Size uses `.max(1)` to guard against zero. Off-screen hide coords are now `PhysicalPosition::new(-9999_i32, -9999_i32)` + `PhysicalSize::new(1_u32, 1_u32)`. Root cause: inside Tauri's main WebView2, `getBoundingClientRect()` already returns values that map directly to the physical pixel coordinates the native child webview expects, so passing them as "Logical" caused them to be multiplied by the OS scale factor and overflow the window.
- **Bug A final fix: multiply CSS bounds by `Window::scale_factor()` to get physical pixels**
  - On a 125% DPI display, `Window::scale_factor()` returns `1.25`. CSS pixels from `getBoundingClientRect()` (e.g. `height: 720`) must be multiplied by `1.25` to get physical pixels (`900`) that match the actual on-screen content area.
  - `browser_navigate`, `browser_set_bounds`, `browser_show` all now compute `let sf = window.scale_factor().unwrap_or(1.0); let px = (x * sf) as i32;` etc. and use those values in `PhysicalPosition`/`PhysicalSize`.
  - `set_browser_visible` signature changed to accept already-physical values directly.
  - `browser_hide` passes the raw off-screen constants `(-9999, -9999, 1, 1)` (no scale factor needed).
- **DPR division removed from getBounds() in useWebviewBridge.ts (was incorrect: WebView2 returns CSS pixels not scaled pixels)**
  - `src/hooks/useWebviewBridge.ts`: the `devicePixelRatio` compensation block is gone. `getBounds()` now returns raw `getBoundingClientRect()` values, rounded.
- **Bug B fix: address bar stays focused after navigation**
  - `src/components/browser/AddressBar.tsx`: removed `inputRef.current?.blur()` from `handleNavigate`. Previously, after the first navigation, the address bar lost focus, so the user's second Enter press was captured by the webview (which was now showing Google) instead of the address bar. The Rust `browser_navigate` function was never invoked, and the address bar update was the only visible state change.
  - Added a diagnostic `console.log('[xevo] handleNavigate called with raw:', raw, '→ resolved:', url)` to confirm the function fires.
- **Bug B final fix: close-and-recreate the child webview on every bounds/URL change**
  - **Root cause confirmed via runtime diagnostic:** Tauri 2 child webviews (created via `Window::add_child`) cannot have their bounds updated post-creation. `Webview::set_bounds`, `Webview::set_position`, and `Webview::set_size` all internally call `self.window()` which returns `current webview is not a WebviewWindow` for child webviews. The eval-based URL change works, but a window resize / tab switch after the webview is already created will silently fail bounds updates.
  - **Fix:** introduced a new private helper `create_or_recreate_browser_webview(app, url, px, py, pw, ph)` in `src-tauri/src/commands/browser.rs` that closes the existing webview (if any) via `webview.close()` and then calls `parent_window.add_child(...)` with the current URL and physical bounds.
  - All navigation/bounds/show commands now route through this helper instead of mutating an existing webview.
  - **Trade-off accepted:** navigation history (back/forward) is lost on every call. The prior single-webview architecture already lost history on every tab switch, so close-and-recreate is no worse.
- **BrowserState extended with `last_url: Mutex<Option<String>>`**
  - `src-tauri/src/lib.rs`: `BrowserState` now has two fields: `created: Mutex<bool>` and `last_url: Mutex<Option<String>>`. Both registered via `.manage(...)` at startup.
  - `src-tauri/src/commands/browser.rs`: `browser_navigate` writes the resolved URL to `state.last_url`. `browser_set_bounds`, `browser_show` read it back so a bounds change after navigation re-creates the webview at the current page. `browser_hide` no longer needs to remember anything (URL is preserved in state).
  - `on_navigation` callback also writes the navigated URL to `state.last_url` so redirect destinations survive hide→show cycles.
- **Old "already created" eval branch removed from `browser_navigate`**
  - The prior `webview.eval("window.location.href = " + json_str)` path is gone. All navigations now go through `create_or_recreate_browser_webview`. This means the `.navigate()` rule (no calls on child webviews) and the `eval()` rule (no longer used) are both obsolete; only the `add_child` constructor matters.
- **2px bounds-oscillation loop fixed via 5px threshold (frontend + backend)**
  - **Root cause:** When a child webview is added to the main window, WebView2 re-layers the chrome and the content area's bounding rect shifts by ~2px (subpixel). ResizeObserver fired on this shift and called `syncBounds → setWebviewBounds → create_or_recreate`, which then triggered another re-layer shift, which fired ResizeObserver again — an infinite close-and-recreate loop oscillating between two near-identical bounds (e.g. phys y: 100 ↔ 102, height: 1012 ↔ 1010). The address bar was seeing the URL change events fire in rapid succession, looking like a "continuous search".
  - **Fix (frontend):** `src/hooks/useWebviewBridge.ts` `syncBounds()` threshold bumped from 1px to 5px on all four bounds. A 2px subpixel shift is now filtered out before the backend call.
  - **Fix (backend):** `src-tauri/src/commands/browser.rs` `browser_set_bounds` now compares new phys against `state.last_bounds` (a new `Mutex<Option<(i32, i32, u32, u32)>>` field on `BrowserState`). If all four components are within 5px, it returns early without calling `create_or_recreate`. Defense-in-depth in case the frontend threshold is bypassed.
  - `browser_navigate` and `browser_show` write the new phys to `state.last_bounds` after computing it, keeping the threshold check's baseline current.
- **Duplicate `showWebview` calls removed from frontend**
  - The 50ms-delayed `setTimeout → showWebview(freshBounds)` block at the end of `navigate()` was redundant — `navigateWebview` already creates the webview at the content area bounds. The duplicate call triggered a second `create_or_recreate` 50ms later, which raced with the first `close+add` and surfaced as "tab switch navigate failed: current webview is not a WebviewWindow" in the Xevo console.
  - The `.then(() => showWebview(bounds))` chain in the tab-switch `useEffect` had the same problem and was removed.
  - Each navigation / tab switch now triggers exactly one `create_or_recreate`.
  - `showWebview` import removed from `useWebviewBridge.ts` (no longer used). The Tauri command `browser_show` stays in place as a no-op defensive entry point; the frontend just doesn't call it.
- **All diagnostic logs removed (frontend + backend)**
  - Frontend: removed `console.log('[xevo] navigate() called with url:', ...)` and `console.log('[xevo] bounds:', ...)` from `navigate()`. Removed `console.log('[xevo] tab switch to:', ...)` from the tab-switch useEffect.
  - Backend: removed `println!("[xevo] browser_navigate: ...")` from `browser_navigate` and `eprintln!("[xevo] create_or_recreate: ...")` from `create_or_recreate_browser_webview`.
  - `isSwitchingTabRef` and `lastBoundsRef` (and their usages) stay — they're production logic, not diagnostics.
- **Tab-switch race condition fixed: 50ms close-settle delay in Rust + retry-based getBounds in JS**
  - **Root cause:** `webview.close()` is async — it sends a close request to the WebView2 process, but the OS-level webview registry is not updated immediately. When `add_child` was called right after with the same label (`"browser"`), Tauri could fail with "label already in use" or similar. The Rust function returned an error, the JS catch logged it, and the old webview remained visible. The JS state updated normally (URL bar changed), producing the symptom "URL changes but screen stays on old page".
  - **Rust fix:** `src-tauri/src/commands/browser.rs` `create_or_recreate_browser_webview` is now `async fn`. After `webview.close()` returns, it does `tokio::time::sleep(Duration::from_millis(50)).await` before `add_child`. Gives WebView2 time to fully unregister the closed webview's label. The three callers (`browser_navigate`, `browser_set_bounds`, `browser_show`) now `.await` the call.
  - **JS fix:** `src/hooks/useWebviewBridge.ts` tab-switch `useEffect` now uses a `tryNavigate(attempt)` recursive function. If `getBounds()` returns null (rect < 10px because layout hasn't settled), retry up to 3 times with 100ms intervals. The initial `setTimeout` was bumped from 50ms to 100ms to give the flex layout more time on the first attempt. Worst case: 100ms + 3×100ms = 400ms before the webview is recreated, but in practice it succeeds on the first attempt.
  - This also handles the case where a tab is closed and the next active tab is selected — the same useEffect fires, the same retry logic applies.
- **Tab-switch race condition FINAL fix: unique webview labels (v0.9.5)**
  - **Why v0.9.4's 50ms delay wasn't enough:** the previous fix was a band-aid. WebView2's label-registry update latency is hardware-dependent, and on the user's machine 50ms was not enough. The symptom ("URL changes but webview stays on old page") persisted through three sessions because the root cause was never addressed — the close-vs-add race with a fixed label is fundamentally fragile.
  - **Root fix:** each new webview is given a UNIQUE label (`browser-1`, `browser-2`, ...) from a monotonically-increasing counter stored in `BrowserState.label_counter`. The new webview is added FIRST, then the old one is closed. Because the labels are always different, there is no race with WebView2's label-registry update — the old webview can be closed lazily in the background.
  - **State changes:** `BrowserState` gained two fields: `current_label: Mutex<Option<String>>` and `label_counter: Mutex<u64>`. `get_browser_webview` now reads the current label from state. `create_or_recreate_browser_webview` generates a new label, updates `state.current_label` BEFORE the add (so concurrent `get_browser_webview` calls find the new label), and closes the old webview AFTER the add succeeds.
  - **Removed:** the 50ms `tokio::time::sleep` (no longer needed), the `BROWSER_LABEL` const (no longer used), and the 5px threshold in `browser_set_bounds` (the entire command is now a no-op).
  - **`browser_set_bounds` is now a no-op.** Window-resize-driven webview repositioning is disabled. The webview stays at the bounds from the last `create_or_recreate`. To refresh bounds, trigger a re-navigation (e.g. press Enter on the address bar) — that calls `browser_navigate` with fresh bounds from `getBounds()`. This eliminates the stale-`state.last_url` issue that occurred when rapid `syncBounds` calls would read the old URL from state and recreate the webview with the wrong page.
- **BrowserState managed state (Mutex<bool>) tracks webview creation in Rust**
  - `src-tauri/src/lib.rs`: `pub struct BrowserState { pub created: Mutex<bool>, pub last_url: Mutex<Option<String>>, pub last_bounds: Mutex<Option<(i32, i32, u32, u32)>>, pub current_label: Mutex<Option<String>>, pub label_counter: Mutex<u64> }` declared at module scope; registered via `.manage(BrowserState { ... })` before `.invoke_handler(...)`.
  - `src-tauri/src/commands/browser.rs`: `use crate::BrowserState;` import added. `browser_navigate` reads the flag, and on subsequent navigations looks up the existing webview via the parent window. After successful `add_child`, the flag is set to `true`. If the lookup fails the flag is reset to `false` and a fresh `add_child` is attempted.
- **Parent window webview lookup: parent.get_webview(BROWSER_LABEL) is more reliable than app.get_webview(BROWSER_LABEL) for child webviews**
  - `get_browser_webview` helper signature is now `fn get_browser_webview(app: &AppHandle) -> Option<tauri::Webview>` and resolves `app.get_window("main")?.get_webview(BROWSER_LABEL)`.
  - `browser_set_bounds` also resolves the parent window first before calling `get_webview`.
  - `browser_navigate` does the same in its "already created" branch.
- **Tab title shows URL domain immediately (before document.title arrives)**
  - `useWebviewBridge.ts`: in `navigate`, after `updateTab(..., { url, isLoading: true })`, the tab title is also set to `url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0]` (e.g. "google.com"). This is replaced by the real `document.title` when Rust's `update_tab_info` event fires.
- **Address bar URL syncs correctly on redirect navigation**
  - `AddressBar.tsx`: the `useEffect` that syncs `draft` with `activeTab.url` already had `[activeTabId, activeTab?.url, focused]` in its deps array, so URL updates from redirects propagate to the input immediately. No code change needed; verified correct.
- **ResizeObserver debounced 50ms to prevent rapid-fire bounds updates**
  - Spec note: only applied conditionally if runtime reveals resize misalignment. The current implementation in `useWebviewBridge.ts` calls `syncBounds()` directly on every ResizeObserver event. If the user observes resize glitches during runtime, the conditional fix in 45.5 is ready to apply.
- **JSON auto-formatter** — `BROWSER_INIT_SCRIPT` extended with `xevoRenderJson()` IIFE that detects JSON pages (`document.contentType` check + `JSON.parse(body.innerText)` fallback for unknown types) and replaces the DOM with a dark-themed collapsible tree view, syntax-highlighted (keys blue / strings green / numbers orange / booleans purple / nulls grey / brackets amber), with a toolbar showing the URL + size + a Copy button. Depth limit 8, max 500 items per array/object, real HTML pages skipped, cross-origin pages silently ignored
- **Light + System theme** — `:root { color-scheme: dark }` default. All `--xevo-*` CSS variables now live in `[data-theme="dark"]` and `[data-theme="light"]` blocks (full light palette). `App.tsx` second `useEffect` reads `theme` from settings, sets `data-theme` attribute; for `system` mode uses `matchMedia('(prefers-color-scheme: dark)')` + change listener with proper cleanup
- **Per-tab history isolation** — `Tab` type gains `historyBack`/`historyForward` arrays. `useTabsStore` adds `recordNavigation` (50-entry cap, dedupes consecutive duplicates, clears forward on new nav), `popBack`, `popForward`. `useWebviewBridge` wires: address-bar `navigate` records current URL before nav, `goBack`/`goForward` use the pop actions + `navigateWebview` (not native `window.history`), tab-switch useEffect records leaving tab's URL, `onUrlChanged` listener records on in-page link clicks. `AddressBar` back/forward enable state reads from the active tab's stacks
- **Tab drag-to-reorder** — `TabItem` accepts `draggable` + 4 drag props; drop target gets a 2px left border in `--xevo-accent`. `TabBar` owns `dragTabId`/`dragOverTabId` state, computes new tab order on drop, calls `reorderTabs()`. Uses native HTML5 drag-and-drop, no external library. **v0.9.7:** `e.dataTransfer.setData("text/plain", tabId)` added in `handleDragStart` (Firefox/WebView2 need it for drop to fire), `draggable={false}` added to close button (some WebView2 versions route mousedown on the button to the parent, breaking drag), `onDragEnd` moved from the container to each TabItem (dragend fires on source element), source tab fades to 40% opacity while dragging, cursor changes to `grab` / `grabbing`
- **Light-mode color leak fix** — every `--xevo-*` color variable has both a dark and light value. To make the variable system complete, 5 new vars were added: `--xevo-hover` (button hover bg), `--xevo-modal-bg` (modals/menus), `--xevo-modal-border`, `--xevo-warning` (insecure URL icon), `--xevo-badge-bg` (kbd + count pills). All 10 components with hardcoded dark hex codes (TabItem, TabBar, AddressBar, ContentArea, Sidebar, WorkspaceSwitcher, SettingsPanel, CommandPalette, ShortcutHelp, TabContextMenu) now use CSS variables
- **JSON viewer ultra-minimal** — `BROWSER_INIT_SCRIPT` in `src-tauri/src/commands/browser.rs` rewritten. Header is a single 32px line (URL path on left, Copy button on right, 1px bottom border). 2 colors only: `--xevo-accent` blue for keys, body color for everything else (strings, numbers, booleans, null, brackets, commas, colons all inherit). Auto-expand limited to top 1 level (root open, children collapsed). Removed 5 redundant CSS classes (`xj-label`, `xj-url`, `xj-size`, `xj-n`, `xj-b`, `xj-null`, `xj-bracket`, `xj-toolbar`)
- **Package rename** — `src-tauri/Cargo.toml` package `xevo-temp` → `xevo`, lib `xevo_temp_lib` → `xevo_lib`. `src-tauri/src/main.rs` updated to `xevo_lib::run()`. Empty `src/utils/` directory removed
- **Find in Page** (Session 11 / Part A) — `Ctrl+F` opens a fixed-positioned search bar in the content area. Queries flow through Rust commands `browser_find` / `browser_find_next` / `browser_stop_find` to a JavaScript `XEVO_FIND_SCRIPT` injected into the webview (since Tauri 2.11.2 stable does NOT expose `WebviewWindow::find` natively — confirmed by grepping the tauri-2.11.2 source). The JS walks `document.body` text nodes, wraps matches in `<mark class="xevo-find-hit">`, scrolls the active match into view, and reports `(activeMatch, totalMatches)` back to Rust via `browser_find_callback`, which emits `browser://find-result` to the frontend. Enter cycles matches, Shift+Enter goes back, Esc closes (also stops the find and clears highlights). Match count shown live in the bar (`"1 of 5"` / "No results"). Debounced 150ms.
- **Bookmarks** (Session 11 / Part B) — `Ctrl+D` bookmarks the active tab to the active workspace. Toggle behavior: re-pressing Ctrl+D on a bookmarked tab removes the bookmark. Workspace-scoped: a "Frontend" workspace keeps its own list separate from "Personal". Persisted to `localStorage` under `xevo-bookmarks`. New sidebar panel (sidebar's `bookmarks` icon) shows the list with inline rename (double-click), open-in-new-tab (click row), per-row delete (hover icon), and "Clear all" with `window.confirm`. Empty state with Ctrl+D hint.
- **XEVO Home Page** (Session 11 / Part C) — Replaces the bare Globe-icon placeholder in `ContentArea` with a proper landing page. Three sections: (1) Hero with workspace icon + name + centered search input that submits to the active tab's `bridge.navigate` (or opens a new tab if no bridge). (2) Live Servers grid — 2/3/4-column responsive cards, one per running localhost dev server, with status dot + port + label. (3) Bookmarks list — most recent workspace-scoped bookmarks, click to open. Each section has a "View all" link that switches the sidebar panel to the corresponding detail view. Shown only when `!hasUrl` (no active tab URL).
- **API Tester MVP** (Session 11 / Part D) — Postman-style panel in the sidebar. Method selector (GET/POST/PUT/DELETE/PATCH/HEAD/OPTIONS, color-coded), URL input, tabbed request editor (Headers / Body / cURL Import), Send button (uses `fetch()` directly), response viewer (status pill, duration, size, body/headers tabs, Copy button, JSON pretty-printing), quick-pick row of live server URLs, request history (last 50, click to load method+URL back into editor). cURL Import parses cURL commands: `-X METHOD`, `-H 'k: v'`, `-d 'BODY'`, `-F 'k=v'`, `-u user:pass` (Basic auth), `-A 'UA'`, `-b 'cookie'`. Single + multi-line cURL bodies both supported. Empty method-by-default for cURL-import defaults to POST if `-d` is present. `Ctrl+Enter` in the URL input sends. Two layouts: embedded (sidebar, default) and full-page modal (via `onClose` prop).
- **JWT Decoder** (Session 12) — Sidebar panel (`KeyRound` icon). Paste button reads clipboard, textarea for token input, 300ms debounced decode. Base64url decoding with UTF-8 support. Displays algorithm badge ("ALG: HS256"), collapsible HEADER/PAYLOAD sections with key-value rows, expiry countdown ("Expired 3h 21m ago" in red / "Expires in 2d 4h" in green), signature note. Handles invalid tokens gracefully with error message.
- **Base64 Tool** (Session 12) — Sidebar panel (`Binary` icon). Encode/decode mode toggle, URL-safe checkbox (`-` and `_` instead of `+` and `/`). TextEncoder/TextDecoder for proper Unicode handling. Input/output with char counts, copy button with 2s "Copied!" feedback. Real-time conversion as you type.
- **Status Bar** (Session 12) — 20px bar at bottom of window. Shows load time in ms after page navigation (e.g. "✓ 342ms"), or animated "Loading…" text while page loads, or hovered URL (placeholder for now — Task 63.3 hover tracking skipped). Page origin displayed on the right (e.g. "https://api.github.com").
- **Load Time Tracking** (Session 12) — `loadTime: number | null` added to Tab type. `useWebviewBridge` tracks time from `onLoadingChanged(true)` to `onLoadingChanged(false)` and writes elapsed ms to the active tab. Reset on new navigation.
- **Reopen Last Closed Tab** (Session 12) — `Ctrl+Shift+T` reopens the last closed tab with its URL and title. `lastClosedTab: Tab | null` added to tabs store. Single slot (not a stack) — standard browser behavior.
- **Stop Loading** (Session 12) — `Escape` key calls `window.stop()` via `browser_stop_loading` Rust command when no find bar is open and page is loading. Stops all pending network requests for the current page.
- **Sidebar Toggle** (Session 14) — ☰ button in WorkspaceSwitcher icon strip collapses/expands the sidebar panel area. Ctrl+B keyboard shortcut. WorkspaceSwitcher icon strip always visible. Webview repositions via new `browser_reposition` Rust command when sidebar toggles.
- **Keyboard Shortcut Forwarding from Webview** (Session 14) — `XEVO_SHORTCUT_FORWARD_SCRIPT` injected into every webview page intercepts Ctrl+D/K/T/W/R/B/,/Shift+T and calls new `forward_shortcut` Rust command which emits `xevo://shortcut` event to main window. `useKeyboardShortcuts.ts` listens for this event and handles each shortcut identically to the regular keydown handler.
- **Modal Visibility Fix** (Session 14) — Command palette and shortcut help modals now hide the browser WebviewWindow when open and show it again (with 50ms delay) when closed. Prevents modals from appearing behind the OS-level webview window.
- **Rust command count: 26** — browser_create_tab, browser_activate_tab, browser_close_tab, browser_navigate_tab, browser_set_bounds, browser_go_back, browser_go_forward, browser_reload, browser_stop_loading, browser_bookmark_request, forward_shortcut, update_tab_info, browser_find, browser_find_next, browser_stop_find, browser_find_callback, browser_reposition, browser_set_theme, browser_hide_tab, browser_show_tab, network_log_entry, browser_update_header_rules, browser_eval_inspector, inspector_data, inspector_mutate, scan_ports.

### XEVO_FRONTEND.md Design System (Sessions 28–30)
- **Tailwind v4 @theme token system** — `src/index.css`: `@custom-variant dark` for Tailwind v4 dark mode via `data-theme` attribute. All design tokens wrapped in `@theme { ... }` block (colors, fonts, spacing, radius, motion). Tailwind now generates utility classes like `bg-base`, `text-text-primary`, `bg-elevated`, etc. `:root` retains shadcn/ui semantic mappings + legacy `--xevo-*` aliases + RTE theme variables.
- **`prefers-reduced-motion: reduce`** — global CSS rule disables all animations/transitions for users who prefer reduced motion.
- **`decorations: false`** — main window has no native title bar (`src-tauri/tauri.conf.json`). Window controls are custom-rendered in the tab bar.
- **HomePage redesign (spec §10)** — centered 720px column, "Your stack, at a glance." heading (24px/600), 64px server cards with liveness dot + port + "Open →" link, ambient radial gradient pulse (3s infinite), italic empty state text.
- **CommandPalette animation + sizing (spec §6)** — 80ms `paletteIn` animation (fade + scale 0.97→1.0), input height 44px, results max-height 320px, result items 32px, border-radius 6px, accent-dim selected state.
- **Sidebar 150ms width transition (spec §7)** — always rendered (no `return null`), width transitions 150ms ease-snap between `sidebarWidth` and `0`.
- **Toast 100ms animation (spec §7)** — 100ms `toastIn` animation (was 200ms), inline `<style>` tag removed (keyframe now in index.css).
- **34 aria-labels added (spec §13)** — all icon-only buttons across 17 files now have `aria-label`. Dynamic labels for toggle buttons (sidebar collapse, pin/unpin).
- **tabular-nums on numeric columns (spec §3)** — `font-feature-settings: "tnum" 1` or `tabular-nums` added to 10 numeric elements (StatusBar load time, ApiTester status/duration/size, FindBar match counter, port numbers).
- **All unauthorized shadows removed (spec §9 rule 2)** — `shadow-lg` from Toast + context menu, `shadow-[...]` from AddressBar, `shadow-xs` from ui/input + ui/button, `box-shadow` transition from badge, drag ghost boxShadow from TabBar. Only liveness dot glow and input focus ring remain.
- **hover:scale removed (spec §9 rule 4)** — `hover:scale-110` from NotesNotepad color picker dots.
- **Custom WindowControls** — replaced `tauri-controls` (React 18 peer dep, incompatible with React 19) with custom `src/components/browser/WindowControls.tsx`: 3 buttons (minimize, maximize, close) using `@tauri-apps/api/window` `getCurrentWindow()`. 46px wide hit targets, hover states (subtle bg on min/max, red bg on close). Zero dependencies.
- **tauri-plugin-os added** — `tauri-plugin-os = "2"` in Cargo.toml + registered in lib.rs. `os:default` permission added to capabilities. Available for future OS-specific features.

## ARCHITECTURE NOTE (CURRENT)
- **Tab-per-WebviewWindow architecture:** Each tab gets its own `WebviewWindow` (label `browser-{tabId}`), created lazily on first navigation via `browser_create_tab`. Tab switching calls `browser_activate_tab` which hides the old webview and shows the new one — no navigation, no reload, full state preservation.
- Parent is the main `WebviewWindow`. Tauri uses the parent for z-order and lifecycle.
- **Lifecycle rule:** Webviews are created once per tab (on first URL navigation) and destroyed when the tab is closed. Tab switch = hide/show only.
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
- **Window-move following uses `onMoved` + `onResized` dual listeners** — `onMoved` fires reliably for user drags but is unreliable for maximize/unmaximize on Windows (SWP_NOMOVE). `onResized` is always reliable. The maximize-state detection resets `lastBoundsRef` on transitions. Residual risk: if the lib.rs repaint hack's `maximize() → unmaximize()` fires both events in a single frame, the `onResized` 50ms delay may race with `onMoved`. In practice this is invisible because both最终 call `syncBoundsRef.current()` which reads fresh DOM values. **Root cause is Tauri 2.x architectural:** `WebviewWindow::parent()` "doesn't seem to work in a Windows environment" per Tauri team's own Issue #10079 (closed as "not planned", June 2024). The frontend `onMoved` + `onResized` dual listener is the best available workaround.
- **WebviewWindow is always built with `transparent: true`** — works on Windows 10+ but may show a white flash on first creation before the page paints. Acceptable; will be addressed if users complain.
- **JSON viewer's depth limit is 8 and max items per array/object is 500** — deeper/larger structures are rendered as `[deep array]` / `{deep object}` / `...N more items` to prevent infinite recursion and unbounded HTML. Most APIs stay well under these limits.
- **Theme has brief dark flash on first paint** — between page load and React's first effect run, `:root { color-scheme: dark }` is active and the html/body have hardcoded dark backgrounds, so light-theme users see a flicker. The dark flash is intentional per spec; first effect run sets the correct data-theme. Acceptable; can be eliminated with an inline boot script in index.html if it bothers users.
- **No transparent window** — main window is opaque (per spec Task 22, tauri.conf.json has no `transparent` key). The WebviewWindow IS transparent (`transparent(true)` in the builder), so the main window's content-area background shows through any pixels the browser page doesn't paint.
- **Settings panel uses absolute positioning** — anchored to the right side of the content area. Does not currently push or reflow the webview; it overlays the right edge (matches the spec).
- **Compact mode CSS uses class-name overrides** — the `.h-9`, `.h-11`, `.w-12`, `.py-2` overrides only apply inside `.xevo-compact`, so they're scoped safely. They DO affect any other element with the same Tailwind class names in compact mode (none currently exist outside tab bar / address bar / workspace switcher, but if someone adds one, the height will shrink too).
- **Command palette mount placement** — `<CommandPalette />` and `<ShortcutHelp />` are mounted in `RootLayout.tsx` OUTSIDE the `relative` content wrapper (they need `position: fixed` over the full window). They don't interfere with the settings panel because all are conditional renders. Opening one overlay while another is open will show the newer one on top (both have z-9999).
- **Tab drag-to-reorder uses pointer events** — replaced HTML5 DnD (broken in WebView2). Ghost element follows cursor during drag. Drop target indicated by 2px blue left border. No animated reorder transition (items snap to position on drop).
- **In-page link click records history via `onUrlChanged` from Rust** — if a page fires multiple `onUrlChanged` events in rapid succession (e.g. SPA internal routing), each one is treated as a navigation and pushed to the back stack. This can pollute history with intermediate URLs. Acceptable for now; can be filtered later by debouncing.
- **Per-tab history is in-memory only** — Zustand `tabs` store is not persisted. On app restart, tabs and their history are lost. Acceptable for v1.0; persistence can be added by extending the tabs store with `persist` middleware in a follow-up.
- **Global shortcuts fire even when XEVO is not focused** — `tauri-plugin-global-shortcut` registers OS-level hotkeys. If another app has the same shortcut (e.g. Ctrl+T in Chrome), both apps receive it. The plugin silently fails for shortcuts already taken by another app. This is the intended trade-off for making shortcuts work when the webview has focus.
- **Network log captures fetch/XHR only** — document navigations, image/CSS/font/script asset loads, and Web Worker requests are not captured. By design — developers debugging API calls care about fetch/XHR, not assets.
- **HttpOnly cookies not visible in Cookie inspector** — browser security restriction; JavaScript cannot read HttpOnly cookies. The inspector shows a warning banner about this.
- **Header injection applies to fetch/XHR only** — navigation requests and asset loads are not intercepted. By design — no dev wants auth headers on images.
- **Header rules pushed to existing tabs via eval; new tabs get rules from init script** — `browser_update_header_rules` evals `window.__XEVO_HEADER_RULES = [...]` in all open browser webviews. New tabs created after the rules are set will also have the rules injected via the init script's initial empty array (which is then updated by `browser_update_header_rules`). This two-step approach ensures rules work immediately on existing tabs without requiring a page reload.

## SESSION NOTE (2026-06-03 - live server + workspace audit)
- Fixed Live Servers discovery so newly started localhost ports are picked up on the next scan even when the service binds on a different loopback family.
- Tightened server merge state so `alive`, `lastSeen`, `title`, and `status` stay in sync with the newest scan result.
- Switched workspace tab persistence to session-only behavior and added live-tab helpers so hover counts, tab iteration, shortcuts, and command palette results all read from the live tab map instead of stale persisted IDs.
- Ran the sibling-bug audit across the obvious state-consistency hotspots in the browser chrome, sidebar, tab bar, command palette, and shortcut paths.
- Validation: `cargo check` passed; `tsc --noEmit` passed with `node_modules\.bin\tsc.cmd`.
- Notes: no `TASKS.md` entry exactly matched this fix set, so the backlog was left unchanged.

## CHANGES THIS SESSION (Session 14 — v1.2.0 → v1.3.0)

### Sidebar Toggle
- **WorkspaceSwitcher.tsx**: Added ☰ button at top of icon strip. Uses `PanelLeftClose` icon when sidebar is open, `PanelLeft` when closed. Calls `toggleSidebar()` from ui store. Always visible regardless of sidebar state.
- **ui.ts**: No changes needed — `sidebarOpen` and `toggleSidebar` already existed.
- **Sidebar.tsx**: No changes needed — already returns `null` when `!sidebarOpen` (line 147). Flex layout in RootLayout.tsx handles content area expansion.
- **useKeyboardShortcuts.ts**: Added Ctrl+B (and Cmd+B) case that calls `toggleSidebar()`.
- **browser.rs**: New `browser_reposition` command takes `(x, y, width, height)` as f64 logical pixels, calls `set_position` + `set_size` on the browser WebviewWindow. Does NOT navigate or reload.
- **services/browser.ts**: New `repositionWebview(x, y, w, h)` function invokes `browser_reposition`.
- **useWebviewBridge.ts**: New `useEffect` watches `sidebarOpen`. On change, waits 80ms for React layout to settle, then calls `getBounds()` and `repositionWebview()` if a page is loaded.

### Keyboard Shortcut Forwarding from Webview
- **browser.rs**: New `XEVO_SHORTCUT_FORWARD_SCRIPT` constant — IIFE injected into every webview page. Intercepts keydown events (capture phase) for Ctrl+D/K/T/W/R/B/, and Ctrl+Shift+T. Calls `forward_shortcut` Rust command with the shortcut string. Skips editable targets (input/textarea/select/contenteditable).
- **browser.rs**: New `forward_shortcut` command takes `shortcut: String`, emits `xevo://shortcut` event to the main window.
- **useKeyboardShortcuts.ts**: New `useEffect` listens for `xevo://shortcut` Tauri events. Routes each shortcut string to the same handler logic used by the regular keydown handler. Handles: ctrl+d (bookmark), ctrl+k (command palette), ctrl+b (sidebar toggle), ctrl+, (settings panel), ctrl+r (reload), ctrl+t (new tab), ctrl+w (close tab), ctrl+shift+t (reopen closed tab).
- **lib.rs**: `forward_shortcut` and `browser_reposition` registered in invoke_handler (16 → 18 entries).

### Modal Visibility Fix
- **useWebviewBridge.ts**: New `useEffect` watches `commandPaletteOpen` and `shortcutHelpOpen`. When either becomes true AND a page is loaded, calls `hideWebview()`. When both become false, waits 50ms then calls `showWebview(bounds)` with fresh bounds. Prevents modals from appearing behind the OS-level webview window.

### Files changed
- `src/components/sidebar/WorkspaceSwitcher.tsx` — added PanelLeft/PanelLeftClose imports, sidebarOpen/toggleSidebar state, toggle button
- `src/hooks/useKeyboardShortcuts.ts` — added Ctrl+B shortcut, listen import, xevo://shortcut event listener useEffect
- `src/hooks/useWebviewBridge.ts` — added repositionWebview/showWebview imports, useUIStore import, sidebar toggle reposition effect, modal hide/show effect
- `src/services/browser.ts` — added repositionWebview function
- `src-tauri/src/commands/browser.rs` — added XEVO_SHORTCUT_FORWARD_SCRIPT, browser_reposition command, forward_shortcut command, registered init script
- `src-tauri/src/lib.rs` — registered browser_reposition and forward_shortcut (16 → 18 entries)

### Verification
- `cd src-tauri && cargo check` — clean
- `pnpm tsc --noEmit` — clean
- invoke_handler count: 18

## WORKTREE SNAPSHOT (2026-06-25)
```text
.gitignore
.vscode\extensions.json
AGENTS.md
ARCHITECTURE.md
DEVBROWSER_PROJECT_GUIDE.md
ISSUE.md
README.md
TASKS.md
PROJECT_STATE.md
XEVO_FRONTEND.md
components.json
implementation_plan.md
index.html
package.json
pnpm-workspace.yaml
repo-structure.md
tsconfig.json
tsconfig.node.json
vite.config.ts
public\tauri.svg
public\vite.svg
src\App.tsx
src\index.css
src\main.tsx
src\vite-env.d.ts
src\types\index.ts
src\lib\bookmarkAction.ts
src\lib\utils.ts
src\lib\workspaceTabs.ts
src\services\browser.ts              ← per-tab IPC: createTab/activateTab/closeTabWebview/navigateTab
                                       + hideTabWebview/showTabWebview + tabId-aware events
                                       + onNetworkEntry, updateHeaderRules, evalInspector, inspectorMutate
src\stores\apiHistory.ts
src\stores\bookmarks.ts
src\stores\headers.ts                 ← NEW: workspace-scoped header injection rules (persisted)
src\stores\history.ts
src\stores\inspector.ts               ← NEW: inspector panel state (session-only)
src\stores\notes.ts
src\stores\network.ts                 ← NEW: network log entries per tab (session-only, 200 limit)
src\stores\servers.ts
src\stores\settings.ts
src\stores\tabs.ts
src\stores\ui.ts
src\stores\workspaces.ts
src\hooks\useKeyboardShortcuts.ts    ← closeTabWebview on Ctrl+W
src\hooks\usePortScanner.ts
src\hooks\useWebviewBridge.ts        ← tab-per-webview: activateTab on switch, createTab on first nav
                                       + hideTabWebview/showTabWebview for overlays
src\components\CommandPalette.tsx
src\components\ShortcutHelp.tsx
src\components\Toast.tsx
src\components\browser\AddressBar.tsx
src\components\browser\BrowserChrome.tsx
src\components\browser\ContentArea.tsx
src\components\browser\FindBar.tsx   ← passes active tabId to find commands
src\components\browser\LoadingBar.tsx
src\components\browser\StatusBar.tsx
src\components\browser\TabBar.tsx    ← closeTabWebview on tab close
src\components\browser\TabContextMenu.tsx ← closeTabWebview on close/close-others
src\components\browser\TabItem.tsx
src\components\browser\Toolbar.tsx
src\components\browser\WindowControls.tsx
src\components\overlay\OverlayPanel.tsx
src\components\panels\ApiTester.tsx
src\components\panels\Base64Tool.tsx
src\components\panels\HeadersPanel.tsx    ← NEW: custom header injection rule management
src\components\panels\HomePage.tsx
src\components\panels\InspectorPanel.tsx  ← NEW: meta/cookies/storage inspector with auto-refresh
src\components\panels\JwtDecoder.tsx
src\components\panels\NetworkPanel.tsx    ← NEW: real-time network request log
src\components\panels\NotesNotepad.tsx
src\components\panels\SettingsPanel.tsx
src\components\sidebar\ApiTesterPanel.tsx
src\components\sidebar\BookmarksPanel.tsx
src\components\sidebar\HistoryPanel.tsx
src\components\sidebar\NotesSidebarPanel.tsx
src\components\sidebar\Sidebar.tsx
src\components\sidebar\WorkspaceContextMenu.tsx
src\components\sidebar\WorkspaceSwitcher.tsx
src\components\ui\badge.tsx
src\components\ui\button.tsx
src\components\ui\input.tsx
src\components\ui\separator.tsx
src\components\ui\tooltip.tsx
src-tauri\Cargo.toml                 ← tauri features = ["unstable"]
src-tauri\Cargo.lock
src-tauri\tauri.conf.json
src-tauri\build.rs
src-tauri\capabilities\default.json
src-tauri\icons\                     (18 icon files)
src-tauri\src\main.rs
src-tauri\src\lib.rs                 ← BrowserState { active_tab_label } + 26 invoke handlers
src-tauri\src\commands\mod.rs
src-tauri\src\commands\browser.rs    ← per-tab commands: create_tab, activate_tab, close_tab,
                                       navigate_tab, hide_tab, show_tab, set_bounds, go_back,
                                       go_forward, reload, stop_loading, find, find_next,
                                       stop_find, find_callback, set_theme, reposition,
                                       update_tab_info, bookmark_request, forward_shortcut,
                                       network_log_entry, browser_update_header_rules,
                                       browser_eval_inspector, inspector_data, inspector_mutate
                                       + BROWSER_INIT_SCRIPT with fetch/XHR monkeypatching
                                       + header injection + network monitoring
src-tauri\src\commands\ports.rs
src-tauri\gen\schemas\              (4 generated schema files)
```

## Session 19 (v1.7.1 — Windows webview boundary inset) — DONE

- [x] Task 80: Frontend-only webview boundary inset
  - [x] 80.1 — `src/hooks/useWebviewBridge.ts`: added a Windows-only `BROWSER_EDGE_INSET` and applied it inside `getBounds()` so every browser-webview path inherits the same inset
  - [x] 80.2 — Inset is centralized in the shared bounds calculation, after overlay-height reduction, so navigation / tab switching / resize sync / overlay resize / show-hide all remain consistent
  - [x] 80.3 — Existing 5px relayout-jitter threshold left unchanged; Rust commands and layout tree untouched
  - [ ] 80.4 — Runtime GUI verification: pending human-run `pnpm tauri dev`
```text
Xevo/
├── .gitignore
├── .vscode/
│   └── extensions.json
├── AGENTS.md
├── ARCHITECTURE.md
├── README.md
├── TASKS.md
├── PROJECT_STATE.md
├── repo-structure.md
├── components.json
├── index.html
├── package.json
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
├── tsconfig.json
├── tsconfig.node.json
├── vite.config.ts
│
├── public/
│   ├── tauri.svg
│   └── vite.svg
│
├── src/
│   ├── App.tsx                            ← compact mode class toggle on documentElement
│   ├── main.tsx
│   ├── index.css                          ← @import Google Fonts (DM Sans + JetBrains Mono)
│   │                                        +[data-theme="dark"] + [data-theme="light"]
│   │                                        +.xevo-compact class overrides
│   │                                        +input focus ring + scrollbar 4px
│   ├── vite-env.d.ts
│   ├── types/
│   │   └── index.ts                       ← Tab, Workspace, LocalServer, AppSettings, PanelId
│   │                                        (includes "jwt" | "base64"; Tab has loadTime)
│   ├── lib/
│   │   ├── utils.ts                       ← cn() helper
│   │   ├── workspaceTabs.ts
│   │   └── bookmarkAction.ts
│   │
│   ├── services/
│   │   └── browser.ts                     ← IPC service: navigate/show/hide/back/fwd/reload
│   │                                        + stopLoading, find, bookmark request events
│   │                                        + onUrlChanged / onLoadingChanged / onTabInfoChanged
│   │                                        + repositionWebview
│   │
│   ├── stores/
│   │   ├── tabs.ts                        ← tabs + lastClosedTab + addTab/closeTab/updateTab/
│   │   │                                    duplicateTab/pinTab/setLoading/setFavicon
│   │   │                                    recordNavigation/popBack/popForward/clearLastClosedTab
│   │   ├── workspaces.ts                  ← workspaces + activeWorkspaceId (persist)
│   │   │                                    addTabToWorkspace/removeTabFromWorkspace/setActiveTab
│   │   ├── settings.ts                    ← settings + update / setTheme / setSearchEngine /
│   │   │                                    setCustomSearchUrl / setPortScanInterval /
│   │   │                                    setCompactMode / reset
│   │   ├── bookmarks.ts                   ← workspace-scoped bookmarks (persist)
│   │   ├── ui.ts                          ← sidebarOpen, sidebarWidth, activePanel,
│   │   │                                    commandPaletteOpen, settingsOpen,
│   │   │                                    settingsPanelOpen, shortcutHelpOpen, findOpen
│   │   └── servers.ts                     ← live localhost server scan results
│   │
│   ├── hooks/
│   │   ├── useWebviewBridge.ts            ← browser WebviewWindow bridge
│   │   │                                    + loadStartRef for load time tracking
│   │   │                                    + stopLoading in bridge return
│   │   │                                    + onUrlChanged/onLoadingChanged/onTabInfoChanged
│   │   │                                    + useMemo'd bridge return for stable ref
│   │   │                                    + sidebar toggle reposition effect
│   │   │                                    + modal hide/show effect (command palette, shortcut help)
│   │   ├── useKeyboardShortcuts.ts        ← Ctrl+K, Ctrl+?, Ctrl+F, Ctrl+D, Ctrl+Shift+T,
│   │   │                                    Alt+←/→, Ctrl+R, Ctrl+1-9, Escape (stop loading),
│   │   │                                    Ctrl+Tab, Ctrl+Shift+Tab, Ctrl+, Ctrl+B
│   │   │                                    + xevo://shortcut event listener (webview forwarded)
│   │   └── usePortScanner.ts
│   │
│   └── components/
│       ├── CommandPalette.tsx             ← Ctrl+K centered overlay with fuzzy search
│       ├── ShortcutHelp.tsx               ← Ctrl+? centered modal with all shortcuts
│       │                                    + 25 shortcuts (incl. Ctrl+Shift+T, Esc)
│       ├── Toast.tsx
│       ├── layout/
│       │   └── RootLayout.tsx             ← flex-col: content + StatusBar at bottom
│       │                                    + reads tab isLoading/loadTime/url for StatusBar
│       ├── sidebar/
│       │   ├── WorkspaceSwitcher.tsx      ← active: white tint bg, settings border
│       │   │                                + sidebar toggle button (PanelLeft/PanelLeftClose)
│       │   ├── Sidebar.tsx                ← 8 panel icons (32px, white accent active state)
│       │   │                                servers, bookmarks, history, network, api, notes, jwt, base64
│       │   ├── BookmarksPanel.tsx
│       │   └── ApiTesterPanel.tsx
│       ├── browser/
│       │   ├── TabBar.tsx                 ← Ctrl+T / Ctrl+W listeners + context-menu state
│       │   ├── TabItem.tsx                ← favicon (white-opacity placeholder) + Pin icon + drag-to-reorder
│       │   ├── TabContextMenu.tsx         ← right-click menu via Portal
│       │   ├── AddressBar.tsx             ← URL input + Ctrl+L + back/fwd/reload
│       │   ├── BrowserChrome.tsx          ← TabBar + AddressBar + LoadingBar + ContentArea + FindBar
│       │   ├── LoadingBar.tsx             ← 2px CSS-animated progress bar
│       │   ├── FindBar.tsx                ← Ctrl+F search bar (fixed-positioned top-right)
│       │   ├── StatusBar.tsx              ← 20px bottom bar: load time (no ✓), origin, hovered URL
│       │   └── ContentArea.tsx            ← child webview host + HomePage when no URL
│       ├── panels/
│       │   ├── SettingsPanel.tsx          ← theme, search engine, scan interval, compact mode
│       │   ├── HomePage.tsx               ← landing page: search, live servers, bookmarks
│       │   ├── ApiTester.tsx              ← Postman-style API tester panel
│       │   ├── JwtDecoder.tsx             ← JWT decode: header/payload/signature/expiry
│       │   └── Base64Tool.tsx             ← Base64 encode/decode with URL-safe toggle
│       └── ui/
│           ├── badge.tsx
│           ├── button.tsx
│           ├── input.tsx
│           ├── separator.tsx
│           └── tooltip.tsx
│
└── src-tauri/
    ├── Cargo.toml                         ← tauri features = ["unstable"]
    ├── Cargo.lock
    ├── tauri.conf.json
    ├── build.rs
    ├── capabilities/
    │   └── default.json
    ├── icons/                             (18 icon files)
    └── src/
        ├── main.rs
        ├── lib.rs                         ← 18 invoke handlers
        └── commands/
            ├── mod.rs
            ├── browser.rs                 ← 13 commands + ensure_browser_window helper
             │                                + BROWSER_INIT_SCRIPT + XEVO_FIND_SCRIPT
             │                                + XEVO_BOOKMARK_SCRIPT + XEVO_SHORTCUT_FORWARD_SCRIPT
             │                                + browser_stop_loading + browser_reposition
             │                                + forward_shortcut
            └── ports.rs
```

## CHANGES THIS SESSION (v0.9.4 → v0.9.5)

### Tab-switch race condition — FINAL fix via unique webview labels
**Why v0.9.4's 50ms delay wasn't enough:** the previous fix was a band-aid. WebView2's label-registry update latency is hardware-dependent, and on the user's machine 50ms was not enough. The symptom ("URL changes but webview stays on old page") persisted through three sessions because the root cause was never addressed — the close-vs-add race with a fixed label is fundamentally fragile.

**Root fix:** each new webview is given a UNIQUE label (`browser-1`, `browser-2`, ...) from a monotonically-increasing counter stored in `BrowserState.label_counter`. The new webview is added FIRST, then the old one is closed. Because the labels are always different, there is no race with WebView2's label-registry update — the old webview can be closed lazily in the background.

**State changes:** `BrowserState` gained two fields: `current_label: Mutex<Option<String>>` and `label_counter: Mutex<u64>`. `get_browser_webview` now reads the current label from state. `create_or_recreate_browser_webview` generates a new label, updates `state.current_label` BEFORE the add (so concurrent `get_browser_webview` calls find the new label), and closes the old webview AFTER the add succeeds.

**Removed:** the 50ms `tokio::time::sleep` (no longer needed), the `BROWSER_LABEL` const (no longer used), and the 5px threshold in `browser_set_bounds` (the entire command is now a no-op).

**`browser_set_bounds` is now a no-op.** Window-resize-driven webview repositioning is disabled. The webview stays at the bounds from the last `create_or_recreate`. To refresh bounds, trigger a re-navigation (e.g. press Enter on the address bar) — that calls `browser_navigate` with fresh bounds from `getBounds()`. This eliminates the stale-`state.last_url` issue that occurred when rapid `syncBounds` calls would read the old URL from state and recreate the webview with the wrong page.

### Files changed
- `src-tauri/src/lib.rs`:
  - `BrowserState` extended with `current_label: Mutex<Option<String>>` and `label_counter: Mutex<u64>`. Both initialized in `.manage(...)`.
- `src-tauri/src/commands/browser.rs`:
  - Removed `const BROWSER_LABEL: &str = "browser";` — no longer used.
  - `get_browser_webview`: now reads `state.current_label` to find the active webview's label and looks up by that label. Returns `None` if no label is recorded yet.
  - `create_or_recreate_browser_webview`: generates a new unique label (`browser-N`) from the counter, updates `state.current_label` BEFORE the add, then calls `parent.add_child(WebviewBuilder::new(&new_label, ...), pos, size)`. AFTER the add succeeds, closes the old webview by its old label. The 50ms `tokio::time::sleep` is removed.
  - `browser_set_bounds`: now a no-op. Takes the same parameters but ignores them and returns `Ok(())`. Window resize will not reposition the webview.

### Verification
- `cd src-tauri && cargo check` — clean
- `pnpm tsc --noEmit` — clean
- User should run `pnpm tauri dev` and verify:
  - Tab 1 (github) → Tab 2 (vercel): webview updates to vercel
  - Close Tab 1: webview updates to next active tab
  - Rapid tab switching: each tab's page is correct
  - The video that was "playing" in the old tab is now gone (the old webview is closed)
  - No "stuck on old page" behavior
  - Window resize: webview stays at its current position (slight misalignment acceptable)

## CHANGES THIS SESSION (v0.9.5 → v0.9.6)

### Architectural pivot: child webview → `WebviewWindow` with `parent`
**Why all of v0.9.2 through v0.9.5 failed:** every prior fix targeted a "race condition" between `webview.close()` and the next `add_child`, but the actual error string — `current webview is not a WebviewWindow` — was the unambiguous tell that this is a **Tauri 2 design limitation**, not a race. `Window::add_child` internally calls `self.window().set_bounds(...)` on the newly-created child webview to position it. Child webviews are not `WebviewWindow`s in Tauri 2, so that internal call returns the error. Unique labels, 50ms delays, and 5px thresholds could not fix this because the error fires during `add_child` itself, not in any subsequent operation.

**The real fix:** switch from `Window::add_child` to `WebviewWindowBuilder` with `parent`. The resulting window is a real `WebviewWindow` (not a child webview), so `set_position` / `set_size` / `navigate` / `eval` all work natively. Tauri uses the `parent` argument for z-order (child above parent) and lifecycle (child closes when parent closes), but the child is otherwise a regular top-level OS window with absolute screen coordinates.

### Single persistent `WebviewWindow` (no more close-and-recreate)
- `ensure_browser_window(app, main_window, url, x, y, w, h)`: checks `app.get_webview_window("browser")`. If `Some`, calls `set_position(Logical)` + `set_size(Logical)` + `navigate()`. If `None`, builds a new `WebviewWindow` via `WebviewWindowBuilder`.
- **No more `BrowserState`.** All five previous fields (`created`, `last_url`, `last_bounds`, `current_label`, `label_counter`) are obsolete — the persistent WebviewWindow + the OS-managed parent/child relationship carry everything that was previously stored in state.
- **No more unique labels / label_counter.** Single fixed label `"browser"`, looked up via `app.get_webview_window("browser")` whenever needed.
- **No more 50ms close-settle delay.** No close-and-add race because there's no close.

### Coordinate system: logical (CSS) pixels
- `WebviewWindowBuilder::position(x, y)` and `.inner_size(w, h)` take `f64` **logical** pixels. `WebviewWindow::set_position(Position::Logical)` / `set_size(Size::Logical)` likewise. The OS scales to physical via DPI. No `scale_factor()` multiplication in Rust.
- Frontend `getBounds()` returns screen-relative CSS pixels: `rect.left + window.screenX, rect.top + window.screenY + (outerHeight - innerHeight)`. The `outerHeight - innerHeight` term is the title bar (OS chrome) height — needed because the Tauri main window has native decorations, so the WebView2 viewport starts BELOW the title bar but `window.screenY` reports the OS window's top-left (above the title bar).
- Removed: the `use crate::BrowserState;` import, the `get_browser_webview` helper, the `create_or_recreate_browser_webview` helper, the `tokio::time::sleep(50ms)`, the `PhysicalPosition` / `PhysicalSize` imports, the scale_factor multiplications in `browser_navigate` / `set_bounds` / `show`.

### Free side benefits of the new architecture
- **Back/forward history now works.** The persistent `WebviewWindow` keeps its `window.history` across tab switches and navigations. `browser_go_back` / `browser_go_forward` call `wv.eval("window.history.back()")` / `eval("window.history.forward()")` on the same window. Previously, history was destroyed on every close-and-recreate cycle.
- **Window resize now works.** `browser_set_bounds` calls `set_position(Logical)` + `set_size(Logical)` on the live `WebviewWindow` — Tauri 2's `set_bounds` bug only affected child webviews, not real `WebviewWindow`s. The 5px threshold in `syncBounds` is kept as IPC traffic optimization (filters subpixel noise).
- **First-nav lag is paid once.** The WebviewWindow is created on the first navigation and reused for all subsequent ones. No recreation per navigation.

### Main window drag → browser window follows
- `main_window.on_window_event(...)` is registered on first build with a `WindowEvent::Moved` filter. When the main window is dragged, the browser window's position is updated to match. Without this, the browser window would stay at its initial screen position even if the user moves the main window — visually broken. The `Moved` event delivers a `PhysicalPosition`; we divide by `scale_factor()` to convert back to logical so the WebviewWindow receives the same units it was built with.
- Registered only on the first build (subsequent `ensure_browser_window` calls hit the `Some` branch and skip registration).

### Frontend simplifications (`useWebviewBridge.ts`)
- `getBounds()`: added title-bar offset (`window.outerHeight - window.innerHeight`) to convert content-area-local to screen CSS pixels. Also documents the unit reasoning.
- Tab-switch `useEffect`: removed the `tryNavigate(attempt)` recursive retry (3×100ms). With no recreate race, one attempt is enough. Kept the 100ms initial `setTimeout` for layout settling. Reduced the post-nav `isSwitchingTabRef` re-enable from 800ms to 500ms (with the persistent WebviewWindow, the navigation's `on_navigation` event fires faster, so the suppress window can be shorter).
- `navigate()`: removed the `console.error('[xevo] navigate failed:', e)` catch (silent failure). The `isSwitchingTabRef` is now only used in the tab-switch useEffect (the navigate() function no longer touches it — navigate is called from the address bar, not from tab switching, and the address bar already updates the tab URL optimistically).
- `syncBounds()` 5px threshold and `isSwitchingTabRef` retained — they remain useful even with the new architecture (threshold = IPC optimization, ref = suppress URL echo from our own navigations).

### `AddressBar.tsx` cleanup
- Removed the leftover `console.log('[xevo] handleNavigate called with raw:', ...)` at line 54 (originally added as a Bug B diagnostic in v0.9.1, claimed removed in v0.9.3, but was actually still in the file).
- Removed the surrounding comment block about "Keep the address bar focused after navigation so the user can immediately type the next URL" — no longer needed because the bug it documented (Bug B) is fully fixed by the persistent WebviewWindow architecture.

### Files changed
- `src-tauri/src/lib.rs`: `BrowserState` struct and all fields removed. `.manage(BrowserState { ... })` removed. `use std::sync::Mutex;` removed. `.invoke_handler` entries unchanged.
- `src-tauri/src/commands/browser.rs`: full rewrite of the helper and the four stateful commands (`browser_navigate`, `browser_set_bounds`, `browser_show`, `browser_hide`). The five stateless commands (`browser_go_back`, `browser_go_forward`, `browser_reload`, `browser_close`, `update_tab_info`) and the `BROWSER_INIT_SCRIPT` / `resolve_url` constants/helper are unchanged in behavior. New imports: `WebviewWindowBuilder`, `LogicalPosition`, `LogicalSize`, `Position`, `Size`, `WebviewUrl`, `WindowEvent`. Removed imports: `PageLoadEvent` is now imported via `use tauri::webview::PageLoadEvent` (it was already there, just kept), `PhysicalPosition`, `PhysicalSize`, `std::time::Duration` retained.
- `src/hooks/useWebviewBridge.ts`: `getBounds()` adds title-bar offset and updates the explanatory comment to mention the new screen-relative CSS pixel semantics. Tab-switch useEffect simplifies from `tryNavigate(attempt)` recursion to a single `setTimeout(100) → navigateWebview` call. `navigate()` removes the `console.error` catch. All other logic unchanged.
- `src/components/browser/AddressBar.tsx`: removed leftover `console.log` and surrounding 5-line comment block at line 54.

### Verification
- `cd src-tauri && cargo check` — clean (only warning was a `Rect` import that I no longer use, fixed in the rewrite)
- `pnpm tsc --noEmit` — clean
- User should run `pnpm tauri dev` and verify:
  - First navigation (`google.com`): webview appears at content area, no errors in console
  - Second navigation (`github.com`): URL bar updates, page changes immediately, no "stuck on old page"
  - Tab switching: page updates to the new tab's URL
  - **Back/Forward buttons in the address bar (Alt+← / Alt+→): now actually work** (was always broken)
  - **Window resize**: WebviewWindow content area resizes to match (was broken since v0.9.3)
  - Switch to non-browser tab: WebviewWindow hides
  - Switch back to browser tab: WebviewWindow shows, **same page is still there** (history preserved across hide/show)
  - **Drag the main window**: browser window follows (new behavior — was always misaligned after drag)
  - Close the main window: WebviewWindow closes automatically (Tauri parent behavior)

## CHANGES THIS SESSION (v0.9.3 → v0.9.4)

### Tab-switch race condition — fixed via 50ms close-settle delay + retry-based getBounds
**Root cause (from runtime):** `webview.close()` is async — it sends a close request to the WebView2 process, but the OS-level webview registry is not updated immediately. When `add_child` was called right after with the same label (`"browser"`), Tauri could fail with "label already in use" or a similar error. The Rust function returned an error, the JS catch logged it, and the old webview remained visible. The JS state updated normally (URL bar changed), producing the symptom "URL changes but screen stays on old page".

**Rust fix:** `src-tauri/src/commands/browser.rs` `create_or_recreate_browser_webview` is now `async fn`. After `webview.close()` returns, it does `tokio::time::sleep(Duration::from_millis(50)).await` before `add_child`. Gives WebView2 time to fully unregister the closed webview's label. The three callers (`browser_navigate`, `browser_set_bounds`, `browser_show`) now `.await` the call.

**JS fix:** `src/hooks/useWebviewBridge.ts` tab-switch `useEffect` now uses a `tryNavigate(attempt)` recursive function. If `getBounds()` returns null (rect < 10px because the flex layout hasn't settled), retry up to 3 times with 100ms intervals. The initial `setTimeout` was bumped from 50ms to 100ms to give the layout more time on the first attempt. Worst case: 100ms + 3×100ms = 400ms before the webview is recreated, but in practice the first attempt succeeds.

This also handles the case where a tab is closed and the next active tab is selected — the same useEffect fires, the same retry logic applies.

### Files changed
- `src-tauri/src/commands/browser.rs`:
  - `create_or_recreate_browser_webview`: changed `fn` to `async fn`. Added `tokio::time::sleep(Duration::from_millis(50)).await` after the `webview.close()` block. Added an inline comment explaining why.
  - `browser_navigate`: changed call to `create_or_recreate_browser_webview(...).await?;`
  - `browser_set_bounds`: same
  - `browser_show`: same
- `src/hooks/useWebviewBridge.ts`:
  - Tab-switch `useEffect`: replaced the single-shot `setTimeout(50) → if (!bounds) return` with a recursive `tryNavigate(attempt)` function. Initial delay bumped from 50ms to 100ms. Up to 3 retries with 100ms gaps if `getBounds()` returns null.

### Verification
- `cd src-tauri && cargo check` — clean
- `pnpm tsc --noEmit` — clean
- User should run `pnpm tauri dev` and verify:
  - Tab switching updates the webview content (github → vercel)
  - Closing a tab updates the webview to the next active tab's URL
  - Rapid tab switching: each tab's page is correct
  - No "stuck on old page" behavior

## CHANGES THIS SESSION (v0.9.2 → v0.9.3)

### 2px bounds-oscillation loop — fixed via 5px threshold
**Root cause (confirmed at runtime):** Adding a child webview to the main window causes WebView2 to re-layer the chrome, which shifts the content area's bounding rect by ~2px (subpixel). ResizeObserver fired on this shift and called `syncBounds → setWebviewBounds → create_or_recreate`, which then triggered another re-layer shift, which fired ResizeObserver again — an infinite close-and-recreate loop oscillating between two near-identical bounds (e.g. phys y: 100 ↔ 102, height: 1012 ↔ 1010). Visible symptom: the address bar saw URL-change events firing in rapid succession, looking like the page was being "searched continuously".

**Fix (frontend):** `src/hooks/useWebviewBridge.ts` `syncBounds()` threshold bumped from 1px to 5px on all four bounds. The 2px subpixel shift is now filtered out before the backend call. 5px is 2.5× the observed oscillation — safe margin, still catches real changes (sidebar toggle, window resize > 5px).

**Fix (backend):** `src-tauri/src/commands/browser.rs` `browser_set_bounds` now compares new phys against `state.last_bounds` (new `Mutex<Option<(i32, i32, u32, u32)>>` field on `BrowserState`). If all four components are within 5px, it returns early without calling `create_or_recreate`. Defense-in-depth in case the frontend threshold is ever bypassed.

### Duplicate `showWebview` calls removed
**Problem:** The 50ms-delayed `setTimeout → showWebview(freshBounds)` block at the end of `navigate()` was redundant — `navigateWebview` already creates the webview at the content area bounds. The duplicate call triggered a second `create_or_recreate` 50ms later, which raced with the first `close+add` and surfaced as "tab switch navigate failed: current webview is not a WebviewWindow" in the Xevo console (the rapid succession of `add_child` calls sometimes hit the race where the previous label wasn't yet unregistered).

**Fix:** Removed the `setTimeout` block in `navigate()`. Removed the `.then(() => showWebview(bounds))` chain in the tab-switch `useEffect`. Each navigation / tab switch now triggers exactly one `create_or_recreate`.

`showWebview` import removed from `useWebviewBridge.ts` (no longer used). The Tauri command `browser_show` stays in place as a no-op defensive entry point.

### All diagnostic logs removed
**Frontend (`useWebviewBridge.ts`):**
- `console.log('[xevo] navigate() called with url:', ...)` — removed
- `console.log('[xevo] bounds:', ...)` — removed
- `console.log('[xevo] tab switch to:', ...)` — removed

**Backend (`browser.rs`):**
- `println!("[xevo] browser_navigate: ...")` — removed
- `eprintln!("[xevo] create_or_recreate: ...")` — removed

### Files changed
- `src/hooks/useWebviewBridge.ts`:
  - `syncBounds()`: threshold `< 1` → `< 5` on all four bounds. Added comment explaining the WebView2 subpixel re-layer shift.
  - `navigate()`: removed the 50ms-delayed `showWebview` block. Removed two diagnostic `console.log` lines.
  - Tab-switch `useEffect`: removed the diagnostic `console.log`. Removed the `.then(() => showWebview(bounds))` chain.
  - Removed `showWebview` from the import (no longer used).
- `src-tauri/src/lib.rs`:
  - `BrowserState` extended with `last_bounds: Mutex<Option<(i32, i32, u32, u32)>>`. Initialized as `Mutex::new(None)` in `.manage(...)`.
- `src-tauri/src/commands/browser.rs`:
  - `create_or_recreate_browser_webview`: removed the `[xevo] create_or_recreate:` eprintln.
  - `browser_navigate`: removed the `[xevo] browser_navigate:` println. Added a `state.last_bounds` write after the existing `state.last_url` write.
  - `browser_set_bounds`: added a 5px threshold check against `state.last_bounds`; if all four components are within 5px, return early. Otherwise, update `state.last_bounds` and call `create_or_recreate`. Inline comment explains the rationale.
  - `browser_show`: added a `state.last_bounds` write before the `create_or_recreate` call (so the next `set_bounds` call has a fresh baseline).

### Verification
- `cd src-tauri && cargo check` — clean
- `pnpm tsc --noEmit` — clean (one transient error from unused `showWebview` import, fixed immediately)
- User should run `pnpm tauri dev` and verify:
  - First navigation: webview appears in bounds, NO oscillation
  - Second navigation: webview updates to new URL, NO oscillation
  - Tab switching: webview swaps to new tab's URL cleanly
  - Window resize > 5px: webview re-creates at new bounds (acceptable)
  - Window resize < 5px: no re-creation (sub-perceptual, acceptable)
  - No more "tab switch navigate failed" error

## CHANGES THIS SESSION (v0.9.1 → v0.9.2)

### Bug B (second navigation doesn't update) — final fix via close-and-recreate
**Root cause (confirmed at runtime):** Tauri 2 child webviews (created via `Window::add_child`) cannot have their bounds updated post-creation. The eval-based URL change worked, but a subsequent window resize / tab switch / second navigation hit `Webview::set_bounds` which internally calls `self.window()` and returns `current webview is not a WebviewWindow`. The first URL appeared stuck because the new webview was created with the original (stale) bounds, and bounds updates silently failed afterward.

**Fix:** close-and-recreate. Every navigation / bounds change / show cycle closes the existing child webview and calls `parent.add_child(...)` with a fresh `WebviewBuilder` carrying the current URL and the new physical bounds. Centralized in the new `create_or_recreate_browser_webview` private helper in `src-tauri/src/commands/browser.rs`.

**Trade-off accepted:** back/forward history is reset on every cycle. The prior single-webview architecture already lost history on every tab switch, so this is no worse. The proper fix is per-tab webviews (Session 10 Option B).

### Files changed
- `src-tauri/src/lib.rs`:
  - `BrowserState` extended with `last_url: Mutex<Option<String>>`. Both fields initialized in `.manage(...)`.
- `src-tauri/src/commands/browser.rs`:
  - Added private helper `create_or_recreate_browser_webview(app, url, px, py, pw, ph)` that closes the existing webview (if any) and calls `parent_window.add_child(...)` with the new URL and physical bounds. Logs `[xevo] create_or_recreate: url=... phys=(...)` to stderr.
  - `browser_navigate`: removed the "already created" eval branch. Always routes through `create_or_recreate_browser_webview`. Writes resolved URL to `state.last_url`.
  - `browser_set_bounds`: reads `state.last_url` and recreates the webview at the new physical bounds. If `last_url` is None (no prior navigation), the call is a no-op.
  - `browser_show`: reads `state.last_url` and recreates the webview at the target bounds. If no URL is recorded, closes any stale webview (defensive).
  - `browser_hide`: just calls `webview.close()`. URL is preserved in `state.last_url`.
  - `on_navigation` callback now also writes the navigated URL to `state.last_url`, so redirect destinations survive hide→show cycles.
  - Removed unused `Rect` import.

### Diagnostic output the user should see on next run
For the first navigation (e.g. `google.com`):
```
[xevo] handleNavigate called with raw: google.com → resolved: https://google.com
[xevo] navigate() called with url: https://google.com
[xevo] bounds: {x: 258, y: 80, width: 1022, height: 720}
[xevo] browser_navigate: url=https://google.com css=(258,80,1022,720) scale=1.25 phys=(322,100,1277,900)
[xevo] create_or_recreate: url=https://google.com phys=(322,100,1277,900)
```

For the second navigation (e.g. `github.com`):
```
[xevo] handleNavigate called with raw: github.com → resolved: https://github.com
[xevo] navigate() called with url: https://github.com
[xevo] bounds: {x: 258, y: 80, width: 1022, height: 720}
[xevo] browser_navigate: url=https://github.com css=(258,80,1022,720) scale=1.25 phys=(322,100,1277,900)
[xevo] create_or_recreate: url=https://github.com phys=(322,100,1277,900)
```

For a tab switch that triggers `browser_set_bounds` or `browser_show`:
```
[xevo] create_or_recreate: url=https://github.com phys=(322,100,1277,900)
```

## CHANGES THIS SESSION (v0.9 → v0.9.1)

### Bug A (webview overflow / mis-sizing)
**Root cause:** On a 125% DPI display, `Window::scale_factor()` returns `1.25`. The previous code passed raw CSS pixels (e.g. `720`) as `PhysicalSize`, which made the webview only 720 physical pixels tall — far smaller than the 900 physical pixel content area. (The original "overflow" symptom from the spec was based on the `Logical` code; the `Physical` code I shipped in v0.9 caused an underflow instead.)

**Fix:** Multiply CSS bounds by `scale_factor()` in Rust before constructing `PhysicalPosition`/`PhysicalSize`.

### Files changed
- `src-tauri/src/commands/browser.rs`:
  - `browser_navigate`: added `let sf = window.scale_factor().unwrap_or(1.0);` at the top. Computes `px = (x * sf) as i32`, `py = (y * sf) as i32`, `pw = ((width * sf) as u32).max(1)`, `ph = ((height * sf) as u32).max(1)`. Uses these in the `add_child` call, the `set_browser_visible` call, and the diagnostic println.
  - `browser_set_bounds`: same multiplication. Gets scale factor from `parent.scale_factor()`.
  - `browser_show`: same multiplication. Gets scale factor from `app.get_window("main")?.scale_factor()`.
  - `browser_hide`: passes raw off-screen constants `(-9999, -9999, 1, 1)` (no scaling needed).
  - `set_browser_visible`: signature changed to accept already-physical values (`physical_x: i32, physical_y: i32, physical_width: u32, physical_height: u32`). No more multiplication inside.
  - Renamed parameter `_window` → `window` on `browser_navigate` so the `window.scale_factor()` call compiles.
  - Added eprintln diagnostics: scale_factor, physical bounds, webview label, and which branch (first / already_created) was taken.

### Bug B (navigation not updating on second URL)
**Root cause:** `AddressBar.handleNavigate` called `inputRef.current?.blur()` after the first navigation. The address bar lost focus, and the user's second Enter press was captured by the webview (now showing Google) instead of the address bar. The Rust `browser_navigate` function was never invoked on the second attempt.

**Fix:** Removed the blur call. The address bar stays focused after navigation, so the user can immediately type and submit the next URL.

### Files changed
- `src/components/browser/AddressBar.tsx`:
  - `handleNavigate`: removed `inputRef.current?.blur()`. Added a comment explaining why.
  - Added diagnostic `console.log('[xevo] handleNavigate called with raw:', raw, '→ resolved:', url)`.

### Diagnostic output the user should see on next run
For the first navigation (e.g. `google.com`):
```
[xevo] handleNavigate called with raw: google.com → resolved: https://google.com
[xevo] navigate() called with url: https://google.com
[xevo] bounds: {x: 258, y: 80, width: 1022, height: 720}
[xevo] browser_navigate: url=https://google.com css=(258,80,1022,720) scale=1.25 phys=(322,100,1277,900)
[xevo] first navigation: add_child with phys=(322,100,1277,900)
```

For the second navigation (e.g. `github.com`):
```
[xevo] handleNavigate called with raw: github.com → resolved: https://github.com
[xevo] navigate() called with url: https://github.com
[xevo] bounds: {x: 258, y: 80, width: 1022, height: 720}
[xevo] browser_navigate: url=https://github.com css=(258,80,1022,720) scale=1.25 phys=(322,100,1277,900)
[xevo] already_created branch: webview label=browser
```

## NEXT SESSION PRIORITIES

**Architecture is LOCKED at v0.9.11** (Session 10.6 confirmed no migration path):
- The frontend `onMoved` listener is the best available drag-sync mechanism in Tauri 2.x
- Tauri 2.11.2 is the latest stable; child-webview-Windows bug is "not planned" (Issue #10079)
- A residual ~5-10ms drag lag is accepted; do not invest more time on it

**Option A (STRONGLY RECOMMENDED NOW):** GitHub push + README
   App is now genuinely compelling:
   - Free + open source vs Polypane's $9/mo
   - JSON viewer built-in (better than Chrome's extension approach)
   - Light/Dark/System theme
   - Per-tab browsing history
   - Live localhost port scanner
   - Keyboard-first (Ctrl+K, Ctrl+T, Ctrl+1-9, etc.)
   Write a real README with the above pitch, a screenshot, build
   instructions, and the roadmap. Tag v1.0, push to GitHub.

**Option B:** Tab-per-WebviewWindow (one real browser window per tab)
   This is the proper architecture for true tab isolation.
   Each tab = its own WebviewWindow(parent=main), shown/hidden on switch.
   Back/Forward works natively per tab. Memory per tab increases.
   Estimated effort: one full session.

**Option C:** API Tester panel
   A basic Postman-style panel in the sidebar.
   Method selector (GET/POST/PUT/DELETE), URL input, body editor,
   response viewer with JSON formatting.
   Built entirely in React, calls fetch() directly.

**Option D (major refactor, NOT recommended):** Single-webview architecture
   Render the entire app UI (sidebar, tabs, address bar) inside a single full-window webview using absolutely-positioned divs. Would eliminate the position-sync problem entirely but requires rewriting ~80% of the React layout. Estimate: 2-3 full sessions. Not justified for a v1.0 launch.

Come back to Claude with this PROJECT_STATE.md to choose and get the next prompt.

## SESSION NOTE (2026-06-06 — Session 10)
- **JSON auto-formatter** — `BROWSER_INIT_SCRIPT` in `src-tauri/src/commands/browser.rs` extended with a `xevoRenderJson()` IIFE function that detects JSON pages (via `document.contentType` or by attempting `JSON.parse(document.body.innerText)`) and replaces the DOM with a dark-themed collapsible tree view, syntax-highlighted (keys blue, strings green, numbers orange, booleans purple, nulls grey), with a toolbar showing URL + size + a Copy button. Truncates arrays/objects at 500 items and caps recursion depth at 8. Real HTML pages are skipped (head with children check). Entirely pure-JS, no Rust changes for runtime.
- **Light + System theme** — `src/index.css` split: `:root { color-scheme: dark; }` is the default; all `--xevo-*` variables now live in `[data-theme="dark"]` and `[data-theme="light"]` blocks with full light-value palette. `src/App.tsx` adds a `useEffect` that reads `theme` from the settings store and sets `document.documentElement[data-theme]` accordingly, with a `matchMedia('(prefers-color-scheme: dark)')` listener for the `system` mode that swaps the attribute when the OS preference changes. `SettingsPanel.tsx` ThemeButton active-state now uses `var(--xevo-tab-active)` for proper contrast in both themes.
- **Per-tab history isolation** — `Tab` type gains `historyBack: string[]` and `historyForward: string[]`. `useTabsStore` gains three actions (`recordNavigation`, `popBack`, `popForward`) that maintain per-tab stacks. `useWebviewBridge.ts` `navigate()` now records the previous URL before navigating, `goBack`/`goForward` pop the stack and re-navigate the webview (instead of calling native `history.back()`), and the tab-switch useEffect records the leaving tab's URL. `AddressBar.tsx` back/forward button enable state is driven by the active tab's `historyBack.length` / `historyForward.length`. In-page link clicks (`onUrlChanged` from Rust) also record to history.
- **Tab drag-to-reorder** — `TabItem.tsx` accepts `draggable`, `onDragStart`, `onDragOver`, `onDrop`, `isDragOver` props. `TabBar.tsx` maintains `dragTabId` and `dragOverTabId` state, wires up the four handlers, and calls `reorderTabs()` from the workspaces store on drop. Drop target gets a 2px left border in `--xevo-accent` color. Tab list container has `onDragEnd` to clear stale state.
- **Cleanup** — `src-tauri/Cargo.toml` package name `xevo-temp` → `xevo`, lib name `xevo_temp_lib` → `xevo_lib`. `src-tauri/src/main.rs` `xevo_temp_lib::run()` → `xevo_lib::run()`. Empty `src/utils/` directory deleted. No `[xevo]` diagnostic console logs left in `useWebviewBridge.ts` (only genuine `console.error` in `webviewReload` catch remains).
- **Verification** — `cargo check` clean, `pnpm tsc --noEmit` clean. Runtime GUI verification (Task 53) requires a `pnpm tauri dev` run on hardware.

## WORKTREE SNAPSHOT (2026-06-06)
```text
.gitignore
.vscode\extensions.json
AGENTS.md
ARCHITECTURE.md
README.md
TASKS.md
PROJECT_STATE.md
promptcodex.md
repo-structure.md
components.json
index.html
package.json
pnpm-lock.yaml
pnpm-workspace.yaml
tsconfig.json
tsconfig.node.json
vite.config.ts

public\tauri.svg
public\vite.svg

src\App.tsx                        ← theme useEffect (in addition to compact mode)
src\main.tsx
src\index.css                      ← [data-theme="dark"] + [data-theme="light"] + :root default
src\vite-env.d.ts
src\types\index.ts                 ← Tab.historyBack / historyForward
src\lib\utils.ts
src\lib\workspaceTabs.ts

src\stores\tabs.ts                 ← + recordNavigation / popBack / popForward actions
src\stores\workspaces.ts
src\stores\settings.ts
src\stores\ui.ts
src\stores\servers.ts

src\services\browser.ts            ← BrowserBounds, TabInfo, onUrlChanged / onLoadingChanged / onTabInfoChanged
                                     + navigateWebview / setWebviewBounds / hideWebview / webviewReload

src\hooks\useWebviewBridge.ts      ← per-tab history wiring, tab-switch prev-tab record
                                     + recordNavigation in onUrlChanged for in-page link clicks
src\hooks\useKeyboardShortcuts.ts
src\hooks\usePortScanner.ts

src\components\CommandPalette.tsx
src\components\ShortcutHelp.tsx
src\components\layout\RootLayout.tsx
src\components\sidebar\Sidebar.tsx
src\components\sidebar\WorkspaceSwitcher.tsx
src\components\panels\SettingsPanel.tsx  ← ThemeButton active state uses --xevo-tab-active variable

src\components\browser\TabBar.tsx       ← dragTabId/dragOverTabId state + drag handlers
src\components\browser\TabItem.tsx      ← draggable + 4 drag props + isDragOver left-border highlight
src\components\browser\TabContextMenu.tsx
src\components\browser\AddressBar.tsx   ← canGoBack/canGoForward from active tab history stacks
src\components\browser\BrowserChrome.tsx
src\components\browser\LoadingBar.tsx
src\components\browser\ContentArea.tsx

src\components\ui\badge.tsx
src\components\ui\button.tsx
src\components\ui\input.tsx
src\components\ui\separator.tsx
src\components\ui\tooltip.tsx

src-tauri\.gitignore
src-tauri\Cargo.toml                    ← package name = "xevo", lib name = "xevo_lib"
src-tauri\Cargo.lock
src-tauri\tauri.conf.json
src-tauri\build.rs
src-tauri\capabilities\default.json

src-tauri\icons\32x32.png
src-tauri\icons\128x128.png
src-tauri\icons\128x128@2x.png
src-tauri\icons\icon.ico
src-tauri\icons\icon.icns
src-tauri\icons\icon.png
src-tauri\icons\Square30x30Logo.png
src-tauri\icons\Square44x44Logo.png
src-tauri\icons\Square71x71Logo.png
src-tauri\icons\Square89x89Logo.png
src-tauri\icons\Square107x107Logo.png
src-tauri\icons\Square142x142Logo.png
src-tauri\icons\Square150x150Logo.png
src-tauri\icons\Square284x284Logo.png
src-tauri\icons\Square310x310Logo.png
src-tauri\icons\StoreLogo.png

src-tauri\src\main.rs                   ← xevo_lib::run()
src-tauri\src\lib.rs                    ← 10 invoke handlers
src-tauri\src\commands\mod.rs
src-tauri\src\commands\browser.rs       ← BROWSER_INIT_SCRIPT now contains
                                           xevoRenderJson IIFE + JSON viewer
                                           (sits before the existing
                                           xevoSendPageInfo / title observer)
src-tauri\src\commands\ports.rs
```


## SESSION NOTE (2026-06-06 â€” Session 10.1 polish pass)
- **Tab drag-to-reorder â€” Firefox/WebView2 compat** â€” `e.dataTransfer.setData("text/plain", tabId)` added in `TabBar.handleDragStart`. Without it, Firefox and some WebView2 builds silently refuse to fire `drop` (the data transfer is considered empty). `draggable={false}` added to the close `<button>` inside `TabItem` (some WebView2 versions route the button mousedown to the draggable parent in a way that kills the drag). `onDragEnd` moved from the tab list container to each `TabItem` element (`dragend` fires on the source, not the target). Source tab fades to `opacity-40` while dragging, cursor switches to `grab` / `grabbing` for visual affordance.
- **Light-mode color leak sweep** â€” added 5 new CSS variables to `src/index.css` (in both `[data-theme="dark"]` and `[data-theme="light"]` blocks): `--xevo-hover` (#282828 / #0000000d), `--xevo-modal-bg` (#1a1a1a / #ffffff), `--xevo-modal-border` (#282828 / #e4e4e7), `--xevo-warning` (#f59e0b / #d97706), `--xevo-badge-bg` (#222222 / #f4f4f5). Replaced all hardcoded dark hex codes across 10 components: TabItem.tsx (5), TabBar.tsx (1), AddressBar.tsx (~14), ContentArea.tsx (4), Sidebar.tsx (~13), WorkspaceSwitcher.tsx (5), SettingsPanel.tsx (~16), CommandPalette.tsx (~12), ShortcutHelp.tsx (~10), TabContextMenu.tsx (~9). Final grep for hardcoded hex Tailwind classes returns 0 matches in `src/`.
- **JSON viewer â€” ultra-minimal 2-color redesign** â€” `BROWSER_INIT_SCRIPT` in `src-tauri/src/commands/browser.rs` rewritten. Old toolbar (40px tall, 4 elements, big `{ } JSON` badge, size display) replaced with a single 32px-tall header line: truncated URL on the left, Copy button on the right, 1px bottom border. Syntax highlighting collapsed from 6 colors to 2: accent blue for keys (`.xj-k`), body color for everything else (strings, numbers, booleans, null, brackets, commas, colons, toggle arrow â€” all inherit). URL strings remain clickable but uncolored. Auto-expand threshold reduced from `depth < 2` to `depth < 1` (only root auto-opens, children collapsed). Removed CSS classes: `.xj-toolbar`, `.xj-label`, `.xj-url`, `.xj-size`, `.xj-s`, `.xj-n`, `.xj-b`, `.xj-null`, `.xj-bracket`. Kept: `.xj-header`, `.xj-path`, `.xj-copy`, `.xj-k`, `.xj-toggle`. Removed the `size = new Blob([raw]).size` variable (size no longer displayed).
- **Verification** â€” `cd src-tauri && cargo check` clean, `pnpm tsc --noEmit` clean. Runtime GUI verification needed: drag a tab to a new position in dark mode, switch to light mode and check every panel/modal, navigate to a JSON URL (e.g. `https://api.github.com/repos/tauri-apps/tauri`) to see the minimal tree.


## SESSION NOTE (2026-06-06 â€” Session 10.2 polish pass)
- **Tab drag-to-reorder â€” "blocked" cursor fix** â€” User reported the browser's "not-allowed" (ðŸš«) cursor was appearing while dragging tabs. Root cause: `onDragOver` and `onDrop` were wired ONLY on individual `TabItem` elements. The HTML5 drag spec dictates the cursor shows the drop-blocked icon the moment the cursor enters ANY element without a working `dragover` handler â€” and there were three "dead zones" in the tab bar: the new-tab `+` button, the empty padding in the tab list scroll container, and the outer TabBar container itself.
- **Fix:** `src/components/browser/TabBar.tsx`:
  - New `dropAtEnd: boolean` state for "drop at end of list" semantics
  - New `handleContainerDragOver` callback: `preventDefault` + `dropEffect = "move"` + `setDropAtEnd(true)` ONLY when `e.target === e.currentTarget` (cursor is directly on the container's padding, not a child)
  - New `handleContainerDrop` callback: moves dragTabId to the end of the live tab list
  - New `handlePlusDragOver` callback for the `+` button: always sets `dropAtEnd = true` (separate from the container handler because the `+` button has a `Plus` icon as a child, so `e.target` is the icon SVG, not the button)
  - Outer TabBar container, tab list container, and `+` button all get `onDragOver` + `onDrop` handlers
  - `+` button shows a 2px blue left border (in `--xevo-accent`) when `dropAtEnd` is true â€” visual hint that dropping there moves the tab to the end
  - Per-tab `handleDragOver` now also clears `dropAtEnd` so the "precise position" mode wins over "drop at end" when cursor enters a tab
  - All drag handlers (`handleDrop`, `handleContainerDrop`, `handleDragEnd`) reset `dropAtEnd` to false
- **Custom full-size drag preview** â€” `handleDragStart` now clones the source tab element via `cloneNode(true)`, styles the clone as a semi-transparent full-size ghost (positioned off-screen via `top: -9999px`), calls `e.dataTransfer.setDragImage(ghost, rect.width / 2, rect.height / 2)` to center it on the cursor, and removes the ghost on the next tick. Replaces WebView2's small low-res default drag preview.
- **Verification** â€” `pnpm tsc --noEmit` clean, `cargo check` clean. Runtime test: drag a tab past the last tab onto the `+` button â€” cursor stays "move", `+` button gets blue left border, ghost preview is full-size, drop moves tab to end of list.


## SESSION NOTE (2026-06-06 â€” Session 10.4 polish pass: tab drag-to-reorder bug sweep)
Implemented every fix listed in `fixing.md` (BUG #1 through BUG #9). All changes are surgical and confined to `src/components/browser/TabBar.tsx`, `src/components/browser/TabItem.tsx`, and `src/lib/workspaceTabs.ts`.

- **BUG #1 (CRITICAL) — drop event bubbling fixed.** The dropped tab was always ending up at the end of the list because the per-tab `onDrop` handler and the container `onDrop` handler both fired (React bubbles `drop` like any DOM event). The container handler then re-pushed the tab to the end, overwriting the correct position. **Fix:** added `e.stopPropagation()` right after `e.preventDefault()` in both `handleContainerDrop` (TabBar.tsx:110) and `handleDrop` (TabBar.tsx:140). The inner container and outer container both had `onDrop={handleContainerDrop}` — stopping at the inner handler prevents the outer from firing too. **This is the bug the user was reporting.**
- **BUG #2 (MEDIUM) — click-after-drop no longer activates the source tab.** HTML5 fires a `click` on the source element after a successful drop, which was calling `onActivate` and making the just-dragged tab active. **Fix:** `TabItem` now owns a `justDraggedRef = useRef<boolean>(false)`. `handleDragStart` (TabItem.tsx:41) sets the ref to `true`; the new `handleClick` (TabItem.tsx:46) wrapper checks the ref — if true, clears it and returns, otherwise calls `onActivate()`. `onDragEnd` deliberately does NOT clear the ref (the ref must stay `true` until the post-drop `click` reads it).
- **BUG #3 (MEDIUM) — drop on `+` no longer creates a phantom new tab.** Same click-after-drop behavior on the `+` button was firing `openNewTab` after a drop. **Fix:** `TabBar` now owns `justDroppedAtPlusRef = useRef<boolean>(false)`. `handleContainerDrop` (TabBar.tsx:132) sets it to `true` on every successful drop. New `openNewTabSafe` (TabBar.tsx:47) wrapper on the `+` button checks the ref — if true, clears it and returns, otherwise calls `openNewTab()`. `handleDragEnd` (TabBar.tsx:176) clears the ref defensively. (Note: the timing relies on the post-drop `click` running before `dragend` clears the ref; if this regresses in a future WebView2 build, see FLAG below.)
- **BUG #4 (LOW) — drop on the close X no longer reorders.** The close `<button>` has `draggable={false}` but the `drop` event still fires on it and bubbles to the `TabItem` root, which reorders the tab AND closes it (via the X's own click). **Fix:** added `data-tab-close="true"` attribute to the close button in `TabItem.tsx:123`. The `onDrop` wrapper in `TabBar.tsx:230` now checks `e.target.closest("[data-tab-close]")` and returns early if true — the drop on the X is ignored, only the X's own `onClick` (close) fires.
- **BUG #5 (LOW) — stuck drop-target border when cursor leaves the bar.** No `onDragLeave` existed, so a tab's blue left border could persist if the cursor left the bar (e.g. went to the address bar) before the drop. **Fix:** added `onDragLeave` prop to `TabItem` (TabItem.tsx:15), wired to the root div (TabItem.tsx:65). New `handleTabDragLeave` (TabBar.tsx:179) clears `dragOverTabId` AND `dropAtEnd` if `e.relatedTarget` is null OR not inside `[data-tab-bar]`. Added `data-tab-bar="true"` attribute on the outer TabBar container (TabBar.tsx:206) for the `closest` lookup.
- **BUG #6 (LOW) — ghost element cleanup race in WebView2.** `setTimeout(0)` to remove the drag preview ghost was unreliable during rapid successive drags (sometimes the ghost was removed before WebView2 captured the snapshot). **Fix:** replaced with `requestAnimationFrame` (TabBar.tsx:80). The browser takes the drag-image snapshot on the next paint, which is exactly when rAF fires — no race.
- **BUG #7 (LOW) — pinned tabs are now always at the front.** `reorderTabs` in the store just replaces the array, so dragging a pinned tab past the first position could intermix pinned and unpinned tabs. **Fix:** both drop handlers (TabBar.tsx:129-131 and 164-166) now compute `pinned = next.filter(id => tabsState[id]?.isPinned)` and `unpinned = next.filter(id => !tabsState[id]?.isPinned)` after the splice, then call `reorderTabs(liveWsId, [...pinned, ...unpinned])`. The dragged tab is spliced into its natural position first, then the list is normalized so pinned tabs always end up before unpinned ones.
- **BUG #8 (LOW) — stale closure on `activeWorkspaceId` during drag.** The drop handlers closed over `activeWorkspaceId` from `useCallback` deps. If the user switched workspaces mid-drag (e.g. via keyboard shortcut), the drop would target the OLD workspace. **Fix:** both handlers now read `useWorkspacesStore.getState().activeWorkspaceId` at the top (TabBar.tsx:117 and 147) and use that for both the workspace lookup and the `reorderTabs` call. `activeWorkspaceId` was removed from the `useCallback` deps arrays (TabBar.tsx:136 and 170) — no longer needed.
- **BUG #9 (LOW) — silent dedup in `getLiveWorkspaceTabIds` now warns.** If persisted state ever has duplicate tabIds, the function silently dropped them — masking the underlying corruption and confusing future debugging. **Fix:** added a `dups` counter (`workspaceTabs.ts:11`) and a `console.warn` when duplicates are detected (`workspaceTabs.ts:19-21`). The dedup behavior itself is unchanged (the `filter`+`indexOf`+`splice` downstream is still correct under dedup).

**Files changed:**
- `src/components/browser/TabBar.tsx` — 8 edits (1 import line, 1 state line, 1 wrapper function, 4 handler bodies, 1 outer container attribute, 1 useCallback dep cleanup, 1 ghost cleanup change, 1 onDrop wrapper)
- `src/components/browser/TabItem.tsx` — 4 edits (1 import line, 1 ref + 2 helper functions, 2 root-div handler swaps, 1 prop, 1 data attribute)
- `src/lib/workspaceTabs.ts` — 1 edit (dedup counter + warn)

**Verification:**
- `cd src-tauri && cargo check` — clean
- `pnpm tsc --noEmit` — clean
- Runtime GUI tests (Tests 1-9 from `fixing.md` §4.2) — **PENDING**. User should run `pnpm tauri dev` and confirm:
  - Test 1: Drag T4 over T1 → [T4, T1, T2, T3] (was [T1, T2, T3, T4])
  - Test 2: Drag T1 over T3 → [T2, T3, T1, T4] (was [T2, T3, T4, T1])
  - Test 3: Drop on `+` → no new tab created
  - Test 4: After drop, source tab does NOT become active
  - Test 5: Drop on X of T2 → T2 closes, T3 stays in place
  - Test 6: Drag preview is full-size, no 1x1 blank ghost
  - Test 7: Blue left border on target tab and on `+` button in end-zone
  - Test 8: ESC during drag clears all state
  - Test 9: Pinned tabs always at the front after any reorder

**WORKTREE SNAPSHOT (2026-06-06 — v0.9.10)**
No files created or removed. Only the three files above were edited. Worktree is unchanged from v0.9.9 (lines 165-431 of the previous snapshot remain accurate).

**FLAGS:**
- **BUG #3 timing risk:** The fix for BUG #3 sets `justDroppedAtPlusRef.current = true` in `handleContainerDrop` and clears it in `handleDragEnd` (synchronously). The HTML5 spec fires events in this order in one task: `drop` → `dragend` → `mouseup` → `click`. If Chromium/WebView2 fires `click` AFTER `dragend` (as the spec suggests), the ref is already cleared by the time `openNewTabSafe` checks it, and the fix does not work. The fix works ONLY if `click` fires before `dragend`, which appears to be the case in current Edge WebView2 (per the audit). If a user reports the `+` button still creates a phantom tab after a drop, change `handleDragEnd` to use `setTimeout(() => { justDroppedAtPlusRef.current = false; }, 0)` instead of the synchronous clear — this guarantees the `click` event has fired first.
- **BUG #4 scope:** The check in the `onDrop` wrapper (TabBar.tsx:230) only fires if the drop target is INSIDE the close button. If the user drops on the empty space of a tab (not the X), reorder still happens. This is the correct behavior — the X is the only "not a drop target" element on a tab.
- **BUG #7 behavior:** The pinned-first normalization is post-reorder, so the dragged tab is inserted at its requested position first, then the list is normalized. The dragged tab's `isPinned` flag determines which section it ends up in. If a user drags an unpinned tab to the very first position, the normalization moves it past all pinned tabs — this is the intended "pinned tabs always first" rule.
- **BUG #8 read order:** `useWorkspacesStore.getState().activeWorkspaceId` is read FIRST, then `useWorkspacesStore.getState().workspaces[liveWsId]` is read from that. If the user switches workspaces between those two `getState()` calls, the workspace ID and the workspace object are still consistent (both reads happen in the same microtask). The bug is theoretical and the fix is defensive.


## CHANGES THIS SESSION (v0.9.10 → v0.9.11)

### Webview bounds — title-bar double-counting fixed, Moved handler moved to frontend
**Root cause (confirmed at runtime via diagnostic logs `[XEVO-VP]`, `[XEVO-BOUNDS]`, `[xevo] set_bounds applied`):** v0.9.6's `getBounds()` formula `rect.top + window.screenY + titleBarHeight` was wrong on the user's machine. The previous theory was that `window.screenY` reports the OS window's top-left (above the title bar) and we needed to add the title-bar height to convert to viewport top-left. **Actually, in Tauri 2's WebView2, `window.screenX/Y` already returns the viewport's top-left in CSS pixels** (same as Tauri Rust `innerPosition()` divided by DPR). Adding the title bar height was double-counting it, pushing the webview 30.4 CSS px below where it should be in restored mode and 63 CSS px below in maximized mode (where the title bar is gone but the screenY delta wasn't recomputed).

**The Rust `Moved` handler was also wrong** — it took the OS window's frame position in **physical** pixels and re-added the title-bar height in physical pixels, but the frontend's `getBounds()` operates entirely in CSS pixels. Even if both were correct individually, the unit systems didn't match. In practice the Rust handler was over-correcting by `2 * 9 = 18 physical px` per move (the border inset was already in `window.screenX`).

**Fix — `src/hooks/useWebviewBridge.ts`:**
- `getBounds()`: removed `+ titleBarHeightRef.current` from the Y formula. New formula is `y = rect.top + window.screenY`. Updated the explanatory comment to reflect the actual Tauri 2 WebView2 semantics (viewport top-left, not OS frame top-left).
- Deleted `titleBarHeightRef` and the `[XEVO-VP]` measurement `useEffect` (was a diagnostic — no longer needed).
- New `useEffect` registers `getCurrentWindow().onMoved(...)` and calls `syncBounds()` on each event. Necessary because `ResizeObserver` only fires on size changes, not position changes — without this, dragging the OS window left the webview out of sync until the next resize.
- Kept `[XEVO-BOUNDS]` log in `getBounds()` for one verification round (user can confirm new formula gives expected Y values).

**Fix — `src-tauri/src/commands/browser.rs`:**
- Deleted the entire `main_window.on_window_event(Moved)` block in `ensure_browser_window` (operated on physical pixels, conflicted with the frontend's CSS-pixel math).
- Removed the now-unused `WindowEvent` import and the `app_for_move` clone.
- Removed the 3 diagnostic `eprintln!` calls: `ensure(create) applied`, `ensure(reuse) applied`, `set_bounds applied`. Their purpose is served; the frontend `[XEVO-BOUNDS]` log gives the final sanity check on the new formula.
- Stale comment "On main-window moves, we register a one-shot `on_window_event` listener" removed from the `ensure_browser_window` doc comment.

### Expected behavior after the fix
- **Restored mode:** `getBounds()` returns `x=258+33=291, y=80+56=136, w=1022, h=720` (was 258, 166, 1022, 720 — 30.4 CSS px too low)
- **Maximized mode:** `getBounds()` returns `x=258+0=258, y=80+23=103, w=1278, h=810` (was 258, 133, 1278, 810 — 30 CSS px too low in addition to the maximized-mode title-bar error)
- **Drag the main window:** `onMoved` fires → `syncBounds()` re-reads `rect` + new `screenX/Y` → `setWebviewBounds` pushes new bounds to Rust. No drift.
- **Window resize:** `ResizeObserver` still fires → `syncBounds()` runs (unchanged).

### Files changed
- `src/hooks/useWebviewBridge.ts`: removed `titleBarHeightRef` (line 59 in old file), removed the `[XEVO-VP]` measurement `useEffect` (lines 61-81 in old file), simplified `getBounds()` Y formula, updated `getBounds()` comment block to document the actual Tauri 2 WebView2 `screenX/Y` semantics, added new `useEffect` for `onMoved` listener (registers `getCurrentWindow().onMoved(...)`, calls `syncBounds()` on each event, returns cleanup that calls the unlisten function). Net change: -30 lines (the deleted measurement useEffect + title bar math), +19 lines (the new onMoved useEffect + updated comment).
- `src-tauri/src/commands/browser.rs`: deleted `WindowEvent` from the `tauri::` import (line 5 in old file), removed `app_for_move = app.clone()` (line 248 in old file), removed `ensure(reuse) applied` `eprintln!` (lines 232-239 in old file), removed `ensure(create) applied` `eprintln!` and the entire `main_window.on_window_event(Moved)` block + its 3-line comment (lines 318-358 in old file), removed `set_bounds applied` `eprintln!` (lines 399-406 in old file), removed the stale "On main-window moves..." sentence from the `ensure_browser_window` doc comment. Net change: -90 lines.

### Verification
- `cd src-tauri && cargo check` — clean
- `pnpm tsc --noEmit` — clean
- User should run `pnpm tauri dev` and verify:
  - **Restored mode:** webview appears flush inside the content area (sidebar on left, tab bar + address bar on top, status bar at bottom — no gaps, no overflow)
  - **Maximized mode:** same — webview fills content area exactly
  - **Drag the main window around:** webview follows with no drift, no lag
  - **Resize the main window:** webview resizes with the content area
  - **Browser console:** `[XEVO-BOUNDS]` log shows `computed.y` = 136 (restored) and 103 (maximized) — should match the user's expectation. If Y values are off by the title-bar height, the formula is still wrong.

## CHANGES THIS SESSION (Session 10.6 — confirmation only, no version bump)

**Purpose:** Verify whether a full migration away from v0.9.11 was viable. The user reported residual drag-lag on the main window. Sonnet proposed reverting to a true `add_child` child webview (Option 1) or upgrading to a newer Tauri (Option 2). This session was a structured investigation: Phase 0 visual verification of Option 1, then research on Option 2's viability.

**Phase 0 — `add_child` re-verification:**
- Added a temporary `test_child_webview` command in `src-tauri/src/commands/browser.rs` that builds a child webview with `Window::add_child`, sets bounds, navigates, then enables `set_auto_resize(true)`. Registered it in `src-tauri/src/lib.rs` `invoke_handler`.
- `cargo check` clean after registration.
- Visual test result: **FAILED.**
  - Rust API calls all returned `Ok(())`: `add_child`, `set_position`, `set_size`, `navigate`, `set_auto_resize(true)` — none of them errored.
  - **The webview did NOT follow the main window on drag.** Same symptom as v0.9.2-9.5.
  - `set_auto_resize(true)` was glitchy: sometimes worked, sometimes the webview got stuck and required close-and-reopen of the main window to recover.
  - **Conclusion:** the `Ok(())` from Rust only confirms the API call succeeded, not that the OS WebView2 child behaved correctly. A successful Rust return is not a sufficient signal for "this works."
- Cleaned up: removed `test_child_webview` from `browser.rs` and `lib.rs` `invoke_handler`. `cargo check` clean after cleanup.

**Option 2 — Tauri upgrade research:**
- **Tauri 2.11.2 is the latest stable release** (verified via crates.io API and GitHub releases, May 16 2025). No newer 2.x version exists.
- **GitHub Issue #10079** is the canonical reference. Closed as **"not planned"** in June 2024 by the Tauri team. The thread explicitly states: *"`parent()` doesn't seem to work in a Windows environment"*. The team has confirmed they do not intend to fix child webview behavior on Windows.
- **Conclusion: Option 2 is NOT viable.** No upgrade path exists in the Tauri 2.x line. The drag-lag is an architectural limitation, not a bug to be fixed by upgrading.

**Final decision:**
- Stay on v0.9.11 architecture. The frontend `onMoved` listener is the best available workaround.
- The residual ~5-10ms drag lag is accepted as a Tauri 2.x limitation.
- Do NOT propose further architectural changes for this issue. Time should be invested in features, not in fighting the framework.

**Files changed this session:**
- `src-tauri/src/commands/browser.rs`: added then removed `test_child_webview` command (net zero lines)
- `src-tauri/src/lib.rs`: added then removed `test_child_webview` registration in `invoke_handler` (net zero lines)
- `PROJECT_STATE.md`: header updated to Session 10.6 status; KNOWN ISSUES first item updated to cite Issue #10079; NEXT SESSION PRIORITIES updated with architecture-locked note and Option D (single-webview refactor) listed as not-recommended
- `TASKS.md`: Session 10.6 entry added (see that file)

**Verification:**
- `cd src-tauri && cargo check` — clean (after cleanup)
- `pnpm tsc --noEmit` — clean (no frontend changes this session)


## CHANGES THIS SESSION (v0.9.11 → v1.0.0)

**Purpose:** First stable release candidate. Ships four major features on top of the locked v0.9.11 architecture. The architecture is UNCHANGED — all new work builds on the persistent `WebviewWindow` + frontend `onMoved` drag sync. The headline result is a v1.0-quality app: find-in-page, bookmarks, a proper home page, and an API tester.

### Part A — Find in Page (Rust + React)
- **Why a Rust command wraps JavaScript:** Tauri 2.11.2 stable does NOT expose a native `WebviewWindow::find` API. Confirmed by grepping the tauri-2.11.2 source (`tauri-2.11.2\src\`) for `fn find | FindOptions | FindResult` — zero matches. Decision: implement find in JavaScript inside the webview, wrap it in Rust commands so the frontend keeps a single IPC surface.
- **`src-tauri/src/commands/browser.rs` — `XEVO_FIND_SCRIPT` constant** (raw string `r##"..."##` because the JS body contains CSS color strings like `"#fde047"` that would prematurely close a `r#"..."#` raw string). Defines `window.__xevoFind(query, forward)`, `window.__xevoFindNext(forward)`, `window.__xevoClearFind()`. Walks `document.body` text nodes, wraps matches in `<mark class="xevo-find-hit">`, tracks active match, scrolls into view. Reports `(activeMatch, totalMatches, finalUpdate)` back to Rust via `__TAURI_INTERNALS__.invoke("browser_find_callback", ...)`.
- **4 new Rust commands**: `browser_find(query, forward)`, `browser_find_next(forward)`, `browser_stop_find()`, `browser_find_callback(active_match, total_matches, final_update)`. The callback command emits `browser://find-result` events to the frontend. `ensure_browser_window` chains a second `.initialization_script(XEVO_FIND_SCRIPT)` call so the script is available on every fresh page load.
- **`src-tauri/src/lib.rs`** — 4 new entries in `invoke_handler`. Total: 14 invoke handlers.
- **Frontend**: `src/services/browser.ts` (4 new exports + `FindResult` interface), `src/stores/ui.ts` (4 new state fields + 4 new actions), `src/components/browser/FindBar.tsx` (NEW — fixed-positioned at top-right of content area, 150ms debounced, Enter/Shift+Enter cycles, Esc closes, live match count), `src/hooks/useKeyboardShortcuts.ts` (Ctrl/Cmd+F handler), `src/components/browser/BrowserChrome.tsx` (mounted FindBar inside a `relative` wrapper around ContentArea), `src/components/ShortcutHelp.tsx` (Ctrl+F entry), `src/components/CommandPalette.tsx` (Find command), `src/types/index.ts` (FindResult interface).

### Part B — Bookmarks (frontend-only, workspace-scoped, persisted)
- **Why no Rust involvement needed:** bookmarks are pure local data. Zustand `persist` middleware handles `localStorage` automatically.
- **`src/stores/bookmarks.ts` (NEW)** — `Bookmark = { id, workspaceId, url, title, createdAt }`. Persisted to `localStorage` under `xevo-bookmarks`. Actions: `addBookmark`, `removeBookmark`, `removeBookmarkByUrl`, `renameBookmark`, `clearForWorkspace`, `getBookmarksByWorkspace`, `isBookmarked`. `addBookmark` does an `unshift` so newest is first.
- **`src/components/sidebar/BookmarksPanel.tsx` (NEW)** — workspace-scoped list. Header shows active workspace name + "Clear all" button (with `window.confirm`). Each row: title, host (faint sublabel), open-in-new-tab icon (hover-revealed), delete icon (hover-revealed). Click row → open in new tab. Double-click → inline rename (Enter commits / Esc cancels). Empty state with Ctrl+D hint.
- **`src/hooks/useKeyboardShortcuts.ts`** — Ctrl/Cmd+D handler. Skips when focus is in input/textarea. Toggles bookmark for active tab. Skips when there is no active tab URL.
- **`src/components/sidebar/Sidebar.tsx`** — `activePanel === "bookmarks"` renders `<BookmarksPanel />`.
- **`src/components/ShortcutHelp.tsx`** — Ctrl+D entry.
- **`src/components/CommandPalette.tsx`** — "Open Bookmarks Panel" command.
- **`src/types/index.ts`** — `Bookmark` interface added.

### Part C — XEVO Home Page (replaces placeholder)
- **`src/components/panels/HomePage.tsx` (NEW)** — replaces the bare Globe-icon placeholder in ContentArea. Three sections in a centered `max-w-3xl` column:
  1. **Hero** — workspace icon + name + "XEVO Home" heading + centered search input. Submits to `bridge.navigate` (active tab) or opens a new tab if no bridge.
  2. **Live Servers** — 2/3/4-column responsive grid of cards (one per running localhost dev server), with status dot + port + label. Empty state with dashed-border box + "Start a dev server" hint.
  3. **Bookmarks** — vertical list of recent workspace-scoped bookmarks. Each row: arrow icon + title + URL (faint). Empty state with Ctrl+D hint.
  Each section has a "View all" link that switches the sidebar panel to the corresponding detail view.
- **`src/components/panels/HomePage.tsx` — `resolveInput(raw, searchEngine, customSearchUrl)`** — mirrors the address bar's URL/search resolution logic, including the custom-search-engine template (`%s` placeholder). Default engines: google, duckduckgo, bing, custom.
- **`src/components/browser/ContentArea.tsx`** — replaced the bare placeholder with `<HomePage onNavigate={bridge?.navigate ?? null} />`. Only shown when `!hasUrl`.

### Part D — API Tester MVP (frontend-only, uses `fetch()`)
- **`src/components/panels/ApiTester.tsx` (NEW, ~966 lines)** — Postman-style panel. Two layouts: `embedded` (sidebar, default) and full-page modal (via `onClose` prop).
  - **Method selector** (GET/POST/PUT/DELETE/PATCH/HEAD/OPTIONS) with per-method accent color.
  - **URL input** + `Ctrl/Cmd+Enter` to send.
  - **Send button** with "Sending…" pulse animation.
  - **Tabbed request editor**: Headers (key/value rows with enable/disable + add/remove), Body (textarea, disabled for GET/HEAD), cURL Import.
  - **`parseCurl(input: string): { method, url, headers, body }`** — tokenizes cURL commands (single-quoted, double-quoted, unquoted), supports `-X/--request`, `-H/--header`, `-d/--data/--data-raw/--data-binary/--data-urlencode`, `-F/--form` (Basic auth via `btoa`), `-u/--user`, `-A/--user-agent`, `-b/--cookie`. Skips `-L`, `-k`, `-s`, `--silent`, etc. Empty method defaults to POST if `-d` is present.
  - **`send()`** — uses `fetch()` directly. Builds headers (filters disabled rows), sends body (non-empty + method not GET/HEAD). Measures duration via `performance.now()`. Sets response state with status, statusText, headers, raw body, formatted body (if JSON), size, duration. Pushes new `ApiHistoryEntry` to history array (capped at 50, newest first).
  - **Response viewer** — status pill (green 2xx / red 4xx-5xx / amber 3xx), status text, duration (ms), size (B/KB/MB), tabs for Body / Headers, Copy button (`navigator.clipboard.writeText`, "Copied!" for 1.5s). JSON responses are pretty-printed with `JSON.stringify(parsed, null, 2)`.
  - **Quick-pick row** — pre-fills the URL input with the live servers (e.g. `http://localhost:3000`).
  - **Request history** (last 50, collapsible) — each row shows method (colored), URL, status (colored), duration. Click row to load the method+URL back into the editor. "Trash" button clears the history.
- **`src/components/sidebar/Sidebar.tsx`** — `activePanel === "api"` renders `<ApiTester embedded />`.
- **`src/components/CommandPalette.tsx`** — "Open API Tester" command added.
- **`src/types/index.ts`** — `HttpMethod`, `ApiHeader`, `ApiHistoryEntry` interfaces added.

### Files changed
- `src-tauri/src/commands/browser.rs`: added `XEVO_FIND_SCRIPT` const (r##"..."##); added 4 find commands + `FindResultPayload` struct; `ensure_browser_window` now chains a second `.initialization_script(XEVO_FIND_SCRIPT)`.
- `src-tauri/src/lib.rs`: registered 4 new browser commands in `invoke_handler` (browser_find, browser_find_next, browser_stop_find, browser_find_callback).
- `src/types/index.ts`: added FindResult, Bookmark, HttpMethod, ApiHeader, ApiHistoryEntry.
- `src/services/browser.ts`: added FindResult interface + webviewFind / webviewFindNext / webviewStopFind / onFindResult.
- `src/stores/ui.ts`: added findOpen / findQuery / findActiveMatch / findTotalMatches state + openFind / closeFind / setFindQuery / setFindResult actions.
- `src/stores/bookmarks.ts` (NEW): workspace-scoped persisted bookmarks store.
- `src/hooks/useKeyboardShortcuts.ts`: added Ctrl/Cmd+F (open find, refocus input if already open) and Ctrl/Cmd+D (toggle bookmark on active tab) handlers.
- `src/components/browser/FindBar.tsx` (NEW): floating top-right find bar with debounced search + match navigation.
- `src/components/browser/BrowserChrome.tsx`: wrapped ContentArea in `relative` div, mounted `<FindBar />`.
- `src/components/browser/ContentArea.tsx`: replaced Globe placeholder with `<HomePage onNavigate={bridge?.navigate ?? null} />`.
- `src/components/panels/HomePage.tsx` (NEW): XEVO Home with hero/search/Live Servers/Bookmarks.
- `src/components/panels/ApiTester.tsx` (NEW): full Postman-style API tester.
- `src/components/sidebar/BookmarksPanel.tsx` (NEW): sidebar bookmarks list.
- `src/components/sidebar/Sidebar.tsx`: wired BookmarksPanel and ApiTester for `activePanel === "bookmarks"` / `"api"`.
- `src/components/ShortcutHelp.tsx`: added Ctrl+F and Ctrl+D entries.
- `src/components/CommandPalette.tsx`: added "Open Bookmarks Panel", "Open API Tester", "Find in Page" commands.
- `TASKS.md`: Session 11 (v1.0-features-new) section added.
- `PROJECT_STATE.md`: this file.

### Verification
- `cd src-tauri && cargo check` → `Finished dev profile in 1.48s` (exit 0)
- `pnpm tsc --noEmit` → exit 0
- Runtime GUI tests (Task 76.4) — **PENDING**. User should run `pnpm tauri dev` and confirm:
  - **Find**: Ctrl+F → bar appears, typing highlights matches, Enter cycles, Shift+Enter goes back, Esc closes, match count updates live
  - **Bookmarks**: Ctrl+D on a tab → added to sidebar list under current workspace; Ctrl+D again → removed; switch workspace → separate list; reload page → list persists
  - **Home**: open a new empty tab → home page shows with hero + live servers + recent bookmarks; clicking a server card navigates; clicking a bookmark navigates
  - **API tester**: open sidebar "API Tester" → enter URL + Send → response shows status/duration/size/headers/body; cURL import parses a real cURL command; history persists within session


## WORKTREE SNAPSHOT (2026-06-07 — v1.0.0)
```text
Xevo/
├── .gitignore
├── .vscode/
│   └── extensions.json
├── AGENTS.md
├── ARCHITECTURE.md
├── README.md
├── TASKS.md
├── PROJECT_STATE.md
├── promptcodex.md
├── repo-structure.md
├── components.json
├── index.html
├── package.json
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
├── tsconfig.json
├── tsconfig.node.json
├── vite.config.ts
│
├── dist/                                  ← Vite build output (gitignored)
│
├── node_modules/                          ← pnpm-managed deps (gitignored)
│
├── public/
│   ├── tauri.svg
│   └── vite.svg
│
├── src/
│   ├── App.tsx                            ← theme useEffect + compact mode class on documentElement
│   ├── main.tsx
│   ├── index.css                          ← [data-theme="dark"] + [data-theme="light"] + :root default
│   │                                        + @keyframes xevo-progress / xevo-progress-done
│   │                                        + .xevo-compact class overrides
│   ├── vite-env.d.ts
│   ├── types/
│   │   └── index.ts                       ← Tab (with historyBack/historyForward), Workspace,
│   │                                        LocalServer, AppSettings, FindResult, Bookmark,
│   │                                        HttpMethod, ApiHeader, ApiHistoryEntry
│   ├── lib/
│   │   ├── utils.ts                       ← cn() helper
│   │   └── workspaceTabs.ts               ← getLiveWorkspaceActiveTab,
│   │                                        getLiveWorkspaceTabIds (with dedup warn)
│   │
│   ├── services/
│   │   └── browser.ts                     ← IPC service: navigateWebview / setWebviewBounds /
│   │                                        hideWebview / webviewReload / webviewGoBack /
│   │                                        webviewGoForward / webviewFind / webviewFindNext /
│   │                                        webviewStopFind / onFindResult
│   │                                        + BrowserBounds, ScannedPort, TabInfo, FindResult
│   │                                        + onUrlChanged / onLoadingChanged / onTabInfoChanged
│   │
│   ├── stores/
│   │   ├── tabs.ts                        ← tabs: Record<id, Tab>; addTab/closeTab/updateTab/
│   │   │                                    duplicateTab/pinTab/setLoading/setFavicon/
│   │   │                                    recordNavigation/popBack/popForward
│   │   ├── workspaces.ts                  ← workspaces + activeWorkspaceId (persist)
│   │   │                                    addTabToWorkspace/removeTabFromWorkspace/setActiveTab
│   │   ├── settings.ts                    ← settings + update / setTheme / setSearchEngine /
│   │   │                                    setCustomSearchUrl / setPortScanInterval /
│   │   │                                    setCompactMode / reset
│   │   ├── ui.ts                          ← sidebarOpen, sidebarWidth, activePanel,
│   │   │                                    commandPaletteOpen, settingsOpen,
│   │   │                                    settingsPanelOpen, shortcutHelpOpen
│   │   │                                    + findOpen, findQuery, findActiveMatch,
│   │   │                                      findTotalMatches
│   │   │                                  + toggleSettingsPanel / openCommandPalette /
│   │   │                                    closeCommandPalette / openShortcutHelp /
│   │   │                                    closeShortcutHelp
│   │   │                                  + openFind / closeFind / setFindQuery /
│   │   │                                    setFindResult
│   │   ├── servers.ts                     ← live localhost server scan results
│   │   └── bookmarks.ts                   ← NEW: workspace-scoped persisted bookmarks
│   │                                        (localStorage key "xevo-bookmarks")
│   │                                        addBookmark / removeBookmark /
│   │                                        removeBookmarkByUrl / renameBookmark /
│   │                                        clearForWorkspace /
│   │                                        getBookmarksByWorkspace / isBookmarked
│   │
│   ├── hooks/
│   │   ├── useWebviewBridge.ts            ← embedded webview lifecycle
│   │   │                                    + onUrlChanged / onLoadingChanged /
│   │   │                                      onTabInfoChanged
│   │   │                                    + getBounds() returns raw CSS pixels (no DPR,
│   │   │                                      no title-bar offset — Tauri 2 WebView2's
│   │   │                                      screenX/Y already returns viewport top-left)
│   │   │                                    + tab title set to URL domain immediately
│   │   │                                      on navigate (overwritten by document.title)
│   │   │                                    + ResizeObserver on content area AND
│   │   │                                      documentElement
│   │   │                                    + syncBounds 5px threshold (filters
│   │   │                                      WebView2 2px subpixel re-layer shift)
│   │   │                                    + tab-switch useEffect uses tryNavigate(attempt)
│   │   │                                      with 3x100ms retry on null bounds
│   │   │                                    + NO duplicate showWebview calls
│   │   │                                    + useMemo'd bridge return for stable ref
│   │   │                                    + primitive selectors (no destructure-subscribe)
│   │   │                                    + getCurrentWindow().onMoved(...) listener for
│   │   │                                      main-window drag → syncBounds()
│   │   │                                    + per-tab history wiring
│   │   │                                    + recordNavigation in onUrlChanged for
│   │   │                                      in-page link clicks
│   │   ├── useKeyboardShortcuts.ts        ← Ctrl+K (palette), Ctrl+? (help),
│   │   │                                    Alt+←/→, Ctrl+R, Ctrl+1-9,
│   │   │                                    Ctrl+Tab, Ctrl+Shift+Tab, Ctrl+, (settings)
│   │   │                                    + Ctrl+F (open find)
│   │   │                                    + Ctrl+D (toggle bookmark on active tab)
│   │   └── usePortScanner.ts              ← skips updateFromScan when scan results
│   │                                        unchanged (port count + alive flags)
│   │
│   └── components/
│       ├── CommandPalette.tsx             ← Ctrl+K centered overlay with fuzzy search
│       │                                    + tab items (Globe icon + TAB badge)
│       │                                    + Open Bookmarks Panel command
│       │                                    + Open API Tester command
│       │                                    + Find in Page command
│       │                                    + ArrowUp/Down + Enter + Escape keyboard
│       │                                    + click-outside-to-close backdrop
│       ├── ShortcutHelp.tsx               ← Ctrl+? centered modal with all shortcuts
│       │                                    + Ctrl+F (Find in Page) entry
│       │                                    + Ctrl+D (Bookmark Current Tab) entry
│       │                                    + two-column list (kbd keys + description)
│       │                                    + Esc / X / backdrop click to close
│       │
│       ├── layout/
│       │   └── RootLayout.tsx             ← adds SettingsPanel + CommandPalette +
│       │                                      ShortcutHelp mounts
│       │
│       ├── sidebar/
│       │   ├── WorkspaceSwitcher.tsx      ← gear icon at bottom → toggleSettingsPanel()
│       │   ├── Sidebar.tsx                ← live port-scan results, click to open
│       │   │                                + BookmarksPanel for activePanel="bookmarks"
│       │   │                                + ApiTester embedded for activePanel="api"
│       │   └── BookmarksPanel.tsx         ← NEW: sidebar bookmarks list
│       │                                      (workspace-scoped, inline rename, hover
│       │                                       delete, "Clear all" with confirm)
│       │
│       ├── browser/
│       │   ├── TabBar.tsx                 ← Ctrl+T / Ctrl+W listeners + context-menu state
│       │   │                                + dragTabId/dragOverTabId/dropAtEnd state +
│       │   │                                  drag handlers + ghost preview
│       │   │                                + drop event stopPropagation
│       │   │                                + pinned tabs always at front
│       │   ├── TabItem.tsx                ← favicon img + onError Globe fallback +
│       │   │                                  onContextMenu + Pin icon when isPinned
│       │   │                                + draggable + 4 drag props + isDragOver
│       │   │                                  left-border highlight + justDraggedRef
│       │   │                                  (suppresses click-after-drop activate)
│       │   │                                + data-tab-close="true" on close button
│       │   ├── TabContextMenu.tsx         ← right-click menu via Portal
│       │   ├── AddressBar.tsx             ← URL input + Ctrl+L listener + back/fwd/reload
│       │   │                                buttons
│       │   │                                canGoBack/canGoForward from active tab
│       │   │                                history stacks
│       │   │                                useEffect deps include activeTabId AND
│       │   │                                activeTab?.url (URL syncs on redirect)
│       │   ├── BrowserChrome.tsx          ← mounts TabBar + AddressBar + LoadingBar +
│       │   │                                  ContentArea + FindBar
│       │   │                                  (ContentArea wrapped in relative div for
│       │   │                                   FindBar positioning)
│       │   │                                primitive Zustand selectors
│       │   │                                (no destructure-subscribe)
│       │   ├── LoadingBar.tsx             ← 2px CSS-animated progress bar
│       │   ├── ContentArea.tsx            ← child webview host div, transparent when hasUrl
│       │   │                                + HomePage shown when !hasUrl
│       │   └── FindBar.tsx                ← NEW: floating top-right find bar
│       │                                      (Ctrl+F) with debounced search,
│       │                                      match count, prev/next/close buttons
│       │
│       ├── panels/
│       │   ├── HomePage.tsx               ← NEW: XEVO Home with hero/search/
│       │   │                                  Live Servers/Bookmarks sections
│       │   │                                (workspace-scoped, shown when no active
│       │   │                                 tab URL)
│       │   ├── SettingsPanel.tsx          ← theme, search engine, scan interval,
│       │   │                                  compact mode, about; absolutely
│       │   │                                  positioned right
│       │   └── ApiTester.tsx              ← NEW: Postman-style API tester MVP
│       │                                      (~966 lines: method selector, URL,
│       │                                       headers editor, body editor, cURL
│       │                                       import with parseCurl, fetch-based
│       │                                       send, response viewer with status
│       │                                       pill + duration + size + JSON
│       │                                       pretty-print + Copy, quick-pick
│       │                                       live server URLs, request history
│       │                                       with click-to-load)
│       │
│       └── ui/
│           ├── badge.tsx
│           ├── button.tsx
│           ├── input.tsx
│           ├── separator.tsx
│           └── tooltip.tsx
│
└── src-tauri/
    ├── .gitignore
    ├── Cargo.toml                         ← tauri features = ["unstable"], package = "xevo",
    │                                        lib = "xevo_lib"
    ├── Cargo.lock
    ├── tauri.conf.json                    ← no transparent key
    ├── build.rs
    ├── capabilities/
    │   └── default.json
    ├── gen/schemas/                       (auto-generated by Tauri)
    │   ├── acl-manifests.json
    │   ├── capabilities.json
    │   ├── desktop-schema.json
    │   └── windows-schema.json
    ├── icons/                             (auto-generated, 18 files)
    │
    └── src/
        ├── main.rs                        ← xevo_lib::run()
        ├── lib.rs                         ← 14 invoke handlers (Session 11)
        │                                    browser_navigate, browser_set_bounds,
        │                                    browser_go_back, browser_go_forward,
        │                                    browser_reload, browser_close,
        │                                    browser_show, browser_hide,
        │                                    browser_find, browser_find_next,
        │                                    browser_stop_find, browser_find_callback,
        │                                    update_tab_info, scan_ports
        └── commands/
            ├── mod.rs                     ← pub mod browser; pub mod ports;
            ├── browser.rs                 ← 13 commands + ensure_browser_window helper
            │                                + BROWSER_INIT_SCRIPT const (contains
            │                                  xevoRenderJson IIFE + JSON viewer)
            │                                + XEVO_FIND_SCRIPT const (Session 11)
            │                                + BROWSER_LABEL = "browser" const
            │                                + FindResultPayload struct (Session 11)
            │                                + resolve_url() helper (search/URL parser)
            │                                + ensure_browser_window() — checks
            │                                  app.get_webview_window("browser"):
            │                                  if Some, calls set_position(Logical) +
            │                                  set_size(Logical) + navigate() on the
            │                                  existing window. If None, builds a new
            │                                  WebviewWindow via WebviewWindowBuilder
            │                                  with parent(main_window),
            │                                  decorations(false), resizable(false),
            │                                  transparent(true), inner_size + position
            │                                  in logical (CSS) pixels, TWO
            │                                  initialization_scripts
            │                                  (BROWSER_INIT_SCRIPT + XEVO_FIND_SCRIPT),
            │                                  on_navigation (emits url-changed),
            │                                  on_page_load (emits loading + eval
            │                                  title script + 500ms + 1.5s retries).
            │                                + LogicalPosition / LogicalSize throughout
            │                                  (no scale_factor() multiplication — the
            │                                  OS handles DPI scaling)
            │                                + browser_hide calls wv.hide() (window
            │                                  preserved, just hidden)
            │                                + browser_show calls set_position +
            │                                  set_size + show
            │                                + browser_find / browser_find_next /
            │                                  browser_stop_find: wv.eval() calls
            │                                  to window.__xevoFind / __xevoFindNext /
            │                                  __xevoClearFind (Session 11)
            │                                + browser_find_callback: emits
            │                                  "browser://find-result" event with
            │                                  (activeMatch, totalMatches,
            │                                  finalUpdate) payload (Session 11)
            │                                + browser_go_back / forward / reload all
            │                                  work via wv.eval() on the persistent
            │                                  window (history preserved!)
            └── ports.rs
```

## CHANGES THIS SESSION (v1.0.0 → v1.1.0)

### Session 12: Verification + Missing Panels + Polish

**Purpose:** Verify Session 11 features at runtime, add missing JWT Decoder and Base64 Tool panels, implement the Status Bar, add Reopen Last Tab (Ctrl+Shift+T), and add Stop Loading (Escape).

### Task 61 — JWT Decoder + Base64 Tool
- **`src/types/index.ts`** — `PanelId` union extended with `| "jwt" | "base64"`. `Tab` interface gains `loadTime: number | null`.
- **`src/components/panels/JwtDecoder.tsx` (NEW)** — Paste button (reads clipboard), textarea, 300ms debounced decode. Base64url decode with UTF-8 support via `decodeURIComponent(Array.from(atob(...)))`. Displays algorithm badge, collapsible HEADER/PAYLOAD sections with key-value rows, expiry countdown (red/green), signature note.
- **`src/components/panels/Base64Tool.tsx` (NEW)** — Encode/decode mode toggle, URL-safe checkbox (`-`/`_` instead of `+`/`/`). `TextEncoder`/`TextDecoder` for Unicode. Input/output with char counts, copy button with 2s "Copied!" feedback.
- **`src/components/sidebar/Sidebar.tsx`** — Added `KeyRound` and `Binary` icons from lucide-react. Added JwtDecoder and Base64Tool imports. Added `{ id: "jwt", Icon: KeyRound, label: "JWT Decoder" }` and `{ id: "base64", Icon: Binary, label: "Base64" }` to PANELS array. Added render entries. Reduced icon padding (`p-1.5` → `p-1`) and size (`13` → `11`) to prevent overflow with 8 icons.

### Task 63 — Status Bar
- **`src/components/browser/StatusBar.tsx` (NEW)** — 20px bar at bottom. Shows: hovered URL (placeholder — Task 63.3 skipped), animated "Loading…" text (animate-pulse), or "✓ {loadTime}ms" after navigation. Page origin displayed on right. `var(--xevo-workspace-bar)` background.
- **`src/stores/tabs.ts`** — `buildTab` initializes `loadTime: null`. `recordNavigation` resets `loadTime: null` on new navigation.
- **`src/hooks/useWebviewBridge.ts`** — Added `loadStartRef`. `onLoadingChanged`: on `true` records `Date.now()`, on `false` computes elapsed and writes to tab via `updateTab(tabId, { isLoading: false, loadTime: elapsed })`.
- **`src/components/layout/RootLayout.tsx`** — Restructured to `flex flex-col`: outer row holds content, `StatusBar` sits at the bottom. Reads `isLoading`, `loadTime`, `url` from Zustand via primitive selectors.
- Task 63.3 (hovered URL detection) **SKIPPED** — requires injected hover-tracking script in the webview + new Rust commands. StatusBar receives `hoveredUrl={null}` with a TODO comment.

### Task 64 — Reopen Last Closed Tab
- **`src/stores/tabs.ts`** — New `lastClosedTab: Tab | null` field (default null). `closeTab` saves `{ ...s.tabs[tabId] }` before deleting. New `clearLastClosedTab()` action.
- **`src/hooks/useKeyboardShortcuts.ts`** — Added `Ctrl+Shift+T` handler: reads `lastClosedTab`, creates new tab with same URL/title, adds to workspace, sets active, clears lastClosedTab.
- **`src/components/ShortcutHelp.tsx`** — Added `{ keys: ["Ctrl", "Shift", "T"], description: "Reopen Last Tab" }` and `{ keys: ["Esc"], description: "Stop Loading / Close Find" }` to the shortcuts list.

### Task 65 — Stop Loading + Escape Key
- **`src-tauri/src/commands/browser.rs`** — New `browser_stop_loading` command: gets "browser" webview window, calls `wv.eval("window.stop()")`.
- **`src-tauri/src/lib.rs`** — Registered `browser_stop_loading` in invoke handler (16 total).
- **`src/services/browser.ts`** — New `stopLoading()` function: `invoke<void>("browser_stop_loading")`.
- **`src/hooks/useWebviewBridge.ts`** — Imported `stopLoading` from services. Added to `useMemo`'d bridge return: `stopLoading: async () => { await stopLoading(); }`.
- **`src/hooks/useKeyboardShortcuts.ts`** — New Escape handler: if `findOpen` → close find bar; else if page is loading → call `bridge.stopLoading()`.

### Verification
- `cd src-tauri && cargo check` — clean (16 invoke handlers)
- `pnpm tsc --noEmit` — clean (no type errors)

### Runtime tests (Task 62 / Task 66) — PENDING
User should run `pnpm tauri dev` and confirm:
- **Status bar**: visible at bottom, shows load time after navigation
- **JWT Decoder**: sidebar panel, paste token, see decoded header/payload/expiry
- **Base64 Tool**: encode "Hello Developer" → "SGVsbG8gRGV2ZWxvcGVy", decode back
- **Reopen tab**: close tab → Ctrl+Shift+T → tab reopens at same URL
- **Stop loading**: navigate to slow page → Escape → loading stops
- **All Session 11 features**: Find (Ctrl+F), Bookmarks (Ctrl+D), Home page, API tester
- **No console errors on startup**
- **Light theme**: Settings → Light → UI changes correctly

## CHANGES THIS SESSION (v1.1.0 → v1.2.0 — Session 13: UI Visual Refresh)

### Design direction: "Refined Monochrome"
Pure black-and-white with warmth and depth. White (`#f0f0f2`) as the sole accent color — the "accent" in a monochrome theme IS the white against dark. No blue, no indigo, no purple.

### Files changed (8 files, zero logic changes)

**`src/index.css`** — Foundation of the visual refresh:
- Added Google Fonts import: DM Sans (body) + JetBrains Mono (code/monospace)
- Body typography: `font-family: 'DM Sans', ...`, `font-size: 13px`, `line-height: 1.5`, `letter-spacing: -0.01em`
- 12 dark-theme CSS variables remapped for surface depth hierarchy:
  - `--xevo-workspace-bar: #0a0a0c` (darkest)
  - `--xevo-sidebar-bg: #0e0e10` (sidebar)
  - `--xevo-tab-bar: #111113` (tab strip)
  - `--xevo-tab-active: #1a1a1e` (active tab)
  - `--xevo-address-bar: #141416` (toolbar)
  - `--xevo-content-bg: #0c0c0e` (window bg)
  - `--xevo-modal-bg: #1a1a1e` (elevated)
  - `--xevo-border: #1e1e22` (main borders)
  - `--xevo-hover: rgba(255,255,255,0.04)` (hover overlay)
  - `--xevo-text: #f0f0f2`, `--xevo-text-muted: #6b6b76`, `--xevo-text-faint: #45454e`
- 3 new variables: `--xevo-accent-dim`, `--xevo-accent-border`, `--xevo-border-subtle`
- Accent changed from `#3b82f6` (blue) to `#f0f0f2` (white)
- Scrollbar: width 6px→4px, thumb `rgba(255,255,255,0.12)`, hover `rgba(255,255,255,0.22)`
- Global input focus ring: `input:focus { border-color: var(--xevo-accent-border); box-shadow: 0 0 0 2px var(--xevo-accent-dim); }`

**`src/components/browser/TabBar.tsx`** — Subtle depth:
- Tab bar bottom border: `var(--xevo-border)` → `var(--xevo-border-subtle)`

**`src/components/browser/TabItem.tsx`** — Tab polish:
- Transition broadened: `transition-[opacity,colors]` → `transition-all duration-100`
- Favicon fallback: replaced `<Globe>` with 8×8px rounded-[3px] div, `rgba(255,255,255,0.08)` bg
- Close button: w-4 h-4 → w-3.5 h-3.5 (14px), rounded-[3px], hover bg `rgba(255,255,255,0.08)`
- Removed unused `Globe` import from lucide-react

**`src/components/browser/AddressBar.tsx`** — Refined controls:
- Nav buttons: w-7 h-7 (28px) → w-[26px] h-[26px], border-radius 5px
- Disabled opacity: default → `opacity-25` (more faded)
- Input container: border-radius `rounded-[7px]`, focus state uses `var(--xevo-accent-border)` + `box-shadow: 0 0 0 2px rgba(255,255,255,0.04)`
- Transition: `duration-100` → `duration-150`

**`src/components/panels/HomePage.tsx`** — Landing page refresh:
- Workspace label: 12px → 13px, added `letter-spacing: 0.04em`
- Search input: `rounded-lg` → `rounded-[10px]`, focus glow `shadow-[0_0_0_2px_rgba(255,255,255,0.04)]`
- Section headers: `text-[var(--xevo-text-faint)]` → `text-[var(--xevo-accent)]`, `tracking-wider` → `tracking-[0.08em]`
- "View all" links: `text-[var(--xevo-text-faint)]` → `text-[var(--xevo-accent)] opacity-60`, hover: full opacity + underline
- Server cards: `rounded-md` → `rounded-[8px]`, `p-2.5` → `p-3`, `transition-colors` → `transition-all duration-150`, hover border `var(--xevo-accent-border)`
- Both empty states: removed dashed border box, simplified to single centered muted text line

**`src/components/sidebar/WorkspaceSwitcher.tsx`** — Active indicator:
- Active workspace: replaced workspace-color bg/border with `rgba(255,255,255,0.08)` white tint
- Removed `border-2` class (no more colored border on active)
- Active icon color: workspace color → `var(--xevo-text)`
- Settings button: added `borderTop: 1px solid var(--xevo-border-subtle)` for visual separation

**`src/components/sidebar/Sidebar.tsx`** — Panel icons + server list:
- Panel icons: `p-1` (16px) → `w-8 h-8` (32px) with `rounded-[6px]`, icon size 11→14, strokeWidth 1.5
- Active panel: `bg-[var(--xevo-hover)]` → `bg-[var(--xevo-accent-dim)]` + `text-[var(--xevo-accent)]`
- Inactive hover: `var(--xevo-hover)` → `rgba(255,255,255,0.04)`
- Header borders: `var(--xevo-border)` → `var(--xevo-border-subtle)`
- Panel headers: `font-semibold` → `font-bold`, `tracking-widest` → `tracking-[0.09em]`
- Server items: `py-1.5` → `h-8`, port text 11px→12px medium, title 10px→11px truncated
- Server empty state: `text-[11px]` → `text-[12px]` with `text-[var(--xevo-text-muted)]`

**`src/components/browser/StatusBar.tsx`** — Load time format:
- Removed ✓ prefix from load time display
- Split into: `{loadTime}` in `var(--xevo-text-muted)` + ` ms` in `var(--xevo-text-faint)`
- Loading text already uses `var(--xevo-accent)` (white)

### Verification
- `pnpm tsc --noEmit` — clean
- `cargo check` — clean
- No logic changes, no store changes, no Rust changes, no new dependencies

## CHANGES THIS SESSION (Session 15 — v1.3.0 → v1.4.0, 9-issue fix pack)

### Issue 1 — Keyboard shortcuts when webview has focus
- **browser.rs**: `XEVO_SHORTCUT_FORWARD_SCRIPT` extended with Ctrl+?/F/L/1-9/Tab/Shift+Tab, Escape, Alt+Left/Right. Shared `forward()` helper with silent `.catch()` on invoke.
- **useKeyboardShortcuts.ts**: `xevo://shortcut` listener handles all new forwarded shortcuts. Ctrl+L dispatches `xevo:focus-address-bar` custom event.
- **AddressBar.tsx**: Listens for `xevo:focus-address-bar` to focus input from webview-forwarded Ctrl+L.

### Issue 2 — Modals behind webview
- **useWebviewBridge.ts**: Modal hide/show effect now watches `settingsPanelOpen` and `apiTesterOpen` in addition to command palette and shortcut help.

### Issue 3 — Tab drag ban icon
- **TabBar.tsx** + **TabItem.tsx**: Added `onDragEnter` with `preventDefault()` + `dropEffect = "move"` on outer container, inner scroll container, plus button, and each tab. WebView2 requires dragenter in addition to dragover.

### Issue 4 — Webview drag lag
- **No code change** — accepted Tauri 2.x architectural limitation per Session 10.6.

### Issue 5 — UI polish
- **HomePage.tsx**: Vertically centered hero (`flex flex-col items-center justify-center min-h-full`), larger workspace icon, "XEVO" heading with separate "Home" label.
- **ContentArea.tsx**: `flex flex-col` on container for proper HomePage centering.
- **SettingsPanel.tsx**: Section dividers, slide-in animation via `.xevo-settings-panel`, version string updated to v1.1.0.
- **index.css**: `@keyframes xevo-settings-slide-in` + `.xevo-settings-panel` class.

### Issue 6 — Search engine setting
- **AddressBar.tsx**: `resolveInput` now reads `searchEngine` + `customSearchUrl` from settings store (was hardcoded to Google).

### Issue 7 — Delete workspace
- **WorkspaceContextMenu.tsx**: New portal-rendered context menu with Delete option.
- **WorkspaceSwitcher.tsx**: Right-click on workspace icon opens menu; delete confirms, closes tabs, clears bookmarks, calls `deleteWorkspace`.

### Issue 8 — Theme on webview
- **browser.rs**: New `browser_set_theme(theme)` command evals `color-scheme` on webview document.
- **lib.rs**: Registered `browser_set_theme` (18 → 19 invoke handlers).
- **browser.ts**: New `setWebviewTheme()` service.
- **useWebviewBridge.ts**: `useEffect` watches theme setting, resolves system mode, calls `setWebviewTheme` when page loaded.

### Issue 9 — Console IPC errors
- **permissions/browser-webview.toml**: New permission allowing `update_tab_info`, `forward_shortcut`, `browser_bookmark_request`, `browser_find_callback` from browser window.
- **capabilities/browser.json**: New capability targeting `browser` window with above permission.
- **browser.rs**: Added `.catch(function() {})` on Rust-side title fallback `update_tab_info` invoke.
- Note: Website CSP violations, Tracking Prevention, and third-party analytics 503s remain external — not XEVO bugs.

### Verification
- `cd src-tauri && cargo check` — clean
- `pnpm tsc --noEmit` — clean
- invoke_handler count: 19
- Runtime GUI verification pending human `pnpm tauri dev`

## WORKTREE SNAPSHOT (Session 15)

```
src/components/sidebar/WorkspaceContextMenu.tsx  ← NEW
src-tauri/capabilities/browser.json              ← NEW
src-tauri/permissions/browser-webview.toml       ← NEW
src-tauri/src/commands/browser.rs                ← shortcut script, browser_set_theme
src-tauri/src/lib.rs                             ← browser_set_theme registered
src/hooks/useKeyboardShortcuts.ts                ← extended xevo://shortcut handlers
src/hooks/useWebviewBridge.ts                    ← modal hide/show + theme sync
src/services/browser.ts                          ← setWebviewTheme
src/components/browser/AddressBar.tsx            ← search engine + focus event
src/components/browser/TabBar.tsx                ← onDragEnter handlers
src/components/browser/TabItem.tsx               ← onDragEnter prop
src/components/browser/ContentArea.tsx           ← flex layout
src/components/panels/HomePage.tsx                 ← centered hero
src/components/panels/SettingsPanel.tsx          ← polish + v1.1.0 version
src/components/sidebar/WorkspaceSwitcher.tsx     ← workspace delete context menu
src/index.css                                    ← settings slide-in animation
```

## CHANGES THIS SESSION (Session 16 — v1.4.0 → v1.5.0)

### Feature 1: Pointer-Based Tab Reorder (replaces broken HTML5 DnD)
- **Problem:** HTML5 drag-and-drop is fundamentally broken in WebView2 on Windows. The cursor shows a "ban" circle (⊘) on drop. 9 bug fixes in prior sessions couldn't fix it because the issue is in the platform layer, not the code logic.
- **Solution:** Replaced all HTML5 DnD events (`onDragStart`, `onDragOver`, `onDrop`, `onDragEnd`) with pointer events (`onPointerDown`, `onPointerMove`, `onPointerUp`).
- **`src/components/browser/TabBar.tsx`** — Full rewrite. Removed: `dragTabId`/`dragOverTabId`/`dropAtEnd` state, all DnD handlers (`handleDragStart`, `handleDragOver`, `handleDrop`, `handleDragEnd`, etc.), `justDroppedAtPlusRef`. Added: `handlePointerDown` (captures pointer, caches tab rects, creates ghost element), `handlePointerMove` (moves ghost, hit-tests cached rects, updates drop target), `handlePointerUp` (executes reorder via `reorderTabs()`, cleans up ghost). Uses refs for mid-drag state (no re-renders during drag) and state for rendering (only `draggingTabId` and `dropTarget`).
- **`src/components/browser/TabItem.tsx`** — Simplified. Removed all DnD props (`onDragStart`, `onDragEnd`, `onDragEnter`, `onDragOver`, `onDragLeave`, `onDrop`, `isDragOver`). Added: `onPointerDown`, `isDropTarget`, `isDragging`. Removed `draggable={true}` attribute, `justDraggedRef`, drag-start click guard. Added `data-tab-id` attribute for rect caching. Changed `cursor-grab active:cursor-grabbing` to just `cursor-grab`.
- **No backend changes** — `reorderTabs()` in `stores/workspaces.ts` stays unchanged.

### Feature 2: OS-Level Global Shortcuts (replaces CSP-blocked injected JS)
- **Problem:** When the user clicks inside the browser webview, focus moves to the separate WebviewWindow. The main React window stops receiving keyboard events. The previous workaround (injecting JS into pages via `XEVO_SHORTCUT_FORWARD_SCRIPT` that calls `__TAURI_INTERNALS__.invoke("forward_shortcut")`) fails on sites with strict CSP (GitHub, etc.) because `ipc-src` or `connect-src` policies block the Tauri IPC call.
- **Solution:** Use `tauri-plugin-global-shortcut` to register OS-level hotkeys that fire regardless of which window has focus.
- **`src-tauri/Cargo.toml`** — Added `tauri-plugin-global-shortcut = "2"`.
- **`src-tauri/src/lib.rs`** — Added `.plugin(tauri_plugin_global_shortcut::Builder::new().build())`. Removed `forward_shortcut` from invoke_handler (18 entries now).
- **`src-tauri/capabilities/default.json`** — Added `global-shortcut:allow-register`, `global-shortcut:allow-unregister`, `global-shortcut:allow-is-registered` permissions.
- **`package.json`** — Added `@tauri-apps/plugin-global-shortcut` dependency (v2.3.2).
- **`src/hooks/useKeyboardShortcuts.ts`** — Extracted shortcut handler into shared `handleShortcut(shortcut, bridge)` function. Kept main-window keydown listener (Mechanism 1) for when React UI has focus (includes input/textarea guards). Added global shortcut registration (Mechanism 2) via `register()` from `@tauri-apps/plugin-global-shortcut` — registers 25 shortcuts (`CommandOrControl+K`, `CommandOrControl+T`, etc.). Normalizes shortcut format (`CommandOrControl+` → `ctrl+`). Both mechanisms call the same handler; all actions are idempotent so double-handling is harmless. Removed `listen("xevo://shortcut")` listener.
- **`src-tauri/src/commands/browser.rs`** — Removed `XEVO_SHORTCUT_FORWARD_SCRIPT` constant (~100 lines of injected JS). Removed `forward_shortcut` command function. Removed `.initialization_script(XEVO_SHORTCUT_FORWARD_SCRIPT)` from `ensure_browser_window`.

### Files changed
- `src/components/browser/TabBar.tsx` — full rewrite (pointer-based drag)
- `src/components/browser/TabItem.tsx` — simplified (removed DnD props)
- `src/hooks/useKeyboardShortcuts.ts` — rewritten (global shortcuts + shared handler)
- `src-tauri/Cargo.toml` — added tauri-plugin-global-shortcut
- `src-tauri/src/lib.rs` — registered plugin, removed forward_shortcut
- `src-tauri/capabilities/default.json` — added global-shortcut permissions
- `src-tauri/src/commands/browser.rs` — removed shortcut forwarding script + command
- `package.json` — added @tauri-apps/plugin-global-shortcut

### Verification
- `cd src-tauri && cargo check` — clean
- `pnpm tsc --noEmit` — clean (only pre-existing Zustand selector type issues)
- invoke_handler count: 18 (removed forward_shortcut)

## CHANGES THIS SESSION (Session 17 — v1.5.0 → v1.6.0)

### Overlay Panel System (split-view architecture)
**Problem:** The browser webview is a separate OS-level `WebviewWindow` that sits ABOVE the main Tauri window in z-order. React's `position: fixed; z-index: 9999` overlays cannot appear above it. The previous workaround was to HIDE the webview when any overlay opened (command palette, settings, API tester, etc.), causing a "black screen" when the full API tester was opened.

**Solution:** Split-view overlay pattern. When an overlay panel opens (API tester or Notes notepad), the webview is RESIZED (not hidden) to occupy the bottom portion of the content area. The overlay panel renders in the freed-up top portion. Both are visible simultaneously.

**How it works:**
1. `ui.ts` store gains `overlayPanel: "none" | "api-tester" | "notes-notepad"` and `overlayHeight: number` (0.0-1.0, default 0.4)
2. `getBounds()` in `useWebviewBridge.ts` reduces the webview height by `overlayHeight * contentArea.height` when an overlay is active
3. `OverlayPanel.tsx` renders as `position: absolute; top: 0; height: overlayHeight%` inside the content area's relative container
4. The overlay has a drag handle at the bottom for resizing
5. Esc key closes the overlay panel
6. `isChromeOverlayOpen()` no longer includes `apiTesterOpen` — overlay panels don't hide the webview

### History Panel
- **New store:** `src/stores/history.ts` — Zustand + persist (localStorage key: `xevo-history`). `HistoryEntry = { id, url, title, favicon, timestamp, workspaceId }`. Max 100 entries (FIFO). Actions: `addEntry`, `removeEntry`, `clearForWorkspace`, `clearAll`.
- **New component:** `src/components/sidebar/HistoryPanel.tsx` — Groups entries by date (Today, Yesterday, Earlier). Each row: favicon, title, domain, relative time. Hover reveals: open, delete icons. Header with "Clear all" (window.confirm). Empty state with clock icon.
- **Navigation hook:** `useWebviewBridge.ts` now calls `historyStore.addEntry()` on both explicit navigation (address bar Enter) and in-page navigation (onUrlChanged events).

### Notes System (Quick Notes + Full Notepad)
- **New store:** `src/stores/notes.ts` — Zustand + persist (localStorage key: `xevo-notes`). `Note = { id, workspaceId, title, content, createdAt, updatedAt }`. Actions: `createNote`, `updateNote`, `deleteNote`, `getNotesByWorkspace`.
- **New component:** `src/components/sidebar/NotesSidebarPanel.tsx` — "Open Notes" button (opens full notepad overlay). Quick notes section: vertical list of note cards with expand/collapse, inline rename, delete. Add note button (+).
- **New component:** `src/components/panels/NotesNotepad.tsx` — Full notepad for overlay. Split layout: note list sidebar (search, new note button) + editor (title input, textarea with auto-save, word/char count). Per-workspace filtering.

### API Tester Integration
- **Modified:** `ApiTesterPanel.tsx` — "Open API Tester" button now calls `openOverlay("api-tester")` instead of `openApiTester()`.
- **Modified:** `ApiTester.tsx` — `embedded` mode now renders `<EmbeddedBody />` directly without `bg-[var(--xevo-content-bg)]` (overlay provides the background).
- **Modified:** `CommandPalette.tsx` — "Open API Tester" command now calls `openOverlay("api-tester")`.
- **Modified:** `RootLayout.tsx` — Removed `ApiTester` import and the `{apiTesterOpen && <ApiTester />}` modal rendering (now handled by overlay in BrowserChrome).
- **Modified:** `BrowserChrome.tsx` — Mounts `<OverlayPanel>` with `apiTesterContent` and `notesContent` props.

### Files changed
- `src/types/index.ts` — Added `OverlayPanelId`, `HistoryEntry`, `Note` types
- `src/stores/ui.ts` — Added `overlayPanel`, `overlayHeight` state + `openOverlay`, `closeOverlay`, `setOverlayHeight` actions
- `src/stores/history.ts` — NEW: history store with persist
- `src/stores/notes.ts` — NEW: notes store with persist
- `src/components/overlay/OverlayPanel.tsx` — NEW: overlay panel with drag-to-resize
- `src/components/sidebar/HistoryPanel.tsx` — NEW: sidebar history panel
- `src/components/sidebar/NotesSidebarPanel.tsx` — NEW: sidebar notes panel (quick notes)
- `src/components/panels/NotesNotepad.tsx` — NEW: full notepad for overlay
- `src/components/panels/ApiTester.tsx` — Updated embedded mode styling
- `src/components/sidebar/ApiTesterPanel.tsx` — Uses openOverlay instead of openApiTester
- `src/components/sidebar/Sidebar.tsx` — Renders HistoryPanel and NotesSidebarPanel
- `src/components/browser/BrowserChrome.tsx` — Mounts OverlayPanel with content
- `src/components/layout/RootLayout.tsx` — Removed old ApiTester modal
- `src/components/CommandPalette.tsx` — Updated API tester command
- `src/hooks/useWebviewBridge.ts` — getBounds accounts for overlay height, history recording, isChromeOverlayOpen excludes overlayPanel, overlay bounds sync effect

### Verification
- `cd src-tauri && cargo check` — clean
- `pnpm tsc --noEmit` — clean
- invoke_handler count: 18 (unchanged — no Rust changes)

## CHANGES THIS SESSION (Session 18 — v1.6.0 → v1.7.0)

### Advanced Notes with Rich Text Editor

**Library:** `@tolipovjs/rich-text@2.2.0` — ~22KB gzipped, CSS-variable theming, no Tailwind dependency.

### Title Bug Fix
- **Root cause:** `handleTitleCommit` / `handleTitleChange` had `value.trim() || "Untitled"` fallback that overwrote empty titles. New notes started with `title: "Untitled"` which couldn't be cleared.
- **Fix:** Titles now allow empty strings. `placeholder="Untitled"` shown in input only. Sidebar displays `note.title || "Untitled"` for display only. New notes created with `title: ""`.

### Rich Text Editor Integration
- **`src/components/panels/NotesNotepad.tsx`** — Full rewrite. Replaced `<textarea>` with `<RichTextEditor>` from `@tolipovjs/rich-text`. Features enabled:
  - Toolbar (basic preset: bold, italic, underline, headings, lists, code, quote, link, image, undo/redo)
  - Slash menu (`/` command palette)
  - Markdown shortcuts (`**bold**`, `# heading`, `- list`, `> quote`, `` `code` ``, `---`)
  - Bubble toolbar (floating toolbar on text selection)
  - Find & replace (Ctrl+F popup)
  - Theme-aware (`theme` prop reads from XEVO settings: dark/light/auto)
  - Auto-save with 500ms debounce
  - `key={selectedId}` forces remount on note switch (fixes stale content)
  - Export as Markdown `.md` file (blob download fallback when Tauri dialog/fs plugins unavailable)
  - Enhanced footer: char count + word count + reading time estimate

### Note Pinning & Colors
- **`src/types/index.ts`** — Added `NoteColor` type (`"" | "red" | "orange" | "yellow" | "green" | "blue" | "purple"`). Added `isPinned: boolean` and `color: NoteColor` to `Note` interface.
- **`src/stores/notes.ts`** — Added `isPinned`/`color` fields, `togglePin`/`setColor` actions, pinned-first sorting via `sortNotes()` helper.
- **`src/components/panels/NotesNotepad.tsx`** — Pin button (toggle), color picker (6 options with dropdown), color dot in note list, pin icon in note list.
- **`src/components/sidebar/NotesSidebarPanel.tsx`** — Pin indicator, color dots, HTML preview for expanded notes.

### CSS Theme Mapping
- **`src/index.css`** — Added `@import "@tolipovjs/rich-text/styles.css"`. Added 30+ `--rte-*` CSS variable overrides in both `[data-theme="dark"]` and `[data-theme="light"]` blocks, mapping XEVO's `--xevo-*` tokens to the editor's `--rte-*` variables.

### Files changed
- `src/index.css` — Added rich-text CSS import + --rte-* variable mappings (dark + light themes)
- `src/types/index.ts` — Added NoteColor type, isPinned/color fields on Note
- `src/stores/notes.ts` — Added isPinned/color, togglePin/setColor, sortNotes helper
- `src/components/panels/NotesNotepad.tsx` — Full rewrite: RichTextEditor, pin/color/export/reading-time
- `src/components/sidebar/NotesSidebarPanel.tsx` — Fixed title bug, added pin/color indicators, HTML preview
- `package.json` — Added @tolipovjs/rich-text@2.2.0

### Verification
- `cd src-tauri && cargo check` — clean
- `pnpm tsc --noEmit` — clean
- invoke_handler count: 18 (unchanged — no Rust changes)

## WORKTREE SNAPSHOT (2026-06-09)
```text
.gitignore
.vscode\extensions.json
AGENTS.md
ARCHITECTURE.md
README.md
TASKS.md
PROJECT_STATE.md
components.json
index.html
package.json
pnpm-workspace.yaml
tsconfig.json
tsconfig.node.json
vite.config.ts

public\tauri.svg
public\vite.svg

src\App.tsx
src\main.tsx
src\index.css                      ← + @tolipovjs/rich-text/styles.css import
                                         + --rte-* CSS variable mappings (dark + light)
src\vite-env.d.ts
src\types\index.ts                 ← + OverlayPanelId, HistoryEntry, Note, NoteColor types
src\lib\utils.ts
src\lib\workspaceTabs.ts
src\lib\bookmarkAction.ts

src\stores\tabs.ts
src\stores\workspaces.ts
src\stores\settings.ts
src\stores\ui.ts                  ← + overlayPanel, overlayHeight, openOverlay/closeOverlay
src\stores\servers.ts
src\stores\bookmarks.ts
src\stores\apiHistory.ts
src\stores\history.ts             ← NEW: history store (persist)
src\stores\notes.ts               ← + isPinned/color, togglePin/setColor, sortNotes

src\services\browser.ts

src\hooks\useWebviewBridge.ts     ← removed onFocusChanged listener + repaintWebview import
src\hooks\useKeyboardShortcuts.ts
src\hooks\usePortScanner.ts

src\components\CommandPalette.tsx  ← openOverlay for API tester
src\components\ShortcutHelp.tsx
src\components\Toast.tsx

src\components\layout\RootLayout.tsx      ← removed ApiTester modal
src\components\overlay\OverlayPanel.tsx   ← NEW: overlay panel with drag-resize

src\components\sidebar\Sidebar.tsx          ← renders HistoryPanel + NotesSidebarPanel
src\components\sidebar\WorkspaceSwitcher.tsx
src\components\sidebar\BookmarksPanel.tsx
src\components\sidebar\ApiTesterPanel.tsx   ← uses openOverlay
src\components\sidebar\HistoryPanel.tsx     ← NEW: history sidebar panel
src\components\sidebar\NotesSidebarPanel.tsx ← fixed title bug, pin/color indicators
src\components\sidebar\WorkspaceContextMenu.tsx

src\components\browser\TabBar.tsx
src\components\browser\TabItem.tsx
src\components\browser\TabContextMenu.tsx
src\components\browser\AddressBar.tsx
src\components\browser\BrowserChrome.tsx   ← mounts OverlayPanel
src\components\browser\LoadingBar.tsx
src\components\browser\FindBar.tsx
src\components\browser\StatusBar.tsx
src\components\browser\ContentArea.tsx

src\components\panels\ApiTester.tsx         ← updated embedded mode
src\components\panels\NotesNotepad.tsx ← RichTextEditor, pin/color/export/reading-time
src\components\panels\HomePage.tsx
src\components\panels\SettingsPanel.tsx
src\components\panels\JwtDecoder.tsx
src\components\panels\Base64Tool.tsx

src\components\ui\badge.tsx
src\components\ui\button.tsx
src\components\ui\input.tsx
src\components\ui\separator.tsx
src\components\ui\tooltip.tsx

src-tauri\.gitignore
src-tauri\Cargo.toml
src-tauri\Cargo.lock
src-tauri\tauri.conf.json
src-tauri\build.rs
src-tauri\capabilities\default.json
src-tauri\icons\ (18 icon files)

src-tauri\src\main.rs
src-tauri\src\lib.rs                ← .setup() block (minimize tracking + max/unmax cycle) + 20 invoke handlers
src-tauri\src\commands\mod.rs
src-tauri\src\commands\browser.rs   ← do_browser_repaint is now no-op (superseded by lib.rs)
src-tauri\src\commands\ports.rs
```

## CHANGES THIS SESSION (Session 20 — bookmark shortcut registration fix)

- **`src/hooks/useKeyboardShortcuts.ts`** — replaced the invalid global shortcut token `CommandOrControl+Shift+?` with `CommandOrControl+Shift+/`, and taught the shared shortcut handler to treat `ctrl+shift+/` the same as `ctrl+?` so the help overlay still opens when the browser webview has focus.
- **Scope kept tight** — bookmark storage, Rust commands, and all other shortcut branches were left unchanged.
- **Verification note** — `cmd /c npx --no-install tsc --noEmit` passed after `pnpm` was unavailable in this shell and `corepack pnpm` hit a sandboxed network lookup.

## CHANGES THIS SESSION (Session 21 — global shortcut lifecycle stabilization)

- **`src/hooks/useKeyboardShortcuts.ts`** — wrapped the `tauri-plugin-global-shortcut` register/unregister path in a serialized queue with a module-scoped registration flag so React StrictMode remounts cannot overlap `register()` with `unregisterAll()`.
- **Behavior preserved** — the React keydown listener and all shortcut actions remain unchanged; only the lifecycle around OS-level shortcut registration was hardened.
- **Verification note** — `cmd /c npx --no-install tsc --noEmit` passed after the lifecycle guard landed.

## CHANGES THIS SESSION (Session 22 - pre-plugin shortcut bridge restored)

- **`src/hooks/useKeyboardShortcuts.ts`** - removed the global-shortcut plugin path and restored the `xevo://shortcut` listener so browser-focus shortcuts are handled through the injected webview bridge again.
- **`src-tauri/src/commands/browser.rs`** - reintroduced `XEVO_SHORTCUT_FORWARD_SCRIPT` and the `forward_shortcut` Rust command, while keeping the separate bookmark script intact.
- **`src-tauri/src/lib.rs`, `src-tauri/Cargo.toml`, `src-tauri/capabilities/default.json`, `package.json`** - removed the global-shortcut plugin registration, dependency, and permissions; the browser webview now uses the old injected forwarding architecture instead.
- **Verification note** - `cmd /c npx --no-install tsc --noEmit` and `cd src-tauri; cargo check` both passed after the rollback.

## CHANGES THIS SESSION (Session 23 — black screen on window restore)

### Bug: Black screen when restoring minimized window
**Root cause:** WebView2 on Windows does not always issue a WM_PAINT after the parent window is restored from minimize. The rendering surface is stale — the webview's content is still painted in memory, but the OS never requests a repaint, so the window shows black. Microsoft's official docs explicitly state: *"WebView2 as a child window does not get window messages when the top window is minimized or restored. For performance reasons, developers should set IsVisible property of the WebView to FALSE when the app window is minimized and back to TRUE when app window is restored."*

### Fix: Hide + Show cycle (Microsoft's put_IsVisible pattern adapted for Tauri)
**`src-tauri/src/commands/browser.rs`** — `browser_repaint` command rewritten:
- Original Fix A (JS eval with `display:none` + `offsetHeight` trick) did NOT work — the problem is at the native compositing level, not the DOM level
- New approach: `wv.hide()` + 50ms delay + `wv.show()` — this forces the OS to tear down and rebuild the window surface, making WebView2 issue a fresh WM_PAINT
- Equivalent to the `put_IsVisible(FALSE)` / `put_IsVisible(TRUE)` pattern from the `ICoreWebView2Controller` docs
- The 50ms delay ensures the OS fully processes the hide before the show
- Trade-off: brief 50ms dark flash (browser window hidden during this time) — acceptable vs permanent black screen

### Frontend (unchanged from Session 23)
- `useWebviewBridge.ts` `onFocusChanged` handler calls `repaintWebview()` on window restore
- Only fires when `focused === true` with an active URL loaded
- 100ms delay before calling Rust command

### Files changed
- `src-tauri/src/commands/browser.rs` — rewrote `browser_repaint` from JS eval to hide+show cycle
- `src-tauri/src/lib.rs` — registered `browser_repaint` (19 → 20 invoke handlers)
- `src/services/browser.ts` — added `repaintWebview()` export
- `src/hooks/useWebviewBridge.ts` — added `repaintWebview` import + `onFocusChanged` useEffect

### Verification
- `cd src-tauri && cargo check` — clean
- `pnpm tsc --noEmit` — clean
- invoke_handler count: 20
- Runtime GUI verification pending human `pnpm tauri dev`:
  1. Navigate to any URL (e.g. github.com)
  2. Minimize the XEVO window
  3. Wait 3-5 seconds
  4. Restore the XEVO window
  5. Browser should show the page immediately (brief 50ms dark flash acceptable) — NO permanent black screen
  6. Repeat 3 times to confirm consistency

## CHANGES THIS SESSION (v1.7.6 → v1.9.0 — XEVO_FRONTEND.md design system)

### P1 — Foundation (Session 28)
- **`src/index.css`**: Added `@custom-variant dark` for Tailwind v4 dark mode via `data-theme` attribute. Wrapped all design tokens in `@theme { ... }` block (colors, fonts, spacing, radius, motion). Added `@media (prefers-reduced-motion: reduce)` global rule. Added `@keyframes ambientPulse`, `paletteIn`, `toastIn`.
- **`src-tauri/tauri.conf.json`**: Added `"decorations": false` + `"transparent": false` to main window.

### P2 — Components (Session 28)
- **`src/components/panels/HomePage.tsx`**: Redesigned per spec §10 — centered 720px column, "Your stack, at a glance." heading (24px/600), 64px server cards with liveness dot + port + "Open →", ambient radial gradient pulse (3s infinite), italic empty state.
- **`src/components/CommandPalette.tsx`**: 80ms `paletteIn` animation (fade + scale 0.97→1.0), input height 44px, results max-height 320px, result items 32px, border-radius 6px, accent-dim selected state.
- **`src/components/sidebar/Sidebar.tsx`**: Always rendered (no `return null`), width transitions 150ms ease-snap between `sidebarWidth` and `0`.
- **`src/components/Toast.tsx`**: 100ms `toastIn` animation (was 200ms), inline `<style>` removed.

### P3 — Polish (Session 29)
- **aria-labels**: Added `aria-label` to 34 icon-only buttons across 17 files (TabItem, TabBar, Toolbar, FindBar, Sidebar, WorkspaceSwitcher, SettingsPanel, OverlayPanel, ShortcutHelp, ApiTester, NotesNotepad, HistoryPanel, BookmarksPanel, HomePage, etc.)
- **tabular-nums**: Added `font-feature-settings: "tnum" 1` or `tabular-nums` to 10 numeric elements (StatusBar load time, ApiTester status/duration/size, FindBar match counter, port numbers).
- **Shadows removed**: `shadow-lg` from Toast + context menu, `shadow-[...]` from AddressBar, `shadow-xs` from ui/input + ui/button, `box-shadow` transition from badge, drag ghost boxShadow from TabBar. Kept: liveness dot glow + input focus ring.
- **hover:scale removed**: `hover:scale-110` from NotesNotepad color picker.
- **tauri-controls wired**: Added `tauri-plugin-os` to Cargo.toml + lib.rs. Added `os:default` + window permissions to capabilities. TabBar uses `WindowControls` component — detects OS via `platform()`, renders controls on correct side (macOS: left, Windows/Linux: right). Removed hardcoded `paddingRight: 140px`.

### Verification
- `pnpm tsc --noEmit` — clean
- `cargo check` — clean (21 invoke_handler entries)
- Runtime GUI verification pending human `pnpm tauri dev`

## CHANGES THIS SESSION (Session 31 — v1.10.0 → v1.11.0 — browser webview drag-after-restore fix)

### Root cause
On Windows, `onMoved` is **unreliable for maximize/unmaximize** (tao uses `WM_WINDOWPOSCHANGED` with `SWP_NOMOVE` gate — confirmed via [tauri #7664](https://github.com/tauri-apps/tauri/issues/7664), closed "not planned"). After the lib.rs maximize/unmaximize hack fires, `onMoved` may not re-fire for subsequent drags because the hack's intermediate events desync `lastBoundsRef`.

### Fix — `src/hooks/useWebviewBridge.ts`
- **Ref-based syncBounds**: `syncBoundsRef.current` holds the latest sync logic; `syncBounds = useCallback(() => syncBoundsRef.current(), [])` has a stable identity. Eliminates stale-closure bugs and prevents onMoved/onResized effects from re-registering across re-renders.
- **onResized listener**: Added alongside onMoved. `onResized` is **always reliable** for maximize/unmaximize (WM_SIZE fires unconditionally). 50ms delay lets DOM reflow after the lib.rs repaint hack.
- **Maximize-state detection**: `wasMaximizedRef` tracks maximize state via `onResized` + `isMaximized()`. On transition, resets `lastBoundsRef = null` to force a full re-sync (bypasses 5px threshold).
- **onMoved throttle**: 16ms throttle + `requestAnimationFrame` reduces Rust calls from ~60/sec to ~60/sec (one per frame) during drag.
- **getBounds inlined**: The standalone `getBounds` useCallback was removed. Bounds computation is now inlined into `syncBoundsRef.current`, `ensureWebviewVisible`, `navigate`, `goBack`, `goForward`, `sidebar toggle effect`, and `tab-switch effect`. All read `contentAreaRef.current` fresh at call time via ref.
- **lib.rs hack kept**: The maximize/unmaximize hack (lines 28-44) is **required** for WebView2 to re-composite after minimize→restore. Removing it causes black screen regression (confirmed across Sessions 23-27, 5 failed fix attempts).

### What is NOT changed
- `src-tauri/src/lib.rs` — no changes (hack kept as-is)
- `src-tauri/src/commands/browser.rs` — no changes
- All other files — no changes

### Verification
- `pnpm tsc --noEmit` — clean
- `cargo check` — clean
- Runtime verification pending human `pnpm tauri dev`:
  - Maximize → restore → drag → browser webview follows
  - Minimize → restore → webview appears (no black screen)
  - Normal drag → browser webview follows
  - Window resize → browser webview resizes

## CHANGES THIS SESSION (Session 32 — v1.11.0 → v1.11.1 — main window drag fix)

### Root cause
Tauri's injected `drag.js` walks the composed event path from the click target upward. For the bare `data-tauri-drag-region` attribute (no value), the `isDragRegion` function returns `true` **only** when `el === composedPath[0]` — meaning the click target must be the exact element with the attribute, not any of its children. The TabBar had this bare attribute on its outer div, so clicking on any `<TabItem>`, the `+` button, or any other child element did NOT trigger drag. Only clicking on the tiny empty padding area between elements worked.

### Fix — `src/components/browser/TabBar.tsx`
- Changed `data-tauri-drag-region` → `data-tauri-drag-region="deep"` on the outer TabBar div (line 225).
- With `"deep"`, `isDragRegion` returns `true` for any click within the subtree. The `data-tauri-drag-region="false"` on WindowControls still blocks drag on minimize/maximize/close buttons (the `"false"` check runs first and short-circuits the walk).
- React's `onPointerDown`/`onPointerMove`/`onPointerUp` handlers on TabBar (for tab reordering) coexist with Tauri's `mousedown`-based drag detection. Pointer events and mouse events are separate event streams; `setPointerCapture` only affects pointer events.

### What is NOT changed
- `src-tauri/src/lib.rs` — no changes (maximize/unmaximize hack kept as-is)
- `src-tauri/src/commands/browser.rs` — no changes
- `src/hooks/useWebviewBridge.ts` — no changes
- `src/components/browser/WindowControls.tsx` — no changes (keeps `data-tauri-drag-region="false"`)

### Verification
- `pnpm tsc --noEmit` — clean
- `cargo check` — clean
- Runtime verification pending human `pnpm tauri dev`:
  - Click on any tab → window drag works
  - Click on empty tab bar space → window drag works
  - Click on minimize/maximize/close → buttons work, no drag
  - Double-click on tab bar → toggles maximize
  - Maximize → restore → drag → works
  - Normal drag → works

## CHANGES THIS SESSION (Session 33 — v1.11.1 → v1.11.2 — minimize glitch fix)

### Root cause
When the user clicks minimize, `onMoved` and `onResized` fire in `useWebviewBridge.ts` during the OS minimize animation. These trigger `syncBounds()` → `browser_set_bounds` → `set_position()`/`set_size()` on the browser WebviewWindow. On Windows, calling `SetWindowPos` (which Tauri's `set_position` uses under the hood) on a window that is mid-minimize causes it to un-minimize. Result: the window minimizes for ~1ms then reappears.

### Fix
- **`src-tauri/src/lib.rs`**: Added `use tauri::Emitter` import. In the existing `Focused(false)` + `is_minimized()` handler, emit `app_handle.emit("xevo://minimize-state", true)`. In the `Focused(true)` + `was_minimized` handler, emit `app_handle.emit("xevo://minimize-state", false)` before the repaint hack.
- **`src/hooks/useWebviewBridge.ts`**: Added `import { listen }` from `@tauri-apps/api/event`. Added `isMinimizedRef`. Added guard `if (isMinimizedRef.current) return;` at the top of `syncBoundsRef.current`. Added `useEffect` listening for `xevo://minimize-state` events to toggle the ref.

### What is NOT changed
- `src-tauri/src/commands/browser.rs` — no changes
- `src/components/browser/WindowControls.tsx` — no changes
- All navigation, tab switching, maximize/restore, drag-follow, overlay panels, sidebar toggle, find-in-page, bookmarks, shortcuts — untouched

### Verification
- `cargo check` — clean
- `pnpm tsc --noEmit` — clean
- Runtime verification pending human `pnpm tauri dev`:
  - Navigate to a page (e.g. github.com), click minimize → should minimize cleanly without flash
  - Restore from minimize → page still visible, no black screen
  - Maximize → restore → minimize → works
  - Drag window → webview still follows
  - Tab switch, navigation, overlays → all unaffected

## CHANGES THIS SESSION (Session 35 — v1.12.0 → v1.12.1)

### Part A — Fixed duplicated bookmark URL display
**Root cause:** Case (a) — title and url were the same string (store falls back to URL when no `document.title`), rendered as two adjacent inline `<span>` elements inside a plain `<div>` (no flex-col). Visually appeared as "https://github.com/https://github.com/" with only `ml-2` gap.
**Fix:** `src/components/panels/HomePage.tsx` — converted inner div to `flex flex-col gap-0.5` and changed URL sublabel color from `text-text-disabled` to `text-text-muted` (slightly more visible, matches sidebar panel styling). BookmarksPanel.tsx was already correct (uses stacked `<div>` elements + `getHost()` sublabel).

### Part B — Fixed ambient gradient not rendering
**Root cause:** Gated-behind-servers. The gradient div was wrapped in `{liveServers.length > 0 && ...}`. When no servers detected (empty state), the gradient never rendered. The `ambientPulse` keyframe existed correctly in `index.css:357-361`.
**Fix:** `src/components/panels/HomePage.tsx` — removed the conditional guard. The gradient now always renders in the Live Servers `<section>` regardless of server count.

### Part C — Fixed active tab accent border
**Root cause:** `tailwind-merge` conflict. `cn()` = `clsx` + `twMerge`. `border-b-2` (width) and `border-b-[var(--color-accent)]` (color) were merged into the same conflict group because tailwind-merge doesn't statically recognize arbitrary-value border colors. The later value won but was a color, not a width — browser ignored it, leaving no border.
**Fix:** `src/components/browser/TabItem.tsx` — removed `border-b-[var(--color-accent)]` and `border-b-transparent` from className. Border color now handled entirely via inline `style` prop (`borderBottomColor` based on `isActive`/`isDropTarget`).

### Part D — Restored workspace active-state distinguishability
**Root cause:** Session 13 "Refined Monochrome" changed active workspace from colored left-border to plain white tint. All workspace icons looked generic.
**Fix:** `src/components/sidebar/WorkspaceSwitcher.tsx` — added `borderLeft: 2px solid ${workspace.color}` when active (using the existing `workspace.color` field from the Workspace type). Kept accent-dim background tint for additional differentiation.

### Part E — Loosened home page section spacing
**Fix:** `src/components/panels/HomePage.tsx` — hero div `mb-10` (40px) → `mb-14` (56px). Live Servers section `mb-8` (32px) → `mb-12` (48px). Internal section spacing unchanged.

### Files modified
- `src/components/panels/HomePage.tsx` — Parts A, B, E
- `src/components/browser/TabItem.tsx` — Part C
- `src/components/sidebar/WorkspaceSwitcher.tsx` — Part D

### Verification
- `pnpm tsc —noEmit` — clean
- No Rust changes, no new dependencies, no store changes

## CHANGES THIS SESSION (Session 37 — v1.12.2 → v1.13.0)

### Network Request Log
- Extended `BROWSER_INIT_SCRIPT` in `src-tauri/src/commands/browser.rs` with fetch/XHR monkeypatching. Captures method, URL, status, headers, body, timing. Changed raw string delimiter from `r#"..."#` to `r##"..."##` for safety.
- New `network_log_entry` Rust command receives entries from webview JS and emits `xevo://network-entry` events.
- New `src/stores/network.ts` — session-only Zustand store, 200 entry limit per tab, newest-first.
- New `src/components/panels/NetworkPanel.tsx` — real-time network log with method/URL filters, expandable rows with request/response headers + body, Copy as cURL, color-coded method badges and status codes.

### Custom Header Injection
- `BROWSER_INIT_SCRIPT` includes `__xevoUrlMatches` (glob-to-regex URL matcher) and `__xevoInjectHeaders` (applies matching rules to requests). Both fetch and XHR monkeypatches inject headers before sending.
- New `browser_update_header_rules` Rust command evals `window.__XEVO_HEADER_RULES = [...]` in all open browser webviews.
- New `src/stores/headers.ts` — workspace-scoped header rules, persisted to localStorage.
- New `src/components/panels/HeadersPanel.tsx` — rule management with URL pattern input, quick-pick chips for common header names (Authorization, Content-Type, etc.), toggle/delete rules, debounced push to webviews.

### Inspector Panel (Meta / Cookies / Storage)
- New `browser_eval_inspector` Rust command evals JavaScript in a tab's webview to collect meta tags, cookies, or web storage data.
- New `inspector_data` Rust command receives collected data and emits `xevo://inspector-data` events.
- New `inspector_mutate` Rust command performs write operations (set/delete/clear cookies, set/delete/clear storage).
- New `src/stores/inspector.ts` — session-only Zustand store for inspector state.
- New `src/components/panels/InspectorPanel.tsx` — three sub-tabs: META (SEO checklist, grouped meta tags, og:image preview), COOKIES (read/edit/delete non-HttpOnly cookies, add new), STORAGE (localStorage + sessionStorage with inner toggle, edit/delete/clear). Auto-refreshes every 3 seconds.

### Sidebar Expansion
- PanelId extended with `"headers" | "inspector"` in `src/types/index.ts`.
- `src/components/sidebar/Sidebar.tsx` — 10 panels now (was 8). Added Shield + FlaskConical icons. Network panel "Coming soon" placeholder replaced with actual NetworkPanel component.

### Event Wiring
- `src/hooks/useWebviewBridge.ts` — subscribes to `xevo://network-entry` and `xevo://inspector-data` events, routes to appropriate stores.
- `src/services/browser.ts` — 5 new exports: `onNetworkEntry`, `updateHeaderRules`, `evalInspector`, `onInspectorData`, `inspectorMutate`.

### New files
- `src/stores/network.ts`
- `src/stores/headers.ts`
- `src/stores/inspector.ts`
- `src/components/panels/NetworkPanel.tsx`
- `src/components/panels/HeadersPanel.tsx`
- `src/components/panels/InspectorPanel.tsx`

### Verification
- `cd src-tauri && cargo check` — clean
- `pnpm tsc --noEmit` — clean
- Rust command count: 26

## Session 38 — Manual Rescan Button

### LiveServersPanel rescan button
- `src/components/sidebar/Sidebar.tsx`: imported `RefreshCw` (lucide) + `usePortScanner`, added `const { scan } = usePortScanner()` inside `LiveServersPanel`, added a 20px refresh button in the header row (next to scan status). Disabled + spinning while `isScanning`. Previously dead `scan` return value is now wired up.

### Verification
- `pnpm build` — clean

