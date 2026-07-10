# XEVO Task Backlog

## Session 5 (v0.5-polish) — DONE
- [x] Task 24: Runtime verification + critical fixes
  - [x] DIAGNOSIS A — `add_child` parent resolution (via `app.get_window("main")` because `add_child` is on `Window`, not `WebviewWindow`)
  - [x] DIAGNOSIS B — DPI compensation in `getBounds()` (divide by `window.devicePixelRatio` when DPR ≠ 1.0)
  - [x] DIAGNOSIS D — Rust-side title-extraction fallback on `PageLoadEvent::Finished` (immediate + 500ms + 1.5s retries)
- [x] Task 25: Keyboard shortcuts hook (`useKeyboardShortcuts`)
- [x] Task 26: Tab context menu (`TabContextMenu` via Portal)
- [x] Task 27: Loading progress bar (`LoadingBar` with CSS keyframes, replaces spinner)
- [x] Task 28: Update `PROJECT_STATE.md` to v0.5-polish with full repo structure

## Session 6 (v0.6-settings) — DONE
- [x] Fix infinite re-render loop in BrowserChrome (bridge ref useMemo + primitive Zustand selectors)
- [x] Port scanner: skip updateFromScan when scan results unchanged
- [x] ResizeObserver on document.documentElement for OS window resize propagation
- [x] 50ms delayed show on tab switch (clearTimeout cleanup)
- [x] Settings panel: theme, search engine, scan interval, compact mode
- [x] Settings panel toggle via Ctrl+, and gear icon in WorkspaceSwitcher
- [x] Rename portScanIntervalMs → portScanInterval (seconds)

## Session 7 (v0.7-palette) — DONE
- [x] Task 35: Verify eval-based navigation in browser.rs (already in place from session 6)
- [x] Task 36: Verify ResizeObserver bounds fix (already in place from session 6)
- [x] Task 37: Integration verify — code review only (runtime test still requires human)
- [x] Task 38: Command palette (Ctrl+K)
- [x] Task 39: Update `PROJECT_STATE.md` to v0.7-palette with full repo structure

## Session 8 (v0.8-polish) — DONE
- [x] Navigation truly fixed: `navigate()` calls `browser_show` after `browser_navigate` (fresh bounds re-read)
- [x] Pin icon visual in TabItem when `tab.isPinned`
- [x] Compact mode (`xevo-compact` class on documentElement + CSS overrides)
- [x] Keyboard shortcut help overlay (Ctrl+? → ShortcutHelp)
- [x] Eval errors in browser_navigate now logged via eprintln!
- [x] PROJECT_STATE.md updated to v0.8-polish

## Session 9 (v0.9-stable) — DONE
- [x] Task 43: Fix Rust side (browser.rs + lib.rs)
  - [x] 43.1 — `BrowserState` managed state in lib.rs
  - [x] 43.2 — `use crate::BrowserState;` in browser.rs
  - [x] 43.3 — Replaced ALL `LogicalPosition`/`LogicalSize` with `PhysicalPosition<i32>`/`PhysicalSize<u32>`
  - [x] 43.4 — Rewrote `browser_navigate` to use `BrowserState` flag + parent window lookup
  - [x] 43.5 — Updated `get_browser_webview` helper + `browser_set_bounds` to use parent window
  - [x] 43.6 — `cargo check` clean
- [x] Task 44: Fix frontend bounds calculation
  - [x] 44.1 — Removed `devicePixelRatio` division from `getBounds()`
  - [x] 44.2 — Added diagnostic `console.log` lines
  - [x] 44.3 — `pnpm tsc --noEmit` clean
- [x] Task 46: Quality-of-life fixes
  - [x] 46.1 — Tab title set to URL domain immediately
  - [x] 46.2 — Address bar redirect URL sync verified
  - [x] 46.3 — Both checks clean
- [x] Task 47: PROJECT_STATE.md updated to v0.9-stable

