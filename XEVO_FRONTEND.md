---
name: xevo-frontend
description: >
  XEVO-specific frontend design system. Drop this file into the project root and
  reference it in every AI coding session. Covers Tailwind v4 tokens, shadcn/ui
  overrides, typography, spacing, platform constraints (Tauri 2), all major UI
  zones, component patterns, and hard rules. Replaces generic frontend-design
  skill for this project entirely.
project: XEVO — developer browser (Tauri 2 + React 19 + TypeScript + Tailwind v4 + shadcn/ui + Zustand v5)
---

# XEVO Frontend Design System

XEVO is a developer tool first. Its UI is infrastructure, not decoration. Every
design decision prioritises information density, muscle memory, and the principle
that the webview — the content the developer is building — should be the loudest
thing on screen. Everything else recedes.

The nearest analogues are Linear, VS Code, and Warp: dark surfaces, hairline
borders, monospace for data, one status-color system, and a chrome so quiet the
developer forgets it is there.

---

## 1. Design Identity

**Product:** XEVO — "Your browser. Built for building."
**Audience:** Frontend and full-stack developers using localhost all day.
**Visual character:** Near-monochrome dark surfaces + one blue accent for
interaction + a green/red system for server liveness. Zero decoration. The only
color that matters is the color of whether your server is running.
**Signature element:** The pulsing liveness dot on sidebar server entries. A 6px
circle with a live green radial glow when a dev server is detected. This is
XEVO's heartbeat — visible at a glance without opening any panel. It is the one
place where XEVO allows expressiveness. Everything else is quiet.

---

## 2. Color Tokens (Tailwind v4 + shadcn/ui overrides)

Paste this block into `src/index.css` (the Tailwind entry point).

```css
@import "tailwindcss";

/* ── Custom dark variant ── */
@custom-variant dark (&:where([data-theme=dark], [data-theme=dark] *));

@theme {
  /* ── Surface layers ── */
  --color-base:     #0a0a0b;   /* root background, webview surround */
  --color-surface:  #111113;   /* sidebar, panels, secondary areas */
  --color-elevated: #18181b;   /* cards, popovers, command palette */
  --color-hover:    #1f1f23;   /* row hover state */
  --color-active:   #27272a;   /* selected rows, active tabs */

  /* ── Borders ── */
  --color-border:        #27272a;  /* zone separator (sidebar│content) */
  --color-border-subtle: #1f1f23;  /* within-zone row dividers */

  /* ── Text ── */
  --color-text-primary:   #fafafa;
  --color-text-secondary: #a1a1aa;
  --color-text-muted:     #71717a;
  --color-text-disabled:  #52525b;
  --color-text-inverse:   #09090b;

  /* ── Accent (interaction only) ── */
  --color-accent:       #3b82f6;  /* focus ring, active tab underline, links */
  --color-accent-hover: #60a5fa;
  --color-accent-dim:   rgba(59, 130, 246, 0.12);  /* selection bg */

  /* ── Server liveness ── */
  --color-live:    #22c55e;  /* server is responding */
  --color-dead:    #ef4444;  /* server is down */
  --color-warn:    #f59e0b;  /* partial / slow response */
  --color-live-glow: rgba(34, 197, 94, 0.35);  /* dot pulse shadow */

  /* ── HTTP method colors (used in network log + API tester) ── */
  --color-method-get:     #22c55e;
  --color-method-post:    #f59e0b;
  --color-method-put:     #60a5fa;
  --color-method-delete:  #ef4444;
  --color-method-patch:   #a78bfa;
  --color-method-head:    #71717a;
  --color-method-options: #71717a;

  /* ── HTTP status colors ── */
  --color-status-2xx: #22c55e;
  --color-status-3xx: #f59e0b;
  --color-status-4xx: #ef4444;
  --color-status-5xx: #c084fc;

  /* ── Typography ── */
  --font-ui:   "Inter", "system-ui", sans-serif;
  --font-mono: "JetBrains Mono", "Fira Code", ui-monospace, monospace;

  /* ── Spacing scale (dense, tool-grade) ── */
  --spacing-row-xs:  24px;   /* status bar */
  --spacing-row-sm:  28px;   /* sidebar items, list rows */
  --spacing-row-md:  32px;   /* network log rows, table rows */
  --spacing-row-lg:  36px;   /* tab bar */
  --spacing-row-xl:  40px;   /* toolbar / address bar */

  /* ── Radius ── */
  --radius-sm:   2px;   /* badges, status pills */
  --radius-md:   4px;   /* inputs, buttons, dropdowns */
  --radius-lg:   6px;   /* command palette, panels */

  /* ── Motion ── */
  --duration-instant:  0ms;
  --duration-fast:    80ms;   /* command palette open */
  --duration-normal: 120ms;   /* panel slide-in */
  --duration-slow:   150ms;   /* sidebar collapse */
  --ease-out:  cubic-bezier(0, 0, 0.2, 1);
  --ease-snap: cubic-bezier(0.4, 0, 0.2, 1);
}

/* ── shadcn/ui semantic token override ── */
/* shadcn reads these variable names. Map them to XEVO tokens. */
:root {
  --background:         var(--color-base);
  --foreground:         var(--color-text-primary);
  --card:               var(--color-surface);
  --card-foreground:    var(--color-text-primary);
  --popover:            var(--color-elevated);
  --popover-foreground: var(--color-text-primary);
  --primary:            var(--color-accent);
  --primary-foreground: #ffffff;
  --secondary:          var(--color-elevated);
  --secondary-foreground: var(--color-text-secondary);
  --muted:              var(--color-surface);
  --muted-foreground:   var(--color-text-muted);
  --accent:             var(--color-hover);
  --accent-foreground:  var(--color-text-primary);
  --destructive:        var(--color-dead);
  --destructive-foreground: #ffffff;
  --border:             var(--color-border);
  --input:              var(--color-elevated);
  --ring:               var(--color-accent);
  --radius:             var(--radius-md);
}
```

