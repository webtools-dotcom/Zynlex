# XEVO Project State

## Version: v1.35.0
## Last Updated: 2026-07-22
## Status: Bug-audit remediation pass (Inspector, API Tester, port scanner, network capture, header rules, webview-creation race, debug logging). Both TS and Rust compile clean against the current `Window::add_child` architecture.

## ENVIRONMENT
- OS: Windows
- Node: v24.16.0
- Rust: rustc 1.96.0
- pnpm: 11.5.0
- Tauri CLI: 2.11.2
- Tauri crate: 2.11.2

## COMPLETED ✅

### Full Codebase Audit + Remediation Pass (v1.35.0)
Read-only audit produced a feature inventory and root-cause bug list, then every finding
except the open-source-readiness checklist was fixed:
- **Inspector panel was broken end-to-end**: frontend did `JSON.parse()` on `event.data`,
  but Rust already sends it as a parsed `serde_json::Value` object, not a string — every
  load threw and showed "Failed to parse inspector data". Removed the parse; all 4 sub-tabs
  (meta/cookies/localStorage/sessionStorage) work now.
- **API Tester was localhost-only**: it used the main window's `fetch()`, bound by the app's
  own CSP (`connect-src ... http://localhost:*`) and CORS. Added a Rust `api_fetch` command
  (reqwest + rustls) so requests go out as a real HTTP client instead.
- **Port scanner ran every scan twice**: `usePortScanner()` was mounted in two places, each
  running its own mount+interval scan loop. Added a module-level primary-instance guard.
- **HTTPS dev servers scanned as `http://`**: the scanner only spoke plaintext HTTP, so a TLS
  server's alert/handshake response was mislabeled `tcp` and opened as `http://`. Added a
  cheap TLS-record-byte sniff (no TLS client library needed) — has a unit test.
- **Network capture leaked**: per-request timing metadata was never cleared for
  cancelled/aborted requests or closed tabs, and two concurrent requests to the same URL
  clobbered each other's timing. Re-keyed as a per-URL FIFO queue, swept on tab close; the
  frontend's network log now also clears on a tab's real close (not on discard).
- **Header injection rules defaulted to `*`**, so a rule meant for one API (e.g. an auth
  token) silently attached to every request the tab made, including third-party scripts.
  New rules now default to the active tab's origin, and any enabled wildcard rule shows a
  warning icon.
- **Webview-creation race could permanently blank a tab**: `browser_create_tab` treated a
  handle still visible immediately after its own `destroy()` call as "already exists" and
  silently no-op'd, while the frontend had already marked the tab as created. Now waits for
  the destroy to actually settle before proceeding, and the frontend releases its reserved
  slot on failure instead of leaking it.
- **48 unconditional `eprintln!` + assorted `console.log` traces** ran on every window-move
  frame even in release builds (which have no console to read). Gated behind a debug-only
  `xevo_log!` macro / removed.
- Minor cleanup: extracted the 6×-repeated bounds-computation block in
  `useWebviewBridge.ts` into `getActiveBounds()`, removed dead `settingsOpen`/`UIState`
  fields, removed a stale `vite-review.json` tool-output artifact.

