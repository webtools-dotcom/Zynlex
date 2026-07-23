# XEVO Project State

## Version: v1.39.1
## Status: CORE gap closure (`CORE_GAPS.md`) items 1-9 shipped, item 10 partial. TS, Rust and `pnpm build` all clean.

## ENVIRONMENT
- OS: Windows
- Node: v24.16.0
- Rust: rustc 1.96.0
- pnpm: 11.5.0
- Tauri CLI / crate: 2.11.2

## ARCHITECTURE NOTE (CURRENT)
- **Tab-per-child-webview architecture:** each tab is a child `Webview` (label `browser-{tabId}`) created via `Window::add_child` on the main window, lazily on first navigation. Tab switch = hide/show only, no reload, full state preserved.
- Parent is the main window's `Window` (not `WebviewWindow`) — z-order, move, resize-clip, minimize/restore are OS-native.
- Tabs inactive >10 min are discarded (destroyed, recreated + reloaded on next switch). Pinned/active tabs exempt. Soft cap of 10 concurrent webviews (`maxConcurrentWebviews`), oldest background tab discarded when exceeded.
- All browser webviews share one WebView2 `data_directory` (shared browser/GPU/network processes).
- Bounds are logical (CSS) pixels, window-relative — not screen coordinates.
- **Remote-page IPC is intentionally never used.** Tauri v2 rejects `__TAURI_INTERNALS__.invoke` from `https://` content unless a capability declares `remote.urls`, which would force allow-listing every command and expose tab-scoped commands to any page. Anything that needs data out of a tab (Inspector reads, tab title/favicon, in-page shortcuts) goes through native WebView2 COM APIs instead (`ExecuteScript`, `DocumentTitleChanged`, `AcceleratorKeyPressed`) — Rust-initiated, never page-initiated. Do not reintroduce page-originated IPC calls.

## FEATURES

