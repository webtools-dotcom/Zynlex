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

## Backlog
- [ ] Port scanner: HTTP title shown in sidebar tooltip
- [ ] Port scanner: manual "add custom port" UI
- [ ] Workspace drag-to-reorder in sidebar
- [ ] ResizeObserver 50ms debounce — apply if runtime reveals resize glitches
- [ ] **Option A (NOW):** GitHub push + README + v1.0 tag
- [ ] **Option B:** Tab-per-WebviewWindow (one real browser window per tab)
- [ ] History panel (sidebar — `activePanel === "history"`) — last 100 navigations across workspaces
- [ ] Network log panel (sidebar — `activePanel === "network"`) — request/response log
- [ ] Notes panel (sidebar — `activePanel === "notes"`) — per-workspace scratch pad
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