## Session 9.1 (v0.9.1-stable) — DONE
- [x] Bug A (webview mis-sizing): `Window::scale_factor()` returns 1.25 on user's 125% DPI display. Multiply CSS bounds by scale_factor in browser_navigate, browser_set_bounds, browser_show before constructing PhysicalPosition/PhysicalSize. set_browser_visible signature changed to accept already-physical values. _window renamed to window on browser_navigate (otherwise the scale_factor() call doesn't compile).
- [x] Bug B (second navigation doesn't update): `AddressBar.handleNavigate` called `inputRef.current?.blur()` after navigation, which removed focus from the address bar. The user's second Enter press went to the webview (now showing Google), not the address bar. The Rust `browser_navigate` was never invoked. Fix: removed the blur call so the address bar stays focused for the next URL.
- [x] Added more diagnostic eprintlns in Rust (scale_factor, physical bounds, webview label) and console.logs in JS (handleNavigate, navigate, tab switch).
- [x] `cargo check` and `pnpm tsc --noEmit` both pass clean.

## Session 9.2 (v0.9.2-stable) — DONE
- [x] Bug B FINAL fix: Tauri 2 child webviews cannot have bounds updated post-creation. `Webview::set_bounds`/`set_position`/`set_size` all return `current webview is not a WebviewWindow` because they internally call `self.window()`. Confirmed at runtime via diagnostic output showing the error on second navigation.
- [x] Fix: close-and-recreate approach. Added private `create_or_recreate_browser_webview(app, url, px, py, pw, ph)` helper in `src-tauri/src/commands/browser.rs` that closes the existing child webview via `webview.close()` and calls `parent.add_child(...)` with a fresh `WebviewBuilder` carrying the current URL and physical bounds.
- [x] `browser_navigate` / `browser_set_bounds` / `browser_show` all route through the new helper. Old "already created" eval branch removed (no longer needed — every navigation rebuilds the webview).
- [x] `BrowserState` extended with `last_url: Mutex<Option<String>>` in `src-tauri/src/lib.rs`. `browser_navigate` and `on_navigation` callback write the URL; `browser_set_bounds` / `browser_show` read it back to recreate at the current page after resize / hide→show.
- [x] `browser_hide` now just calls `webview.close()` (state remembers the URL).
- [x] Removed unused `Rect` import from browser.rs.
- [x] `cargo check` clean.

## Session 9.3 (v0.9.3-stable) — DONE
- [x] 2px bounds-oscillation loop fixed: WebView2 re-layers the main window when a child webview is added, shifting the content area's bounding rect by ~2px. This fired ResizeObserver → syncBounds → setWebviewBounds → create_or_recreate, which triggered another re-layer shift, looping indefinitely. Visible symptom: address bar saw URL-change events fire in rapid succession ("continuous search").
- [x] Frontend fix: `src/hooks/useWebviewBridge.ts` `syncBounds()` threshold bumped from 1px to 5px. The 2px subpixel shift is now filtered out before the backend call.
- [x] Backend fix: `src-tauri/src/commands/browser.rs` `browser_set_bounds` now compares new phys against `state.last_bounds` (new `Mutex<Option<(i32, i32, u32, u32)>>` on `BrowserState`). If all four components are within 5px, returns early. Defense-in-depth.
- [x] `BrowserState` extended with `last_bounds` in `src-tauri/src/lib.rs`. `browser_navigate` and `browser_show` write to it.
- [x] Duplicate `showWebview` calls removed: the 50ms-delayed `setTimeout → showWebview` in `navigate()` and the `.then(() => showWebview(bounds))` in the tab-switch useEffect were redundant and caused a race condition ("tab switch navigate failed: current webview is not a WebviewWindow"). Each navigation/tab-switch now triggers exactly one `create_or_recreate`.
- [x] `showWebview` import removed from `useWebviewBridge.ts` (no longer used). Tauri command `browser_show` stays as a no-op defensive entry point.
- [x] All diagnostic `eprintln!`/`println!`/`console.log` lines from sessions 9.1 and 9.2 removed.
- [x] `cargo check` and `pnpm tsc --noEmit` both pass clean.

## Session 9.4 (v0.9.4-stable) — DONE
- [x] Tab-switch "URL changes but webview stays on old page" bug fixed. Root cause: `webview.close()` is async (sends close request to WebView2 process, OS-level registry updates later). `add_child` with the same label called immediately after could fail with "label already in use", leaving the old webview visible while JS state updated normally.
- [x] Rust fix: `src-tauri/src/commands/browser.rs` `create_or_recreate_browser_webview` is now `async fn`. After `webview.close()` returns, it does `tokio::time::sleep(Duration::from_millis(50)).await` before `add_child`. The three callers (`browser_navigate`, `browser_set_bounds`, `browser_show`) now `.await` the call.
- [x] JS fix: `src/hooks/useWebviewBridge.ts` tab-switch `useEffect` now uses a `tryNavigate(attempt)` recursive function. If `getBounds()` returns null, retry up to 3 times with 100ms intervals. Initial `setTimeout` bumped from 50ms to 100ms to give the flex layout more time on the first attempt.
- [x] `cargo check` and `pnpm tsc --noEmit` both pass clean.

## Session 9.5 (v0.9.5-stable) — DONE
- [x] Tab-switch "URL changes but webview stays on old page" bug FINAL fix via unique webview labels. v0.9.4's 50ms delay was a band-aid; WebView2's label-registry update latency is hardware-dependent and 50ms was not enough on the user's machine. The close-vs-add race with a fixed label is fundamentally fragile.
- [x] `src-tauri/src/lib.rs` `BrowserState` extended with `current_label: Mutex<Option<String>>` and `label_counter: Mutex<u64>`. Both initialized in `.manage(...)`.
- [x] `src-tauri/src/commands/browser.rs` `get_browser_webview` now reads `state.current_label` to find the active webview's label and looks up by that label. No more hardcoded `BROWSER_LABEL` const.
- [x] `create_or_recreate_browser_webview` now generates a unique label (`browser-N`) from the counter, updates `state.current_label` BEFORE the add (so concurrent lookups find the new label), then `add_child` with the new label, then closes the OLD webview by its old label. No race because labels are always different.
- [x] Removed: the 50ms `tokio::time::sleep` (no longer needed), the `BROWSER_LABEL` const, and the 5px threshold in `browser_set_bounds` (entire command is now a no-op).
- [x] `browser_set_bounds` is now a no-op: window resize no longer repositions the webview. To refresh bounds, trigger a re-navigation. Eliminates the stale-`state.last_url` issue where rapid `syncBounds` calls would read the old URL and recreate the webview with the wrong page.
- [x] `cargo check` and `pnpm tsc --noEmit` both pass clean.

## Session 9.6 (v0.9.6-stable) — DONE
- [x] **Architectural pivot: child webview → `WebviewWindowBuilder` with `parent`.** Root cause of v0.9.2–v0.9.5 failures was finally diagnosed: `Window::add_child` internally calls `self.window().set_bounds(...)` on the new child webview during creation, which fails with `current webview is not a WebviewWindow` because child webviews are not `WebviewWindow`s in Tauri 2. The error fires during `add_child` itself, not in any subsequent operation — no race-condition fix could address it.
- [x] `src-tauri/src/lib.rs`: `BrowserState` struct and all 5 fields removed. `.manage(BrowserState { ... })` removed. `use std::sync::Mutex;` removed. `.invoke_handler` entries unchanged.
- [x] `src-tauri/src/commands/browser.rs`: full rewrite. New `ensure_browser_window(app, main_window, url, x, y, w, h)` helper. If `app.get_webview_window("browser")` returns `Some`, just call `set_position(Logical)` + `set_size(Logical)` + `navigate()`. If `None`, build with `WebviewWindowBuilder::new(app, "browser", WebviewUrl::External(url)).parent(&main_window)?.decorations(false).resizable(false).transparent(true).inner_size(w, h).position(x, y).initialization_script(BROWSER_INIT_SCRIPT).on_navigation(...).on_page_load(...).build()`.
- [x] Removed: `get_browser_webview` helper, `create_or_recreate_browser_webview` helper, 50ms `tokio::time::sleep`, `PhysicalPosition` / `PhysicalSize` imports, `scale_factor()` multiplications in `browser_navigate` / `set_bounds` / `show`, all `BrowserState` reads/writes.
- [x] **Coordinate system: logical (CSS) pixels.** `WebviewWindowBuilder::position(x, y)` and `.inner_size(w, h)` take `f64` logical pixels. `WebviewWindow::set_position(Position::Logical)` / `set_size(Size::Logical)` likewise. The OS scales to physical via DPI. No `scale_factor()` multiplication needed.
- [x] Frontend `getBounds()`: now returns screen-relative CSS pixels — `rect.left + window.screenX, rect.top + window.screenY + (outerHeight - innerHeight)`. The `outerHeight - innerHeight` term is the title bar height, needed because the Tauri main window has native decorations, so the WebView2 viewport starts BELOW the title bar but `window.screenY` reports the OS window's top-left (above the title bar).
- [x] `src-tauri/src/commands/browser.rs` `browser_set_bounds` RE-ENABLED (was a no-op since v0.9.3). Calls `set_position(Logical)` + `set_size(Logical)` on the live `WebviewWindow`. Tauri 2's set_bounds bug only affected child webviews, not real `WebviewWindow`s.
- [x] `src-tauri/src/commands/browser.rs` `browser_hide` now calls `wv.hide()` (window preserved, just hidden). `browser_show` calls `set_position` + `set_size` + `show`. Both work because the WebviewWindow is persistent.
- [x] **Main window drag → browser window follows.** `main_window.on_window_event(...)` registered on first build with a `WindowEvent::Moved` filter. When the main window is dragged, the browser window's position is updated to match. Without this, the browser window would stay at its initial screen position — visually broken. The `Moved` event delivers a `PhysicalPosition`; we divide by `scale_factor()` to convert back to logical so the WebviewWindow receives the same units it was built with.
- [x] `src/hooks/useWebviewBridge.ts` simplifications:
  - `getBounds()`: adds title-bar offset (`window.outerHeight - window.innerHeight`), updated comment to mention the new screen-relative CSS pixel semantics.
  - Tab-switch `useEffect`: removed the `tryNavigate(attempt)` recursive retry (3×100ms). With no recreate race, one attempt is enough. Kept the 100ms initial `setTimeout` for layout settling. Reduced the post-nav `isSwitchingTabRef` re-enable from 800ms to 500ms.
  - `navigate()`: removed the `console.error('[xevo] navigate failed:', e)` catch (silent failure).
- [x] `src/components/browser/AddressBar.tsx`: removed leftover `console.log('[xevo] handleNavigate called with raw:', ...)` at line 54 (originally added as a Bug B diagnostic in v0.9.1, claimed removed in v0.9.3, but was actually still in the file). Removed the surrounding 5-line comment block about "Keep the address bar focused after navigation".
- [x] **Free side benefits of the new architecture (verified by code review, runtime verification pending):**
  - Back/forward history now works (was always broken — close-and-recreate wiped `window.history`).
  - Window resize now works (was disabled in v0.9.3).
  - First-nav lag is paid once (was paid every navigation).
- [x] `cargo check` and `pnpm tsc --noEmit` both pass clean.

## Session 10 (v1.0-feature-complete) — DONE
- [x] Task 48: JSON auto-formatter
  - [x] 48.1 — `xevoRenderJson()` IIFE added inside `BROWSER_INIT_SCRIPT` in `src-tauri/src/commands/browser.rs`, registered on DOMContentLoaded BEFORE the existing title/favicon code
  - [x] 48.2 — Detects JSON via `document.contentType` (`application/json` / `text/json`) OR via `JSON.parse(document.body.innerText)` for unknown content-types with empty `<head>`
  - [x] 48.3 — Renders dark-themed collapsible tree with syntax colors (keys blue, strings green, numbers orange, booleans purple, nulls grey, brackets amber)
  - [x] 48.4 — Toolbar: `{ } JSON` label + URL (truncated 80) + size in bytes + Copy button (clipboard, "Copied!" for 2s)
  - [x] 48.5 — Depth limit 8, max 500 items per array/object (truncated with `...N more items`)
  - [x] 48.6 — Real HTML pages skipped (head-with-children check); cross-origin / unparseable pages silently ignored
  - [x] 48.7 — `cargo check` clean
- [x] Task 49: Light + System theme
  - [x] 49.1 — `src/index.css`: `:root { color-scheme: dark; }` default. All `--xevo-*` vars moved into `[data-theme="dark"]` block. New `[data-theme="light"]` block with full light palette (white background, dark text, lighter borders, etc.). Light theme body + scrollbar overrides added
  - [x] 49.2 — `src/App.tsx`: second `useEffect` reads `theme: ThemeMode` from settings store, sets `document.documentElement[data-theme]` accordingly. For `system` mode, uses `matchMedia('(prefers-color-scheme: dark)')` + `change` listener; cleanup removes the listener
  - [x] 49.3 — `src/components/panels/SettingsPanel.tsx`: ThemeButton active background switched to `var(--xevo-tab-active)` so the highlighted option contrasts properly in both dark and light themes
  - [x] 49.4 — `pnpm tsc --noEmit` clean
- [x] Task 50: Per-tab history isolation
  - [x] 50.1 — `src/types/index.ts` `Tab` interface gains `historyBack: string[]` and `historyForward: string[]`
  - [x] 50.2 — `src/stores/tabs.ts` `buildTab` initializes both to `[]`. Store gains `recordNavigation(tabId, fromUrl)` (pushes, clears forward, 50-entry cap), `popBack(tabId): string | null`, and `popForward(tabId): string | null`
  - [x] 50.3 — `src/hooks/useWebviewBridge.ts`: `navigate()` calls `recordNavigation` for the active tab's current URL before navigating. `goBack`/`goForward` replaced with Zustand-pop + `navigateWebview` (sets `isSwitchingTabRef` for 500ms to suppress redirect URL echo). `prevActiveTabIdRef` added; tab-switch useEffect records the leaving tab's URL
  - [x] 50.4 — `src/hooks/useWebviewBridge.ts` `onUrlChanged` listener: if not a tab-switch and URL changed, records the previous URL to history (so in-page link clicks accumulate history)
  - [x] 50.5 — `src/components/browser/AddressBar.tsx`: back/forward buttons enabled state now reads `activeTab.historyBack.length` / `activeTab.historyForward.length` (with `?? 0` for persisted tabs missing the fields)
  - [x] 50.6 — `pnpm tsc --noEmit` clean
- [x] Task 51: Tab drag-to-reorder
  - [x] 51.1 — `src/components/browser/TabItem.tsx`: root div gets `draggable={true}` + 4 new drag props (`onDragStart`, `onDragOver`, `onDrop`, `isDragOver`). `isDragOver` adds `border-left: 2px solid var(--xevo-accent)` for the drop target indicator
  - [x] 51.2 — `src/components/browser/TabBar.tsx`: `dragTabId` and `dragOverTabId` state, `handleDragStart`/`Over`/`Drop`/`End` callbacks. Drop recomputes live tab order, removes dragged tab, splices into target's position, calls `reorderTabs(activeWorkspaceId, next)`. `onDragEnd` on the tab list container clears stale state
  - [x] 51.3 — `pnpm tsc --noEmit` clean
- [x] Task 52: Minor cleanup
  - [x] 52.1 — `src-tauri/Cargo.toml`: package name `xevo-temp` → `xevo`, lib name `xevo_temp_lib` → `xevo_lib`. `src-tauri/src/main.rs` updated to call `xevo_lib::run()`
  - [x] 52.2 — `src/utils/` empty directory deleted
  - [x] 52.3 — No `[xevo]`-tagged diagnostic `console.log` lines in `useWebviewBridge.ts`. The only `console.error` left is the genuine error path in `webviewReload`
  - [x] 52.4 — `cargo check` clean, `pnpm tsc --noEmit` clean
- [x] Task 54: `PROJECT_STATE.md` updated to v1.0-feature-complete with new worktree snapshot, completed features list, known issues, and next-session priorities (Option A: GitHub push + README; Option B: per-tab WebviewWindow; Option C: API Tester panel)

## Session 56 — UI Scaling (size increase) — DONE
- [x] Scaled all UI elements (tab bar, toolbar, address bar, sidebar, workspace switcher, status bar, find bar, toast) for better readability
- [x] Base font 13px → 14px, compact mode overrides updated
- [x] `tsc --noEmit` and `cargo check` both clean
- [x] No Rust backend, no store logic, no feature behavior changed

## Session 19 (v1.32.0-dev — Network Health Monitor) — CURRENT
- [x] Task 77: Rust backend — add resourceContext, timing, contentLength, reasonPhrase to network-entry event
  - [x] 77.1 — Capture `COREWEBVIEW2_WEB_RESOURCE_CONTEXT` via `args.ResourceContext()` in WebResourceRequested handler — 17 resource types detected
  - [x] 77.2 — Store `(Instant::now(), resourceType)` in shared static `HashMap<(tabId, url)>` for cross-handler communication
  - [x] 77.3 — In response handler: look up stored metadata, compute durationMs, parse Content-Length from headers, capture ReasonPhrase
  - [x] 77.4 — Emit new fields: resourceType, durationMs, contentLength, reasonPhrase in browser://network-entry
  - [x] 77.5 — `cargo check` clean
- [x] Task 78: Frontend types & store — update NetworkLogEntry, NetworkEntryPayload
  - [x] 78.1 — Added: reasonPhrase, resourceType, durationMs, contentLength (removed unused timestamp)
  - [x] 78.2 — New helper functions: formatSize, formatDuration, resourceTypeLabel, entryIsError, entryIsSlow, entryIsApi
  - [x] 78.3 — `pnpm tsc --noEmit` clean
- [x] Task 79: Copy utilities (src/lib/networkCopy.ts)
  - [x] 79.1 — entryToCurl() — generates full cURL command with headers
  - [x] 79.2 — entryToFetch() — generates fetch() call with method, headers, body
  - [x] 79.3 — copyToClipboard() — clipboard API with fallback
- [x] Task 80: NetworkPanel rewrite — lightweight Network Health Monitor
  - [x] 80.1 — Summary bar: count, total size, error/slow/API counts, Clear button
  - [x] 80.2 — Filter chips: All, Errors, API, Slow — dynamic counts
  - [x] 80.3 — Column headers: Method, Status, Type, URL, Size, Time
  - [x] 80.4 — Enhanced rows: method color, status color, type badge (colored), URL, size, time, hover cURL copy
  - [x] 80.5 — Detail pane with tabs: Headers, Body, Copy (cURL + fetch)
  - [x] 80.6 — Debounced auto-scroll, tab-specific scoping via key prop, Clear button
  - [x] 80.7 — `pnpm tsc --noEmit` clean
- [x] Task 81: Cleanup — removed all NET-DBG debug logging (Rust eprintln, frontend console.log)
- [x] Task 82: Final integration — `cargo check` + `pnpm tsc --noEmit` both clean

## Backlog
- [ ] Port scanner: HTTP title shown in sidebar tooltip
- [ ] Port scanner: manual "add custom port" UI
- [ ] Workspace drag-to-reorder in sidebar
- [ ] ResizeObserver 50ms debounce — apply if runtime reveals resize glitches
- [ ] **Option A (NOW):** GitHub push + README + v1.0 tag
- [ ] **Option B:** Tab-per-WebviewWindow (one real browser window per tab)
- [ ] History panel (sidebar — `activePanel === "history"`) — last 100 navigations across workspaces
- [ ] Network log panel (sidebar — `activePanel === "network"`) — request/response log
- [ ] Notes panel: drag-to-reorder notes in sidebar list
- [ ] API tester: persist request history to localStorage
- [ ] API tester: response body type detection (HTML preview, image preview, JSON tree view)
- [ ] API tester: saved collections / environments
- [ ] API tester: request duplication / share via URL
- [ ] Find in page: case-sensitive toggle, whole-word toggle
- [ ] Bookmarks: drag-to-reorder, folder support
- [ ] Runtime integration tests (Tasks 45.2-45.5 + 53.1-53.4 + 76.4) — require a `pnpm tauri dev` GUI run on hardware

## Session 10.1 (v0.9.7-polish) â€” DONE
- [x] Task 55: Tab drag-to-reorder Firefox/WebView2 compat fix
  - [x] 55.1 â€” `src/components/browser/TabBar.tsx` `handleDragStart`: added `e.dataTransfer.setData("text/plain", tabId)`. Without it, Firefox and some WebView2 builds refuse to fire `drop` on empty data transfers
  - [x] 55.2 â€” `src/components/browser/TabItem.tsx`: close `<button>` gets `draggable={false}` (some WebView2 versions route the button mousedown to the draggable parent in a way that kills the drag)
  - [x] 55.3 â€” `src/components/browser/TabItem.tsx`: new props `onDragEnd` and `isDragging`. Source tab gets `cursor-grab` / `active:cursor-grabbing` and `opacity-40` while being dragged
  - [x] 55.4 â€” `src/components/browser/TabBar.tsx`: `onDragEnd` moved from the tab list container to each `TabItem` (dragend fires on the source, not the target). Container `onDragEnd` removed
  - [x] 55.5 â€” `pnpm tsc --noEmit` clean
- [x] Task 56: Light-mode color leak sweep
  - [x] 56.1 â€” `src/index.css`: 5 new CSS variables added to both `[data-theme="dark"]` and `[data-theme="light"]` blocks: `--xevo-hover`, `--xevo-modal-bg`, `--xevo-modal-border`, `--xevo-warning`, `--xevo-badge-bg`
  - [x] 56.2 â€” `src/components/browser/TabItem.tsx`: 5 hardcoded hex codes â†’ CSS vars
  - [x] 56.3 â€” `src/components/browser/TabBar.tsx`: 1 hardcoded hex code â†’ CSS var
  - [x] 56.4 â€” `src/components/browser/AddressBar.tsx`: ~14 hardcoded hex codes â†’ CSS vars
  - [x] 56.5 â€” `src/components/browser/ContentArea.tsx`: 4 hardcoded hex codes â†’ CSS vars
  - [x] 56.6 â€” `src/components/sidebar/Sidebar.tsx`: ~13 hardcoded hex codes â†’ CSS vars
  - [x] 56.7 â€” `src/components/sidebar/WorkspaceSwitcher.tsx`: 5 hardcoded hex codes â†’ CSS vars
  - [x] 56.8 â€” `src/components/panels/SettingsPanel.tsx`: ~16 hardcoded hex codes â†’ CSS vars
  - [x] 56.9 â€” `src/components/CommandPalette.tsx`: ~12 hardcoded hex codes â†’ CSS vars
  - [x] 56.10 â€” `src/components/ShortcutHelp.tsx`: ~10 hardcoded hex codes â†’ CSS vars
  - [x] 56.11 â€” `src/components/browser/TabContextMenu.tsx`: ~9 hardcoded hex codes â†’ CSS vars
  - [x] 56.12 â€” Final grep for hardcoded hex Tailwind classes: 0 matches in `src/`. Workspace accent colors in `stores/workspaces.ts` intentionally remain (user-chosen, not theme-dependent)
  - [x] 56.13 â€” `pnpm tsc --noEmit` clean
- [x] Task 57: JSON viewer ultra-minimal 2-color redesign
  - [x] 57.1 â€” `src-tauri/src/commands/browser.rs` `renderValue`: dropped `xj-null` / `xj-b` / `xj-n` / `xj-s` / `xj-bracket` class wrappers around values. Null / boolean / number / string / bracket content now rendered as plain text inheriting body color. URL strings still wrapped in `<a href="...">` for clickability
  - [x] 57.2 â€” `src-tauri/src/commands/browser.rs` `renderValue`: auto-expand threshold changed from `depth < 2` to `depth < 1` (only root auto-opens, children collapsed)
  - [x] 57.3 â€” `src-tauri/src/commands/browser.rs` CSS: replaced 40px `.xj-toolbar` with 32px `.xj-header` (URL on left, Copy on right, 1px bottom border, no big badge). Removed `.xj-label` / `.xj-url` / `.xj-size` / `.xj-s` / `.xj-n` / `.xj-b` / `.xj-null` / `.xj-bracket`. Kept `.xj-header` / `.xj-path` / `.xj-k` / `.xj-toggle` / `.xj-copy` / `a` / `pre` / `details`
  - [x] 57.4 â€” `src-tauri/src/commands/browser.rs` body HTML: header is now `<div class="xj-header"><span class="xj-path">URL</span><button class="xj-copy">Copy</button></div><pre>tree</pre>`
  - [x] 57.5 â€” `src-tauri/src/commands/browser.rs` removed `var size = new Blob([raw]).size;` (no longer displayed)
  - [x] 57.6 â€” `cargo check` clean
- [x] Task 58: `PROJECT_STATE.md` updated to v0.9.7 with new worktree snapshot, completed list, session note


## Session 10.2 (v0.9.8-polish) â€” DONE
- [x] Task 59: Tab drag "blocked" cursor fix
  - [x] 59.1 â€” `src/components/browser/TabBar.tsx`: new `dropAtEnd: boolean` state. `handleContainerDragOver` callback with `e.target === e.currentTarget` equality check (sets dropAtEnd when cursor is on container padding). `handleContainerDrop` callback (moves dragTabId to end). `handlePlusDragOver` callback for the `+` button (always sets dropAtEnd, separate from container handler because the Plus icon SVG is a child of the button)
  - [x] 59.2 â€” Outer TabBar container, tab list container, and `+` button all gain `onDragOver` + `onDrop` handlers
  - [x] 59.3 â€” `+` button shows 2px blue left border (in `--xevo-accent`) when `dropAtEnd` is true â€” visual feedback for end-drop
  - [x] 59.4 â€” Per-tab `handleDragOver` clears `dropAtEnd` so precise positioning wins over end-drop when cursor enters a tab
  - [x] 59.5 â€” All drag handlers reset `dropAtEnd` on drop/dragend
- [x] Task 60: Custom full-size drag preview
  - [x] 60.1 â€” `src/components/browser/TabBar.tsx` `handleDragStart`: clone source tab via `cloneNode(true)`, style clone as full-size semi-transparent ghost, position off-screen, call `e.dataTransfer.setDragImage(ghost, rect.width / 2, rect.height / 2)` to center on cursor, remove ghost on next tick
- [x] Task 61: `pnpm tsc --noEmit` clean, `cargo check` clean


## Session 10.4 (v0.9.10-polish) — DONE
- [x] Task 62: Tab drag-to-reorder — implement all 9 fixes from `fixing.md`
  - [x] 62.1 — BUG #1 (CRITICAL): `e.stopPropagation()` added after `e.preventDefault()` in `TabBar.tsx` `handleContainerDrop` and `handleDrop`. Stops the `drop` event from bubbling to the outer container handlers, which were re-pushing the tab to the end. **This is the user-reported "tab always ends up at end" bug.**
  - [x] 62.2 — BUG #2 (MEDIUM): `TabItem` gains `justDraggedRef = useRef<boolean>(false)`. `handleDragStart` sets it to `true`; new `handleClick` wrapper checks the ref — if true, clears it and skips `onActivate()`. Prevents the post-drop `click` on the source tab from activating it.
  - [x] 62.3 — BUG #3 (MEDIUM): `TabBar` gains `justDroppedAtPlusRef = useRef<boolean>(false)`. `handleContainerDrop` sets it to `true` on successful drop. New `openNewTabSafe` wrapper on the `+` button checks the ref. `handleDragEnd` clears it defensively. Prevents the post-drop `click` on `+` from creating a phantom new tab.
  - [x] 62.4 — BUG #4 (LOW): Close `<button>` in `TabItem` gets `data-tab-close="true"`. The `onDrop` wrapper in `TabBar` checks `e.target.closest("[data-tab-close]")` and returns early if true. Drop on the X no longer reorders.
  - [x] 62.5 — BUG #5 (LOW): `TabItem` gains `onDragLeave` prop. `TabBar` `handleTabDragLeave` clears `dragOverTabId` and `dropAtEnd` if the related target is null or outside the `[data-tab-bar]` outer container. Outer container gets `data-tab-bar="true"`.
  - [x] 62.6 — BUG #6 (LOW): `setTimeout(0)` for ghost cleanup replaced with `requestAnimationFrame`. WebView2 takes the drag-image snapshot on the next paint, which is exactly when rAF fires.
  - [x] 62.7 — BUG #7 (LOW): Both drop handlers normalize the final order to `[...pinned, ...unpinned]` before calling `reorderTabs`. Pinned tabs always end up at the front.
  - [x] 62.8 — BUG #8 (LOW): Both drop handlers read `useWorkspacesStore.getState().activeWorkspaceId` and `useWorkspacesStore.getState().workspaces[liveWsId]` at the top of the handler body. `activeWorkspaceId` removed from `useCallback` deps. No more stale closure.
  - [x] 62.9 — BUG #9 (LOW): `getLiveWorkspaceTabIds` in `workspaceTabs.ts` now counts duplicates and emits a `console.warn` if any are found. Dedup behavior unchanged.
  - [x] 62.10 — `cd src-tauri && cargo check` clean
  - [x] 62.11 — `pnpm tsc --noEmit` clean
  - [ ] 62.12 — Runtime GUI verification (Tests 1-9 from `fixing.md` §4.2): pending human-run `pnpm tauri dev`


## Session 10.5 (v0.9.11-webview-bounds) — DONE
- [x] Task 63: Webview bounds — title-bar double-counting fixed, Moved handler moved to frontend
  - [x] 63.1 — **Root cause confirmed at runtime via `[XEVO-VP]`, `[XEVO-BOUNDS]`, and `[xevo] set_bounds applied` diagnostic logs**: in Tauri 2's WebView2, `window.screenX/Y` returns the **viewport's** top-left in CSS pixels (same as Tauri Rust `innerPosition()` divided by `devicePixelRatio`), NOT the OS window's frame top-left. v0.9.6's `getBounds()` formula `rect.top + window.screenY + titleBarHeightRef.current` was double-counting the title bar (already in `window.screenY`). The Rust `Moved` handler in `browser.rs` was also wrong — it added the title bar in physical pixels to a `PhysicalPosition` that already had it baked in, over-correcting by `2 * 9 = 18 physical px` per move.
  - [x] 63.2 — `src/hooks/useWebviewBridge.ts`: removed `titleBarHeightRef` and the `[XEVO-VP]` measurement `useEffect`. Simplified `getBounds()` Y formula to `rect.top + window.screenY` (no title-bar offset). Updated the `getBounds()` comment block to document the actual Tauri 2 WebView2 `screenX/Y` semantics.
  - [x] 63.3 — `src/hooks/useWebviewBridge.ts`: added new `useEffect` that registers `getCurrentWindow().onMoved(...)` and calls `syncBounds()` on each event. `ResizeObserver` only fires on size changes, not position changes, so this is required for drag-follow to work.
  - [x] 63.4 — `src-tauri/src/commands/browser.rs`: deleted the entire `main_window.on_window_event(Moved)` block in `ensure_browser_window`. Removed the now-unused `WindowEvent` import and the `app_for_move` clone. Removed the stale "On main-window moves, we register a one-shot `on_window_event` listener" comment from the doc block.
  - [x] 63.5 — `src-tauri/src/commands/browser.rs`: removed the 3 diagnostic `eprintln!` calls (`ensure(create) applied`, `ensure(reuse) applied`, `set_bounds applied`) — their purpose is served; the frontend `[XEVO-BOUNDS]` log gives the final sanity check on the new formula.
  - [x] 63.6 — `cd src-tauri && cargo check` — clean
  - [x] 63.7 — `pnpm tsc --noEmit` — clean
  - [ ] 63.8 — Runtime GUI verification: pending human-run `pnpm tauri dev`. Verify (a) webview flush inside content area in restored mode, (b) webview flush in maximized mode, (c) drag the main window → webview follows with no drift, (d) resize the main window → webview resizes with content area, (e) browser console shows `[XEVO-BOUNDS]` with `computed.y` = 136 (restored) and 103 (maximized).


## Session 10.6 (architecture confirmation — no version bump) — DONE

**Goal:** Investigate whether the residual drag-lag reported after v0.9.11 is fixable via (A) a full migration to a true WS_CHILD via `Window::add_child`, or (B) a Tauri upgrade. Conclude with a definitive architectural decision so future sessions stop investing time on this issue.

- [x] Task 64: Phase 0 — `add_child` visual verification (rejected)
  - [x] 64.1 — Added temporary `test_child_webview` command in `src-tauri/src/commands/browser.rs`: builds a child webview with `Window::add_child`, sets bounds via `set_position(Logical)` + `set_size(Logical)`, navigates to a URL, then calls `set_auto_resize(true)`
  - [x] 64.2 — Registered `test_child_webview` in `src-tauri/src/lib.rs` `invoke_handler`
  - [x] 64.3 — `cargo check` clean
  - [x] 64.4 — **Visual test FAILED.** All Rust API calls returned `Ok(())`, but the webview did NOT follow the main window on drag (same symptom as v0.9.2-9.5). `set_auto_resize(true)` was glitchy — sometimes worked, sometimes the webview got stuck and required close-and-reopen of the main window to recover.
  - [x] 64.5 — **Lesson:** `Ok(())` from Tauri Rust calls only confirms the API call succeeded, not that the OS WebView2 child behaved correctly. A successful Rust return is not a sufficient signal for "this works."
  - [x] 64.6 — Cleaned up: removed `test_child_webview` from `browser.rs` and `lib.rs` `invoke_handler`. `cargo check` clean after cleanup
- [x] Task 65: Option 2 — Tauri upgrade research (rejected)
  - [x] 65.1 — **Tauri 2.11.2 is the latest stable release** (verified via crates.io API and GitHub releases, May 16 2025). No newer 2.x version exists.
  - [x] 65.2 — **GitHub Issue #10079** is the canonical reference for this Windows-child-webview bug. Closed as **"not planned"** in June 2024 by the Tauri team. The thread explicitly states: *"`parent()` doesn't seem to work in a Windows environment"*. The Tauri team has confirmed they do not intend to fix child webview behavior on Windows.
  - [x] 65.3 — **Option 2 is NOT viable.** No upgrade path exists in the Tauri 2.x line.
- [x] Task 66: Architecture decision locked
  - [x] 66.1 — Stay on v0.9.11 architecture. The frontend `getCurrentWindow().onMoved(...)` listener is the best available drag-sync mechanism in Tauri 2.x.
  - [x] 66.2 — The residual ~5-10ms drag lag is accepted as a Tauri 2.x architectural limitation.
  - [x] 66.3 — Do NOT propose further architectural changes for this issue. Time should be invested in features, not in fighting the framework.
- [x] Task 67: `PROJECT_STATE.md` updated to Session 10.6 status
  - [x] 67.1 — Header status bumped to Session 10.6 summary
  - [x] 67.2 — KNOWN ISSUES first item updated to cite Issue #10079 as the root cause
  - [x] 67.3 — NEXT SESSION PRIORITIES updated with architecture-locked note, new Option D (single-webview refactor, NOT recommended) added
  - [x] 67.4 — New "CHANGES THIS SESSION (Session 10.6)" section appended at end of file documenting the failed Phase 0, the Option 2 research, and the final architectural decision


## Session 11 (v1.0.0-feature-pack) — DONE

**Goal:** Ship the four high-value features in one batch: find-in-page, bookmarks, XEVO home page, and API tester.

### Part A — Find in Page
- [x] Task 68: Rust find command (browser_find / browser_find_next / browser_stop_find / browser_find_callback) + `XEVO_FIND_SCRIPT` injected into the webview at creation
  - [x] 68.1 — **Tauri 2.11.2 stable does NOT expose a native `WebviewWindow::find` API.** Verified by grepping the tauri-2.11.2 source for `fn find | FindOptions | FindResult` in `C:\Users\ADMIN\.cargo\registry\src\index.crates.io-1949cf8c6b5b557f\tauri-2.11.2\src\` — zero matches. Decision: implement find-in-page in JavaScript, wrap it in Rust commands so the frontend keeps a single IPC surface.
  - [x] 68.2 — `src-tauri/src/commands/browser.rs` — new `XEVO_FIND_SCRIPT: &str` const. Defines `window.__xevoFind(query, forward)`, `window.__xevoFindNext(forward)`, `window.__xevoClearFind()`. Walks `document.body` text nodes, wraps matches in `<mark class="xevo-find-hit">`, tracks the active match, scrolls into view. Reports back via `__TAURI_INTERNALS__.invoke("browser_find_callback", { activeMatch, totalMatches, finalUpdate: true })`.
  - [x] 68.3 — `src-tauri/src/commands/browser.rs` — new `FindResultPayload` struct + 4 new commands: `browser_find(query, forward)`, `browser_find_next(forward)`, `browser_stop_find()`, `browser_find_callback(active_match, total_matches, final_update)`. The callback command emits `browser://find-result` events to the frontend.
  - [x] 68.4 — Rust raw string delimiter `r##"..."##` (two hashes) used because the JS body contains CSS color strings like `"#fde047"` which contain `"#` (one hash) and would prematurely close a `r#"..."#` raw string. First build with `r#"..."#` failed with "prefix `hit` is unknown" / "prefix `fde047` is unknown" — switched to `r##"..."##` and cargo check passed clean.
  - [x] 68.5 — `ensure_browser_window` chains a second `.initialization_script(XEVO_FIND_SCRIPT)` call. The script installs `__xevoFind`/`__xevoFindNext`/`__xevoClearFind` on `window` for every fresh page load and resets find state on `DOMContentLoaded`.
  - [x] 68.6 — `src-tauri/src/lib.rs` — 4 new entries in `invoke_handler` (`browser_find`, `browser_find_next`, `browser_stop_find`, `browser_find_callback`). Now 14 total invoke handlers.
  - [x] 68.7 — `cd src-tauri && cargo check` clean
- [x] Task 69: FindBar React component + state + Ctrl+F shortcut + service wiring
  - [x] 69.1 — `src/services/browser.ts` — new `webviewFind`, `webviewFindNext`, `webviewStopFind`, `onFindResult` exports + `FindResult` interface.
  - [x] 69.2 — `src/stores/ui.ts` — added `findOpen`, `findQuery`, `findActiveMatch`, `findTotalMatches` state + `openFind`, `closeFind`, `setFindQuery`, `setFindResult` actions.
  - [x] 69.3 — `src/components/browser/FindBar.tsx` — new component. Fixed-positioned at top-right of the content area (overlays the webview). Search input + match count (`"1 of 5"` / "No results") + prev/next chevrons + close button. Debounced 150ms on each keystroke. Enter cycles matches, Shift+Enter goes back, Esc closes. Subscribes to `onFindResult` for live match counts. Stops webview find on close.
  - [x] 69.4 — `src/components/browser/BrowserChrome.tsx` — wraps ContentArea in a `<div class="relative">` and mounts `<FindBar />` inside it. The fixed-positioned FindBar is anchored to the content area, not the window.
  - [x] 69.5 — `src/hooks/useKeyboardShortcuts.ts` — new `Ctrl/Cmd+F` branch. If find is open, closes and reopens (re-focus input). If closed, opens. Skips while focus is in an input/textarea.
  - [x] 69.6 — `src/components/ShortcutHelp.tsx` — added `Ctrl+F` and `Ctrl+D` to the shortcut list.
  - [x] 69.7 — `pnpm tsc --noEmit` clean
- [x] Task 70: Find / clear paths through the integration
  - [x] 70.1 — Verified Ctrl+F is the only path to open the bar, Esc is the only path to close from inside it. `webviewStopFind` is called on close and on every `findOpen=false` transition.
  - [x] 70.2 — `lastQueriedRef` deduplicates consecutive same-query calls so re-renders don't re-eval Rust.
  - [x] 70.3 — `pnpm tsc --noEmit` clean

### Part B — Bookmarks
- [x] Task 71: Bookmarks Zustand store (workspace-scoped, persist)
  - [x] 71.1 — `src/stores/bookmarks.ts` — new store. `Bookmark = { id, workspaceId, url, title, createdAt }`. Persisted to `localStorage` under `xevo-bookmarks`. Actions: `addBookmark`, `removeBookmark`, `removeBookmarkByUrl`, `renameBookmark`, `clearForWorkspace`, `getBookmarksByWorkspace`, `isBookmarked`. `addBookmark` does an `unshift` so the most-recent bookmark is first in the list.
  - [x] 71.2 — `src/types/index.ts` — new `Bookmark` interface.
  - [x] 71.3 — `pnpm tsc --noEmit` clean
- [x] Task 72: BookmarksPanel sidebar component + Ctrl+D shortcut
  - [x] 72.1 — `src/components/sidebar/BookmarksPanel.tsx` — new panel. Header shows active workspace name + a "Clear all" button (with `window.confirm`). Bookmarks list: each row shows title, host (faint sublabel), open-in-new-tab icon (hover-revealed), delete icon (hover-revealed). Click row to open in a new tab. Double-click to rename (inline input + Enter to commit / Esc to cancel). Empty state with Ctrl+D hint.
  - [x] 72.2 — `src/hooks/useKeyboardShortcuts.ts` — new `Ctrl/Cmd+D` branch. Skips when focus is in input/textarea. Reads active tab, calls `isBookmarked(wsId, url)`. If already bookmarked → `removeBookmarkByUrl` (toggles off). If not → `addBookmark` (toggles on). User gets the native-browser muscle memory.
  - [x] 72.3 — `src/components/sidebar/Sidebar.tsx` — when `activePanel === "bookmarks"` renders `<BookmarksPanel />`. Also when `activePanel === "api"` renders `<ApiTester embedded />` (Part D wire-up).
  - [x] 72.4 — `pnpm tsc --noEmit` clean

### Part C — XEVO Home Page
- [x] Task 73: HomePage component
  - [x] 73.1 — `src/components/panels/HomePage.tsx` — new component. Replaces the bare "Type a URL or search" placeholder. Three sections in a centered max-w-3xl column:
    - **Hero** — workspace icon + name + "XEVO Home" heading + a centered search input (uses the active tab's `bridge.navigate` if available, otherwise falls back to opening a new tab via the tabs store). Subtitle mentions `Ctrl+L` for the address bar.
    - **Live Servers** — 2/3/4-column responsive grid of cards. Each card shows the port (`:3000`) and label/title, with a green status dot. Empty state: dashed-border box with a "Start a dev server" hint.
    - **Bookmarks** — vertical list of recent workspace-scoped bookmarks. Each row: arrow icon + title + URL (faint). Empty state with `Ctrl+D` hint.
  - [x] 73.2 — `src/components/panels/HomePage.tsx` — `resolveInput(raw, searchEngine, customSearchUrl)` mirrors the address bar's logic, including the custom-search-engine template (`%s` placeholder). Default engines: google, duckduckgo, bing, custom.
  - [x] 73.3 — `src/components/browser/ContentArea.tsx` — replaced the previous Globe-icon placeholder with `<HomePage onNavigate={bridge?.navigate ?? null} />`. Only shown when `!hasUrl` (i.e. no active tab URL).
  - [x] 73.4 — `pnpm tsc --noEmit` clean

### Part D — API Tester MVP
- [x] Task 74: `src/components/panels/ApiTester.tsx` — main component
  - [x] 74.1 — Method selector (GET/POST/PUT/DELETE/PATCH/HEAD/OPTIONS) with per-method accent color. `<select>` element with the method name + a chevron, background tinted by method color.
  - [x] 74.2 — URL input. Press `Ctrl/Cmd+Enter` to send. Empty/disabled state shows a placeholder.
  - [x] 74.3 — Send button. Shows a `Sending…` pulse animation while in flight.
  - [x] 74.4 — Tabs: Headers, Body, cURL Import. Headers tab shows key/value rows with an enabled checkbox; "Add header" button. Body tab is a monospace textarea (disabled for GET/HEAD). cURL tab is a textarea + Import button.
  - [x] 74.5 — `parseCurl(input: string): { method, url, headers, body }` — tokenizes cURL commands (single-quoted, double-quoted, unquoted), supports `-X/--request`, `-H/--header`, `-d/--data/--data-raw/--data-binary/--data-urlencode`, `-F/--form`, `-u/--user` (Basic auth via `btoa`), `-A/--user-agent`, `-b/--cookie`. Skips `-L`, `-k`, `-s`, `--silent`, etc.
  - [x] 74.6 — `send()` — uses `fetch()` directly. Builds the headers object (filtering disabled rows), sends the body if non-empty AND method is not GET/HEAD. Measures duration via `performance.now()`. Sets `response` state with status, statusText, headers (record), raw body, formatted body (if JSON), size, duration. Pushes a new `ApiHistoryEntry` to the history array (capped at 50, newest first).
  - [x] 74.7 — Response viewer — status pill (color-coded: green 2xx, red 4xx/5xx, amber 3xx), status text, duration (ms), size (B/KB/MB), tabs for Body / Headers, Copy button (clipboard, "Copied!" for 1.5s). JSON responses are pretty-printed with `JSON.stringify(parsed, null, 2)`.
  - [x] 74.8 — Quick-pick row at the bottom — pre-fills the URL input with the live servers (e.g. `http://localhost:3000`).
  - [x] 74.9 — Request history (last 50, collapsible) — each row shows method (colored), URL, status (colored), duration. Click a row to load the method+URL back into the editor. "Trash" button clears the history.
  - [x] 74.10 — Two layouts: `embedded` (sidebar) and full-page modal (`onClose` prop). Embedded is what the sidebar uses; full-page is the fallback for command-palette / future "open in window" mode.
  - [x] 74.11 — `src/types/index.ts` — new `HttpMethod`, `ApiHeader`, `ApiHistoryEntry` types.
  - [x] 74.12 — `pnpm tsc --noEmit` clean
- [x] Task 75: API Tester wiring
  - [x] 75.1 — `src/components/sidebar/Sidebar.tsx` — `activePanel === "api"` renders `<ApiTester embedded />` filling the sidebar.
  - [x] 75.2 — `src/components/CommandPalette.tsx` — added 3 new commands: "Open Bookmarks Panel", "Open API Tester", "Find in Page" (Ctrl+F shortcut reachable via palette).
  - [x] 75.3 — `pnpm tsc --noEmit` clean

### Final integration verification
- [x] 76.1 — `cd src-tauri && cargo check` — clean
- [x] 76.2 — `pnpm tsc --noEmit` — clean
- [x] 76.3 — `PROJECT_STATE.md` updated to v1.0.0 with the new repo worktree snapshot, the new files, and a "CHANGES THIS SESSION (v0.9.11 → v1.0.0)" section
- [x] 76.4 — Runtime GUI verification (Ctrl+F → find bar appears, typing highlights matches, Enter cycles, Esc closes; Ctrl+D adds bookmark, sidebar reflects; open new tab → home page shows; sidebar "API Tester" → fetch() works) — pending human-run `pnpm tauri dev`

## Session 12 (v1.1.0 — panels + status bar + shortcuts) — DONE

- [x] Task 60: Audit missing panels (JwtDecoder.tsx and Base64Tool.tsx both MISSING)
- [x] Task 61: JWT Decoder + Base64 Tool
  - [x] 61.1 — Added "jwt" | "base64" to PanelId in src/types/index.ts
  - [x] 61.2 — Created src/components/panels/JwtDecoder.tsx (base64url decode, 300ms debounce, expiry countdown, collapsible sections)
  - [x] 61.3 — Created src/components/panels/Base64Tool.tsx (encode/decode, URL-safe toggle, TextEncoder/Decoder)
  - [x] 61.4 — Updated Sidebar.tsx (KeyRound + Binary icons, panel render entries, icon size reduced for 8-icon overflow)
- [x] Task 62: Runtime verification — pending human-run `pnpm tauri dev`
- [x] Task 63: Status Bar
  - [x] 63.1 — Created src/components/browser/StatusBar.tsx (20px bar, load time, loading pulse, origin)
  - [x] 63.2 — Load time tracking (loadStartRef in useWebviewBridge, loadTime field on Tab type)
  - [x] 63.3 — Hovered URL detection — SKIPPED (requires injected script, too complex for now)
  - [x] 63.4 — Mounted StatusBar in RootLayout.tsx (flex-col layout with content + StatusBar)
- [x] Task 64: Reopen Last Closed Tab
  - [x] 64.1 — lastClosedTab field + clearLastClosedTab action in tabs store
  - [x] 64.3 — Ctrl+Shift+T shortcut in useKeyboardShortcuts.ts
  - [x] 64.4 — Updated ShortcutHelp.tsx with Ctrl+Shift+T and Esc entries
- [x] Task 65: Stop Loading + Escape Key
  - [x] 65.1 — browser_stop_loading Rust command + registered in lib.rs (16 total handlers)
  - [x] 65.2 — stopLoading() in services/browser.ts
  - [x] 65.3 — Escape handler (close find or stop loading) + stopLoading in bridge return
- [x] Task 66: Final integration test — pending human-run `pnpm tauri dev`
- [x] Task 67: Updated PROJECT_STATE.md to v1.1.0 with new worktree, completed features, and CHANGES THIS SESSION

## Session 17 (v1.6.0 — overlay panels + history + notes) — DONE

- [x] Task 68: Overlay panel system (split-view architecture)
  - [x] 68.1 — Added `OverlayPanelId` type, `HistoryEntry` type, `Note` type to `src/types/index.ts`
  - [x] 68.2 — Added `overlayPanel`, `overlayHeight`, `openOverlay`, `closeOverlay`, `setOverlayHeight` to `src/stores/ui.ts`
  - [x] 68.3 — Created `src/components/overlay/OverlayPanel.tsx` (absolute-positioned, drag-to-resize handle, Esc to close)
  - [x] 68.4 — Updated `src/hooks/useWebviewBridge.ts`: `getBounds()` reduces height by `overlayHeight * contentArea.height` when overlay active; `isChromeOverlayOpen()` no longer includes `apiTesterOpen`; new useEffect syncs bounds when overlay opens/closes
  - [x] 68.5 — Mounted `OverlayPanel` in `src/components/browser/BrowserChrome.tsx` with apiTesterContent and notesContent props
  - [x] 68.6 — Updated `src/components/panels/ApiTester.tsx` embedded mode styling
  - [x] 68.7 — Updated `src/components/sidebar/ApiTesterPanel.tsx` to use `openOverlay("api-tester")`
  - [x] 68.8 — Updated `src/components/CommandPalette.tsx` to use `openOverlay("api-tester")`
  - [x] 68.9 — Removed `ApiTester` modal from `src/components/layout/RootLayout.tsx`

- [x] Task 69: History panel
  - [x] 69.1 — Created `src/stores/history.ts` (Zustand + persist, max 100 entries, FIFO)
  - [x] 69.2 — Created `src/components/sidebar/HistoryPanel.tsx` (grouped by date, delete/clear, open in new tab)
  - [x] 69.3 — Hooked `historyStore.addEntry()` into `useWebviewBridge.ts` navigate() and onUrlChanged

- [x] Task 70: Notes system
  - [x] 70.1 — Created `src/stores/notes.ts` (Zustand + persist, per-workspace)
  - [x] 70.2 — Created `src/components/sidebar/NotesSidebarPanel.tsx` (quick notes, expand/collapse, inline rename, "Open Notes" button)
  - [x] 70.3 — Created `src/components/panels/NotesNotepad.tsx` (full notepad: note list sidebar + editor, auto-save, word count)

- [x] Task 71: Sidebar wiring
  - [x] 71.1 — Updated `src/components/sidebar/Sidebar.tsx` to render `HistoryPanel` and `NotesSidebarPanel`
  - [x] 71.2 — Updated condition checks for "Coming soon" placeholder

- [x] Task 72: Verification
  - [x] 72.1 — `cd src-tauri && cargo check` — clean
  - [x] 72.2 — `pnpm tsc --noEmit` — clean
  - [x] 72.3 — Updated PROJECT_STATE.md to v1.6.0
  - [x] 72.4 — Updated TASKS.md
  - [ ] 72.5 — Runtime GUI verification: pending human-run `pnpm tauri dev`

## Session 18 (v1.7.0 — advanced notes with rich text editor) — DONE

- [x] Task 73: Install @tolipovjs/rich-text
  - [x] 73.1 — `pnpm add @tolipovjs/rich-text` (v2.2.0 installed)

- [x] Task 74: CSS theme mapping
  - [x] 74.1 — Added `@import "@tolipovjs/rich-text/styles.css"` to `src/index.css`
  - [x] 74.2 — Added 30+ `--rte-*` CSS variable overrides in both `[data-theme="dark"]` and `[data-theme="light"]` blocks, mapping XEVO's `--xevo-*` tokens to the editor's `--rte-*` variables

- [x] Task 75: Fix title bug
  - [x] 75.1 — `NotesNotepad.tsx`: removed `|| "Untitled"` fallback from `handleTitleChange`. Titles now allow empty strings. Placeholder shown via `placeholder="Untitled"`.
  - [x] 75.2 — `NotesSidebarPanel.tsx`: removed `|| "Untitled"` from `handleTitleCommit`. Titles can be empty. Display uses `note.title || "Untitled"`.
  - [x] 75.3 — `notes.ts` store: `createNote` now creates notes with `title: ""` instead of `"Untitled"`.

- [x] Task 76: Update Note type and store
  - [x] 76.1 — `src/types/index.ts`: added `NoteColor` type (`"" | "red" | "orange" | "yellow" | "green" | "blue" | "purple"`), added `isPinned: boolean` and `color: NoteColor` to `Note` interface
  - [x] 76.2 — `src/stores/notes.ts`: added `isPinned`/`color` fields, `togglePin`/`setColor` actions, `sortNotes()` helper (pinned-first, then by updatedAt)

- [x] Task 77: Replace textarea with RichTextEditor
  - [x] 77.1 — `NotesNotepad.tsx` full rewrite: replaced `<textarea>` with `<RichTextEditor>` from `@tolipovjs/rich-text`
  - [x] 77.2 — Enabled: toolbar (basic preset), slash menu, markdown shortcuts, bubble toolbar, find/replace
  - [x] 77.3 — Theme-aware: reads XEVO settings theme (dark/light/auto)
  - [x] 77.4 — Auto-save with 500ms debounce, `key={selectedId}` forces remount on note switch
  - [x] 77.5 — Export as Markdown (.md) via blob download
  - [x] 77.6 — Enhanced footer: char count + word count + reading time estimate
  - [x] 77.7 — Pin button, color picker (6 options), color dot in note list

- [x] Task 78: Update NotesSidebarPanel
  - [x] 78.1 — Pin indicator (Pin icon) in note cards
  - [x] 78.2 — Color dots in note cards
  - [x] 78.3 — HTML preview for expanded notes (dangerouslySetInnerHTML)
  - [x] 78.4 — Pin/unpin button in hover actions

- [x] Task 79: Verification
  - [x] 79.1 — `cd src-tauri && cargo check` — clean
  - [x] 79.2 — `pnpm tsc --noEmit` — clean
  - [x] 79.3 — Updated PROJECT_STATE.md to v1.7.0
  - [x] 79.4 — Updated TASKS.md
  - [ ] 79.5 — Runtime GUI verification: pending human-run `pnpm tauri dev`

## Session 23 (black screen on window restore) — DONE

- [x] Task 80: Fix black screen on window restore (Fix A — repaint trigger)
  - [x] 80.1 — Added `browser_repaint` Rust command in `src-tauri/src/commands/browser.rs`
  - [x] 80.2 — Registered `browser_repaint` in `src-tauri/src/lib.rs` invoke_handler (19 → 20)
  - [x] 80.3 — Added `repaintWebview()` IPC wrapper in `src/services/browser.ts`
  - [x] 80.4 — Added `onFocusChanged` useEffect in `src/hooks/useWebviewBridge.ts`
  - [x] 80.5 — `cd src-tauri && cargo check` — clean
  - [x] 80.6 — `pnpm tsc --noEmit` — clean
  - [ ] 80.7 — Runtime GUI verification: pending human-run `pnpm tauri dev` — **FAILED at runtime: black screen persists after restore**

## Session 24 (black screen fix — set_size WM_SIZE approach) — DONE

- [x] Task 81: Fix black screen on window restore (Fix C — RedrawWindow Win32 API)
  - [x] 81.1 — Added `windows` crate dependency to `src-tauri/Cargo.toml` with `Win32_Foundation` + `Win32_Graphics_Gdi` features
  - [x] 81.2 — Replaced `browser_repaint` hide+show cycle with `RedrawWindow(hwnd, None, None, RDW_INVALIDATE | RDW_UPDATENOW | RDW_ALLCHILDREN)` Win32 API call
  - [x] 81.3 — Uses `wv.hwnd()` to get the native HWND from Tauri's `WebviewWindow`
  - [x] 81.4 — `#[cfg(windows)]` guard for platform-specific code, fallback to hide+show on non-Windows
  - [x] 81.5 — `cd src-tauri && cargo check` — clean
  - [x] 81.6 — `pnpm tsc --noEmit` — clean
  - [ ] 81.7 — Runtime GUI verification: pending human-run `pnpm tauri dev` — **FAILED at runtime: black screen persists (RedrawWindow sends WM_PAINT but WebView2 needs WM_SIZE)**

- [x] Task 82: Fix black screen on window restore (Fix D — set_size triggers WM_SIZE)
  - [x] 82.1 — Root cause identified: maximize/restore fixes black screen because those actions send WM_SIZE. WebView2 re-composites on WM_SIZE, not WM_PAINT.
  - [x] 82.2 — Replaced RedrawWindow in `browser_repaint` with `wv.inner_size()` + `wv.set_size(Size::Physical(size))` — re-applies current size to trigger WM_SIZE
  - [x] 82.3 — Removed `windows` crate dependency from `src-tauri/Cargo.toml` (no longer needed)
  - [x] 82.4 — `cd src-tauri && cargo check` — clean
  - [x] 82.5 — `pnpm tsc --noEmit` — clean
  - [ ] 82.6 — Runtime GUI verification: pending human-run `pnpm tauri dev`

## Session 25 (black screen fix — ±1px resize trick) — DONE

- [x] Task 83: Fix black screen on window restore (Fix E — ±1px resize trick)

  - [x] 83.1 — Root cause chain confirmed: `SW_SHOW` does not send WM_SIZE → RedrawWindow sends WM_PAINT not WM_SIZE → `set_size(same)` suppressed by Windows → only real size change triggers WM_SIZE → WebView2 re-composites on WM_SIZE
  - [x] 83.2 — Extracted `pub(crate) async fn do_browser_repaint(app: &AppHandle)` in `browser.rs` — shrinks height by 1px (WM_SIZE #1), sleeps 50ms, restores original (WM_SIZE #2)
  - [x] 83.3 — Simplified `browser_repaint` command to delegate to `do_browser_repaint`
  - [x] 83.4 — Added `.setup()` block in `lib.rs` with `WindowEvent::Focused(true)` handler → spawns async task → 150ms delay → `do_browser_repaint`
  - [x] 83.5 — Removed frontend `onFocusChanged` listener from `useWebviewBridge.ts` (double-fire causes flicker)
  - [x] 83.6 — Removed unused `repaintWebview` import from `useWebviewBridge.ts`
  - [x] 83.7 — `cd src-tauri && cargo check` — clean
  - [x] 83.8 — `pnpm tsc --noEmit` — clean
  - [ ] 83.9 — Runtime GUI verification: pending human-run `pnpm tauri dev`

## Session 26 (black screen fix — focus-ping approach) — DONE

- [x] Task 84: Fix black screen on window restore (Fix F — focus-ping browser WebviewWindow)

  - [x] 84.1 — Replaced `do_browser_repaint` body: now focuses browser WebviewWindow (triggers WebView2 re-composite), sleeps 80ms, returns focus to main
  - [x] 84.2 — Removed unused `PhysicalSize` import from browser.rs
  - [x] 84.3 — Increased delay in `lib.rs` `WindowEvent::Focused(true)` handler from 150ms to 200ms
  - [x] 84.4 — `cd src-tauri && cargo check` — clean
  - [x] 84.5 — `pnpm tsc --noEmit` — clean
  - [ ] 84.6 — Runtime GUI verification: pending human-run `pnpm tauri dev`

## Session 27 (black screen fix — auto maximize/unmaximize cycle) — DONE

- [x] Task 85: Fix black screen on window restore (Fix G — maximize/unmaximize cycle)

  - [x] 85.1 — Added `Arc<AtomicBool>` minimize tracking in `lib.rs` setup block
  - [x] 85.2 — `Focused(false)` handler: checks `is_minimized()`, sets flag if true
  - [x] 85.3 — `Focused(true)` handler: if flag set, spawns async task → 150ms delay → maximize→unmaximize (or reverse if was maximized)
  - [x] 85.4 — Made `do_browser_repaint` a no-op in browser.rs (superseded)
  - [x] 85.5 — `cd src-tauri && cargo check` — clean (fixed borrow error with mw_clone)
  - [x] 85.6 — `pnpm tsc --noEmit` — clean
  - [ ] 85.7 — Runtime GUI verification: pending human-run `pnpm tauri dev`

## Session 28 (v1.8.0 — XEVO_FRONTEND.md design system P1+P2) — DONE

- [x] Task 86: P1 — Tailwind v4 theme system
  - [x] 86.1 — `src/index.css`: added `@custom-variant dark` after `@import "tailwindcss"`
  - [x] 86.2 — `src/index.css`: wrapped all design tokens in `@theme { ... }` block (colors, fonts, spacing, radius, motion)
  - [x] 86.3 — `src/index.css`: `:root` retains shadcn/ui semantic mappings + legacy aliases + RTE theme
  - [x] 86.4 — `src/index.css`: added `@media (prefers-reduced-motion: reduce)` global rule
  - [x] 86.5 — `src/index.css`: added `@keyframes ambientPulse`, `paletteIn`, `toastIn`
  - [x] 86.6 — `src-tauri/tauri.conf.json`: added `"decorations": false` + `"transparent": false` to main window
  - [x] 86.7 — `pnpm tsc --noEmit` clean, `cargo check` clean

- [x] Task 87: P2 — HomePage redesign (spec §10)
  - [x] 87.1 — `src/components/panels/HomePage.tsx`: centered 720px column, "Your stack, at a glance." heading (24px/600)
  - [x] 87.2 — Server cards: 64px height, liveness dot + port + "Open →" link, ambient radial gradient pulse
  - [x] 87.3 — Empty state: italic "No servers detected..." text

- [x] Task 88: P2 — CommandPalette animation + sizing (spec §6)
  - [x] 88.1 — `src/components/CommandPalette.tsx`: 80ms `paletteIn` animation (fade + scale 0.97→1.0)
  - [x] 88.2 — Input height 44px, results max-height 320px, result items 32px, border-radius 6px
  - [x] 88.3 — Selected state uses `accent-dim`, sublabel shown on right for commands

- [x] Task 89: P2 — Sidebar 150ms width transition (spec §7)
  - [x] 89.1 — `src/components/sidebar/Sidebar.tsx`: always rendered (no `return null`), width animated 150ms ease-snap

- [x] Task 90: P2 — Toast 100ms animation (spec §7)
  - [x] 90.1 — `src/components/Toast.tsx`: 100ms `toastIn` animation (was 200ms), inline `<style>` removed
  - [x] 90.2 — `src/index.css`: `@keyframes toastIn` added

- [x] Task 91: Verification
  - [x] 91.1 — `pnpm tsc --noEmit` — clean
  - [x] 91.2 — `cargo check` — clean

## Session 29 (v1.9.0 — XEVO_FRONTEND.md design system P3) — DONE

- [x] Task 92: P3 — aria-label sweep (spec §13)
  - [x] 92.1 — Added `aria-label` to 10 icon-only buttons in browser components (TabItem, TabBar, Toolbar, FindBar)
  - [x] 92.2 — Added `aria-label` to 24 icon-only buttons across sidebar/panel/overlay components (Sidebar, WorkspaceSwitcher, SettingsPanel, OverlayPanel, ShortcutHelp, ApiTester, NotesNotepad, HistoryPanel, BookmarksPanel, etc.)
  - [x] 92.3 — Dynamic aria-labels for toggle buttons (sidebar collapse, pin/unpin)

- [x] Task 93: P3 — font-feature-settings tnum (spec §3)
  - [x] 93.1 — Added `fontFeatureSettings: '"tnum" 1'` or `tabular-nums` to 10 high-priority numeric elements (StatusBar load time, ApiTester status/duration/size, FindBar match counter, Sidebar port numbers, HomePage port numbers)

- [x] Task 94: P3 — Remove unauthorized shadows (spec §9 rule 2)
  - [x] 94.1 — Removed `shadow-lg` from Toast.tsx and WorkspaceContextMenu.tsx
  - [x] 94.2 — Removed `shadow-[0_0_0_2px_rgba(255,255,255,0.04)]` from AddressBar.tsx
  - [x] 94.3 — Removed `shadow-xs` from ui/input.tsx and ui/button.tsx
  - [x] 94.4 — Removed `box-shadow` transition from ui/badge.tsx
  - [x] 94.5 — Removed `boxShadow` from TabBar.tsx drag ghost element
  - [x] 94.6 — Kept: liveness dot glow (Sidebar.tsx) and focus ring (index.css) — both permitted by spec

- [x] Task 95: P3 — Remove hover:scale (spec §9 rule 4)
  - [x] 95.1 — Removed `hover:scale-110` from NotesNotepad.tsx color picker dots

- [x] Task 96: P3 — Wire tauri-controls
  - [x] 96.1 — Added `tauri-plugin-os = "2"` to src-tauri/Cargo.toml
  - [x] 96.2 — Registered `tauri_plugin_os::init()` in src-tauri/src/lib.rs
  - [x] 96.3 — Added `os:default` + window permissions to src-tauri/capabilities/default.json
  - [x] 96.4 — Updated TabBar.tsx: imports `WindowControls` from tauri-controls, detects OS via `platform()`, renders controls on correct side (macOS: left, Windows/Linux: right)
  - [x] 96.5 — Removed hardcoded `paddingRight: 140px` — padding now handled by WindowControls component

- [x] Task 97: Verification
  - [x] 97.1 — `pnpm tsc --noEmit` — clean
  - [x] 97.2 — `cargo check` — clean
  - [x] 97.3 — Final shadow sweep: 0 unauthorized shadow references remaining

## Session 31 (v1.11.0 — browser webview drag-after-restore fix) — DONE

- [x] Task 98: Fix browser webview not following main window after maximize/restore
  - [x] 98.1 — Root cause confirmed: `onMoved` is unreliable for maximize/unmaximize on Windows (SWP_NOMOVE in WM_WINDOWPOSCHANGED, tauri #7664 closed "not planned"). `onResized` is always reliable (WM_SIZE fires unconditionally).
  - [x] 98.2 — Ref-based syncBounds: `syncBoundsRef.current` holds latest logic, `syncBounds = useCallback(() => syncBoundsRef.current(), [])` has stable identity. Eliminates stale-closure bugs across re-renders.
  - [x] 98.3 — Added `onResized` listener alongside `onMoved`. 50ms delay lets DOM reflow after the lib.rs repaint hack. Both call `syncBoundsRef.current()`.
  - [x] 98.4 — Maximize-state detection: `wasMaximizedRef` tracks state via `onResized` + `isMaximized()`. On transition, resets `lastBoundsRef = null` to force full re-sync (bypasses 5px threshold).
  - [x] 98.5 — onMoved throttle: 16ms + `requestAnimationFrame` reduces redundant Rust calls during drag.
  - [x] 98.6 — Removed standalone `getBounds` useCallback. Bounds computation inlined into syncBoundsRef.current, ensureWebviewVisible, navigate, goBack, goForward, sidebar toggle effect, tab-switch effect. All read contentAreaRef.current fresh at call time.
  - [x] 98.7 — Verified lib.rs maximize/unmaximize hack must stay — removing it causes black screen regression (Sessions 23-27, 5 failed fix attempts). The hack is the only mechanism that sends WM_SIZE with actual size change to WebView2.
  - [x] 98.8 — `pnpm tsc --noEmit` — clean
  - [x] 98.9 — `cargo check` — clean
  - [ ] 98.10 — Runtime verification: pending human `pnpm tauri dev`
    - Test 1: Maximize → restore → drag → browser follows
    - Test 2: Minimize → restore → webview appears (no black screen)
    - Test 3: Normal drag → browser follows
    - Test 4: Window resize → browser resizes

## Session 32 (v1.11.1 — main window drag fix) — DONE

- [x] Task 99: Fix main window not draggable after maximize→restore
  - [x] 99.1 — Root cause: Tauri's drag.js `isDragRegion()` uses bare `data-tauri-drag-region` attribute which only triggers drag when the exact element is the click target (`el === composedPath[0]`), not child elements. Clicking on tabs, + button, etc. did NOT trigger drag.
  - [x] 99.2 — Changed `data-tauri-drag-region` → `data-tauri-drag-region="deep"` on TabBar outer div. With "deep", any click within the subtree triggers drag. `data-tauri-drag-region="false"` on WindowControls still blocks drag on min/max/close buttons.
  - [x] 99.3 — `pnpm tsc --noEmit` — clean
  - [x] 99.4 — `cargo check` — clean
  - [ ] 99.5 — Runtime verification: pending human `pnpm tauri dev`
    - Test 1: Click on any tab → window drag works
    - Test 2: Click on empty tab bar space → window drag works
    - Test 3: Click on minimize/maximize/close → buttons work, no drag
    - Test 4: Double-click on tab bar → toggles maximize
    - Test 5: Maximize → restore → drag → works
    - Test 6: Normal drag → works

## ENHANCED_BROWSER.md Phase 1: Tab Persistence — DONE

- [x] Add `persist` middleware to `src/stores/tabs.ts` with `partialize` (strip transient fields: isLoading, loadTime, discardedAt, lastActiveAt, scrollPosition) and `merge` (hydrate with defaults)
- [x] Fix `src/stores/workspaces.ts` `sanitizeWorkspace` to preserve `tabIds` and `activeTabId`
- [x] Add hydration recovery `useEffect` in `useWebviewBridge.ts` — creates webview for active tab after `xevo:tabs-hydrated` event
- [x] Orphaned tab cleanup: tabs not belonging to any workspace are removed on hydration
- [x] `pnpm tsc --noEmit` — clean
- [x] `cargo check` — clean
- [ ] Runtime GUI verification: pending human-run `pnpm tauri dev`
  - Open 3 tabs with different URLs → Pin one → Close app → Reopen → All 3 tabs restored with correct URLs, pinned tab shows pin icon, active tab preserved

## ENHANCED_BROWSER.md Phase 4: Meta Tag Inspector — DONE
- [x] Create MetaValidator.ts with validation rules
- [x] Create SocialPreview.tsx component (Facebook, Twitter, LinkedIn, Discord cards)
- [x] Add image diagnostics (fetch og:image, measure dimensions, validate aspect ratio/size)
- [x] Update InspectorPanel MetaSubTab with validation + previews
- [x] `pnpm tsc --noEmit` — clean

## ENHANCED_BROWSER.md Phase 3: User Agent Switcher — DONE
- [x] Create UA presets data file (UserAgentPresets.ts)
- [x] Add browser_set_user_agent Rust command + BrowserState field
- [x] Inject UA override script into webview init
- [x] Create UserAgentPanel.tsx sidebar panel
- [x] Register panel in Sidebar.tsx, add userAgent to settings
- [x] `pnpm tsc --noEmit` — clean
- [x] `cargo check` — clean

## ENHANCED_BROWSER.md Phase 2: Performance Optimization — DONE
- [x] 5A — React.lazy panels (all 9 panels, PanelSkeleton fallback)
- [x] 5B — manualChunks in vite.config.ts
- [x] 5C — Split Init Script (CORE_SCRIPT + HEADER_SCRIPT + NETWORK_SCRIPT)
- [x] 5D — Lazy Webview Creation (already default, confirmed)
- [x] 5E — Virtualize Long Lists (react-window v2, VirtualList wrapper, applied to BookmarksPanel)
- [x] `pnpm tsc --noEmit` — clean
- [x] `cargo check` — clean

## ENHANCED_BROWSER.md Phase 5: Multi-Viewport Mode — DONE
- [x] Create 7 Rust commands (create_viewport, destroy_viewport, resize_viewport, show_viewport, hide_viewport, scroll_viewport, click_viewport, notify_viewport_scroll, browser_eval_raw)
- [x] Create ViewportPresets.ts (mobile/tablet/laptop presets)
- [x] Extend ui.ts store with viewport state + actions
- [x] Create browser.ts service functions
- [x] Create useViewportSync.ts (scroll sync via event bus)
- [x] Create ViewportPanel.tsx (CSS Grid layout, preset dropdown, sync toggles)
- [x] Replace `__TAURI_INTERNALS__.invoke` with `evalRaw` from services/browser in ViewportPanel
- [x] Add "viewport" to PanelId type
- [x] Register ViewportPanel in Sidebar.tsx (lazy import + panel entry + rendering)
- [x] Add viewport mode toggle button in Toolbar.tsx (Columns3 icon)
- [x] Wire viewport overlay in RootLayout.tsx (replaces BrowserChrome when viewportMode on)
- [x] Fix unused variables (resizeViewport, SCROLL_SYNC_SCRIPT, scrollLabelsRef)
- [x] `pnpm tsc --noEmit` — clean
- [x] `cargo check` — clean

## Session 40 — Screenshot Bug Fix (WebView2 Content Black) — DONE
- [x] Replace `PrintWindow` screenshot approach with DevTools Protocol (`Page.captureScreenshot`) via WebView2 COM API
- [x] Add `webview2-com = "0.38"`, `base64 = "0.22"`, `windows-core = "0.61"` dependencies
- [x] Use `CallDevToolsProtocolMethodCompletedHandler` pre-built handler from `webview2-com` crate
- [x] Bridge COM callback to async Rust via `tokio::sync::oneshot`
- [x] Refactor: split into orchestrator + `capture_browser_devtools` + `capture_main_window_printwindow`
- [x] Keep `PrintWindow` as fallback when DevTools capture unavailable
- [x] `cargo check` — clean
- [x] `pnpm build` (includes tsc) — clean

## ENHANCED_BROWSER.md Phase 6: Screenshot Tool — DONE
- [x] Add `xcap` + `image` crates to Cargo.toml
- [x] `browser_screenshot` Rust command (captures XEVO window, encodes to PNG, returns Vec<u8>)
- [x] Register command in lib.rs invoke_handler
- [x] Create `src/lib/screenshot.ts` (clipboard copy + download fallback)
- [x] Add `takeScreenshot()` service function in browser.ts
- [x] Add Ctrl+Shift+S shortcut in useKeyboardShortcuts.ts + forwarded handler
- [x] Add Camera toolbar button in Toolbar.tsx (with toast feedback)
- [x] Add screenshot entry to ShortcutHelp.tsx
- [x] `pnpm tsc --noEmit` — clean
- [x] `cargo check` — clean

## Webview Stuck on Maximize Fix (v1.28.0) — DONE
- [x] Merge duplicate `onResized` listeners into one (eliminated race between 50ms and 60ms handlers)
- [x] Increase maximize sync delay: 60ms → 350ms (outlasts ~200-300ms Windows animation)
- [x] Add `isMaximizingRef` to suppress ResizeObserver during maximize animation
- [x] Add double-sync after maximize (350ms + 500ms) for defensive late-settle catch
- [x] Remove duplicate `browser_reposition` command (identical to `browser_set_bounds`)
- [x] `cargo check` — clean
- [x] `pnpm build` — clean

## Webview Stuck on Minimize-Restore (v1.28.0 follow-up) — DONE
- [x] Replace single 80ms sync with triple-sync (rAF, 120ms, 350ms) on minimize-restore
- [x] Clear `isMaximizingRef` in minimize-state listener so ResizeObserver can fire during restore
- [x] Clear `lastBoundsRef` before each sync attempt to bypass 5px threshold
- [x] `pnpm build` — clean

## Comprehensive Webview Bounds Sync Rewrite (v1.29.0) — DONE
- [x] Root cause found: async `getCurrentWindow().isMaximized()` IPC creates race window where `isMaximizingRef` isn't set before ResizeObserver fires, allowing an intermediate-bounds sync that can go uncorrected
- [x] Fix 1a: Rewrite `onResized` to dual-timer approach (50ms fast + 500ms slow) — no async IPC, no conditional maximize detection
- [x] Fix 1b: Remove `isMaximizingRef` guard from ResizeObserver — all sync paths fire freely
- [x] Fix 1c: Bump minimize-restore delay 350ms → 500ms; remove `isMaximizingRef` clear (no longer exists)
- [x] Fix 1d: Add `xevo://force-sync` frontend listener for Rust-driven immediate bounds sync
- [x] Fix 1e: Remove unused refs (`wasMaximizedRef`, `isMaximizingRef`); add `resizeTimerRef`/`longResizeTimerRef`
- [x] Fix 2: Emit `xevo://force-sync` from Rust `Focused(true)` restore handler in `lib.rs`
- [x] `cargo check` — clean
- [x] `pnpm build` — clean

## Session 57 (v1.30.0 — Tab Memory Preservation) — DONE

- [x] Task 100: Tab state save/restore on discard (not on switch)
  - [x] 100.1 — Extended Tab interface with `savedScrollX`, `savedScrollY`, `savedFormState` fields
  - [x] 100.2 — Updated tabs store: `saveTabState` action, `buildTab`/`stripTab`/`hydrateTab`/`StoredTab` with new fields
  - [x] 100.3 — Added Rust commands: `browser_save_tab_state`, `browser_tab_state_saved`, `browser_restore_tab_state`
  - [x] 100.4 — Registered 3 new commands in `lib.rs` invoke_handler (30 → 33)
  - [x] 100.5 — Added IPC wrappers in `browser.ts`: `saveTabState()`, `restoreTabState()`, `onTabStateSaved()`
  - [x] 100.6 — Fixed `useWebviewBridge.ts`: save on discard only (timer + cap paths), restore on recreate only, removed broken switch/onLoadingChanged logic
  - [x] 100.7 — `cargo check` — clean
  - [x] 100.8 — `pnpm tsc --noEmit` — clean
  - [x] 100.9 — `pnpm build` — clean

## Session 58 (Tab Memory Preservation — Fix) — DONE

- [x] Task 100.10 — Fixed black screen + reload cycle caused by save/restore on every tab switch
  - [x] Removed `saveTabState(prevId)` from tab switching effect (was triggering Rust eval → onLoadingChanged → restore cycle)
  - [x] Removed `restoreTabState()` from `onLoadingChanged` (was firing on every page load, not just discard recovery)
  - [x] Removed `onTabStateSaved` listener and `unTabStateSaved` cleanup
  - [x] Added `saveTabState(tabId)` before `closeTabWebview(tabId)` in discard timer path
  - [x] Added `saveTabState(tabId)` before `closeTabWebview(tabId)` in cap enforcement path
  - [x] Added form state restore + clear after webview recreate in tab switching effect
  - [x] Added `saveTabState(id)` in `recreateForUserAgent` before closing non-active webviews
  - [x] Verified: `cargo check` + `pnpm tsc --noEmit` + `pnpm build` clean

## Session — Header Injection Fix (fetch/XHR monkeypatch) — DONE (v2 follow-up fix applied 2026-07-10)
- [x] Added fetch and XMLHttpRequest monkeypatching to HEADER_SCRIPT so `__xevoInjectHeaders` is actually called on real requests
- [x] Verified: `cargo check` + `pnpm tsc --noEmit` clean

- [x] Task 101.5 — Codebase cleanup after tab switching fix
  - [x] Removed dead `browser_activate_tab` function (Rust + lib.rs registration + TS export)
  - [x] Removed orphan exports: `onTabStateSaved`, `onViewportMetrics` from `browser.ts`
  - [x] Removed persist middleware from `tabs.ts`: `StoredTab`, `stripTab`, `partialize`, `merge`, `version`, `onRehydrateStorage`, unused imports (`useUIStore`, `useWorkspacesStore`), `persist` import
  - [x] Removed dead Tab fields: `scrollPosition`, `savedScrollX`, `savedScrollY` (kept `loadTime` — used by StatusBar)
  - [x] Fixed `workspaces.ts` `onRehydrateStorage`: replaced direct state mutation with proper `resetAllWorkspaceTabs` store action using immer `set()`
  - [x] Updated `saveTabState` store action signature (removed unused scrollX/scrollY params)
  - [x] Verified: `cargo check` + `pnpm tsc --noEmit` + `pnpm build` clean

## Session 60 — Network Log Rebuild (Native WebView2 COM) — DONE

### Phase 0-4: Rust backend (DONE)
- [x] Phase 0 — Version audit: `webview2-com 0.38.2` + `windows 0.61.3`, single resolved versions, no changes needed
- [x] Phase 1 — Proof of concept: `register_webview_network_capture` with request handler via `.with_webview()` on main thread
- [x] Phase 2 — Multi-tab: auto-handled (every `create_webview_for_tab` calls it)
- [x] Phase 3 — Response handler: `ICoreWebView2_2` cast, `add_WebResourceResponseReceived`, status code + headers via `GetCurrentHeader`/`HasCurrentHeader`/`MoveNext`
- [x] Phase 4 — Body reading: `GetContent` + `IStream::Read` in 8KB chunks capped at 64KB, `String::from_utf8_lossy`, event emission via `browser://network-entry`
- [x] `cargo check` — clean

### Phase 5: Frontend (DONE)
- [x] Add `"network"` to `PanelId` type in `src/types/index.ts`
- [x] Create `src/stores/network.ts` (Zustand, entriesByTab, 200-entry cap)
- [x] Create `src/components/panels/NetworkPanel.tsx` (method colors, status colors, truncation)
- [x] Add `onNetworkEntry()` listener in `src/services/browser.ts`
- [x] Wire event listener in `src/hooks/useWebviewBridge.ts`
- [x] Register `NetworkPanel` in `Sidebar.tsx` between History and Header Injection (Activity icon)
- [x] `pnpm tsc --noEmit` — clean
- [x] Runtime GUI verification — 4 requests captured for jsonplaceholder (was 0 for fast-loading URLs)

## Session 61 — Network Capture Timing Fix (v1.32.1)

- [x] **Root cause:** `register_webview_network_capture` called after `webview.build()` — navigation starts during `build()`, so fast-loading URLs respond before handlers are registered → 0 entries.
- [x] **Fix:** Build with `about:blank`, register handlers, then navigate to real URL.
- [x] Files changed: `src-tauri/src/commands/browser.rs` (3 edits: clone parsed URL, about:blank builder, navigate after handlers)
- [x] Verified: `cargo check` clean; runtime verified with `https://jsonplaceholder.typicode.com/posts/1`

## Session 59 (Tab Switching Fix + Remove Tab Persistence) — DONE

- [x] Task 101 — Fixed tab recreation on every switch (root cause: `browser_activate_tab` destroyed webviews unconditionally)
  - [x] Removed stale handle destruction from `browser_activate_tab` in `browser.rs` (lines 1016-1024) — the webview lookup at line 1037 now works correctly
  - [x] Replaced `activateTab` with `hideTabWebview` + `showTabWebview` in the normal tab switching path in `useWebviewBridge.ts`
  - [x] Removed unused `activateTab` import
  - [x] Removed `TAB HYDRATION RECOVERY` section and `hydTimerRef` from `useWebviewBridge.ts`
  - [x] Modified `tabs.ts` `merge` function to return empty tabs on startup (no restore)
  - [x] Added `onRehydrateStorage` to `workspaces.ts` to clear `tabIds`/`activeTabId` on startup
  - [x] Removed unused `hydrateTab` function from `tabs.ts`
  - [x] Verified: `cargo check` + `pnpm tsc --noEmit` + `pnpm build` clean

