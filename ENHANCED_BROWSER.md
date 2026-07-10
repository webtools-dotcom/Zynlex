# ENHANCED_BROWSER.md — XEVO: The 70% → 100% Plan

> **Purpose:** This document is the single source of truth for completing the remaining 30% of XEVO.
> It covers three areas: Tab Persistence, Developer Features, and Performance Optimization.
> Any AI session can read this file and execute without asking questions.
> **Last updated:** July 2026

---

## TABLE OF CONTENTS

1. [Executive Summary](#1-executive-summary)
2. [Research Findings](#2-research-findings)
3. [POINT 1: Tab Persistence](#3-point-1-tab-persistence)
4. [POINT 2: Developer Features](#4-point-2-developer-features)
5. [POINT 3: Performance Optimization](#5-point-3-performance-optimization)
6. [Execution Order](#6-execution-order)
7. [Verification Checklists](#7-verification-checklists)

---

## 1. EXECUTIVE SUMMARY

XEVO is currently at 70% completion. The core browser works — tabs, address bar, navigation, port scanner, workspaces, network log, API tester, JWT decoder, Base64 tool, command palette, bookmarks, find-in-page, JSON viewer, custom header injection, rich text notes, theme system (dark/light/system), and keyboard shortcuts are all functional.

**What's missing to reach 100%:**

| Area | Gap | Impact |
|------|-----|--------|
| Tab Persistence | Tabs lost on every restart | Users won't switch from Chrome |
| Multi-Viewport Mode | No responsive testing | Can't compete with Responsively |
| User Agent Switcher | No device simulation | Developers can't test mobile |
| Meta Tag Inspector | No OG/Twitter preview | Can't catch broken share cards |
| Screenshot Tool | No capture capability | No documentation workflow |
| Performance | Eager loading of all panels | App feels heavy |

**Estimated time to 100%:** 10-17 hours across 6 phases.

---

## 2. RESEARCH FINDINGS

### 2.1 Tab Persistence Research

**Source: Min Browser (github.com/minbrowser/min — 9.1k stars)**
- Min stores tabs as `{ tabId: url }` mapping in a JSON file
- Uses Electron's `electron-store` for persistence
- Saves: tab URLs, titles, pinned state, tab order
- Restores all tabs on startup, creates webviews lazily

**Source: Flow Browser (github.com/multiboxlabs/flow-browser)**
- Uses dirty-tracking: only tabs changed since last flush are written
- Batch flush every 2 seconds — not every keystroke
- Tab groups are written immediately (change infrequently)
- `flush()` called synchronously at quit time to ensure no data loss

**Source: Notion-Electron (github.com/anechunaev/notion-electron)**
- `TabPersistence` class encapsulates electron-store schema
- Persists: `tabs` (id→url), `tab-titles`, `tab-current`, `tabs-pinned`, `tab-apps`
- Gated on `tabs-reopen-on-start` option
- `reopenTabs()` creates webviews with `skipChange: true` to avoid navigation events during restore

**Source: Zustand persist middleware (zustand.docs.pmnd.rs)**
- `persist(middleware)` stores state in localStorage automatically
- Use `partialize` to exclude non-serializable data (functions, loading states)
- `onRehydrateStorage` callback fires after hydration completes
- `version` and `migrate` features handle schema changes across versions
- `createJSONStorage(() => localStorage)` is the default storage engine
- Middleware order: `devtools → persist → immer` (outermost to innermost)

**Source: Zustand GitHub Discussion #1614**
- For syncing across tabs: use `storage` event listener
- `window.addEventListener('storage', (e) => { if (e.key === 'tabs') store.persist.rehydrate() })`
- This prevents UI flash when switching to another tab

**Key insight for XEVO:**
- Zustand `persist` middleware is the right approach
- `partialize` must strip: action functions, `loadTime`, `discardedAt`, `lastActiveAt`
- `Tab` type fields that MUST persist: `id`, `title`, `url`, `favicon`, `isPinned`, `isMuted`, `workspaceId`, `historyBack`, `historyForward`, `zoom`
- On startup: hydrate store → create WebviewWindows for persisted tabs → show active tab

### 2.2 Multi-Viewport Research

**Source: Tauri 2 multiwebview example (github.com/tauri-apps/tauri/blob/dev/examples/multiwebview/main.rs)**
```rust
// Official Tauri example — 4 webviews in a 2x2 grid
let _webview1 = window.add_child(
    tauri::webview::WebviewBuilder::new("main1", WebviewUrl::App(Default::default()))
        .auto_resize(),
    LogicalPosition::new(0., 0.),
    LogicalSize::new(width / 2., height / 2.),
)?;

let _webview2 = window.add_child(
    tauri::webview::WebviewBuilder::new("main2", WebviewUrl::External(url))
        .auto_resize(),
    LogicalPosition::new(width / 2., 0.),
    LogicalSize::new(width / 2., height / 2.),
)?;
```

**Source: Tauri PR #8280 (refactor: add support for multiple webviews)**
- `Window::add_child(WebviewBuilder, position, size)` adds child webviews
- `auto_resize()` makes webview follow parent window resize
- `set_position(Logical)` and `set_size(Logical)` reposition/resize at runtime
- Each child webview gets its own label (unique identifier)
- Child webviews are NOT `WebviewWindow` — they're `Webview` structs
- `WebviewWindow` = Window + Webview combined (for standalone windows)

**Source: Tauri DeepWiki (Window and Webview API)**
- `Webview.getCurrent()` — gets current webview instance
- `Webview.getAll()` — gets all webview instances
- `Webview.getByLabel(label)` — gets webview by label
- Constructor requires parent `Window` instance and identifier label
- `set_auto_resize(bool)` — auto grow/shrink with parent

**Source: Responsively App (github.com/responsively-org/responsively-app)**
- Uses `browser-sync` for event mirroring (scroll, click, input)
- XPath-based element targeting — fragile when DOM differs across viewports
- Issue #532: "Page interaction mirror only works as long as DOM structure is the same across devices"
- Issue #1010: Shared `browser-sync` instance causes cross-app interference
- **Lesson for XEVO:** Use coordinate-based sync (scroll by percentage, click at relative position) for v1. DOM-based sync is a v2 optimization.

**Source: Tauri Issue #2975 (Multiple webviews in one window)**
- API for managing multiple webviews in a window
- Specify position and size per webview
- Show/hide different webviews
- This is exactly what multi-viewport needs

**Key insight for XEVO:**
- Use `Window::add_child` (available via `unstable` feature, already enabled in your Cargo.toml)
- Each viewport = a child webview with unique label (`viewport-1`, `viewport-2`, etc.)
- Frontend manages grid layout via CSS Grid
- Sync events via injected JavaScript (scroll + click interception)
- Start with coordinate-based sync, add DOM-based sync later

### 2.3 User Agent Switcher Research

**Source: Tauri PR #5317 (expose user_agent to window config)**
- `user_agent` option added to `WindowConfig` in tauri.conf.json
- `WebviewWindowBuilder::user_agent(&str)` sets UA at creation time
- UA is set on the webview attributes, applied when webview is created

**Source: Tauri Issue #4284 (Custom user-agent)**
- At runtime, use `window.with_webview()` to access native webview
- Windows: WebView2 COM API `ICoreWebView2Settings2::SetUserAgent()`
- Linux: WebKitGTK `SettingsExt::set_user_agent()`
- macOS: `objc::msg_send![webview, setCustomUserAgent: nsstring]`
- **Simpler approach:** Recreate the webview with new UA (XEVO already has close-and-recreate pattern)

**Source: Tauri Issue #9492 (multiwebview does not use provided user agent)**
- `WindowConfig.userAgent` sets UA for main window only
- Child webviews don't inherit the UA from config
- Must set UA explicitly on each child webview builder

**Key insight for XEVO:**
- Store active UA in Zustand settings store
- Inject UA override into `BROWSER_INIT_SCRIPT`: `Object.defineProperty(navigator, 'userAgent', { get: () => window.__XEVO_USER_AGENT })`
- When user switches UA: update settings → recreate webview → page reloads with new UA
- Preset list: Chrome/Firefox/Safari (desktop), Chrome/Safari (mobile), Googlebot

### 2.4 Meta Tag Inspector Research

**Source: meta-inspector (github.com/diShine-digital-agency/meta-inspector)**
- Extracts: title, description, og:*, twitter:*, canonical, JSON-LD, charset, viewport
- Validates against platform requirements
- Simulates social feed previews
- Checks: title length (≤60), description length (≤160), image dimensions (1200×630)

**Source: social-preview-tool (github.com/GPRizzi/social-preview-tool)**
- Renders previews for 15 platforms (WhatsApp, Telegram, Facebook, X, LinkedIn, Discord, etc.)
- Fetches page HTML via CORS proxy, parses with DOMParser
- Re-fetches og:image as blob to read real dimensions + file size
- Smart warnings: image too small, above WhatsApp ~300KB limit, wrong ratio

**Source: metaprev (github.com/hungv47/metaprev)**
- Validates: og:title length (50-60 optimal), og:description (110-160)
- Checks og:image is absolute URL (relative paths fail for crawlers)
- Checks og:image returns HTTP 200
- Checks content-type is image/* (not HTML error page)
- Warns on SVG (Facebook, X, LinkedIn don't render SVG share images)
- Compares declared `og:image:width/height` vs actual image dimensions

**Source: opengraph.dev**
- og:image minimum: 600×315, recommended: 1200×630 (1.91:1 ratio)
- File size: ≤200KB optimal, acceptable to ~500KB
- twitter:card should be `summary_large_image` for big images
- WhatsApp, LinkedIn, Slack, Discord, Telegram don't execute JavaScript — meta tags must be in initial HTML

**Key insight for XEVO:**
- Extend existing `InspectorPanel.tsx` (already extracts meta tags via `eval_inspector`)
- Parse and group: SEO tags, Open Graph, Twitter Card, Other
- Render social preview cards for Facebook, Twitter/X, LinkedIn, Discord
- Add validation: ✅ present and valid, ⚠️ suboptimal, ❌ missing
- Image diagnostics: fetch og:image → check HTTP 200 → check content-type → check dimensions

### 2.5 Screenshot Tool Research

**Source: Tauri 2 documentation**
- `WebviewWindow::snapshot()` — macOS only (WKWebView)
- Windows: Use `WebView2::CapturePreview` or Windows.Graphics.Capture API
- Linux: WebKitGTK `webkit_web_view_get_snapshot()`
- Alternative: Use Rust `screenshot` crate for full-window capture

**Key insight for XEVO:**
- Start with Windows (your primary platform)
- Use WebView2 COM API `CapturePreview` to capture webview content
- Return as base64 PNG to frontend
- Frontend: save to clipboard or download as file

### 2.6 Performance Research

**Source: React lazy loading tutorial (asoasis.tech)**
- `React.lazy(() => import('./Component'))` splits component into separate chunk
- Must wrap in `<Suspense fallback={<Spinner />}>`
- Place boundaries near widgets that may be slow
- Keep entry chunk small (<100-150KB gzip ideal)
- Don't lazy-load anything on first-paint critical path

**Source: Vite performance optimization (jsdevblog.hashnode.dev)**
- Route-based code splitting: biggest impact, lowest effort
- Vendor chunk splitting with `manualChunks`: React, Zustand, icons as separate cacheable chunks
- `assetsInlineLimit`: inline small assets as base64 (reduce HTTP requests)
- Entry chunk should be <100KB gzipped

**Source: Code splitting guide (generalistprogrammer.com)**
- Code splitting = build-time concern (how code is packaged)
- Lazy loading = runtime concern (when chunk is fetched)
- Every `import()` is a splitting point — Vite creates chunks automatically
- Don't over-split: too many tiny chunks increase HTTP overhead
- Don't lazy-load tiny components (<3KB) — HTTP overhead > bundle savings

**Source: Manual chunks example (mykolaaleksandrov.dev)**
```typescript
// vite.config.ts
manualChunks: {
  'react-vendor': ['react', 'react-dom'],
  'motion': ['framer-motion'],
  'icons': ['lucide-react'],
  'vendor': everything else in node_modules
}
```
- Result: main bundle trimmed ~95%, FCP improved 0.4-1.0s, LCP improved 0.4-1.0s

**Source: Min Browser architecture**
- 91.9% JavaScript, uses Electron
- Loads fast because it lazy-loads features
- Full-text search, ad blocking, reader view loaded on demand
- Tab groups (Tasks) are lightweight containers

**Source: Electron performance docs**
- Preload scripts should be minimal
- Use `contextBridge` efficiently
- Avoid loading unnecessary modules in main process
- V8 snapshots can cut startup by 40% (not applicable to Tauri, but principle applies)

**Source: Tauri benchmarks**
- Tauri hello world: ~2.67MB binary, <100ms startup
- Electron hello world: ~150MB, ~200ms startup
- Tauri memory: ~30-50MB for basic app
- Electron memory: ~80-150MB for basic app

**Key insight for XEVO:**
- `React.lazy` for all sidebar panels (ApiTester, JwtDecoder, Base64Tool, NetworkPanel, HeadersPanel, InspectorPanel)
- `manualChunks` in Vite config: react-vendor, zustand, icons, ui-libraries
- Split `BROWSER_INIT_SCRIPT` into core (~50 lines) + on-demand modules (~150 lines each)
- Lazy webview creation on startup: active tab first, adjacent tabs after 500ms, others on switch
- Virtualize long lists (history, bookmarks) with `react-window`

---

## 3. POINT 1: TAB PERSISTENCE

### 3.1 Goal
Users close XEVO, reopen it, and all their tabs, workspaces, pinned tabs, and navigation history are exactly where they left off.

### 3.2 What Persists

| Data | Where | Format |
|------|-------|--------|
| Tab URLs, titles, favicons | `tabs` store | `localStorage` key `xevo-tabs` |
| Tab order per workspace | `workspaces` store | `localStorage` key `xevo-workspaces` |
| Pinned state | `tabs` store | Part of Tab object |
| History (back/forward stacks) | `tabs` store | Part of Tab object |
| Active tab per workspace | `workspaces` store | Part of Workspace object |
| Settings (theme, search engine, etc.) | `settings` store | Already persisted ✓ |
| Bookmarks | `bookmarks` store | Already persisted ✓ |

### 3.3 What Does NOT Persist

| Data | Reason |
|------|--------|
| `isLoading` | Transient — recalculated on webview load |
| `loadTime` | Session-specific — recalculated on navigation |
| `discardedAt` | Session metadata — not meaningful across restarts |
| `lastActiveAt` | Session metadata |
| Action functions | Not serializable |
| Network log entries | Session-only (by design) |
| API tester history | Session-only (acceptable for v1) |

### 3.4 Implementation Steps

#### Step 3.4.1: Add `persist` to tabs store

**File:** `src/stores/tabs.ts`

**Current structure:**
```typescript
interface TabsState {
  tabs: Record<string, Tab>
  activeTabId: string | null
  lastClosedTab: Tab | null
  // + action functions
}
```

**Change to:**
```typescript
import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

const useTabsStore = create<TabsState>()(
  persist(
    (set, get) => ({
      tabs: {},
      activeTabId: null,
      lastClosedTab: null,

      // ... all existing action functions unchanged ...

    }),
    {
      name: 'xevo-tabs',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        tabs: state.tabs,
        activeTabId: state.activeTabId,
        lastClosedTab: state.lastClosedTab,
      }),
      version: 1,
    }
  )
)
```

**Critical: `partialize` must strip:**
- All action functions (addTab, closeTab, updateTab, etc.)
- Transient fields from Tab objects

**Before persisting each Tab, strip transient fields:**
```typescript
// In partialize, transform tabs:
tabs: Object.fromEntries(
  Object.entries(state.tabs).map(([id, tab]) => [id, {
    id: tab.id,
    title: tab.title,
    url: tab.url,
    favicon: tab.favicon,
    isPinned: tab.isPinned,
    isMuted: tab.isMuted,
    workspaceId: tab.workspaceId,
    historyBack: tab.historyBack,
    historyForward: tab.historyForward,
    zoom: tab.zoom,
    // OMIT: isLoading, loadTime, discardedAt, lastActiveAt
  }])
),
```

#### Step 3.4.2: Verify workspaces persistence

**File:** `src/stores/workspaces.ts`

Already has `persist` middleware. Verify it includes:
- `workspaces` Record (with `tabIds` array per workspace)
- `activeWorkspaceId`

If `tabIds` is missing from the persist config, add it.

#### Step 3.4.3: Handle hydration

**File:** `src/stores/tabs.ts`

Add `onRehydrateStorage` callback:
```typescript
onRehydrateStorage: () => (state, error) => {
  if (error) {
    console.error('[XEVO] Tab persistence hydration failed:', error)
    return
  }
  console.log('[XEVO] Tabs hydrated successfully')
  // Dispatch custom event so hooks can react
  window.dispatchEvent(new CustomEvent('xevo:tabs-hydrated'))
}
```

#### Step 3.4.4: Restore webviews on startup

**File:** `src/hooks/useWebviewBridge.ts`

Add a new `useEffect` that runs once on mount:

```typescript
useEffect(() => {
  // Wait for Zustand hydration
  const handleHydration = async () => {
    const tabs = useTabsStore.getState().tabs
    const activeTabId = useTabsStore.getState().activeTabId
    const activeWorkspaceId = useWorkspacesStore.getState().activeWorkspaceId

    // Create webviews for all tabs that have URLs
    const tabEntries = Object.values(tabs).filter(tab => tab.url)

    for (const tab of tabEntries) {
      try {
        await createTab(tab.id, tab.url)
        // Hide all except active
        if (tab.id !== activeTabId) {
          await hideTabWebview(tab.id)
        }
      } catch (e) {
        console.warn(`[XEVO] Failed to restore tab ${tab.id}:`, e)
      }
    }

    // Show the active tab
    if (activeTabId && tabs[activeTabId]?.url) {
      const bounds = getBounds()
      if (bounds) {
        await showTabWebview(activeTabId, bounds)
      }
    }
  }

  // Listen for hydration event
  window.addEventListener('xevo:tabs-hydrated', handleHydration)

  // Also handle case where hydration already completed
  if (useTabsStore.persist.hasHydrated()) {
    handleHydration()
  }

  return () => {
    window.removeEventListener('xevo:tabs-hydrated', handleHydration)
  }
}, []) // Empty deps — runs once on mount
```

#### Step 3.4.5: Handle edge cases

**Orphaned tabs:**
```typescript
// On hydration, clean up tabs that don't belong to any workspace
const workspaces = useWorkspacesStore.getState().workspaces
const allWorkspaceTabIds = new Set(
  Object.values(workspaces).flatMap(ws => ws.tabIds)
)
const tabs = useTabsStore.getState().tabs

for (const tabId of Object.keys(tabs)) {
  if (!allWorkspaceTabIds.has(tabId)) {
    useTabsStore.getState().removeTab(tabId)
  }
}
```

**Corrupt data:**
```typescript
// In partialize, wrap in try/catch
partialize: (state) => {
  try {
    return { /* ... */ }
  } catch (e) {
    console.error('[XEVO] Failed to serialize tabs:', e)
    return {} // Fall back to empty
  }
}
```

**Storage quota:**
```typescript
// Check before persisting
try {
  localStorage.setItem('xevo-tabs', JSON.stringify(data))
} catch (e) {
  if (e.name === 'QuotaExceededError') {
    // Clear oldest non-pinned tabs
    const tabs = Object.values(data.tabs)
      .filter(t => !t.isPinned)
      .sort((a, b) => (a.lastActiveAt || 0) - (b.lastActiveAt || 0))
    // Remove oldest 20%
    const toRemove = tabs.slice(0, Math.ceil(tabs.length * 0.2))
    toRemove.forEach(t => delete data.tabs[t.id])
    localStorage.setItem('xevo-tabs', JSON.stringify(data))
  }
}
```

### 3.5 Verification Checklist

- [ ] Open 3 tabs with different URLs
- [ ] Pin one tab
- [ ] Close the app completely
- [ ] Reopen the app
- [ ] **Expected:** All 3 tabs restored with correct URLs
- [ ] **Expected:** Pinned tab shows pin icon
- [ ] **Expected:** Active tab is the same one that was active before close
- [ ] **Expected:** Tab titles and favicons restored
- [ ] **Expected:** Back/forward history preserved for each tab
- [ ] **Expected:** Workspaces maintain their tab assignments

---

## 4. POINT 2: DEVELOPER FEATURES

### 4A. Multi-Viewport Mode

#### 4A.1 Goal
Show the same URL in multiple device sizes simultaneously. Scroll in one, all scroll. Click in one, all navigate. This kills Responsively.

#### 4A.2 Architecture

```
┌─────────────────────────────────────────────────┐
│  XEVO Main Window                                │
│  ┌──────────────┬──────────────┬──────────────┐  │
│  │ Viewport 1   │ Viewport 2   │ Viewport 3   │  │
│  │ iPhone SE    │ iPad         │ Desktop 1440 │  │
│  │ 375×667      │ 820×1180     │ 1440×900     │  │
│  │              │              │              │  │
│  │ [webview]    │ [webview]    │ [webview]    │  │
│  │              │              │              │  │
│  └──────────────┴──────────────┴──────────────┘  │
│  ┌──────────────────────────────────────────────┐ │
│  │ Viewport Toolbar: [Add] [Remove] [Sync] [UA]│ │
│  └──────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

Each viewport is a Tauri `WebviewWindow` with `parent(&main_window)`, created via `Window::add_child`.

#### 4A.3 Rust Commands

**File:** `src-tauri/src/commands/browser.rs`

**New commands:**

```rust
/// Create a viewport webview at the specified position and size
#[tauri::command]
pub async fn create_viewport(
    app: AppHandle,
    label: String,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let parent = app.get_window("main").ok_or("Main window not found")?;

    let webview = WebviewWindowBuilder::new(
        &app,
        &label,
        WebviewUrl::External(url.parse().map_err(|e| e.to_string())?)
    )
    .parent(&parent)
    .map_err(|e| e.to_string())?
    .position(x, y)
    .inner_size(width, height)
    .decorations(false)
    .resizable(false)
    .transparent(true)
    .build()
    .map_err(|e| e.to_string())?;

    Ok(())
}

/// Destroy a viewport webview
#[tauri::command]
pub async fn destroy_viewport(app: AppHandle, label: String) -> Result<(), String> {
    if let Some(webview) = app.get_webview_window(&label) {
        webview.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Resize and reposition a viewport webview
#[tauri::command]
pub async fn resize_viewport(
    app: AppHandle,
    label: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    if let Some(webview) = app.get_webview_window(&label) {
        webview.set_position(Position::Logical(LogicalPosition::new(x, y)))
            .map_err(|e| e.to_string())?;
        webview.set_size(Size::Logical(LogicalSize::new(width, height)))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Show a viewport webview
#[tauri::command]
pub async fn show_viewport(app: AppHandle, label: String) -> Result<(), String> {
    if let Some(webview) = app.get_webview_window(&label) {
        webview.show().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Hide a viewport webview
#[tauri::command]
pub async fn hide_viewport(app: AppHandle, label: String) -> Result<(), String> {
    if let Some(webview) = app.get_webview_window(&label) {
        webview.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Scroll a viewport to a specific position (for sync)
#[tauri::command]
pub async fn scroll_viewport(
    app: AppHandle,
    label: String,
    scroll_x: f64,
    scroll_y: f64,
) -> Result<(), String> {
    if let Some(webview) = app.get_webview_window(&label) {
        let script = format!("window.scrollTo({}, {});", scroll_x, scroll_y);
        webview.eval(&script).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Click at a position in a viewport (for sync)
#[tauri::command]
pub async fn click_viewport(
    app: AppHandle,
    label: String,
    x: f64,
    y: f64,
) -> Result<(), String> {
    if let Some(webview) = app.get_webview_window(&label) {
        let script = format!(
            "document.elementFromPoint({}, {}).click();",
            x, y
        );
        webview.eval(&script).map_err(|e| e.to_string())?;
    }
    Ok(())
}
```

**Register in `lib.rs`:**
```rust
.invoke_handler(tauri::generate_handler![
    // ... existing commands ...
    create_viewport,
    destroy_viewport,
    resize_viewport,
    show_viewport,
    hide_viewport,
    scroll_viewport,
    click_viewport,
])
```

#### 4A.4 Frontend State

**File:** `src/stores/ui.ts` (extend)

```typescript
interface Viewport {
  id: string
  url: string
  width: number
  height: number
  label: string // e.g. "iPhone 14 Pro"
  deviceCategory: 'mobile' | 'tablet' | 'laptop'
}

interface UIState {
  // ... existing state ...

  // Viewport mode
  viewportMode: boolean
  viewports: Viewport[]
  syncScroll: boolean
  syncClick: boolean
  syncInput: boolean

  // Viewport actions
  enterViewportMode: () => void
  exitViewportMode: () => void
  addViewport: (preset: DevicePreset) => void
  removeViewport: (id: string) => void
  toggleSyncScroll: () => void
  toggleSyncClick: () => void
  toggleSyncInput: () => void
}
```

#### 4A.5 Device Presets

**File:** `src/components/panels/ViewportPresets.ts` (new)

```typescript
export interface DevicePreset {
  label: string
  width: number
  height: number
  category: 'mobile' | 'tablet' | 'laptop'
}

export const DEVICE_PRESETS: Record<string, DevicePreset[]> = {
  mobile: [
    { label: "iPhone SE", width: 375, height: 667, category: 'mobile' },
    { label: "iPhone 14", width: 390, height: 844, category: 'mobile' },
    { label: "iPhone 14 Pro Max", width: 430, height: 932, category: 'mobile' },
    { label: "Galaxy S23", width: 360, height: 780, category: 'mobile' },
    { label: "Pixel 7", width: 412, height: 915, category: 'mobile' },
  ],
  tablet: [
    { label: "iPad Mini", width: 768, height: 1024, category: 'tablet' },
    { label: "iPad", width: 820, height: 1180, category: 'tablet' },
    { label: "iPad Pro 11\"", width: 834, height: 1194, category: 'tablet' },
    { label: "iPad Pro 12.9\"", width: 1024, height: 1366, category: 'tablet' },
  ],
  laptop: [
    { label: "1280×800", width: 1280, height: 800, category: 'laptop' },
    { label: "1366×768", width: 1366, height: 768, category: 'laptop' },
    { label: "1440×900", width: 1440, height: 900, category: 'laptop' },
    { label: "1920×1080", width: 1920, height: 1080, category: 'laptop' },
  ],
}
```

#### 4A.6 Viewport Panel Component

**File:** `src/components/panels/ViewportPanel.tsx` (new)

```typescript
// Layout:
// ┌─────────────────────────────────────────┐
// │ Toolbar: [Preset Dropdown] [Add] [Sync] │
// ├─────────────────────────────────────────┤
// │ ┌─────────┐ ┌─────────┐ ┌─────────┐    │
// │ │ View 1  │ │ View 2  │ │ View 3  │    │
// │ │ Label   │ │ Label   │ │ Label   │    │
// │ │ [webview│ │ [webview│ │ [webview│    │
// │ │  area]  │ │  area]  │ │  area]  │    │
// │ └─────────┘ └─────────┘ └─────────┘    │
// └─────────────────────────────────────────┘

// CSS Grid layout:
// grid-template-columns: repeat(auto-fit, minmax(300px, 1fr))
// Each cell gets a label bar + the webview area
```

**Key behaviors:**
- Grid divides available width equally among viewports
- Each viewport has a label bar showing device name + dimensions
- "X" button to remove a viewport
- Toolbar has sync toggles (scroll, click, input)
- When entering viewport mode: hide main browser webview, create viewport webviews
- When exiting: destroy all viewport webviews, show main browser webview

#### 4A.7 Viewport Sync

**File:** `src/hooks/useViewportSync.ts` (new)

**Scroll sync:**
```typescript
// Inject into each viewport webview:
const SCROLL_SYNC_SCRIPT = `
  (function() {
    let isSyncing = false;
    window.addEventListener('scroll', function() {
      if (isSyncing) return;
      isSyncing = true;
      const scrollPercent = {
        x: window.scrollX / (document.body.scrollWidth - window.innerWidth),
        y: window.scrollY / (document.body.scrollHeight - window.innerHeight)
      };
      window.__TAURI_INTERNALS__.invoke('viewport_scroll_sync', {
        percent: scrollPercent
      });
      setTimeout(() => { isSyncing = false; }, 50);
    });
  })();
`;

// In main window, listen for scroll events:
// When viewport A scrolls:
//   For each other viewport B:
//     Calculate: B.scrollX = scrollPercent.x * (B.body.scrollWidth - B.innerWidth)
//     Calculate: B.scrollY = scrollPercent.y * (B.body.scrollHeight - B.innerHeight)
//     Call: scroll_viewport(B.label, B.scrollX, B.scrollY)
```

**Click sync:**
```typescript
// Inject into each viewport:
const CLICK_SYNC_SCRIPT = `
  document.addEventListener('click', function(e) {
    const rect = e.target.getBoundingClientRect();
    const relativeX = (e.clientX - rect.left) / rect.width;
    const relativeY = (e.clientY - rect.top) / rect.height;
    window.__TAURI_INTERNALS__.invoke('viewport_click_sync', {
      relativeX, relativeY,
      selector: getSelector(e.target)
    });
  });
`;

// In main window:
// When viewport A clicks:
//   For each other viewport B:
//     Find element at same relative position in B
//     Or use CSS selector to find matching element
//     Call: click_viewport(B.label, x, y)
```

**Note:** Coordinate-based sync (scroll by percentage) is more reliable than DOM-based sync when viewports have different layouts. Start with this for v1.

#### 4A.8 Verification Checklist

- [ ] Click "Enter Viewport Mode" in toolbar
- [ ] 3 viewports appear: iPhone SE (375), iPad (820), Desktop (1440)
- [ ] All 3 show the same URL
- [ ] Scroll in iPhone SE → iPad and Desktop scroll proportionally
- [ ] Click a link in iPad → all 3 navigate to the link
- [ ] Remove a viewport → grid adjusts
- [ ] Add a custom viewport (e.g., 500×800) → appears in grid
- [ ] Exit viewport mode → viewports destroyed, main browser webview restored

---

### 4B. User Agent Switcher

#### 4B.1 Goal
Let developers simulate any browser/device by switching the user agent string.

#### 4B.2 UA Presets

**File:** `src/components/panels/UserAgentPresets.ts` (new)

```typescript
export interface UserAgentPreset {
  label: string
  ua: string
  category: 'desktop' | 'mobile' | 'bot'
}

export const UA_PRESETS: UserAgentPreset[] = [
  // Desktop
  {
    label: "Chrome 125 (Windows)",
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    category: 'desktop'
  },
  {
    label: "Firefox 128 (Windows)",
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0",
    category: 'desktop'
  },
  {
    label: "Safari 17.5 (macOS)",
    ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
    category: 'desktop'
  },
  {
    label: "Edge 125 (Windows)",
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0",
    category: 'desktop'
  },

  // Mobile
  {
    label: "Chrome (Android 14)",
    ua: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36",
    category: 'mobile'
  },
  {
    label: "Safari (iOS 17.5)",
    ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
    category: 'mobile'
  },
  {
    label: "Samsung Browser (Android)",
    ua: "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36",
    category: 'mobile'
  },

  // Bot
  {
    label: "Googlebot",
    ua: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    category: 'bot'
  },
  {
    label: "Bingbot",
    ua: "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
    category: 'bot'
  },
]
```

#### 4B.3 Rust Command

**File:** `src-tauri/src/commands/browser.rs`

**Option A: Recreate webview with new UA (simpler, recommended for v1)**

```rust
#[tauri::command]
pub async fn browser_set_user_agent(
    app: AppHandle,
    user_agent: String,
) -> Result<(), String> {
    // Store the UA in app state
    let state = app.state::<BrowserState>();
    *state.user_agent.lock().unwrap() = Some(user_agent.clone());

    // The next time browser_navigate is called, it will use this UA
    // in the WebviewWindowBuilder::user_agent() call
    Ok(())
}
```

**Option B: Change UA at runtime (more complex, for v2)**

On Windows, use WebView2 COM API:
```rust
#[cfg(windows)]
unsafe {
    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings2;
    use windows::core::Interface;

    let settings: ICoreWebView2Settings2 = webview
        .controller()
        .CoreWebView2()
        .unwrap()
        .Settings()
        .unwrap()
        .cast()
        .unwrap();

    settings.SetUserAgent(user_agent).unwrap();
}
```

**Recommendation:** Start with Option A. When user switches UA, recreate the webview with the new UA in the builder. The page reloads automatically with the new identity.

#### 4B.4 Inject UA Override Script

**File:** `src-tauri/src/commands/browser.rs` — extend `BROWSER_INIT_SCRIPT`

Add at the top of the init script:
```javascript
// Override navigator.userAgent if custom UA is set
if (window.__XEVO_USER_AGENT) {
  Object.defineProperty(navigator, 'userAgent', {
    get: () => window.__XEVO_USER_AGENT,
    configurable: true
  });
  Object.defineProperty(navigator, 'appVersion', {
    get: () => window.__XEVO_USER_AGENT.replace('Mozilla/5.0 ', ''),
    configurable: true
  });
}
```

#### 4B.5 Frontend UI

**File:** `src/components/panels/UserAgentPanel.tsx` (new)

```
┌─────────────────────────────────────┐
│ User Agent                          │
├─────────────────────────────────────┤
│ Current: Chrome 125 (Windows)       │
│ [Mozilla/5.0 (Windows NT 10.0...)]  │
│                                     │
│ ┌─ Desktop ──────────────────────┐  │
│ │ ○ Chrome 125 (Windows)         │  │
│ │ ○ Firefox 128 (Windows)        │  │
│ │ ○ Safari 17.5 (macOS)          │  │
│ │ ○ Edge 125 (Windows)           │  │
│ └────────────────────────────────┘  │
│ ┌─ Mobile ───────────────────────┐  │
│ │ ○ Chrome (Android 14)          │  │
│ │ ○ Safari (iOS 17.5)            │  │
│ │ ○ Samsung Browser              │  │
│ └────────────────────────────────┘  │
│ ┌─ Bot ──────────────────────────┐  │
│ │ ○ Googlebot                    │  │
│ │ ○ Bingbot                      │  │
│ └────────────────────────────────┘  │
│                                     │
│ Custom UA:                          │
│ [_________________________________] │
│ [Apply]                             │
└─────────────────────────────────────┘
```

#### 4B.6 Settings Integration

**File:** `src/stores/settings.ts`

Add to `AppSettings`:
```typescript
interface AppSettings {
  // ... existing settings ...
  userAgent: string | null // null = default browser UA
}
```

When `userAgent` is set, inject it into every webview's init script:
```javascript
window.__XEVO_USER_AGENT = "<user_agent_string>";
```

#### 4B.7 Verification Checklist

- [ ] Open User Agent panel in sidebar
- [ ] See current UA displayed
- [ ] Select "Safari (iOS 17.5)" → page reloads
- [ ] Check `navigator.userAgent` in webview console → shows Safari iOS string
- [ ] Navigate to a site that checks UA → sees mobile version
- [ ] Enter custom UA in text field → click Apply → page reloads with custom UA
- [ ] Switch back to "Default" → original UA restored

---

### 4C. Meta Tag Inspector

#### 4C.1 Goal
Inspect any page's meta tags, validate them against social platform requirements, and preview how the page will look when shared on Facebook, Twitter/X, LinkedIn, Discord.

#### 4C.2 Extend Existing Inspector

**File:** `src/components/panels/InspectorPanel.tsx`

Your inspector already extracts meta tags via `eval_inspector` Rust command. Extend it to:

1. Parse `og:*`, `twitter:*`, and standard meta tags
2. Group by category: SEO, Open Graph, Twitter Card, Other
3. Show validation indicators (✅/⚠️/❌)
4. Render social preview cards

#### 4C.3 Meta Tag Extraction Script

**File:** `src-tauri/src/commands/browser.rs` — extend `BROWSER_INIT_SCRIPT`

```javascript
// Add to xevoInspect function:
function extractMetaTags() {
  const metas = {};
  document.querySelectorAll('meta').forEach(tag => {
    const name = tag.getAttribute('name') || tag.getAttribute('property') || tag.getAttribute('http-equiv');
    const content = tag.getAttribute('content');
    if (name && content) {
      metas[name] = content;
    }
  });

  return {
    // Standard SEO
    title: document.title,
    description: metas['description'] || '',
    canonical: document.querySelector('link[rel="canonical"]')?.href || '',
    viewport: metas['viewport'] || '',
    charset: document.characterSet || '',
    robots: metas['robots'] || '',
    author: metas['author'] || '',

    // Open Graph
    ogTitle: metas['og:title'] || '',
    ogDescription: metas['og:description'] || '',
    ogImage: metas['og:image'] || '',
    ogImageUrl: metas['og:image:url'] || '',
    ogImageWidth: metas['og:image:width'] || '',
    ogImageHeight: metas['og:image:height'] || '',
    ogUrl: metas['og:url'] || '',
    ogType: metas['og:type'] || '',
    ogSiteName: metas['og:site_name'] || '',
    ogLocale: metas['og:locale'] || '',

    // Twitter Card
    twitterCard: metas['twitter:card'] || '',
    twitterTitle: metas['twitter:title'] || '',
    twitterDescription: metas['twitter:description'] || '',
    twitterImage: metas['twitter:image'] || '',
    twitterSite: metas['twitter:site'] || '',
    twitterCreator: metas['twitter:creator'] || '',

    // Other
    themeColor: metas['theme-color'] || '',
    appleMobileWebAppCapable: metas['apple-mobile-web-app-capable'] || '',
  };
}
```

#### 4C.4 Validation Rules

**File:** `src/components/panels/MetaValidator.ts` (new)

```typescript
export interface MetaValidation {
  field: string
  value: string
  status: 'valid' | 'warning' | 'error'
  message: string
}

export function validateMetaTags(meta: Record<string, string>): MetaValidation[] {
  const validations: MetaValidation[] = [];

  // SEO validations
  if (!meta.title) {
    validations.push({ field: 'title', value: '', status: 'error', message: 'Missing title tag' });
  } else if (meta.title.length > 60) {
    validations.push({ field: 'title', value: meta.title, status: 'warning', message: `Title too long (${meta.title.length}/60 chars)` });
  } else {
    validations.push({ field: 'title', value: meta.title, status: 'valid', message: 'Title present' });
  }

  if (!meta.description) {
    validations.push({ field: 'description', value: '', status: 'error', message: 'Missing meta description' });
  } else if (meta.description.length > 160) {
    validations.push({ field: 'description', value: meta.description, status: 'warning', message: `Description too long (${meta.description.length}/160 chars)` });
  } else {
    validations.push({ field: 'description', value: meta.description, status: 'valid', message: 'Description present' });
  }

  if (!meta.canonical) {
    validations.push({ field: 'canonical', value: '', status: 'warning', message: 'Missing canonical URL' });
  } else {
    validations.push({ field: 'canonical', value: meta.canonical, status: 'valid', message: 'Canonical present' });
  }

  // Open Graph validations
  if (!meta.ogTitle) {
    validations.push({ field: 'og:title', value: '', status: 'error', message: 'Missing og:title' });
  } else {
    validations.push({ field: 'og:title', value: meta.ogTitle, status: 'valid', message: 'og:title present' });
  }

  if (!meta.ogDescription) {
    validations.push({ field: 'og:description', value: '', status: 'error', message: 'Missing og:description' });
  } else {
    validations.push({ field: 'og:description', value: meta.ogDescription, status: 'valid', message: 'og:description present' });
  }

  if (!meta.ogImage) {
    validations.push({ field: 'og:image', value: '', status: 'error', message: 'Missing og:image — link preview will have no image' });
  } else {
    // Check if URL is absolute
    try {
      new URL(meta.ogImage);
      validations.push({ field: 'og:image', value: meta.ogImage, status: 'valid', message: 'og:image present (absolute URL)' });
    } catch {
      validations.push({ field: 'og:image', value: meta.ogImage, status: 'warning', message: 'og:image is relative URL — may fail for crawlers' });
    }
  }

  if (!meta.ogUrl) {
    validations.push({ field: 'og:url', value: '', status: 'warning', message: 'Missing og:url' });
  }

  // Twitter Card validations
  if (!meta.twitterCard) {
    validations.push({ field: 'twitter:card', value: '', status: 'warning', message: 'Missing twitter:card — defaults to summary' });
  } else if (meta.twitterCard !== 'summary_large_image') {
    validations.push({ field: 'twitter:card', value: meta.twitterCard, status: 'warning', message: 'Consider using summary_large_image for large image cards' });
  } else {
    validations.push({ field: 'twitter:card', value: meta.twitterCard, status: 'valid', message: 'twitter:card is summary_large_image' });
  }

  if (!meta.twitterImage && !meta.ogImage) {
    validations.push({ field: 'twitter:image', value: '', status: 'error', message: 'No twitter:image or og:image — link preview will have no image' });
  }

  return validations;
}
```

#### 4C.5 Social Preview Component

**File:** `src/components/panels/SocialPreview.tsx` (new)

```typescript
// Renders a preview card for a specific platform
function SocialPreviewCard({ platform, meta }: { platform: string, meta: Record<string, string> }) {
  const title = meta.ogTitle || meta.title || 'Untitled'
  const description = meta.ogDescription || meta.description || ''
  const image = meta.twitterImage || meta.ogImage || ''
  const url = meta.ogUrl || meta.canonical || ''

  switch (platform) {
    case 'facebook':
      return (
        <div className="social-preview facebook">
          {image && <img src={image} alt="" className="social-preview-image" />}
          <div className="social-preview-content">
            <span className="social-preview-domain">{new URL(url || 'https://example.com').hostname}</span>
            <h3 className="social-preview-title">{title.slice(0, 100)}</h3>
            <p className="social-preview-desc">{description.slice(0, 200)}</p>
          </div>
        </div>
      )

    case 'twitter':
      return (
        <div className="social-preview twitter">
          {image && <img src={image} alt="" className="social-preview-image" />}
          <div className="social-preview-content">
            <h3 className="social-preview-title">{title.slice(0, 70)}</h3>
            <p className="social-preview-desc">{description.slice(0, 200)}</p>
            <span className="social-preview-domain">{new URL(url || 'https://example.com').hostname}</span>
          </div>
        </div>
      )

    case 'linkedin':
      return (
        <div className="social-preview linkedin">
          {image && <img src={image} alt="" className="social-preview-image" />}
          <div className="social-preview-content">
            <span className="social-preview-domain">{new URL(url || 'https://example.com').hostname}</span>
            <h3 className="social-preview-title">{title.slice(0, 100)}</h3>
            <p className="social-preview-desc">{description.slice(0, 200)}</p>
          </div>
        </div>
      )

    case 'discord':
      return (
        <div className="social-preview discord">
          {image && <img src={image} alt="" className="social-preview-image" />}
          <div className="social-preview-content">
            <h3 className="social-preview-title">{title.slice(0, 100)}</h3>
            <p className="social-preview-desc">{description.slice(0, 200)}</p>
          </div>
        </div>
      )
  }
}
```

#### 4C.6 Image Diagnostics

```typescript
async function diagnoseOgImage(imageUrl: string): Promise<ImageDiagnostics> {
  try {
    const response = await fetch(imageUrl)
    if (!response.ok) {
      return { status: 'error', message: `HTTP ${response.status}` }
    }

    const contentType = response.headers.get('content-type')
    if (!contentType?.startsWith('image/')) {
      return { status: 'error', message: `Not an image (${contentType})` }
    }

    const blob = await response.blob()
    const sizeKB = blob.size / 1024

    // Load image to get dimensions
    const img = new Image()
    img.src = URL.createObjectURL(blob)
    await new Promise(resolve => { img.onload = resolve })

    const issues: string[] = []
    if (img.width < 600 || img.height < 315) {
      issues.push(`Too small (${img.width}×${img.height}, minimum 600×315)`)
    }
    if (img.width < 1200 || img.height < 630) {
      issues.push(`Below recommended (${img.width}×${img.height}, recommended 1200×630)`)
    }
    if (sizeKB > 5000) {
      issues.push(`Very large (${Math.round(sizeKB)}KB, recommended <500KB)`)
    }

    const ratio = img.width / img.height
    if (Math.abs(ratio - 1.91) > 0.1) {
      issues.push(`Wrong aspect ratio (${ratio.toFixed(2)}, expected 1.91)`)
    }

    URL.revokeObjectURL(img.src)

    return {
      status: issues.length > 0 ? 'warning' : 'valid',
      message: issues.length > 0 ? issues.join('; ') : `${img.width}×${img.height}, ${Math.round(sizeKB)}KB`,
      width: img.width,
      height: img.height,
      sizeKB
    }
  } catch (e) {
    return { status: 'error', message: `Failed to load: ${e}` }
  }
}
```

#### 4C.7 Verification Checklist

- [ ] Open Inspector panel → see meta tags grouped by category
- [ ] Navigate to a page with good OG tags → all show ✅
- [ ] Navigate to a page missing og:image → shows ❌ "Missing og:image"
- [ ] See Facebook preview card with title, description, image
- [ ] See Twitter/X preview card
- [ ] See LinkedIn preview card
- [ ] See Discord preview card
- [ ] Image diagnostics show dimensions and file size
- [ ] Warning when image is too small (<600×315)
- [ ] Warning when image is relative URL

---

### 4D. Screenshot Tool

#### 4D.1 Goal
Capture the current viewport as a PNG image. Save to clipboard or download as file.

#### 4D.2 Rust Command

**File:** `src-tauri/src/commands/browser.rs`

```rust
#[tauri::command]
pub async fn browser_screenshot(app: AppHandle) -> Result<String, String> {
    let state = app.state::<BrowserState>();
    let label = state.current_label.lock().unwrap().clone()
        .ok_or("No active webview")?;

    let webview = app.get_webview_window(&label)
        .ok_or("Webview not found")?;

    // On Windows, use WebView2 CapturePreview
    #[cfg(windows)]
    {
        // WebView2 has CapturePreview API
        // Returns a PNG as a stream
        // Convert to base64 and return to frontend
        // Implementation uses webview2-com crate
    }

    // Fallback: use the Tauri window capture
    // This captures the entire window, not just the webview
    // For v1, this is acceptable

    // For now, return a placeholder
    // TODO: implement actual screenshot capture
    Err("Screenshot not yet implemented".to_string())
}
```

#### 4D.3 Frontend Integration

**File:** `src/hooks/useKeyboardShortcuts.ts`

```typescript
case 'ctrl+shift+s':
  // Screenshot current tab
  const screenshot = await screenshotWebview()
  if (screenshot) {
    // Copy to clipboard
    await navigator.clipboard.write([
      new ClipboardItem({ 'image/png': screenshot })
    ])
    showToast('Screenshot copied to clipboard')
  }
  break
```

**File:** `src/components/browser/Toolbar.tsx`

Add a camera icon button that triggers the screenshot.

---

## 5. POINT 3: PERFORMANCE OPTIMIZATION

### 5A. Lazy-Load Panels

#### 5A.1 Goal
Defer loading of sidebar panels until they're opened. Reduce initial bundle size.

#### 5A.2 Implementation

**File:** `src/components/sidebar/Sidebar.tsx`

**Before:**
```typescript
import ApiTester from '../panels/ApiTester'
import JwtDecoder from '../panels/JwtDecoder'
import Base64Tool from '../panels/Base64Tool'
import NetworkPanel from '../panels/NetworkPanel'
import HeadersPanel from '../panels/HeadersPanel'
import InspectorPanel from '../panels/InspectorPanel'
import NotesNotepad from '../panels/NotesNotepad'
```

**After:**
```typescript
import React, { Suspense } from 'react'

const ApiTester = React.lazy(() => import('../panels/ApiTester'))
const JwtDecoder = React.lazy(() => import('../panels/JwtDecoder'))
const Base64Tool = React.lazy(() => import('../panels/Base64Tool'))
const NetworkPanel = React.lazy(() => import('../panels/NetworkPanel'))
const HeadersPanel = React.lazy(() => import('../panels/HeadersPanel'))
const InspectorPanel = React.lazy(() => import('../panels/InspectorPanel'))
const NotesNotepad = React.lazy(() => import('../panels/NotesNotepad'))

// Skeleton component for loading state
function PanelSkeleton() {
  return (
    <div className="animate-pulse p-4 space-y-3">
      <div className="h-4 bg-[var(--xevo-hover)] rounded w-1/3" />
      <div className="h-4 bg-[var(--xevo-hover)] rounded w-2/3" />
      <div className="h-4 bg-[var(--xevo-hover)] rounded w-1/2" />
    </div>
  )
}

// In render:
<Suspense fallback={<PanelSkeleton />}>
  {activePanel === 'api' && <ApiTester />}
  {activePanel === 'jwt' && <JwtDecoder />}
  {activePanel === 'base64' && <Base64Tool />}
  {activePanel === 'network' && <NetworkPanel />}
  {activePanel === 'headers' && <HeadersPanel />}
  {activePanel === 'inspector' && <InspectorPanel />}
  {activePanel === 'notes' && <NotesNotepad />}
</Suspense>
```

**Impact:** If user opens only 1 panel, you load 1 chunk instead of 7. Each panel is ~5-15KB gzipped. Savings: ~50-100KB on initial load.

### 5B. Vite Manual Chunks

#### 5B.1 Goal
Separate vendor libraries into cacheable chunks. When your code changes, vendor chunks stay cached.

#### 5B.2 Implementation

**File:** `vite.config.ts`

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'zustand-vendor': ['zustand'],
          'icons': ['lucide-react'],
          'ui-lib': ['cmdk', 'class-variance-authority', 'clsx', 'tailwind-merge'],
        }
      }
    }
  }
})
```

**Result:**
```
dist/
  index.js          (your app code — changes every deploy)
  react-vendor.js   (React + ReactDOM — rarely changes, cached)
  zustand-vendor.js (Zustand — rarely changes, cached)
  icons.js          (Lucide icons — rarely changes, cached)
  ui-lib.js         (UI utilities — rarely changes, cached)
