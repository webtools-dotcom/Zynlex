# XEVO — Spec Compliance Scorecard

**Spec:** `DEVBROWSER_PROJECT_GUIDE.md` (May 2026) · **Build audited:** v1.38.0 (2026-07-23)
**Method:** every verdict verified by reading `src/**` and `src-tauri/src/**` directly. Claims in
`PROJECT_STATE.md` / `TASKS.md` were *not* trusted as evidence (both track changes, not coverage;
`repo-structure.md` is stale as of 2026-06-01 and `PROJECT_STATE.md`'s repo tree lists six
markdown files that no longer exist on disk).

## Legend

| Verdict | Meaning |
|---|---|
| **DONE** | Implemented, evidence cited |
| **PARTIAL** | Core of it works, named sub-features absent |
| **MISSING** | Not implemented; no repo-wide match |
| **GHOST** | Type or setting exists but nothing reads it — looks done in the types, does nothing at runtime |
| **BEYOND** | V2/V3 item already shipped |

---

## Headline verdict

**The identity claims all hold. The v1 checklist does not — 11 `[CORE]` items are missing.**

| Spec promise | Reality |
|---|---|
| Binary under 10MB | **4.58MB** exe / **2.23MB** MSI / 1.5MB setup (`src-tauri/target/release/`) — less than half the budget |
| Tauri 2 + Rust + React 19 + TS + Vite + Tailwind v4 + shadcn + Zustand | Exactly as specced |
| No account, no telemetry, no cloud | Holds — no network calls outside user-initiated navigation, `api_fetch`, and the port scanner |
| Full localhost dev workflow | Holds — port scanner, live-servers panel, home page, workspaces, network log, headers, API tester all shipped |
| "Ship working features, not half-built ones" (Principle 8) | **Violated in four places** — `zoom`, `isMuted`, `clearOnClose`, `tabBarPosition`, `homePage` are typed and persisted but wired to nothing |

The gap is not capability — several V2/V3 features shipped early and the hard parts (native
WebView2 COM network capture, cookie manager, child-webview architecture) are done to a higher
standard than the spec asked for. The gap is **ordinary browser plumbing**: session restore,
zoom, downloads.

---

## §7.1 Core Browser Engine

### Address Bar `[CORE]`

| Item | Verdict | Evidence |
|---|---|---|
| Type URL, Enter to navigate | DONE | `components/browser/Toolbar.tsx:156` |
| Auto-prefix `https://` | DONE | `src-tauri/src/commands/browser.rs:475` `resolve_url()` |
| URL vs. search-query detection | DONE | `lib/url.ts`, `browser.rs:471` `is_ip_address()` |
| Configurable search engine (Google/DDG/Bing/custom) | DONE | `stores/settings.ts:8-9`, `panels/SettingsPanel.tsx` |
| Loading progress | DONE | `components/browser/LoadingBar.tsx` |
| Security indicator (lock icon) | **MISSING** | no lock/shield/secure-state rendering in `Toolbar.tsx` |
| Editable path segments | **MISSING** | single `<input>`, no segmentation |
| Ctrl/Cmd+L to focus | DONE | `hooks/useKeyboardShortcuts.ts:144` |
| URL history autocomplete | **MISSING** | no suggestion list, datalist, or dropdown in `Toolbar.tsx` |
| Show page title when not focused | **MISSING** | input always bound to URL draft |

### Tab System `[CORE]`