### Browser Chrome
- Settings Panel: theme (dark/light/system), search engine (+custom `%s`), scan interval, compact mode.
- Command Palette (Ctrl+K): fuzzy search across tabs, bookmarks, history, workspaces, servers, requests; grouped results, 5-entry MRU.
- Find in Page (Ctrl+F): JS-based, match highlighting/cycling.
- Tab bar: drag-to-reorder (pointer events, HTML5 DnD is broken in WebView2), context menu (close/close others/close right), pinning, vertical mode (`tabBarPosition: "left"`).
- Bookmark bar: toggleable, folders, JSON import/export (Blob+anchor, re-ids on import so double-import can't collide).
- Status bar: load time, loading pulse, origin, zoom indicator when ≠100%.
- Address bar: scheme-derived security indicator (lock/not-secure/wrench for localhost).
- Keyboard shortcuts: Ctrl+F/D/K/L/H/?, Ctrl+Shift+S/T/1-9, Escape. Full list in Ctrl+? sheet.
- Zoom: native Ctrl+mousewheel (WebView2), Ctrl+/-/0 forwarded from page, per-tab persisted. Known gap: mousewheel zoom doesn't update the store, so the status bar can lag that one input path.
- Hard reload: goes through CDP `Page.reload({ignoreCache:true})` — neither wry nor WebView2 exposes an ignore-cache reload API directly.

### Sidebar Panels
- Bookmarks, History (100-entry FIFO), Notes (rich text, pin/color/export MD), JWT Decoder, Base64 Tool.
- Network Log: native WebView2 COM capture (fetch/XHR only, not assets/images/fonts — by design), 17 resource types, timing, response body (5KB cap), filter chips, pause/resume, URL search, method/status/resource-type filters, preserve-log toggle, per-tab scoping, 500-entry cap.
- API Tester: Postman-style, method/URL/headers/body/cURL import, `api_fetch` Rust command (reqwest+rustls, bypasses app CSP/CORS), collections (folders, save/load/duplicate/move), 100-entry history.
- Header Injection: per-tab rules via WebView2 `WebResourceRequested`, anchored glob matching, defaults to active tab's origin (wildcard rules show a warning icon), inline value editing, internal-scheme guard.
- UA Switcher: 9 presets, injects override script.
- Inspector: meta validation, social preview (FB/Twitter/LinkedIn/Discord), image diagnostics via `new Image()` + HEAD request (not `fetch`, which CSP blocks). Cookie inspector via native `ICoreWebView2CookieManager` — sees HttpOnly cookies, exact domain/path-match delete and attribute-preserving edit. "Clear All" only clears cookies visible to the current page, never `DeleteAllCookies()`.
- Viewport Panel: mobile/tablet/laptop presets, CSS Grid layout, scroll sync.
- Downloads Panel: native `on_download` events, Open/Show-in-folder/Clear history. No live progress % (Tauri's `DownloadEvent` has no progress callback — would need WebView2 COM `ICoreWebView2DownloadOperation`).
- Screenshot Tool (Ctrl+Shift+S): CDP `Page.captureScreenshot`, PrintWindow fallback.
- All destructive actions use in-panel `ConfirmButton` (Sure?/No, Escape or ~4s to disarm) — never `window.confirm()`, which renders behind the child webview and is unreachable.

### UI & Theming
- Light/dark/system theme, rem-based type scale (`--text-micro`→`--text-lg`, root 16px), compact mode is a single `html.xevo-compact { font-size: 14px }` override.
- All colors/spacing go through `@theme` tokens — no raw hex, no undefined `--color-*` custom properties (both were past bugs, see Gotchas).
- Accessibility: ARIA roles, tabIndex + keyboard handlers throughout, 500ms tooltip delay (WCAG).

### Performance & Memory
- React.lazy for all panels; manualChunks in vite; init scripts split (CORE/HEADER/NETWORK).
- WebView2 `SetMemoryUsageTargetLevel`: background tabs → LOW, active → NORMAL, all → LOW on minimize.
- `scripts/measure.ps1` sums the working set of XEVO plus its whole `msedgewebview2` child tree — measuring `xevo.exe` alone understates RAM badly, since renderers live in the children. Takes `-Name chrome` to compare against another browser.
- A `TrySuspend`/`Resume` freeze tier was attempted and **reverted** — it crashed the app (exit `0xcfffffff`) on tab create/close churn. Root cause not yet found; do not retry without a way to reproduce and step through it.
- Network capture OFF by default, enabled on panel mount, 500ms batch flush.

### Persistence
- Session restore: tabs persisted (`xevo-session` key) with only durable fields (`id,url,title,favicon,isPinned,workspaceId,createdAt,zoom`); every transient field excluded. Tabs restore in the discarded state and lazily recreate on activation.
- Downloads, bookmarks, API collections/history, header rules, history: each in its own persisted Zustand store, workspace- or tab-scoped as appropriate.

## KNOWN ISSUES
- Main window is opaque (no `transparent` in tauri.conf.json); tab webview is transparent so content-area background shows through unpainted pixels, may white-flash on first creation.
- JSON viewer depth limit 8, max 500 items/array.
- Brief dark flash on first paint before React sets `data-theme`.
- Settings panel uses absolute positioning, overlays right edge without reflowing the webview.
- Command palette / ShortcutHelp are mounted outside the content wrapper, fixed over the full window.
- In-page SPA link clicks can pollute history (multiple `onUrlChanged` fires).
- Global shortcuts fire even when XEVO isn't focused (OS-level hotkeys — intended).
- Header injection doesn't cover WebSockets (WebView2 never fires `WebResourceRequested` for the handshake — not fixable app-side).
- `Tab.isMuted` and `AppSettings.clearOnClose` are ghost settings (typed/persisted, read by nothing) — left for a human decision.
- App refuses to start on non-Windows; README still claims cross-platform.

## GOTCHAS (non-obvious, worth remembering)
- Tailwind v4 utilities live in `@layer utilities`; any unlayered CSS rule beats them regardless of specificity. Global resets/generic rules must go in `@layer base` or every spacing utility silently no-ops.
- Never put a `*/`-shaped substring inside a CSS comment — it prematurely closes the comment and can silently break the build (Vite keeps serving the last good CSS, so it's easy to miss).
- `--color-base` claims the `.text-base` Tailwind utility name, so the 0.875rem type-scale step is named `--text-md` instead — there is deliberately no `--text-base`.
- A Tauri GitHub issue closed "not planned" (`Window::add_child` limitations, #10079) turned out to be about a *different* API (`.parent()`) — worth re-verifying old architectural pivots against the current Tauri/wry version before assuming a limitation is permanent.
- WebView2 cookies must be deleted/edited by exact domain+path match; a host-only write never removes a `Domain=.example.com` cookie.

## NOT DONE YET
- Port scanner: HTTP title in sidebar tooltip
- Workspace drag-to-reorder in sidebar
- Notes panel: drag-to-reorder in sidebar list
- API tester: response body type detection (HTML/image/JSON preview), environments, request share
- Find in page: case-sensitive / whole-word toggles
- Bookmarks: drag-to-reorder (folders exist, assignment is via a select)
- Downloads: live progress percentage
- Status bar: hovered URL detection (needs injected script)
- GitHub push + README + v1.0 tag
- Runtime integration tests (require `pnpm tauri dev` on hardware)

## SPEC COVERAGE
Full item-by-item audit against the founding spec (`DEVBROWSER_PROJECT_GUIDE.md`) lives in `SPEC_COMPLIANCE.md`. `CORE_GAPS.md` turns that into the ordered closure plan — one item per session, start at the first unchecked item.

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
├─ CORE_GAPS.md
├─ SPEC_COMPLIANCE.md
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
│  │  │  ├─ BookmarkBar.tsx
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
│  │  │  ├─ DownloadsPanel.tsx
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
│  │  ├─ apiCollections.ts
│  │  ├─ apiHistory.ts
│  │  ├─ bookmarks.ts
│  │  ├─ downloads.ts
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
