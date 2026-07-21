# XEVO Task Backlog

## Architecture Foundation

### Webview Architecture (v0.9.0 → locked at v0.9.11)
Early sessions used `Window::add_child` child webviews. Tauri 2's `Webview::set_bounds`/`set_position`/`set_size` all call `self.window()` internally, which errors with "current webview is not a WebviewWindow" for child webviews. Workarounds tried: close-and-recreate with unique labels (v0.9.5), async 50ms delay after `webview.close()` (v0.9.4), 5px thresholds for bounds oscillation (v0.9.3). All fragile.

**v0.9.6 — Pivot to `WebviewWindowBuilder` with `parent`**: Each tab gets a persistent `WebviewWindow` (label `browser-{tabId}`), created lazily on first navigation via `ensure_browser_window`, hidden/shown on switch. Bounds use logical (CSS) pixels — no `devicePixelRatio` or `scale_factor()` multiplication. Frontend `getBounds()` returns screen-relative CSS pixels (`rect.left + window.screenX`, `rect.top + window.screenY`). Main window drag → browser follows via `WindowEvent::Moved`. Unlocked: back/forward history, working resize, first-nav lag paid once per tab.

**Session 10.6 — Architecture locked**: `add_child` tested directly — Rust returned `Ok(())` but webview didn't follow on drag. Tauri 2.11.2 confirmed latest stable. Issue #10079 closed "not planned" (parent() doesn't work on Windows). ~5-10ms drag lag accepted as Tauri 2 limitation. No further investment.

### Coordinate System
Logical (CSS) pixels everywhere. `WebviewWindowBuilder::position(x, y)` and `.inner_size(w, h)` take `f64` logical pixels. `set_position(Position::Logical)` / `set_size(Size::Logical)` on existing windows. OS scales to physical via DPI.

**Key gotcha** (v0.9.11): In Tauri 2 WebView2, `window.screenX/Y` returns the viewport's top-left (same as `innerPosition() / devicePixelRatio`), NOT the OS window frame. Original formula `rect.top + window.screenY + titleBarHeight` double-counted the title bar. Fixed: `rect.top + window.screenY`.

### Tab Lifecycle
- Webviews created once per tab (first navigation), destroyed on close. Tab switch = hide/show only (fixed in Session 59 — `browser_activate_tab` was destroying webviews unconditionally).
- Tabs inactive >10min discarded (pinned/active exempt). Soft cap 10 concurrent (oldest discarded when exceeded).
- All webviews share same WebView2 data directory for process sharing.
- 3 init scripts injected per tab: CORE_SCRIPT (header injection, tab info, keyboard shortcuts), CHROME_FEATURES_SCRIPT (find-in-page, bookmark shortcut, shortcut forwarding), JSON_VIEWER_SCRIPT.