### Color rules

- Use `--color-accent` (#3b82f6) only for interaction signals: focus rings, the
  active tab underline, active sidebar item left-border, and URL/link text.
  Never use it as a background.
- Use `--color-live` / `--color-dead` only for server status. Never reuse them
  for unrelated success/error states — they are reserved so the liveness system
  stays distinct and trustworthy.
- HTTP method and status colors exist for network log and API tester only. They
  are always displayed as a colored text badge against `--color-elevated` bg.
- The three background layers have a strict hierarchy: `base` → `surface` →
  `elevated`. Popovers and command palette are always `elevated`. Never invert
  this stack.

---

## 3. Typography

### Typefaces

| Role | Font | Where |
|---|---|---|
| UI chrome | Inter 13px | Tab labels, sidebar items, toolbar labels, settings |
| Data / technical | JetBrains Mono 12px | URLs, ports, headers, status codes, sizes, timings, JWT, Base64, request bodies |
| Section labels | Inter 10px UPPERCASE | Sidebar section headers ("WORKSPACES", "LIVE SERVERS") |
| Monospace display | JetBrains Mono 11px | Address bar URL when not focused |

**Load Inter from Bunny Fonts (zero telemetry, GDPR-clean, fast CDN):**
```html
<link rel="preconnect" href="https://fonts.bunny.net">
<link href="https://fonts.bunny.net/css?family=inter:400,500,600|jetbrains-mono:400,500&display=swap" rel="stylesheet">
```

### Weight roles — three weights only

- `400` — all data values, body text, URL contents, request bodies
- `500` — interactive labels (tab titles, buttons, sidebar workspace names)
- `600` — section headers, panel titles, active workspace name

### Scale

Never exceed 14px for chrome UI. The webview should feel large by contrast.

| Name | Size | Weight | Use |
|---|---|---|---|
| `text-xs` | 10px | 400–500 | Sidebar section labels (uppercase), status bar |
| `text-sm` | 12px | 400 | Network log rows, API response data, port numbers |
| `text-base` | 13px | 400–500 | Tab labels, toolbar controls, sidebar items, inputs |
| `text-md` | 14px | 500–600 | Panel section titles, settings headings |

### Monospace rules

Use `--font-mono` (JetBrains Mono) for every value that is a technical artifact:
- All URLs and URL components
- All port numbers (`:3000`, `:8080`)
- HTTP status codes (`200`, `404`)
- Response sizes (`4.2 kB`) and timings (`142 ms`)
- All HTTP headers (both key and value)
- JWT tokens, Base64 strings, API keys
- JSON response bodies
- Cookie values

Use `font-feature-settings: "tnum" 1` on all numeric columns in the network log
and API tester so sizes and timings align at their decimal points.

---

## 4. Layout Architecture

### Top-level grid

```
┌──────────────────────────────────────────────────────────────┐
│  TAB BAR (36px)          data-tauri-drag-region              │
│  [← →] [tabs...] [+ New Tab]              [win controls]     │
├──────────────────────────────────────────────────────────────│
│  TOOLBAR (40px)                                              │
│  [←][→][↻] [  address bar...........................  ] [⋮]  │
├────────────────────────┬─────────────────────────────────────│
│                        │                                     │
│  SIDEBAR               │   WEBVIEW                           │
│  220px default         │   fills all remaining space         │
│  (collapsible)         │   border: none, overflow: hidden    │
│                        │                                     │
│  ── WORKSPACES ──      ├─────────────────────────────────────│
│  ○ Project Alpha       │                                     │
│  ● My SaaS App    ◄─   │   BOTTOM PANEL                      │
│  ○ API Testing         │   (network log / API tester /       │
│                        │    dev panels — resizable)          │
│  ── LIVE SERVERS ──    │   min-height: 120px                 │
│  ● :3000 Frontend      │   max-height: 60% of window         │
│  ● :8080 API           │                                     │
│  ○ :5173 Vite          │                                     │
│                        │                                     │
├────────────────────────┴─────────────────────────────────────│
│  STATUS BAR (24px)                                           │
└──────────────────────────────────────────────────────────────┘
```

### CSS layout (root shell)

```tsx
// App.tsx root shell
<div
  className="flex flex-col h-screen overflow-hidden bg-base text-text-primary select-none"
  style={{ fontFamily: 'var(--font-ui)' }}
>
  <TabBar />           {/* 36px, data-tauri-drag-region */}
  <Toolbar />          {/* 40px */}
  <div className="flex flex-1 overflow-hidden">
    <Sidebar />        {/* 220px collapsible */}
    <div className="flex flex-col flex-1 overflow-hidden">
      <WebviewArea />  {/* flex-1 */}
      <BottomPanel />  {/* resizable, hidden by default */}
    </div>
  </div>
  <StatusBar />        {/* 24px */}
</div>
```

### Zone separation

All zone boundaries use a single `1px solid var(--color-border)` line. No
shadows between zones. No gradients as zone separators. The tab bar / toolbar
split uses a border-bottom on the toolbar. The sidebar / content split uses a
border-right on the sidebar.

---

## 5. Tauri 2 Platform Constraints

These rules are mandatory. Violating them breaks the native desktop experience.

### Window decoration

In `src-tauri/tauri.conf.json`:
```json
{
  "app": {
    "windows": [{
      "decorations": false,
      "transparent": false
    }]
  }
}
```

### Drag region

The tab bar row is the window drag region. Apply `data-tauri-drag-region` to the
tab bar container element. **Do not apply it to the tab items, the new-tab
button, the address bar, or any input.** `data-tauri-drag-region` applies only to
the element it is directly on — it does not inherit to children.

```tsx
<div
  className="flex h-[36px] items-center bg-surface border-b border-border"
  data-tauri-drag-region
>
  {/* tabs go here — they are NOT drag regions */}
  {tabs.map(tab => <TabItem key={tab.id} tab={tab} />)}
</div>
```

### OS-specific window control clearance

Use the `tauri-controls` package for native-looking window buttons:
```
pnpm add tauri-controls
```

The tab bar needs padding to avoid controls overlapping tabs:
- **macOS**: traffic lights appear on the LEFT. Reserve `padding-left: 80px`.
- **Windows**: controls appear on the RIGHT. Reserve `padding-right: 140px`.
- **Linux (GNOME)**: controls on RIGHT. Reserve `padding-right: 120px`.

Detect the OS at runtime:
```tsx
import { platform } from '@tauri-apps/plugin-os';
// returns 'macos' | 'windows' | 'linux'
```

### No browser storage

`window.localStorage` and `window.sessionStorage` are not available (Tauri's
security model). All persistence goes through Zustand stores → Tauri IPC →
Rust commands → JSON files. Never write `localStorage` or `sessionStorage`
anywhere in the codebase.

### Global CSS rules for desktop feel

```css
* {
  -webkit-user-select: none;
  user-select: none;
  -webkit-user-drag: none;
}

/* Allow text selection only inside webview and text inputs */
input, textarea, [contenteditable], .selectable {
  -webkit-user-select: text;
  user-select: text;
}

/* Kill scroll bounce on root */
html, body, #root {
  overflow: hidden;
  height: 100vh;
  width: 100vw;
}
```

---

## 6. Component Patterns

### Tab bar item

```
Height: 36px  |  Padding: 0 12px  |  Max-width: 180px  |  Font: 13px/500

States:
  inactive   bg-transparent, text-text-muted, hover: bg-hover
  active     bg-base, text-text-primary, border-bottom: 2px solid --color-accent
  loading    favicon replaced with 12px spinner (see Spinner below)
  pinned     max-width: 40px, no title shown

Anatomy (left → right):
  [favicon 14px] [title truncate flex-1] [× close 14px, show on hover only]

Close button:
  - Opacity 0 by default, opacity 100 on tab:hover and active tabs
  - Size: 16px × 16px clickable area, 10px × icon
  - On hover: bg-hover rounded-sm
```

```tsx
// Tab item structure
<div className={cn(
  "flex items-center gap-1.5 h-[36px] px-3 border-b-2 text-[13px] font-medium",
  "cursor-default select-none shrink-0 max-w-[180px] group/tab",
  isActive
    ? "bg-[var(--color-base)] text-[var(--color-text-primary)] border-[var(--color-accent)]"
    : "bg-transparent text-[var(--color-text-muted)] border-transparent hover:bg-[var(--color-hover)] hover:text-[var(--color-text-secondary)]"
)}>
  <img src={tab.favicon} className="w-3.5 h-3.5 shrink-0" />
  <span className="truncate flex-1">{tab.title}</span>
  <button
    onClick={closeTab}
    className="opacity-0 group-hover/tab:opacity-100 w-4 h-4 flex items-center justify-center
               rounded-[2px] hover:bg-[var(--color-active)] shrink-0"
  >
    <X size={10} />
  </button>
</div>
```

### Address bar / toolbar

```
Toolbar height: 40px  |  bg: var(--color-surface)  |  border-bottom: 1px border

Input:
  Height: 28px  |  max-width: 680px  |  width: 40% of toolbar (min 320px)
  Font: JetBrains Mono 12px when not focused (shows URL cleanly)
       Inter 13px when focused (easier to type)
  Border: 1px solid var(--color-border)
  Focused: ring-1 ring-[var(--color-accent)]
  Radius: var(--radius-md) = 4px
  Padding: 0 10px
  Left slot: 🔒 lock icon (14px, text-muted) OR ⚠ warning icon if HTTP
  Right slot: loading spinner when navigating
```

```tsx
<div className="h-[40px] flex items-center gap-2 px-3 bg-surface border-b border-border">
  {/* nav buttons */}
  <NavButton icon={<ArrowLeft size={14} />} onClick={goBack} />
  <NavButton icon={<ArrowRight size={14} />} onClick={goForward} />
  <NavButton icon={<RotateCw size={14} />} onClick={reload} />

  {/* address bar — centered, max-width constrained */}
  <div className="flex-1 flex justify-center">
    <div className="relative w-full max-w-[680px]">
      <LockIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" size={13} />
      <input
        className={cn(
          "w-full h-[28px] bg-elevated rounded-[4px] border border-border",
          "pl-8 pr-3 text-[12px] font-mono text-text-primary",
          "focus:outline-none focus:ring-1 focus:ring-accent focus:font-sans focus:text-[13px]",
          "placeholder:text-text-disabled"
        )}
      />
    </div>
  </div>

  {/* right-side toolbar actions */}
  <ToolbarButton icon={<MoreHorizontal size={14} />} />
</div>
```

### Sidebar

```
Width: 220px default  |  bg: var(--color-surface)  |  border-right: 1px border
Collapsed: 40px  |  show workspace icon + dot indicator only

Section header:
  Height: 28px  |  padding: 0 12px  |  font: Inter 10px UPPERCASE
  letter-spacing: 0.08em  |  color: text-muted  |  font-weight: 500

Workspace item:
  Height: 28px  |  padding: 0 12px
  Active:   left-border 2px solid (workspace color), bg-hover, text-primary/500
  Inactive: text-secondary/400, hover: bg-hover, text-primary

Server item:
  Height: 28px  |  padding: 0 12px
  Left: 6px status dot (live/dead/warn)
  Label: port number in monospace (e.g. ":3000")
  Right: name label in muted text if named
  
Liveness dot:
  6px × 6px, border-radius: 50%
  alive: background: var(--color-live), box-shadow: 0 0 6px var(--color-live-glow)
  dead:  background: var(--color-dead), no glow
  The glow is the signature. It is the only decorative effect in the whole app.
```

```tsx
// Liveness dot
<span className={cn(
  "inline-block w-1.5 h-1.5 rounded-full shrink-0",
  isAlive
    ? "bg-[var(--color-live)] shadow-[0_0_6px_var(--color-live-glow)]"
    : "bg-[var(--color-dead)]"
)} />
```

### Network log row

```
Row height: 28px  |  font: 12px  |  hover: bg-hover

Columns (fixed widths, monospace for all numeric/code data):
  METHOD  45px  colored text badge (see method colors), font: mono 11px uppercase
  STATUS  44px  colored text, font: mono, font-feature-settings: tnum
  URL     flex-1, truncate from right, font: mono 12px
  SIZE    64px  right-aligned, mono, tnum (e.g. "4.2 kB")
  TIME    64px  right-aligned, mono, tnum (e.g. "142 ms")

Method badge: no background, just colored text in a 45px fixed-width cell
Status: color by range (2xx green, 3xx amber, 4xx red, 5xx purple)
URL: show path only by default, full URL on hover title or when expanded
```

```tsx
<div className="flex items-center h-[28px] px-3 gap-4 hover:bg-hover cursor-default text-[12px]">
  <span
    className="w-[45px] shrink-0 font-mono text-[11px] uppercase tracking-wide"
    style={{ color: `var(--color-method-${req.method.toLowerCase()})` }}
  >
    {req.method}
  </span>
  <span
    className="w-[44px] shrink-0 font-mono tabular-nums"
    style={{ color: `var(--color-status-${statusRange(req.status)})` }}
  >
    {req.status}
  </span>
  <span className="flex-1 font-mono truncate text-text-secondary">
    {req.url}
  </span>
  <span className="w-16 text-right font-mono tabular-nums text-text-muted shrink-0">
    {req.size}
  </span>
  <span className="w-16 text-right font-mono tabular-nums text-text-muted shrink-0">
    {req.duration}
  </span>
</div>
```

### Command palette

```
Trigger: Cmd/Ctrl + K  |  Overlay: bg-base/60 backdrop
Panel: max-width 560px, centered, bg-elevated, border border-border, radius-lg (6px)
Input: height 44px, border-bottom border-border, font: Inter 14px/400
Results list: max-height 320px, overflow-y scroll

Category header:
  height: 24px, font: Inter 10px UPPERCASE, text-muted, padding: 0 12px, letter-spacing 0.08em

Result item:
  height: 32px, padding: 0 12px, flex items-center gap-3
  Icon: 14px, text-muted
  Label: Inter 13px/400, text-primary
  Hint (right): Inter 11px/400, text-disabled (keyboard shortcut)
  Selected: bg-accent-dim, icon and label go text-primary
  
Open animation: 80ms fade + scale from 0.97 to 1.0
```

```tsx
<div className="fixed inset-0 bg-black/40 flex items-start justify-center pt-[15vh] z-50">
  <div className="w-full max-w-[560px] bg-elevated border border-border rounded-[6px] overflow-hidden shadow-2xl">
    <input
      autoFocus
      className="w-full h-11 px-4 bg-transparent border-b border-border font-sans
                 text-[14px] text-text-primary placeholder:text-text-disabled
                 focus:outline-none"
      placeholder="Search tabs, bookmarks, commands..."
    />
    <div className="max-h-[320px] overflow-y-auto">
      {/* result items */}
    </div>
  </div>
</div>
```

### Buttons (toolbar, panel actions)

```
Default (ghost icon button in toolbar):
  Size: 28px × 28px  |  icon: 14px  |  radius: 4px  |  color: text-muted
  Hover: bg-hover, text-primary
  Active: bg-active, text-primary

Small text button (inside panels):
  Height: 24px  |  padding: 0 8px  |  font: 12px/500  |  radius: 4px
  Variants: ghost (default), outline (border-border)

Destructive: text-dead on hover only, never a red background in chrome
```

### Panel header (network log, API tester, etc.)

```
Height: 32px  |  bg: surface  |  border-bottom: border  |  padding: 0 12px
Left: panel title (Inter 12px/500, text-secondary)
Right: action buttons (28px icon buttons), close button

Resizable panel handle:
  4px height  |  bg: transparent  |  hover: bg-border  |  cursor: row-resize
  Placed at the top edge of the bottom panel
```

### Status indicators / badges

```
HTTP method: text-only, colored per method, font-mono uppercase 11px
Status code: text-only, colored per range, font-mono 12px
Server alive/dead: dot only (6px) — never text label for status
HTTPS/HTTP: lock icon in address bar — no text label
Environment badge (V2): small pill, 2px radius
  Local → green text on green/8 bg
  Staging → amber text on amber/8 bg
  Prod → red text on red/8 bg
```

---

## 7. Motion Rules

- Row hover background: **0ms** — instant. Latency here is annoying.
- Tab switch: **0ms** — instant. Webview already handles its own transition.
- Command palette open: **80ms** fade-in + scale(0.97 → 1.0), `ease-out`.
- Bottom panel open/close: **120ms** translate-Y, `ease-out`.
- Sidebar collapse/expand: **150ms** width transition, `ease-snap`.
- Notifications / toasts: **100ms** slide-in from bottom-right.
- All other UI: default to **0ms**. Add motion only when it helps orientation.

No spring physics, no bounce, no momentum scrolling on any chrome element.
No page-load animation. The app opens instantly.

---

## 8. Spacing Philosophy

XEVO is a tool open for 8+ hours. Padding is a cost the developer pays
continuously in eye travel. Use the densest spacing that remains comfortable:

| Zone | Padding |
|---|---|
| Toolbar buttons | 0 (28×28px click target, icon only) |
| Toolbar input | 0 10px |
| Sidebar items | 0 12px |
| Network log rows | 0 12px (handled by column widths) |
| Panel headers | 0 12px |
| Command palette items | 0 12px |
| Settings form rows | 12px 16px |

No `p-4` (16px padding) in any chrome element. `p-3` (12px) is the maximum.
`p-2` (8px) is standard. `p-1.5` (6px) is fine for tight areas.

---

## 9. Hard Rules — Never Do These

1. **No `rounded-xl` or `rounded-2xl`** anywhere in chrome UI. Max: `rounded`
   (4px). XEVO is a tool not a consumer app. Soft corners contradict its identity.

2. **No `shadow-*` utilities for elevation**. Depth is created by background
   color stepping (`base` → `surface` → `elevated`), not by shadows. The only
   permitted shadow is the liveness dot glow and the command palette (`shadow-2xl`
   for the drop shadow under the palette itself).

3. **No `backdrop-blur`**. Too GPU-heavy for a sub-10MB binary claim. Use
   `bg-base/80` (opacity) if you need overlay backgrounds.

4. **No `hover:scale-*`** on any chrome element. Scale animations on tool chrome
   feel playful and wrong. Hover state = background color change only.

5. **No motion longer than 150ms** on any chrome interaction. Developer tools
   live in the peripheral vision of a focused developer. Slow motion is a
   distraction.

6. **No gradient backgrounds** on chrome (toolbar, sidebar, tab bar, panels).
   Gradients are permitted only on the new-tab/localhost quick-bar page.

7. **No placeholder lorem ipsum**. Any content visible in dev mode uses real
   XEVO content (real port numbers, real method names, real example URLs like
   `localhost:3000/api/users`).

8. **No `localStorage`/`sessionStorage`**. All state through Zustand + Tauri IPC.

9. **No `window.*` browser APIs** that assume a browser context without checking
   `window.__TAURI__` exists. Gate all Tauri-specific calls.

10. **Do not use the default shadcn Tab component for the browser tab bar**.
    shadcn Tabs renders content panels — it is for settings screens, not browser
    tabs. The browser tab bar is a custom component with Zustand driving active
    state and the webview rendering elsewhere.

---

## 10. New Tab Page (Localhost Quick Bar)

This is the one screen where the design skill relaxes. The new tab page is not
chrome — it is content. It is XEVO's "hero" moment and the one place where
typographic scale, spacing, and a subtle gradient are permitted.

**Layout:** Centered column, max-width 720px, vertically centered at 40% of
viewport height.

**Heading:** "Your stack, at a glance." — Inter 24px/600, text-primary,
tracking-tight.

**Live server cards:** 64px height, bg-elevated, border-border, radius-md.
Left: liveness dot + port in mono. Right: server name (if set) + "Open →" link.

**Empty state:** "No servers detected. Start your dev server and XEVO will find
it." — Inter 13px/400, text-muted, italic. No illustration, no empty-state art.

**Signature here:** Ambient gradient in the background — a very subtle
radial gradient from `var(--color-live-glow)` at 0% opacity to transparent,
centered under the live server cards. It is the only gradient in the app.
It pulses with a 3s infinite opacity animation (0.15 → 0.25 → 0.15).
Respect `prefers-reduced-motion: reduce`.

---

## 11. Icon System

Use Lucide React icons throughout. They are already in the shadcn/ui ecosystem
and consistent in weight. Size conventions:

| Context | Size |
|---|---|
| Toolbar buttons | 14px |
| Sidebar items | 14px |
| Tab close button | 10px |
| Panel headers | 14px |
| Status bar | 12px |
| Command palette results | 14px |
| Address bar security icon | 13px |

Color: `text-text-muted` by default. `text-text-primary` on hover/active.
Never use colored icons except for the liveness dot and HTTP method text.

---

## 12. Quick shadcn/ui Component Map

Reference for which shadcn component to use for each XEVO feature:

| XEVO Feature | Use | Notes |
|---|---|---|
| Command palette | `cmdk` (Command) | Install separately: `pnpm add cmdk` |
| Settings tabs | shadcn Tabs | Not for browser tabs |
| Context menus | shadcn ContextMenu | Right-click on tabs, requests |
| Tooltips (shortcuts) | shadcn Tooltip | Add keyboard shortcut in content |
| Bottom panel resize | shadcn ResizablePanelGroup | `pnpm add react-resizable-panels` |
| Popovers (overflow menus) | shadcn Popover | Toolbar `⋮` menu |
| Toast notifications | shadcn Sonner | Page load errors, copy confirmations |
| Dropdowns (search engine etc) | shadcn DropdownMenu | Settings controls |
| Inputs | shadcn Input | Apply mono font override for address bar |
| Scrollarea | shadcn ScrollArea | All panel lists — hides ugly native scrollbars |

---

## 13. Accessibility Baseline

Even though XEVO's audience are developers (who generally have working vision),
these are non-negotiable:

- All interactive elements reachable by keyboard. Tab order follows visual order.
- All icon-only buttons have `aria-label`. Tooltips reinforce these.
- Focus ring: `ring-2 ring-[var(--color-accent)] ring-offset-1
  ring-offset-[var(--color-base)]` on any focused element.
- Color is never the only differentiator: HTTP method cells show text AND color.
  Server status shows dot AND the port is dim when dead.
- All animations respect `@media (prefers-reduced-motion: reduce)`.
- Minimum contrast on all text: 4.5:1 for `text-text-muted` against surfaces.

---

## 14. Checklist Before Shipping Any Component

Before considering a component done, verify:

- [ ] Uses tokens from section 2, not hardcoded hex values
- [ ] Monospace font applied to all technical data (URLs, codes, sizes, times)
- [ ] Row height matches section 6 spec (28px, 32px, 36px, 40px, 24px)
- [ ] No `rounded-xl`, no `shadow-*` (except where explicitly permitted)
- [ ] No `localStorage`
- [ ] `data-tauri-drag-region` is on the tab bar container, not on tab items
- [ ] Interactive elements have `aria-label` if icon-only
- [ ] Hover state is a background color change, not scale
- [ ] No animation > 150ms
- [ ] The liveness dot in the sidebar uses the glow (it is the signature)