### Window-Follow Architecture Migration: WebviewWindow → add_child (v1.34.0)
- **Problem:** tab webviews were top-level *owner* windows (`WebviewWindowBuilder::parent()`), which Windows leaves in screen coordinates and never moves with the main window. This forced a JS `onMoved`+`onResized` follower that missed maximize/unmaximize (`SWP_NOMOVE`), a per-edge screen-coordinate fudge constant (`WEBVIEW_EDGE_INSET`), and ~125 lines of minimize/restore/orphan-recovery in `lib.rs`.
- **Root cause vs. old assumption:** the v0.9.6 pivot away from `Window::add_child` (citing Issue #10079, "not planned") was based on `.parent()` not creating a true child window on Windows — not on `add_child` itself being broken. Re-spiked `add_child` on Tauri 2.11.2 / wry 0.55.1: input, focus, scroll, CDP screenshot, and WebView2 memory-target COM calls all work identically on `Webview` vs `WebviewWindow`.
- **Fix:** migrated tab + viewport webviews from owner-window `.parent()` to true child webviews via `Window::add_child` (window-relative coordinates). Deleted the JS move-follower, `WEBVIEW_EDGE_INSET`, and the `lib.rs` minimize/orphan block — window moves are now free (OS-native); only resize still needs `ResizeObserver` sync (unchanged, was already reliable).
- **Lesson:** a Tauri issue closed "not planned" doesn't mean the underlying primitive doesn't work — it meant a *different* API (`.parent()`) had the problem. Worth re-verifying old architectural pivots against current Tauri/wry versions before assuming a limitation is permanent.

### Header Injection — Fixed & Hardened (v1.33.0)
- **Root cause found:** matcher used `uri.contains(&rule.pattern)`; the panel's default
  pattern `"*"` can never match via `.contains()`, so `SetHeader` was never reached. COM
  `SetHeader` itself was never broken — a prior debugging session mistook `httpbin.org`
  returning `"headers": {}` for every request as proof of a COM/CDP bug, when it was just
  bad test data. See `header_issue-report.md`.
- **Fix:** replaced with `url_matches()`, a scheme-stripped, anchored glob matcher.
- **Hardening after a real-world-workflow audit:**
  - `HEADER_RULES` now keyed by `tabId` instead of one global rule set — closes a
    cross-workspace leak (switching workspaces only hides webviews, so an inactive
    workspace's tabs stayed alive and could pick up another workspace's rules)
  - Anchored matching closes a cross-origin leak (a pattern could match a substring inside
    a foreign origin's query string)
  - Inline value editing in the panel (no more delete/recreate on token refresh)
  - Internal-scheme guard so rules never touch Tauri's own IPC traffic
- Sidebar position moved between Network and Inspector.

### UI Scaling (v1.25.0)
- **Chrome scaling (11 files):** base font 13→14px, tabbar 36→40px, toolbar 40→44px, addressbar 44→48px, statusbar 24→28px, findbar 32→36px, sidebar width 210→240px, workspace switcher 48→56px, sidebar header 28→32px, icons +3-4px across all chrome components
- **Panel text scaling (16+ files):** All sidebar panels and overlay panels bumped from text-[9px]/[10px]/[11px] → [11px]/[12px]/[13px]; icon sizes +2px; button containers scaled proportionally
- All changes verified: `tsc --noEmit` clean

### Memory Optimization via WebView2 SetMemoryUsageTargetLevel (v1.26.0)
- **Problem:** Background tabs retain full Chromium render process caches, consuming unnecessary RAM
- **Solution:** Extracted `pub fn apply_memory_target(wv, low)` helper in `browser.rs` — uses `ICoreWebView2_19::SetMemoryUsageTargetLevel` via COM QI cast
- **Tab switch:** Outgoing tab → LOW, incoming tab → NORMAL. Empty-tab branch sets all to LOW.
- **Minimize/restore:** Minimize sets all browser webviews to LOW; restore sets active tab to NORMAL, leaves others at LOW

### Network Panel (v1.32.x)
All requests from browser webviews captured via native WebView2 COM handlers, registered AFTER build (with `about:blank`) but BEFORE navigation. Rust captures method/URL/status/headers/body (8KB chunks, 64KB cap), resource type (17 types: document, stylesheet, image, script, xhr, fetch, font, etc.), and timing via `Instant`. Frontend: summary bar, filter chips (All/Errors/API/Slow), color-coded rows, detail pane with Headers/Body/Copy (cURL + fetch()). Zustand store with per-tab scoping, 500-entry cap. Network logging OFF by default (enabled on panel mount), 500ms batch flush, response body capped at 5KB.

### Earlier sessions (v0.9–v1.24.1)
Scaffolded Tauri 2 + React 19 + TypeScript with Tailwind v4, shadcn/ui, and Zustand v5. Early sessions (v0.9–v0.9.11) went through multiple architectural iterations for the browser webview — started with `Window::add_child` child webviews, then pivoted to persistent `WebviewWindow` with `parent` (v0.9.6) after discovering Tauri 2's child-webview limitations on Windows (Issue #10079, "not planned"). This became the **tab-per-WebviewWindow architecture**: each tab gets its own `WebviewWindow` (label `browser-{tabId}`), created lazily on first navigation, hidden/shown on switch with full state preservation. 30+ Rust commands built covering navigation, find, ports, header injection, inspector, UA switching, screenshot, viewport, tab state, etc. 12+ sidebar panels: Live Servers, Bookmarks, History, Network, API Tester, Notes (rich text), JWT Decoder, Base64 Tool, Headers, Inspector (meta/cookies/storage), Viewport, UA Switcher, Social Preview. Browser chrome: drag-to-reorder tabs, address bar with search engine support, find-in-page (Ctrl+F via injected JS), loading bar, status bar, command palette (Ctrl+K), shortcut help (Ctrl+?), overlay panel system.

## ARCHITECTURE NOTE (CURRENT)
- **Tab-per-child-webview architecture:** Each tab gets its own child `Webview` (label `browser-{tabId}`) created via `Window::add_child` on the main window, lazily on first navigation via `browser_create_tab`. Tab switching hides the old webview and shows the new one — no navigation, no reload, full state preservation.
- Parent is the main window's `Window` (not a `WebviewWindow`) — as a true child, z-order, move, resize-clip, minimize and restore are all handled natively by the OS, not by app code.
- **Lifecycle rule:** Webviews are created once per tab (on first URL navigation) and closed when the tab is closed. Tab switch = hide/show only.
- **Tab discarding:** Tabs inactive >10 minutes are destroyed. On switch, the webview is recreated and the page reloads. Pinned tabs and active tab are exempt.
- **Cap concurrent webviews:** Soft limit of 10 (configurable via `maxConcurrentWebviews`). When exceeded, oldest background tab is discarded.
- **Shared WebView2 environment:** All browser webviews use the same `data_directory` path, so WebView2 shares browser/GPU/network processes across tabs.
- **Init scripts:** 3 scripts injected per tab: (1) CORE_SCRIPT (header injection, tab info, keyboard shortcuts), (2) CHROME_FEATURES_SCRIPT (find-in-page, bookmark shortcut, shortcut forwarding), (3) JSON_VIEWER_SCRIPT (collapsible JSON viewer).
- Bounds are in LOGICAL (CSS) pixels, WINDOW-RELATIVE (main window client area) — not screen coordinates. Frontend `getBounds()` returns `rect.left, rect.top` directly (no `window.screenX/screenY`). Rust passes these to `add_child(builder, Position::Logical(...), Size::Logical(...))` on creation, `set_position`/`set_size` after. The OS scales to physical via DPI.
- Hidden by `Webview::hide()`. Shown by `Webview::show()`.
- Events (`browser://url-changed`, `browser://loading`, `browser://tab-info`) include `tabId` in payload for correct routing.
- **Free side benefits:**
  - **Back/forward history works natively** — each webview has its own `window.history`
  - **Window MOVE is free** — the OS moves child webviews with the parent; no JS follower needed
  - **Window resize** still goes through `browser_set_bounds` (`ResizeObserver` → `set_position`/`set_size`) since resize is a real content-area change, not a move
  - **Tab state is fully preserved** — DOM, scroll, forms, JS state, video survive tab switches

## KNOWN ISSUES
- **Main window is opaque** (no `transparent` key in tauri.conf.json). The tab webview IS transparent so content-area background shows through unpainted pixels.
- **Tab webview is built with `transparent: true`** — may show white flash on first creation before page paints.
- **JSON viewer depth limit 8, max 500 items/array** — deeper structures show truncation markers.
- **Theme has brief dark flash on first paint** — `:root { color-scheme: dark }` active before React effect sets correct data-theme.
- **Settings panel uses absolute positioning** — overlays right edge, does not reflow webview.
- **Command palette and ShortcutHelp mounted outside content wrapper** — fixed over full window, z-9999.
- **Compact mode CSS uses class-name overrides** — `.h-9`, `.h-11` overrides inside `.xevo-compact` could affect other elements with same classes.
- **Tab drag uses pointer events** — HTML5 DnD broken in WebView2.
- **In-page link clicks can pollute history** — SPA routing fires multiple onUrlChanged events.
- **Global shortcuts fire even when XEVO not focused** — OS-level hotkeys. Intended trade-off.
- **Network log captures fetch/XHR only** — assets, images, fonts not captured. By design.
- **HttpOnly cookies not visible in Cookie inspector** — browser security restriction.
- **Header injection doesn't cover WebSockets** — WebView2 doesn't fire `WebResourceRequested` for WebSocket handshakes. Not fixable app-side.

## FEATURES

### Browser Chrome
- **Settings Panel** (v0.6): Theme (dark/light/system), search engine (+custom with %s), scan interval, compact mode. Ctrl+, or gear icon.
- **Command Palette** (v0.7): Ctrl+K, fuzzy search, 80ms fade-in animation.
- **Find in Page** (v1.0.0): Ctrl+F. JS-based (Tauri 2 has no native find API). Match highlighting, cycling, 150ms debounce.
- **Tab Context Menu**: Via Portal. Close, close others, close right.
- **Tab Drag-to-Reorder**: Pointer events. Full-size ghost preview. Pinned always front.
- **Status Bar** (v1.1.0): Load time, loading pulse, origin.
- **Keyboard Shortcuts**: Ctrl+F/D/K/L/?, Ctrl+Shift+S/T, Escape (close find or stop loading).
- **Compact Mode** (v0.6): CSS class overrides for reduced chrome height.

### Sidebar Panels
- **Bookmarks** (v1.0.0): Ctrl+D toggle. Zustand store, workspace-scoped, inline rename.
- **History** (v1.6.0): Zustand+persist, 100-entry FIFO, grouped by date.
- **Network Log** (v1.32.x): Native WebView2 COM capture. 17 resource types, timing, response body. Summary bar, filter chips, color-coded rows, detail pane (Headers/Body/Copy). Per-tab scoping.
- **API Tester** (v1.0.0): Postman-style. Method selector, URL, Headers/Body/cURL Import. fetch() with timing. Response viewer. Request history (50). Embedded + modal.
- **Notes** (v1.6.0–v1.7.0): Rich text (`@tolipovjs/rich-text`). Pin/color, auto-save, export Markdown.
- **JWT Decoder / Base64 Tool** (v1.1.0): Decode, expiry countdown. Encode/decode toggle.
- **Header Injection**: Custom rules per workspace, enforced per-tab via native WebView2 COM interception (`WebResourceRequested`). Live on next request in any open tab, no reload needed. Inline value editing.
- **UA Switcher**: 9 presets (desktop/mobile/bot). Injects UA override script. `browser_set_user_agent` command.
- **Inspector Panel**: Meta validation, SocialPreview (FB/Twitter/LinkedIn/Discord), image diagnostics. Cookie inspector (HttpOnly warning).
- **Viewport Panel**: 7 Rust commands. Mobile/tablet/laptop presets. CSS Grid layout, scroll sync.
- **Screenshot Tool** (v1.0.0): Ctrl+Shift+S. DevTools Protocol Page.captureScreenshot via COM API. PrintWindow fallback. Toast in webview DOM.

### Developer Features
- **JSON Auto-Formatter** (v1.0.0): Collapsible tree, depth limit 8, max 500 items/array.
- **Overlay Panel System** (v1.6.0): Split-view overlay above webview. Drag-to-resize. Webview height reduces when open. Used by API Tester and Notes.
- **Home Page** (v1.0.0): Centered column, search input, Live Servers grid, Bookmarks list.

### UI & Theming
- **Light + System Theme** (v1.0.0): Full light palette. System mode uses prefers-color-scheme media query + change listener.
- **Tailwind v4 Design System** (v1.8.0–v1.9.0): @theme block, reduced-motion rule. Unauthorized shadows removed. tauri-controls (macOS left, Win/Linux right).
- **UI Scaling** (v1.25.0): Base font 13→14px, all chrome and panel elements scaled (~30 files).
- **Accessibility**: ARIA roles, tabIndex + keyboard handlers throughout. Tooltip delay 500ms (WCAG).

### Performance & Memory
- React.lazy for all 9 panels (PanelSkeleton fallback). manualChunks in vite. Init script split (CORE/HEADER/NETWORK).
- **Memory Optimization** (v1.26.0): WebView2 SetMemoryUsageTargetLevel via COM. Background tabs → LOW, active → NORMAL. Minimize sets all to LOW.
- **Network capture**: OFF by default (prevents IPC storm). Enabled on panel mount. 500ms batch flush, 20-entry buffer. Response body capped at 5KB.

## NOT DONE YET
- Port scanner: HTTP title in sidebar tooltip, manual "add custom port" UI
- Workspace drag-to-reorder in sidebar
- Notes panel: drag-to-reorder notes in sidebar list
- API tester: persist request history, response body type detection (HTML preview, image preview, JSON tree), saved collections/environments, request duplication/share
- Find in page: case-sensitive toggle, whole-word toggle
- Bookmarks: drag-to-reorder, folder support
- Status bar: hovered URL detection (requires injected script)
- GitHub push + README + v1.0 tag
- Runtime integration tests — require `pnpm tauri dev` on hardware

## CODE QUALITY

### Ponytail Audit (2026-07-16)
Full codebase audit across 25 subagents. **122 findings (17 critical, 47 high, 38 medium, 20 low), score 5.2/10.** 8 fix batches applied: network timing fix (OnceLock init, removed map.clear that destroyed in-flight data), data corruption fixes (double JSON escaping, GDI SelectObject leak, double backslash remove, UTF-8 byte slicing fix), accessibility sweep (roles/aria throughout), dead code cleanup (deleted unused AddressBar.tsx, package.json name xevo-temp→xevo), IPC type safety (typed invoke/listen), JSON double-serialization fix (pass object directly, data: String → serde_json::Value), viewport sync rAF throttle.

## REPOSITORY STRUCTURE

```text
Xevo/
├─ .vscode/
│  └─ extensions.json
├─ AGENTS.md
├─ ARCHITECTURE.md
├─ PROJECT_STATE.md
├─ README.md
├─ TASKS.md
├─ XEVO_FRONTEND.md
├─ ENHANCED_BROWSER.md
├─ MAJOR_FIXES.md
├─ bug_report.md
├─ feature_bug_fixes.md
├─ quickfixes.md
├─ web_url_issue.md
├─ networklog_issues.md
├─ components.json
├─ index.html
├─ package.json
├─ pnpm-lock.yaml
├─ pnpm-workspace.yaml
├─ tsconfig.json
├─ tsconfig.node.json
├─ vite.config.ts
├─ public/
│  ├─ tauri.svg
│  └─ vite.svg
├─ src/
│  ├─ App.tsx
│  ├─ main.tsx
│  ├─ index.css
│  ├─ vite-env.d.ts
│  ├─ components/
│  │  ├─ browser/
│  │  │  ├─ BrowserChrome.tsx
│  │  │  ├─ ContentArea.tsx
│  │  │  ├─ FindBar.tsx
│  │  │  ├─ LoadingBar.tsx
│  │  │  ├─ StatusBar.tsx
│  │  │  ├─ TabBar.tsx
│  │  │  ├─ TabContextMenu.tsx
│  │  │  ├─ TabItem.tsx
│  │  │  ├─ Toolbar.tsx
│  │  │  └─ WindowControls.tsx
│  │  ├─ layout/
│  │  │  └─ RootLayout.tsx
│  │  ├─ overlay/
│  │  │  └─ OverlayPanel.tsx
│  │  ├─ panels/
│  │  │  ├─ ApiTester.tsx
│  │  │  ├─ Base64Tool.tsx
│  │  │  ├─ HeadersPanel.tsx
│  │  │  ├─ HomePage.tsx
│  │  │  ├─ InspectorPanel.tsx
│  │  │  ├─ JwtDecoder.tsx
│  │  │  ├─ MetaValidator.ts
│  │  │  ├─ NetworkPanel.tsx
│  │  │  ├─ NotesNotepad.tsx
│  │  │  ├─ SettingsPanel.tsx
│  │  │  ├─ SocialPreview.tsx
│  │  │  ├─ UserAgentPanel.tsx
│  │  │  ├─ UserAgentPresets.ts
│  │  │  ├─ ViewportPanel.tsx
│  │  │  └─ ViewportPresets.ts
│  │  ├─ sidebar/
│  │  │  ├─ ApiTesterPanel.tsx
│  │  │  ├─ BookmarksPanel.tsx
│  │  │  ├─ HistoryPanel.tsx
│  │  │  ├─ NotesSidebarPanel.tsx
│  │  │  ├─ Sidebar.tsx
│  │  │  ├─ WorkspaceContextMenu.tsx
│  │  │  └─ WorkspaceSwitcher.tsx
│  │  ├─ ui/
│  │  │  ├─ badge.tsx
│  │  │  ├─ button.tsx
│  │  │  ├─ input.tsx
│  │  │  ├─ separator.tsx
│  │  │  ├─ tooltip.tsx
│  │  │  └─ VirtualList.tsx
│  │  └─ ErrorBoundary.tsx
│  ├─ lib/
│  │  ├─ bookmarkAction.ts
│  │  ├─ networkCopy.ts
│  │  ├─ screenshot.ts
│  │  ├─ url.ts
│  │  ├─ utils.ts
│  │  └─ workspaceTabs.ts
│  ├─ stores/
│  │  ├─ apiHistory.ts
│  │  ├─ bookmarks.ts
│  │  ├─ headers.ts
│  │  ├─ history.ts
│  │  ├─ inspector.ts
│  │  ├─ network.ts
│  │  ├─ notes.ts
│  │  ├─ servers.ts
│  │  ├─ settings.ts
│  │  ├─ tabs.ts
│  │  ├─ ui.ts
│  │  └─ workspaces.ts
│  ├─ types/
│  │  └─ index.ts
│  ├─ hooks/
│  │  ├─ useKeyboardShortcuts.ts
│  │  ├─ usePortScanner.ts
│  │  ├─ useViewportSync.ts
│  │  └─ useWebviewBridge.ts
│  └─ services/
│     └─ browser.ts
└─ src-tauri/
   ├─ .gitignore
   ├─ Cargo.toml
   ├─ Cargo.lock
   ├─ build.rs
   ├─ tauri.conf.json
   ├─ capabilities/
   │  └─ default.json
   ├─ icons/
   └─ src/
      ├─ commands/
      │  ├─ browser.rs
      │  ├─ mod.rs
      │  └─ ports.rs
      ├─ lib.rs
      └─ main.rs
```