| Item | Verdict | Evidence |
|---|---|---|
| New tab (Ctrl+T) | DONE | `useKeyboardShortcuts.ts:79` |
| Close tab (Ctrl+W) | DONE | `useKeyboardShortcuts.ts:88` |
| Reopen last closed (Ctrl+Shift+T) | DONE | `useKeyboardShortcuts.ts:101`, `stores/tabs.ts` `lastClosedTab` |
| Switch tabs (Ctrl+1-9, Ctrl+Tab) | DONE | `useKeyboardShortcuts.ts:180, 194, 214` |
| Duplicate tab | DONE | `components/browser/TabContextMenu.tsx:145` |
| Pin tab | DONE | `TabContextMenu.tsx:146`, `stores/tabs.ts:93`, pinned-first ordering `TabBar.tsx:195` |
| Mute tab | **GHOST** | `Tab.isMuted` declared `types/index.ts:14`, initialised `stores/tabs.ts:18`, **never read anywhere** |
| Move tab between workspaces | **MISSING** | not in `TabContextMenu.tsx:143-149` — the menu is Reload / Duplicate / Pin / Close Tab / Close Other Tabs. (Note: `PROJECT_STATE.md` and `TASKS.md` both claim a "close right" item; there isn't one) |
| Favicon + title display | DONE | `TabItem.tsx`, fed by native `DocumentTitleChanged` (`browser.rs:1410`) |
| Loading animation | DONE | `TabItem.tsx` |
| Drag to reorder | DONE | `TabBar.tsx` pointer-event implementation |
| Middle-click to close | DONE | `TabItem.tsx:33` |
| Right-click context menu | PARTIAL | present, but "move to workspace" absent (above) |

### Navigation `[CORE]`

| Item | Verdict | Evidence |
|---|---|---|
| Back / Forward (Alt+←/→) | DONE | `browser.rs:804, 814`; `useKeyboardShortcuts.ts:170` |
| Reload (Ctrl+R) | DONE | `browser.rs:824` |
| **Hard reload / clear cache (Ctrl+Shift+R)** | **MISSING** | no `ctrl+shift+r` branch; `browser_reload` has no cache-bypass path |
| Stop loading (Escape) | DONE | `browser.rs:834`, `useKeyboardShortcuts.ts:149` |
| Home page (configurable) | **GHOST** | `AppSettings.homePage` (`types/index.ts:80`, default `"xevo://home"`) **never read** — `ContentArea.tsx:37` unconditionally renders `HomePage` for any empty tab |

### Find In Page `[CORE]`

| Item | Verdict | Evidence |
|---|---|---|
| Ctrl+F opens find bar | DONE | `useKeyboardShortcuts.ts:133`, `components/browser/FindBar.tsx` |
| Highlight all matches | DONE | `<mark>` injection, `browser.rs:928` `browser_find` |
| Navigate between matches | DONE | `browser.rs:947` `browser_find_next` |
| Case-sensitive option | **MISSING** | `FindBar.tsx` — no toggle |
| Regex option | **MISSING** | substring matching only |

### Zoom `[CORE]` — **entire feature missing**

| Item | Verdict | Evidence |
|---|---|---|
| Zoom in / out / reset (Ctrl +, -, 0) | **MISSING** | no zoom shortcuts in `useKeyboardShortcuts.ts`; no zoom command in `browser.rs` |
| Per-tab zoom memory | **GHOST** | `Tab.zoom` declared `types/index.ts:18`, written once as `1` (`stores/tabs.ts:22`), never read. The only live "zoom" in the codebase is `viewportZoom` (`stores/ui.ts:195`), which scales the *multi-viewport preview*, not page zoom |

### History `[CORE]`

| Item | Verdict | Evidence |
|---|---|---|
| In-session back/forward | DONE | native per-webview `window.history` (each tab is its own child webview) |
| Browsable history panel | DONE | `components/sidebar/HistoryPanel.tsx`, `stores/history.ts` (persisted, 100-entry FIFO, grouped by date) |
| Search history | DONE | `HistoryPanel.tsx` filter input |
| Clear history | DONE | `HistoryPanel.tsx` + `ConfirmButton` |
| Local only | DONE | `zustand/persist` → localStorage, no network |
| Ctrl+H shortcut | **MISSING** | history panel opens from sidebar only |
| Disable history / stealth mode | **MISSING** | (spec marks this "Optional") |

### Bookmarks `[CORE]`

| Item | Verdict | Evidence |
|---|---|---|
| Add bookmark (Ctrl+D) | DONE | `lib/bookmarkAction.ts`, `useKeyboardShortcuts.ts:315` |
| Workspace-scoped | DONE | `stores/bookmarks.ts` — `Bookmark.workspaceId` |
| Quick search in command palette | PARTIAL | palette has an "open bookmarks panel" command, not bookmark entries — see §7.10 |
| **Bookmark bar (toggle show/hide)** | **MISSING** | no bar component |
| **Bookmark folders** | **MISSING** | no `folder` field or match in `stores/bookmarks.ts` |
| **Import/export (JSON)** | **MISSING** | no import/export in store or panel |

### Downloads `[CORE]` — **entire feature missing**

| Item | Verdict | Evidence |
|---|---|---|
| Download files, progress, manager panel, open / show in folder, clear history | **MISSING** | no download handler in `src-tauri/src/commands/browser.rs`, no `"downloads"` entry in `PanelId` (`types/index.ts:60-72`), no store. WebView2's `DownloadStarting` event is never subscribed |

### Keyboard Shortcuts `[CORE]`

| Item | Verdict | Evidence |
|---|---|---|
| Reference panel (Ctrl+?) | DONE | `components/ShortcutHelp.tsx`, `useKeyboardShortcuts.ts:128` |
| All major actions have shortcuts | PARTIAL | zoom, hard reload, Ctrl+H have no binding because the underlying features don't exist |
| Custom rebinding | *(V2 — not due)* | — |

---

## §7.2 Localhost & Dev Server Management

| Item | Verdict | Evidence |
|---|---|---|
| Auto port scanner, curated dev-port list `[CORE]` | DONE | `src-tauri/src/commands/ports.rs`, `hooks/usePortScanner.ts` |
| Configurable scan interval `[CORE]` | DONE | `settings.portScanInterval` (5-60s), read by `usePortScanner.ts` — a real setting, unlike the ghosts above |
| Live Servers sidebar panel `[CORE]` | DONE | `components/sidebar/Sidebar.tsx:59-165` |
| Port + protocol + status per entry `[CORE]` | DONE | `LocalServer` (`types/index.ts:44-53`) |
| Click to open as tab `[CORE]` | DONE | `Sidebar.tsx`, `panels/HomePage.tsx` |
| Green/red alive indicator `[CORE]` | DONE | `Sidebar.tsx:165`, `stores/servers.ts` |
| Remember ports not currently running `[CORE]` | DONE | `stores/servers.ts` persisted + `lastSeen` |
| Named / pinned ports, persisted `[CORE]` | PARTIAL | `label` and `isPinned` exist and persist (`servers.ts:56, 84`) — no evidence of a rename UI wired to `label` |
| **Add custom ports manually** `[CORE]` | **GHOST** | `AppSettings.customPorts: number[]` (`types/index.ts:83`) exists and persists; no UI writes to it |
| Localhost Quick Bar / start page `[CORE]` | DONE | `panels/HomePage.tsx` — search input, live-servers grid, bookmarks list |
| Grouped by workspace `[CORE]` | **MISSING** | servers store is global, not workspace-scoped |
| Localhost aliases `[V2]`, local file server `[V2]` | not due | — |
| HTTPS dev-server detection | **BEYOND** | TLS-record byte sniff in `ports.rs` — spec never asked for it |

---

## §7.3 Project Workspaces

| Item | Verdict | Evidence |
|---|---|---|
| Create workspace `[CORE]` | PARTIAL | `stores/workspaces.ts:93` — but the UI auto-names `Project N` with no name/color/icon prompt (`WorkspaceSwitcher.tsx:82`) |
| Switch workspace `[CORE]` | DONE | `WorkspaceSwitcher.tsx`, `workspaces.ts:124` |
| Ctrl+Shift+1-9 to switch `[CORE]` | **MISSING** | no workspace shortcuts in `useKeyboardShortcuts.ts` |
| Delete with confirmation `[CORE]` | DONE | `WorkspaceContextMenu.tsx:76` via `ConfirmButton` |
| **Rename workspace** `[CORE]` | **MISSING** | `renameWorkspace` exists (`workspaces.ts:120`) but nothing calls it — no rename UI |
| **Duplicate workspace** `[CORE]` | **MISSING** | no store action, no menu item |
| Isolated tab set `[CORE]` | DONE | `Workspace.tabIds`, `lib/workspaceTabs.ts` |
| Per-workspace bookmarks `[CORE]` | DONE | `stores/bookmarks.ts` |
| Per-workspace custom headers `[CORE]` | DONE | `stores/headers.ts:13` `rulesByWs`, enforced per-tab in `browser.rs` |
| Per-workspace notes/scratchpad `[CORE]` | DONE | `stores/notes.ts` — `Note.workspaceId` |
| Per-workspace network log history `[CORE]` | PARTIAL | `stores/network.ts` is keyed by **tabId**, not workspace, and clears on each page load |
| Per-workspace localhost pin list `[CORE]` | **MISSING** | `stores/servers.ts` is global |
| Per-workspace saved API requests `[CORE]` | **MISSING** | no collections at all — see §7.7 |
| Per-workspace env vars / custom CSS `[CORE]` | **MISSING** | features don't exist (spec marks them V2 elsewhere — inconsistent in the guide itself) |
| Last active tab memory `[CORE]` | PARTIAL | `Workspace.activeTabId` persists, but is wiped on startup — below |
| **Workspace state persistence — "reopen exactly where you left off"** `[CORE]` | **MISSING (deliberate regression)** | `stores/workspaces.ts:223-225` calls `resetAllWorkspaceTabs()` on rehydrate — comment reads *"Clear all tab references on startup — start fresh every time"*. `stores/tabs.ts` has **no `persist` middleware at all** (removed in Session 59 to fix black-screen/stale-state bugs). Every launch opens empty. Scroll positions, pinned state, open URLs: none survive |
| Workspace switcher sidebar `[CORE]` | PARTIAL | `WorkspaceSwitcher.tsx` — colored icons and click-to-switch work; **no drag-to-reorder** (`reorderWorkspaces` exists at `workspaces.ts:157`, uncalled) and **no tab count** |
| Export/import `[V2]`, templates `[V2]` | not due | — |

---

## §7.4 Network Request Log

| Item | Verdict | Evidence |
|---|---|---|
| Toggle panel `[CORE]` | PARTIAL | opens from sidebar; **no Ctrl+Shift+N binding** |
| Capture all page requests `[CORE]` | **BEYOND** | `browser.rs:1145` `register_webview_network_capture` — native `ICoreWebView2` `WebResourceRequested`/`Responded` COM handlers. §13 Risk 3 predicted this would need a Rust proxy; the COM route is strictly better. **Caveat:** capture is off until the panel mounts, and clears on every page load (`useWebviewBridge.ts` `onLoadingChanged`) |
| Method, URL, status, size, duration, content type, timestamp `[CORE]` | DONE | `stores/network.ts`, `panels/NetworkPanel.tsx` |
| Resource type (17 types) `[CORE]` | DONE | classified in `browser.rs` |
| **Initiator** `[CORE]` | **MISSING** | not captured, no column |
| Filter by method / status range / URL pattern / content type `[CORE]` | PARTIAL | only four preset chips — All / Errors / API / Slow (`NetworkPanel.tsx:229-241`). No method filter, no status-range filter, no URL search box, no per-type filter |
| Expand: request + response headers, response body, JSON highlighting `[CORE]` | DONE | `NetworkPanel.tsx` detail pane (body capped 5KB) |
| **Timing waterfall** `[CORE]` | **MISSING** | duration is a number in a cell; no waterfall visual |
| Clear log `[CORE]` | DONE | `NetworkPanel.tsx:282` |
| **Pause/resume capture** `[CORE]` | **MISSING** | no paused state in `stores/network.ts` |
| **Log persists per tab across reloads (toggle)** `[CORE]` | **MISSING** | opposite behaviour — log is cleared on reload by design, no "preserve log" toggle |
| Copy as cURL / fetch() / URL / response body `[CORE]` | DONE | `lib/networkCopy.ts` |
| HAR/JSON/CSV export `[V2]`, blocking `[V2]`, throttling `[V2]` | not due | no match repo-wide for `har`, `throttl`, `blockRules` |

---

## §7.5 Custom Header Injection

| Item | Verdict | Evidence |
|---|---|---|
| Global header rules with URL pattern `[CORE]` | DONE | `browser.rs:60` `url_matches()` — anchored, scheme-stripped glob |
| Rule fields: name, value, pattern, active toggle `[CORE]` | DONE | `HeaderRule` (`stores/headers.ts:4-10`) |
| Multiple rules per workspace `[CORE]` | DONE | `rulesByWs` |
| Per-workspace scoping, right headers on switch `[CORE]` | DONE | `HEADER_RULES` keyed by tabId in Rust — closes the cross-workspace leak documented in `PROJECT_STATE.md` v1.33.0 |
| Override or add headers `[CORE]` | DONE | `browser.rs:2784` `browser_set_header_rules` → COM `SetHeader` |
| Quick token panel `[V2]`, header templates `[V2]` | not due | — |
| Wildcard-rule warning + origin-scoped default | **BEYOND** | safety hardening the spec never asked for |
| *Known limit* | — | WebSocket handshakes not covered (WebView2 doesn't fire the event) |

---

## §7.6 Built-in Developer Panels

| Item | Verdict | Evidence |
|---|---|---|
| JSON viewer: auto-format, tree, highlighting, copy, validation `[CORE]` | DONE | `JSON_VIEWER_SCRIPT` init script (depth 8, 500 items/array) |
| JSON viewer: copy path to key, search/filter keys, raw↔tree toggle `[CORE]` | **MISSING** | not in the injected viewer |
| JWT decoder: header/payload/signature, expiry, countdown, alg `[CORE]` | DONE | `panels/JwtDecoder.tsx` |
| JWT auto-detect in network requests `[CORE]` (marked optional) | **MISSING** | — |
| Base64: encode, decode, URL-safe `[CORE]` | DONE | `panels/Base64Tool.tsx:5-18` |
| Base64 auto-detect input | **MISSING** | manual toggle only |
| **Color picker / eyedropper** `[CORE]` | **MISSING** | no `EyeDropper` usage repo-wide; the `colorPicker` matches in `NotesNotepad.tsx:48` are note-colour swatches, unrelated |
| localStorage / sessionStorage viewer: list, edit, delete, clear, refresh `[CORE]` | DONE | `panels/InspectorPanel.tsx`, `browser.rs:1990` `inspector_mutate` |
| Cookie viewer: name/value/domain/path/expiry/HttpOnly/Secure/SameSite, edit, delete, add `[CORE]` | **BEYOND** | `browser.rs:1696` `read_cookies` / `1758` `mutate_cookies` via `ICoreWebView2CookieManager`. Spec assumed `document.cookie`, which cannot see HttpOnly cookies — the native manager can |
| Cookie export as JSON `[CORE]` | **MISSING** | — |
| Meta tag inspector: all metas, grouped, missing-tag checks, copy `[CORE]` | DONE | `panels/MetaValidator.ts`, `InspectorPanel.tsx` |
| Social share preview `[CORE]` | **BEYOND** | `panels/SocialPreview.tsx` — FB/Twitter/LinkedIn/Discord, plus og:image diagnostics |
| CSS vars / image / font inspector `[V2]` | not due | — |

---

## §7.7 API Tester

| Item | Verdict | Evidence |
|---|---|---|
| Method, URL, headers table, body tabs `[CORE]` | DONE | `panels/ApiTester.tsx:499` `RequestEditor` |
| Send, timing, response viewer (status/time/size/headers/body) `[CORE]` | DONE | `ApiTester.tsx:622` `ResponseViewer` |
| Real HTTP client (not page `fetch`) | **BEYOND** | `src-tauri/src/commands/http.rs` `api_fetch` (reqwest + rustls) — bypasses CSP/CORS, which browser-based testers can't |
| Ctrl+Enter to send `[CORE]` | DONE | `ApiTester.tsx:843` |
| **Request collections (save, folders, rename, delete, duplicate)** `[CORE]` | **MISSING** | only `stores/apiHistory.ts` (flat, 50 entries, session-only). No collection store, no folder model, no workspace scoping |
| cURL import `[CORE]` | DONE | `ApiTester.tsx:100` — handles `-X -H -d -F -u -A -b`, quoting |
| Request history (100) `[CORE]` | PARTIAL | capped at 50, and **not persisted** (`apiHistory.ts` has no `persist`) — spec says last 100, workspace-scoped |
| Response body type detection (image render, HTML highlight) `[CORE]` | PARTIAL | JSON formatting only |
| Environment variables `[V2]`, response comparison `[V3]` | not due | no match for `{{` templating or `environment` in the store |

---

## §7.8 Responsive Design Tools

| Item | Verdict | Evidence |
|---|---|---|
| Multi-viewport toggle `[CORE]` | DONE | `panels/ViewportPanel.tsx`, 7 Rust commands (`browser.rs:2046-2181`) |
| Device presets (mobile/tablet/laptop) `[CORE]` | PARTIAL | `panels/ViewportPresets.ts` — spec names ~15 specific devices incl. ultra-wide 2560×1440; presets file is smaller. Worth a line-by-line check against §7.8 if the exact list matters |
| Custom viewport creator (name, w, h) `[CORE]` | PARTIAL | dimensions of a selected viewport are editable (`ViewportPanel.tsx:300` `resizeViewportDimensions`); **no named, saved custom presets** |
| Toggle individual viewports on/off `[CORE]` | DONE | `stores/ui.ts` viewport list |
| Drag to resize viewports `[CORE]` | PARTIAL | numeric resize confirmed; drag-handle resize not located |
| Scroll sync `[CORE]` | DONE | `hooks/useViewportSync.ts`, `browser.rs:2582` |
| Click sync `[CORE]` | DONE | `browser.rs:2601` `notify_viewport_click` |
| Input sync `[CORE]` | DONE | `browser.rs:2621` `notify_viewport_input`, injected at `ViewportPanel.tsx:119` |
| Sync pause button `[CORE]` | needs runtime check | not located in `ViewportPanel.tsx` |
| Orientation toggle `[V2]` | **BEYOND** | `ViewportPanel.tsx:354, 711` `rotateViewport` |
| Screenshot tool `[V2]` | **BEYOND** | `browser.rs:2202` — CDP `Page.captureScreenshot` via COM, `PrintWindow` fallback, Ctrl+Shift+S |
| Screenshot: full-page, save as PNG, combined multi-viewport image `[V2]` | PARTIAL | captures to clipboard; no save-to-file, no combined image |
| Breakpoint inspector `[V2]` | not due | — |

---

## §7.9-7.10 Environment Switcher · Command Palette

| Item | Verdict | Evidence |
|---|---|---|
| Environment profiles / URL substitution / indicator `[V2]` | not due | no match repo-wide for `environment` as a feature |
| Command palette, Ctrl+K, fuzzy, keyboard nav `[CORE]` | DONE | `components/CommandPalette.tsx` |
| Fuzzy-search **open tabs** `[CORE]` | DONE | `CommandPalette.tsx:42-54` |
| Fuzzy-search **commands** `[CORE]` | DONE | `CommandPalette.tsx:63+` |
| Fuzzy-search **bookmarks, history, saved API requests, workspaces, detected servers** `[CORE]` | **MISSING** | `Item.type` is `"tab" \| "command"` only (`CommandPalette.tsx:24`). Bookmarks appear as an *open-the-panel* command, not as searchable entries |
| Grouped results by category `[CORE]` | PARTIAL | two implicit groups |
| Recent actions at top `[CORE]` | **MISSING** | — |

---

## §7.11 UI & Browser Chrome

| Item | Verdict | Evidence |
|---|---|---|
| **Vertical tab layout (sidebar tabs)** `[CORE]` | **GHOST** | `TabBarPosition = "top" \| "left"` (`types/index.ts:59`), `settings.tabBarPosition` defaults `"top"` and **is never read** — no left-layout branch exists |
| Persist last-used layout `[CORE]` | GHOST | persists a value nothing consumes |
| Compact mode `[CORE]` | DONE | `html.xevo-compact { font-size: 14px }` in `index.css` (v1.38 rework — one variable, replaces the old class-override hack) |
| Theme: dark / light / system `[CORE]` | DONE | `index.css`, `stores/settings.ts`, `browser.rs:987` `browser_set_theme` propagates to webviews |
| Custom accent colour / custom chrome background `[CORE]` | **MISSING** | tokens exist in `@theme`; no user-facing picker |
| Sidebar: workspaces + live servers, collapsible, width-adjustable, shortcut `[CORE]` | DONE | `Sidebar.tsx`, drag-resize (v1.37), Ctrl+B (`useKeyboardShortcuts.ts:278`) |
| Status bar: load status + page response time `[CORE]` | DONE | `components/browser/StatusBar.tsx:25-38` |
| Status bar: **zoom level** `[CORE]` | **MISSING** | no zoom feature to display |
| Status bar: **security info** `[CORE]` | **MISSING** | shows origin only (`StatusBar.tsx:52`) |
| Status bar: hovered-URL zone `[CORE]` | PARTIAL | `hoveredUrl` prop wired through `StatusBar.tsx:5` but never populated — needs an injected script |
| Distraction-free mode `[V2]`, split view `[V2]` | not due | — |

---

## §7.12 Privacy & Security

| Item | Verdict | Evidence |
|---|---|---|
| Zero telemetry / analytics / crash reporting `[CORE]` | DONE | no analytics dependency; no outbound calls beyond user navigation, `api_fetch`, port scan |
| No account, no sign-in, no sync `[CORE]` | DONE | no auth code anywhere |
| Local data only, user-inspectable `[CORE]` | PARTIAL | all state is `zustand/persist` → **localStorage**, not the JSON files in the app-data directory the spec promised ("user can see, edit, backup, delete the files directly"). Functionally local; not the specced storage format |
| **Clear on close** `[CORE]` | **GHOST** | `AppSettings.clearOnClose` (`types/index.ts:84`, default `false`) — **never read**; no close handler clears anything |
| HTTPS-only `[V2]`, cert inspector `[V2]`, ad/tracker blocking `[V2]` | not due | — |
| User agent switcher `[V2]` | **BEYOND** | `panels/UserAgentPanel.tsx`, `browser.rs:1077` |
| Remote-page IPC hardening | **BEYOND** | not in the spec; documented in `PROJECT_STATE.md` — no page-originated IPC anywhere, everything Rust-initiated |

---

## §7.13-7.16 Power Tools · Accessibility · Performance · Extensions

| Item | Verdict | Evidence |
|---|---|---|
| Quick notes / scratchpad, per workspace `[CORE]` | **BEYOND** | `panels/NotesNotepad.tsx` — rich text, pin, colour, auto-save, Markdown export. Spec asked for "just a quick notepad" |
| Page load info in status bar `[CORE]` | PARTIAL | load time shown (`StatusBar.tsx:31-37`); **DOM-content-loaded time and request count are not** |
| Custom CSS injection `[V2]` | not due | — |
| Custom JS injection `[V2]` | not due | *(injected init scripts exist, but as app internals — no user-facing rule system)* |
| Regex tester / timestamp converter / hash generator / URL encoder `[V2]` | not due | no match repo-wide |
| Accessibility checker `[V2]` | not due | — |
| Lighthouse-lite `[V3]`, URL rewriting `[V3]`, request/response modification `[V3]`, diff tool `[V3]` | not due | — |
| Extension system `[V3]` | not due | correctly deferred |

---

## §8 Roadmap position

| Version | Spec contents | Status |
|---|---|---|
| v0.1 Alpha | browser shell, tabs, nav, find, in-session history, <10MB | **Complete** (4.58MB) |
| v0.2 Localhost & Workspaces | port scanner, quick panel, workspaces, isolation, sidebar, scratchpad | **Complete except workspace state persistence** |
| v0.3 Network & Headers | network log, filters, copy-as, headers, JWT, base64, JSON viewer, cookies | **Complete**; filters thinner than specced |
| v0.4 API Tester | builder, response viewer, **collections**, cURL import, history, storage viewer, meta inspector | **Complete except collections** |
| v0.5 UI Polish | palette, **vertical tabs**, **colour picker**, themes, **bookmarks (full)**, **download manager**, UA switcher, compact/distraction-free, shortcut list, settings | **~50%** — four items missing outright |
| v0.6 Responsive | multi-viewport, presets, sync, orientation | **Complete** (orientation was V2) |
| **v1.0 Stable** | all of the above polished, zero critical bugs, README + screenshots, CI cross-platform builds, auto-updater, landing page | **Not reachable yet** |
| v1.x / v2.0 / v3.0 | — | several items already pulled forward (see BEYOND rows) |

Practically: the build sits at a strong **v0.6+**, with chunks of v1.x and v2.0 done, and a
hole in the middle of v0.5.

---

## CORE gap list — ordered by what blocks a credible v1.0

1. **Session restore.** The single most visible miss. Every other browser reopens your tabs; XEVO opens empty every launch, by design, because persisting the tabs store caused black screens back at v0.9. This is the one gap a first-time user notices in the first ten seconds. Non-trivial: it re-enters the tab-lifecycle code that produced the worst bugs in this project's history.
2. **Downloads.** A browser that cannot download a file reads as a prototype. WebView2's `DownloadStarting` event is the hook; nothing subscribes to it.
3. **Zoom (Ctrl +/-/0).** Universally expected, small to implement, and `Tab.zoom` already exists to hold the value.
4. **Bookmark bar + folders + import/export.** Spec called bookmarks a full v0.5 system; what shipped is a flat workspace-scoped list.
5. **API tester collections.** The spec's own §9.3 names the API tester as a launch-demo feature. "Save this request" is the thing that makes it more than a curl box — and history isn't even persisted.
6. **Vertical tab layout.** Explicitly `[CORE]`, and it is the Arc/Edge-style differentiator the spec called out. Currently a setting that does nothing.
7. **Network panel: pause, real filters, initiator.** The panel is excellent at capture and thin at triage.
8. **Command palette breadth.** Tabs and commands only; the spec's pitch was "everything search" — bookmarks, history, servers, workspaces.
9. **Hard reload, Ctrl+H, Ctrl+Shift+1-9.** Three missing bindings.
10. **Address-bar security indicator.** The spec asks for a lock icon; there is no security state in the UI at all.
11. **Colour picker.** `[CORE]` in §7.6, absent. Chromium's `EyeDropper` API may be available in WebView2 — worth a spike before committing to build one.

### The five ghosts — decide each: build or delete

`Tab.zoom` · `Tab.isMuted` · `AppSettings.clearOnClose` · `AppSettings.tabBarPosition` ·
`AppSettings.homePage` (and `AppSettings.customPorts`, which persists with no writer).

Each is typed, defaulted, persisted, and read by nothing. They make the codebase look more
complete than it is and they violate Principle 8 ("ship working features, not half-built ones").
Either wire them or remove them — leaving them is the worst of the three options, because the
next audit has to re-derive that they're dead.

---

## Shipped ahead of spec

- **Native WebView2 COM network capture** (`browser.rs:1145`) — §13 Risk 3 planned a Rust proxy; the COM route is simpler and more accurate.
- **Native cookie manager** (`browser.rs:1696`) — sees HttpOnly cookies and deletes by exact domain/path, which the specced `document.cookie` approach structurally cannot do.
- **Rust-side `api_fetch`** — the API tester isn't bound by the app's own CSP/CORS.
- **UA switcher, screenshot tool, viewport orientation, social preview + og:image diagnostics** — all `[V2]`, all shipped.
- **Memory targeting + tab discarding** — not in the spec at all; directly serves the "lightweight" identity.
- **TLS sniffing in the port scanner** — HTTPS dev servers open correctly.
- **Remote-IPC hardening** — a security property the spec never anticipated needing.

---

## Spec items to retire

These are in the guide but no longer describe this project. Recommend striking them rather than
carrying them as permanent unmet ticks:

- **§10 (AI-Assisted Build Workflow) in full** — written for free-tier context juggling with Deepseek/Flash. `PROGRESS.md` and `CURRENT_TASK.md` (§10.3) were superseded by `PROJECT_STATE.md` + `TASKS.md` + `CLAUDE.md`.
- **§6.3 project structure** — the real tree has diverged (no `commands/network.rs`/`storage.rs`/`system.rs`; `src/utils/` never existed; `services/` and `panels/` were added).
- **§7.3's per-workspace "environment variables" and "custom CSS rules"** — the guide lists both as workspace properties in a `[CORE]` block while marking the features themselves `[V2]`/`[V3]` elsewhere. Internally inconsistent; pick one.
- **§6.4 "JSON files in the app data directory"** — actual storage is localStorage via `zustand/persist`. Either change the spec or migrate, but the current text is inaccurate.

---

## Not a feature gap, but blocks the launch in §9

| Item | Status |
|---|---|
| `README.md` | **Still the Tauri starter template.** No hero GIF, no size badge, no comparison table, no install link |
| `LICENSE` (MIT — promised in §1) | **Absent** |
| `CONTRIBUTING.md`, `CHANGELOG.md` | **Absent** (§12 calls both required from day 1) |
| `.github/workflows/` CI | **Absent** — no cross-platform builds, so no download links |
| `ARCHITECTURE.md` | **2 bytes — empty.** `CLAUDE.md` tells every agent to read it first |
| `tauri.conf.json` version | `0.1.0`, while `PROJECT_STATE.md` says v1.38.0 |
| Auto-updater | Not configured |
| macOS / Linux verification | Never run — §13 Risk 2 warned about exactly this. The whole browser layer is Windows-only COM: `register_webview_network_capture` (`browser.rs:1149`), `register_webview_native_events`, header injection, `apply_memory_target` and the cookie manager are all `#[cfg(windows)]` **inside** the `with_webview` closure, so a mac/Linux build *compiles and silently does nothing*; `browser_eval_inspector` (`browser.rs:1885`) and `browser_screenshot` (`browser.rs:2286`) return errors outright. No `#[cfg(not(windows))]` fallbacks exist anywhere |

The last row is the largest strategic finding in this audit: **XEVO is, today, a Windows
browser.** It would build on macOS and Linux and quietly lose the network log, header injection,
cookie inspector, tab titles/favicons, in-page shortcuts, screenshots, and memory targeting —
which is worse than failing to build, because nothing announces it.

---

*Generated by a read-only audit. No source files were modified.*