### Bounds Sync
Dual listeners: `onMoved` (reliable for drags, unreliable for maximize/unmaximize — `SWP_NOMOVE`, tauri #7664 closed not planned) + `onResized` (always reliable). Dual-timer approach (50ms fast + 500ms slow, v1.29.0 rewrite). Maximize-state detection resets `lastBoundsRef` on transitions. `xevo://force-sync` event from Rust `Focused(true)` handler.

## Notable Bug Fixes

### Black Screen on Window Restore (Sessions 23-27, v1.28.0-v1.29.0)
WebView2 goes black when main window restored from minimize. Root cause chain: `SW_SHOW` does not send WM_SIZE → WebView2 re-composites on WM_SIZE only → `set_size(same)` suppressed by Windows. 5 approaches tried:
1. Repaint command (hide+show) — failed
2. `RedrawWindow` Win32 API — failed (sends WM_PAINT, not WM_SIZE)
3. `set_size(Physical(size))` reapply — failed (same size suppressed)
4. ±1px shrink/restore with 50ms delay — worked
5. Focus-ping browser window — worked
6. **Final**: Auto maximize/unmaximize cycle on restore from minimize.
Current approach: maximize/unmaximize cycle + dual-timer sync + `xevo://force-sync`.

### Webview Stuck on Maximize (v1.28.0)
Race between duplicate `onResized` listeners (50ms and 60ms). Merged to one, delay 350ms (outlasts ~200-300ms Windows animation), `isMaximizingRef` to suppress ResizeObserver during animation, double-sync at 350ms+500ms.

### Webview Stuck on Minimize-Restore (v1.28.0)
Triple-sync (rAF, 120ms, 350ms), clear `lastBoundsRef` before each attempt, clear `isMaximizingRef` in minimize listener.

### Bounds Sync Rewrite (v1.29.0)
Async `getCurrentWindow().isMaximized()` IPC created race — `isMaximizingRef` not set before ResizeObserver fired, allowing uncorrected intermediate-bounds sync. Rewrote to dual-timer (50ms+500ms), no async IPC, removed conditional guards. Added `xevo://force-sync` listener.

### Tab Switching (Sessions 57-59)
- **State save/restore on discard only** (v1.30.0): Save on discard timer/cap paths, restore on recreate. NOT on tab switch or `onLoadingChanged` — caused eval→onLoadingChanged→restore loop (black screen + reload).
- **Recreation on every switch** (Session 59): `browser_activate_tab` destroyed webviews unconditionally (stale handle destruction at browser.rs:1016-1024). Fixed: `hideTabWebview` + `showTabWebview`. Webviews now persistent across switches.

### Network Capture Timing (v1.32.1)
Handlers registered after `webview.build()` — navigation starts during `build()`, fast-loading URLs responded before handlers registered → 0 entries. Fix: build with `about:blank`, register handlers, then navigate to real URL.

### Tab Drag-to-Reorder (v0.9.7–v0.9.10)
~15 bugs fixed: Firefox/WebView2 compat (`dataTransfer.setData`, close button `draggable=false`), phantom click after drop (`justDraggedRef`), phantom new tab from `+` (`justDroppedAtPlusRef`), close-button triggering reorder (`data-tab-close` guard), stale closures, pinned tab normalization, ghost cleanup timing (rAF). Uses pointer events (HTML5 DnD broken in WebView2).

### Header Injection Fix
Added fetch/XHR monkeypatch to HEADER_SCRIPT — `__xevoInjectHeaders` was never called on real requests.

### Ponytail-Discovered Bugs
- **Network timing broken**: `NETWORK_REQUEST_META.get()` → `get_or_init()` (OnceLock never initialized). `map.clear()` on 2000-cap destroyed all in-flight data (removed).
- **Rust data corruption**: `restore_tab_state` double-JSON-escaping (embed raw state as JS expression), GDI `SelectObject` leak (save/restore old bitmap), `eval_find_script` double backslash (removed redundant `replace`), `extract_title` UTF-8 byte slicing on lowercased string (use `char_indices()`).
- **JSON double-serialization**: `JSON.stringify()` on 6 `inspector_data` calls — Rust received nested JSON string. Fixed: pass object directly, `data: String` → `data: serde_json::Value`.

## Feature Inventory

### Browser Chrome
- **Settings Panel** (v0.6): Theme (dark/light/system), search engine (+custom with `%s`), scan interval, compact mode. Ctrl+, or gear icon.
- **Command Palette** (v0.7): Ctrl+K, fuzzy search, 80ms fade-in animation. Mounted fixed over full window.
- **Find in Page** (v1.0.0): Ctrl+F. JS-based (Tauri 2 has no native find API). `XEVO_FIND_SCRIPT` injected, `<mark>` highlighting, match cycling, 150ms debounce.
- **Tab Context Menu** (v0.5): Via Portal. Close, close others, close right.
- **Tab Drag-to-Reorder**: Pointer events. Full-size ghost preview (cloneNode). DropAtEnd support. Pinned always front.
- **Status Bar** (v1.1.0): 20px bar, load time, origin. Hovered URL skipped (requires injected script).
- **Loading Bar** (v0.5): CSS keyframes.
- **Keyboard Shortcuts** (v0.5+): Ctrl+F/D/K/L/?, Ctrl+Shift+S/T, Escape handler (close find or stop loading).
- **Compact Mode** (v0.6): `xevo-compact` class + CSS height overrides.

### Sidebar Panels
- **Bookmarks** (v1.0.0): Ctrl+D toggle. Zustand store, workspace-scoped, inline rename, open-in-new-tab.
- **History** (v1.6.0): Zustand+persist, 100-entry FIFO, grouped by date. Hooked into `navigate()` and `onUrlChanged`.
- **Network Log** (v1.32.x): Native WebView2 COM capture (ICoreWebView2 + ICoreWebView2_2). 17 resource types, timing, response body (8KB chunks, 64KB cap). Summary bar, filter chips, color-coded rows, detail pane with Headers/Body/Copy (cURL + fetch()). Per-tab scoping.
- **API Tester** (v1.0.0): Postman-style. Method selector, URL, Headers/Body/cURL Import. cURL parser (quotes, `-X`/`-H`/`-d`/`-F`/`-u`/`-A`/`-b`). fetch() with timing. Response viewer (status, duration, size, formatted JSON). Request history (50). Embedded + modal layouts.
- **Notes** (v1.6.0–v1.7.0): Rich text (`@tolipovjs/rich-text`). Pin/color, auto-save 500ms, export Markdown. Per-workspace.
- **JWT Decoder / Base64 Tool** (v1.1.0): Decode, expiry countdown. Encode/decode toggle.
- **Header Injection**: Custom rules per workspace. Pushed to existing tabs via eval.
- **UA Switcher** (Phase 3): Presets (Chrome/Firefox/Safari/Edge/Opera). Injects UA override script. `browser_set_user_agent` command.
- **Inspector Panel** (Phase 4): Meta validation, SocialPreview (FB/Twitter/LinkedIn/Discord), image diagnostics (fetch og:image, measure dimensions). Cookie inspector (HttpOnly warning).
- **Viewport Panel** (Phase 5): 7 Rust commands. Mobile/tablet/laptop presets. CSS Grid layout. Scroll sync via event bus.
- **Screenshot Tool** (Phase 6): Ctrl+Shift+S. DevTools Protocol `Page.captureScreenshot` via COM API (was `PrintWindow` — black screen with DirectComposition). `PrintWindow` fallback. COM callback bridged via `tokio::sync::oneshot`.

### Developer Features
- **JSON Auto-Formatter** (v1.0.0): `xevoRenderJson()` injected via init script. Detects JSON via content-type or `JSON.parse(body.innerText)`. 2-color collapsible tree, depth limit 8, max 500 items/array. Real HTML pages skipped.
- **Overlay Panel System** (v1.6.0): Split-view — absolute overlay above webview, drag-to-resize handle. Webview height reduces when open. Used by API Tester and Notes.
- **Home Page** (v1.0.0): Centered column, search input (uses active tab bridge), Live Servers grid (port + label + green dot), recent Bookmarks list. Replaces empty-tab placeholder.

### UI & Theming
- **Light + System Theme** (v1.0.0): Full light palette. System uses `matchMedia('(prefers-color-scheme: dark)')` + change listener.
- **Tailwind v4 Design System** (v1.8.0–v1.9.0): `@theme` block, reduced-motion rule. Unauthorized shadows removed (6 locations). `hover:scale` removed. `tnum` on 10 numeric elements. shadcn/ui semantics.
- **tauri-controls** (v1.9.0): Platform-aware WindowControls (macOS left, Win/Linux right).
- **UI Scaling** (v1.25.0): Base font 13→14px, all elements scaled (~30 files).
- **Accessibility**: ARIA roles/dialog/listbox/radio/listbox throughout. TabIndex + keyboard handlers. Tooltip delay 500ms (WCAG).

### Performance
- React.lazy for all 9 sidebar panels (PanelSkeleton fallback). manualChunks in vite. Init script split.
- **Memory Optimization** (v1.26.0): WebView2 SetMemoryUsageTargetLevel via COM. Background tabs → LOW, active → NORMAL. Minimize → all LOW.

## Code Quality

### Ponytail Audit (2026-07-16)
Full codebase audit across 25 subagents. **122 findings (17 critical, 47 high, 38 medium, 20 low), score 5.2/10.** 8 fix batches applied: network timing fix, data corruption fixes (4), accessibility sweep, dead code cleanup (AddressBar.tsx deleted, package.json name fix), IPC type safety, housekeeping, JSON double-serialization, viewport rAF throttle.

### Cleanup (Session 59)
- Removed persist middleware from tabs store (caused black screen, stale state, startup issues)
- Removed dead Tab fields (scrollPosition, savedScrollX/Y, savedFormState)
- Removed orphan exports (onTabStateSaved, onViewportMetrics, activateTab)
- Fixed workspaces.ts rehydration (immer set() instead of direct mutation)

## Backlog
- Port scanner: HTTP title in sidebar tooltip, manual "add custom port" UI
- Workspace drag-to-reorder in sidebar
- Notes panel: drag-to-reorder notes in sidebar list
- API tester: persist request history, response body type detection (HTML preview, image preview, JSON tree), saved collections/environments, request duplication/share
- Find in page: case-sensitive toggle, whole-word toggle
- Bookmarks: drag-to-reorder, folder support
- Status bar: hovered URL detection (requires injected script)
- GitHub push + README + v1.0 tag
- Tab-per-WebviewWindow — full migration (Option B)
- Runtime integration tests — require `pnpm tauri dev` on hardware