```

### 5C. Split Init Script

#### 5C.1 Goal
Reduce the init script injected into every tab from ~400 lines to ~50 lines core. Load network monitoring, header injection, and JSON viewer on-demand.

#### 5C.2 Implementation

**File:** `src-tauri/src/commands/browser.rs`

**Split into:**

```rust
// CORE_SCRIPT (~50 lines): Injected into EVERY tab
// - Tab info extraction (title, favicon, URL)
// - Shortcut forwarding
// - Basic event listeners
pub const CORE_SCRIPT: &str = r#"
(function() {
  // Tab info extraction
  function sendTabInfo() {
    const title = document.title;
    const url = window.location.href;
    const favicon = document.querySelector('link[rel="icon"]')?.href || '';
    window.__TAURI_INTERNALS__.invoke('update_tab_info', { title, url, favicon });
  }

  // Listen for title changes
  new MutationObserver(sendTabInfo).observe(document.querySelector('title') || document.documentElement, {
    childList: true, subtree: true, characterData: true
  });

  // Send on load
  if (document.readyState === 'complete') sendTabInfo();
  else window.addEventListener('load', sendTabInfo);

  // Shortcut forwarding
  document.addEventListener('keydown', function(e) {
    if (e.ctrlKey || e.metaKey) {
      const key = e.key.toLowerCase();
      const shortcuts = ['d', 'k', 't', 'w', 'r', 'b', ','];
      if (shortcuts.includes(key) || (e.shiftKey && key === 't')) {
        e.preventDefault();
        e.stopPropagation();
        window.__TAURI_INTERNALS__.invoke('forward_shortcut', {
          shortcut: e.shiftKey ? `ctrl+shift+${key}` : `ctrl+${key}`
        });
      }
    }
  }, true);
})();
"#;

// NETWORK_SCRIPT (~150 lines): Injected when network panel is opened
pub const NETWORK_SCRIPT: &str = r#"
(function() {
  // Fetch monkeypatching
  const originalFetch = window.fetch;
  window.fetch = function(...args) {
    const start = performance.now();
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
    const method = args[1]?.method || 'GET';

    return originalFetch.apply(this, args).then(response => {
      const duration = performance.now() - start;
      const entry = {
        method,
        url,
        status: response.status,
        statusText: response.statusText,
        duration: Math.round(duration),
        type: 'fetch'
      };
      window.__TAURI_INTERNALS__.invoke('network_log_entry', entry);
      return response;
    });
  };

  // XHR monkeypatching
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function(method, url) {
    this._xevoMethod = method;
    this._xevoUrl = url;
    this._xevoStart = performance.now();
    return originalOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function() {
    this.addEventListener('load', function() {
      const duration = performance.now() - this._xevoStart;
      window.__TAURI_INTERNALS__.invoke('network_log_entry', {
        method: this._xevoMethod,
        url: this._xevoUrl,
        status: this.status,
        statusText: this.statusText,
        duration: Math.round(duration),
        type: 'xhr'
      });
    });
    return originalSend.apply(this, arguments);
  };
})();
"#;

// HEADER_SCRIPT (~30 lines): Injected when header rules are active
pub const HEADER_SCRIPT: &str = r#"
(function() {
  window.__XEVO_HEADER_RULES = [];

  const originalFetch = window.fetch;
  window.fetch = function(url, options = {}) {
    const headers = new Headers(options.headers);

    for (const rule of window.__XEVO_HEADER_RULES) {
      if (!rule.enabled) continue;
      if (new RegExp(rule.urlPattern).test(url)) {
        headers.set(rule.headerName, rule.headerValue);
      }
    }

    options.headers = Object.fromEntries(headers.entries());
    return originalFetch.call(this, url, options);
  };
})();
"#;
```

**Inject on-demand:**
```rust
// In browser_navigate or ensure_browser_window:
// Only inject CORE_SCRIPT always
// Inject NETWORK_SCRIPT when network panel is opened (via eval)
// Inject HEADER_SCRIPT when header rules are active
```

### 5D. Lazy Webview Creation on Startup

#### 5D.1 Goal
Don't create all webviews at once on startup. Create active tab first, adjacent tabs after 500ms, others on first switch.

#### 5D.2 Implementation

**File:** `src/hooks/useWebviewBridge.ts`

```typescript
useEffect(() => {
  const handleHydration = async () => {
    const tabs = useTabsStore.getState().tabs
    const activeTabId = useTabsStore.getState().activeTabId

    const tabList = Object.values(tabs).filter(t => t.url)
    if (tabList.length === 0) return

    // Phase 1: Create active tab immediately
    const activeTab = tabList.find(t => t.id === activeTabId)
    if (activeTab) {
      await createTab(activeTab.id, activeTab.url)
      const bounds = getBounds()
      if (bounds) await showTabWebview(activeTab.id, bounds)
    }

    // Phase 2: Create adjacent tabs after 500ms
    setTimeout(async () => {
      const activeIndex = tabList.findIndex(t => t.id === activeTabId)
      const adjacent = [
        tabList[activeIndex - 1],
        tabList[activeIndex + 1]
      ].filter(Boolean)

      for (const tab of adjacent) {
        await createTab(tab.id, tab.url)
        await hideTabWebview(tab.id)
      }
    }, 500)

    // Phase 3: Other tabs created on first switch (handled by tab-switch useEffect)
  }

  window.addEventListener('xevo:tabs-hydrated', handleHydration)
  if (useTabsStore.persist.hasHydrated()) handleHydration()

  return () => window.removeEventListener('xevo:tabs-hydrated', handleHydration)
}, [])
```

### 5E. Virtualize Long Lists

#### 5E.1 Goal
Use virtual scrolling for history, bookmarks, and network log when lists are long.

#### 5E.2 Implementation

**File:** `src/components/sidebar/HistoryPanel.tsx`

```typescript
import { FixedSizeList } from 'react-window'

// Before:
{history.map(entry => <HistoryRow entry={entry} />)}

// After:
<FixedSizeList
  height={400}
  itemCount={history.length}
  itemSize={36}
  width="100%"
>
  {({ index, style }) => (
    <HistoryRow entry={history[index]} style={style} />
  )}
</FixedSizeList>
```

**Note:** Only add virtualization if lists exceed 50+ items. For smaller lists, native rendering is fine.

---

## 6. EXECUTION ORDER

### Phase 1: Tab Persistence (1-2 hours)
1. Add `persist` middleware to `tabs.ts` store
2. Add `persist` middleware to `workspaces.ts` store (verify)
3. Add hydration + webview restoration in `useWebviewBridge.ts`
4. Test: open tabs → close app → reopen → verify tabs restored

### Phase 2: Performance (2-3 hours)
1. Add `React.lazy` for all sidebar panels
2. Configure `manualChunks` in `vite.config.ts`
3. Split `BROWSER_INIT_SCRIPT` into core + on-demand modules
4. Add lazy webview creation on startup
5. Measure startup time before/after

### Phase 3: User Agent Switcher (1-2 hours)
1. Create UA presets data
2. Add `browser_set_user_agent` Rust command
3. Create `UserAgentPanel.tsx` sidebar panel
4. Inject UA override script into webview init

### Phase 4: Meta Tag Inspector (2-3 hours)
1. Extend `InspectorPanel.tsx` with OG/Twitter tag extraction
2. Add social preview cards (Facebook, Twitter, LinkedIn, Discord)
3. Add validation indicators (✅/⚠️/❌)
4. Add image diagnostics (dimensions, file size)

### Phase 5: Multi-Viewport Mode (3-5 hours)
1. Add viewport Rust commands (create/destroy/resize)
2. Create viewport state in `ui.ts` store
3. Create device presets data
4. Build `ViewportPanel.tsx` with CSS Grid layout
5. Implement viewport sync (scroll + click)
6. Toolbar toggle to enter/exit viewport mode

### Phase 6: Screenshot Tool (1-2 hours)
1. Add `browser_screenshot` Rust command
2. Add frontend trigger (toolbar button + keyboard shortcut)
3. Handle save to clipboard / download

---

## 7. VERIFICATION CHECKLISTS

### Tab Persistence
- [ ] Open 3 tabs with different URLs
- [ ] Pin one tab
- [ ] Close the app completely
- [ ] Reopen the app
- [ ] All 3 tabs restored with correct URLs
- [ ] Pinned tab shows pin icon
- [ ] Active tab is the same one that was active before close
- [ ] Tab titles and favicons restored
- [ ] Back/forward history preserved for each tab
- [ ] Workspaces maintain their tab assignments

### Multi-Viewport
- [ ] Click "Enter Viewport Mode" in toolbar
- [ ] 3 viewports appear: iPhone SE (375), iPad (820), Desktop (1440)
- [ ] All 3 show the same URL
- [ ] Scroll in iPhone SE → iPad and Desktop scroll proportionally
- [ ] Click a link in iPad → all 3 navigate to the link
- [ ] Remove a viewport → grid adjusts
- [ ] Add a custom viewport (e.g., 500×800) → appears in grid
- [ ] Exit viewport mode → viewports destroyed, main browser webview restored

### User Agent Switcher
- [ ] Open User Agent panel in sidebar
- [ ] See current UA displayed
- [ ] Select "Safari (iOS 17.5)" → page reloads
- [ ] Check `navigator.userAgent` in webview console → shows Safari iOS string
- [ ] Navigate to a site that checks UA → sees mobile version
- [ ] Enter custom UA in text field → click Apply → page reloads with custom UA
- [ ] Switch back to "Default" → original UA restored

### Meta Tag Inspector
- [ ] Open Inspector panel → see meta tags grouped by category
- [ ] Navigate to a page with good OG tags → all show ✅
- [ ] Navigate to a page missing og:image → shows ❌ "Missing og:image"
- [ ] See Facebook preview card with title, description, image
- [ ] See Twitter/X preview card
- [ ] See LinkedIn preview card
- [ ] See Discord preview card
- [ ] Image diagnostics show dimensions and file size
- [ ] Warning when image is too small (<600×315)
- [ ] Warning when image is relative URL

### Performance
- [ ] Run `vite build` — check chunk sizes in dist/
- [ ] Main bundle should be <150KB gzipped
- [ ] Vendor chunks (react-vendor, zustand-vendor) should be separate files
- [ ] Open sidebar panels — only loads the opened panel's chunk
- [ ] Measure startup time: `console.time('xevo-boot')` in main.tsx
- [ ] Startup should be <500ms on modern hardware
- [ ] Open 10 tabs — memory usage should stay <200MB

---

## 8. DEPENDENCY GRAPH

```
Tab Persistence ──────────────┐
                              ├──> (independent, do first)
Performance Optimization ─────┘

User Agent Switcher ──────────┐
                              ├──> (independent, can parallel)
Meta Tag Inspector ───────────┘

Multi-Viewport Mode ──────────┐
                              ├──> (depends on nothing, but complex)
Screenshot Tool ──────────────┘
```

**Recommended order:** Persistence → Performance → UA Switcher → Meta Inspector → Multi-Viewport → Screenshot

---

## 9. TIME ESTIMATES

| Phase | Time | Difficulty |
|-------|------|------------|
| Tab Persistence | 1-2 hours | Easy (Zustand patterns well-documented) |
| Performance | 2-3 hours | Medium (lazy loading + script splitting) |
| User Agent Switcher | 1-2 hours | Medium (Rust COM API on Windows) |
| Meta Tag Inspector | 2-3 hours | Easy (JS parsing, already have inspector) |
| Multi-Viewport | 3-5 hours | Hard (Tauri multi-webview, sync logic) |
| Screenshot | 1-2 hours | Medium (platform-specific APIs) |
| **Total** | **10-17 hours** | |

---

## 10. WHAT MAKES THIS "100%"

After completing these 3 points, XEVO will have:

**Tab Persistence:** Users never lose their workspace. Close and reopen — everything is there. This is table-stakes for any serious browser.

**Developer Features:**
- Multi-viewport responsive testing (kills Responsively)
- User agent switching (simulate any device)
- Meta tag inspector with social previews (catches broken share cards before deploy)
- Screenshot tool (documentation, bug reports)

**Performance:** Lazy-loaded panels, optimized bundles, minimal init scripts, fast startup. Feels "lightweight" not just in size but in behavior.

That's the gap between "70% done" and "ready to ship."

---

*End of ENHANCED_BROWSER.md — Version 1.0*
