# DEVBROWSER — Full Project Guide & Specification
> **This document is the single source of truth for this project.**
> Paste it at the start of every AI conversation to restore full context.
> Last updated: May 2026

---

## QUICK CONTEXT SNAPSHOT (for AI sessions)
> Copy-paste this block at the start of any new AI chat:

```
We are building an open-source, free, Tauri 2 + Rust + React developer browser
called DEVBROWSER. It is a minimal, lightweight (<10MB) desktop browser built
specifically for web developers. Zero account, zero telemetry, zero bloat.
It competes with Polypane (paid) and is different from Responsively (only responsive testing).
Our core angle is: full localhost dev workflow in a tiny Tauri binary.
Stack: Tauri 2, Rust (backend), React 19, TypeScript, Vite, Tailwind v4, shadcn/ui, Zustand.
The project guide is in DEVBROWSER_PROJECT_GUIDE.md. Ask me to paste relevant sections.
```

---

## 1. PROJECT IDENTITY

**Name:** XEVO 
**Tagline:** "Your browser. Built for building."
**License:** MIT (open source, forever free)
**Platform:** Windows, macOS, Linux (via Tauri 2)
**Binary size target:** Under 10MB installed
**Account required:** Never
**Telemetry:** Never

---

## 2. THE PROBLEM

Every web developer uses Chrome or Firefox as their dev browser. These are
consumer browsers — built for billions of people who shop, watch videos, and
scroll feeds. Developers then try to bolt dev workflows on top using:

- Extensions that break with every update
- DevTools panels they open and close 50 times a day
- Separate tools for API testing (Postman/Insomnia)
- Browser tabs with no project organization
- Having to type localhost:3000 every single time
- No memory of which servers belong to which project

The result: a developer's browser is a bloated, tab-infested, account-gated
mess that was never designed for them.

**The existing "solutions" all fail in one way:**
- **Polypane** — paid ($9/mo), closed source, account required, Chromium-based (heavy)
- **Responsively App** — free, open source, but ONLY does responsive multi-viewport testing. Built on Electron (150MB+). Does nothing for localhost workflow, API testing, or workspaces.
- **Sizzy** — paid, focused only on responsive design, closed source
- **Min Browser** — open source, minimal, but built for regular users. No dev features at all.
- **Chrome DevTools** — powerful but buried, resets every session, not a workflow

**No one has built a free, open-source, lightweight browser that handles the
full day-to-day developer workflow from a clean, minimal interface.**
That is the gap. That is DEVBROWSER.

---

## 3. WHO THIS IS FOR

**Primary users:**
- Frontend developers (React, Vue, Svelte, Angular, vanilla)
- Full-stack developers building web apps locally
- Indie hackers and solo developers
- Freelancers managing multiple client projects
- Developer students learning web development

**Secondary users:**
- Backend developers who occasionally test APIs in a browser
- QA engineers doing lightweight manual testing
- Design engineers who care about responsive layouts

**NOT built for:**
- Regular non-developer users (no sync, no extensions marketplace)
- Heavy enterprise teams (that's Polypane's turf)
- People who need full Chrome DevTools power (just use Chrome)

**The perfect DEVBROWSER user is someone who:**
1. Has 2-5 projects they work on regularly
2. Constantly types localhost:3000 (or some port)
3. Uses Postman or the Network tab for API testing
4. Opens Chrome only for devtools and hates the bloat
5. Has complained at least once about tab management

---

## 4. COMPETITION ANALYSIS (DETAILED)

### 4.1 Responsively App
- **GitHub:** github.com/responsively-org/responsively-app (~24.9k stars)
- **Stack:** Electron + React
- **Size:** ~150MB (Electron)
- **Free:** Yes, open source (AGPL-3.0)
- **Account:** Not required
- **What it does:** Multi-viewport responsive testing. Shows your site in
  multiple device sizes simultaneously. Click sync across viewports.
- **What it DOESN'T do:** Localhost detection, workspaces, API testing,
  network log, request headers, command palette, environment switching
- **Weakness:** Electron bloat, single-purpose, no dev workflow features
- **Our edge:** Everything it doesn't do, plus Tauri's 15x smaller binary

### 4.2 Polypane
- **Website:** polypane.app
- **Stack:** Chromium (closed source)
- **Price:** $9/mo individual, $54/mo team of 10
- **Account:** Required
- **What it does:** Multi-viewport testing, accessibility checker (80+ tests),
  20+ debug tools, meta inspector, color blindness simulation, full devtools
- **What it DOESN'T do:** Be free, be open source, be lightweight, API testing
- **Weakness:** Paid, account-gated, not open source, heavy
- **Our edge:** Free forever, open source, no account, Tauri-based

### 4.3 Sizzy
- **Stack:** Electron (closed source)
- **Price:** Paid
- **What it does:** Responsive design testing
- **Our edge:** Same as Responsively edge + free

### 4.4 Min Browser
- **GitHub:** github.com/minbrowser/min
- **Stack:** Electron + JS/CSS
- **What it does:** Minimal UI for regular browsing, ad blocking, focus mode,
  tab tasks. For normal users who want a clean browser.
- **What it DOESN'T do:** Any developer features
- **Our edge:** Totally different audience

### 4.5 Competitive Summary
DEVBROWSER is positioned at the intersection no one occupies:
- Free ✅ (vs Polypane)
- Open Source ✅ (vs Polypane, Sizzy)
- Lightweight <10MB ✅ (vs all Electron-based tools)
- Full dev workflow ✅ (vs Responsively which only does responsive)
- No account ✅ (vs Polypane)
- No telemetry ✅ (vs most tools)

---

## 5. DESIGN PRINCIPLES

These rules govern every feature decision. If a proposed feature breaks one
of these, it either gets redesigned or dropped.

1. **Tiny binary, always.** Every dependency gets challenged.
   "How much does this add to the binary? Is it worth it?"
2. **Zero friction for the first use.** Open the app, start browsing.
   No setup wizard, no account screen, no permissions popup.
3. **Localhost is a first-class citizen.** The app should feel like it was
   built *for* localhost, not that localhost is an afterthought.
4. **Keyboard-first.** Everything reachable without a mouse.
5. **No telemetry, no accounts, no cloud, ever.** All data lives locally.
6. **Features serve developers, not general users.**
   If a feature would confuse a non-developer, that's fine.
7. **Minimal by default, powerful when needed.**
   Advanced features exist but are hidden until you need them.
8. **Ship working features, not half-built ones.**
   Better to have 5 features that work perfectly than 15 that are buggy.

---

## 6. TECHNICAL STACK

### 6.1 Core Technologies
| Layer | Technology | Reason |
|---|---|---|
| Desktop Framework | Tauri 2 | ~3-10MB binary, Rust backend, uses OS webview |
| Backend | Rust | Performance, memory safety, tiny binary |
| Frontend UI | React 19 + TypeScript | Component model, large ecosystem |
| Build Tool | Vite | Fast HMR in dev |
| Styling | Tailwind v4 | Utility-first, no extra CSS runtime |
| Components | shadcn/ui | Copy-paste components, no dependency bloat |
| State | Zustand | Lightweight, simple, no boilerplate |
| Webview (Windows) | WebView2 (Chromium) | Ships with Windows 11, evergreen |
| Webview (macOS) | WKWebView (WebKit) | OS-native, no bundling |
| Webview (Linux) | WebKitGTK | OS-native |

### 6.2 Why Tauri Over Electron
- Electron bundles the entire Chromium engine (~100MB+ overhead)
- Tauri uses the OS webview already installed — adds ~3MB
- Rust backend is faster and uses less RAM than Node.js
- Security model is stricter by default (allowlist-based)
- Same frontend stack (React/Vue/etc.)

### 6.3 Project Structure
```
devbrowser/
├── src/                          # Frontend (React + TypeScript)
│   ├── components/               # UI components
│   │   ├── browser/              # Webview, tab bar, address bar
│   │   ├── sidebar/              # Workspace panel, server list
│   │   ├── panels/               # Network log, API tester, etc.
│   │   └── ui/                   # shadcn/ui components
│   ├── stores/                   # Zustand state stores
│   │   ├── tabs.ts               # Tab management state
│   │   ├── workspaces.ts         # Workspace state
│   │   ├── network.ts            # Network log state
│   │   └── settings.ts           # App settings
│   ├── hooks/                    # Custom React hooks
│   ├── utils/                    # Utility functions
│   └── App.tsx                   # Root component
├── src-tauri/                    # Rust backend
│   ├── src/
│   │   ├── main.rs               # Tauri app entry
│   │   ├── commands/             # Tauri commands (IPC)
│   │   │   ├── ports.rs          # Port scanning
│   │   │   ├── network.rs        # Request interception
│   │   │   ├── storage.rs        # Workspace persistence
│   │   │   └── system.rs         # OS-level commands
│   │   └── lib.rs
│   ├── tauri.conf.json
│   └── Cargo.toml
├── package.json
├── vite.config.ts
└── README.md
```

### 6.4 Data Storage
- All data is local. No cloud, no remote sync.
- Workspaces, settings, bookmarks, request history → stored via Tauri's
  app data directory (OS-native: AppData on Windows, ~/.config on Linux, etc.)
- Format: JSON files (human-readable, easy to backup/share)
- No SQLite for v1 (adds complexity). Switch if JSON gets slow.

---

## 7. FEATURE SPECIFICATION (COMPLETE)

This is the exhaustive feature list. Features are grouped by area.
Each has a priority: **[CORE]** = must have v1, **[V2]** = second major version,
**[V3]** = future/stretch goal.

---

### 7.1 CORE BROWSER ENGINE

**Address Bar** [CORE]
- Type URL, hit Enter to navigate
- Auto-prefixes https:// if no protocol entered
- Auto-detects if input is search query vs URL
- Configurable default search engine (Google, DuckDuckGo, Bing, custom)
- Shows loading progress
- Shows security indicator (lock icon for HTTPS)
- Editable path segments (click to edit)
- Keyboard shortcut to focus (Ctrl/Cmd + L)
- URL history autocomplete (from session history)
- Shows current page title when not focused

**Tab System** [CORE]
- Open new tab (Ctrl/Cmd + T)
- Close tab (Ctrl/Cmd + W)
- Reopen last closed tab (Ctrl/Cmd + Shift + T)
- Switch tabs (Ctrl/Cmd + 1-9, Ctrl/Cmd + Tab)
- Duplicate tab
- Pin tab (pinned tabs stay small, don't close accidentally)
- Mute tab
- Move tab between workspaces
- Tab favicon + title display
- Tab loading animation
- Drag to reorder tabs
- Middle-click to close
- Right-click context menu (duplicate, pin, move to workspace, close others)

**Navigation** [CORE]
- Back button (Alt + Left)
- Forward button (Alt + Right)
- Reload (Ctrl/Cmd + R)
- Hard reload / clear cache (Ctrl/Cmd + Shift + R)
- Stop loading (Escape)
- Home page (configurable, defaults to blank or localhost panel)

**Find In Page** [CORE]
- Ctrl/Cmd + F opens find bar
- Highlight all matches
- Navigate between matches
- Case-sensitive option
- Regex option (power user toggle)

**Zoom** [CORE]
- Zoom in (Ctrl/Cmd + +)
- Zoom out (Ctrl/Cmd + -)
- Reset zoom (Ctrl/Cmd + 0)
- Per-tab zoom memory (optional)

**History** [CORE]
- In-session history (back/forward)
- Full browsable history panel (Ctrl/Cmd + H)
- Search history
- Clear history
- History is local only, never sent anywhere
- Optional: disable history entirely (stealth mode)

**Bookmarks** [CORE]
- Add bookmark (Ctrl/Cmd + D)
- Bookmark bar (toggle show/hide)
- Bookmark folders
- Import/export bookmarks (JSON format)
- Workspace-scoped bookmarks (bookmarks belong to a workspace)
- Quick bookmark search (in command palette)

**Downloads** [CORE]
- Download files
- Show download progress
- Download manager panel
- Open downloaded files / show in folder
- Clear download history

**Keyboard Shortcuts** [CORE]
- Full keyboard shortcut reference panel (Ctrl/Cmd + ?)
- All major actions have shortcuts
- Custom shortcut rebinding (V2)

---

### 7.2 LOCALHOST & DEV SERVER MANAGEMENT

**Auto Port Scanner** [CORE]
This is one of the most unique features. When the app starts, it silently
scans common localhost ports in the background.

- Scans these ports automatically: 3000, 3001, 3002, 4000, 4200 (Angular),
  5000, 5001, 5173 (Vite), 5174, 6006 (Storybook), 8000, 8080, 8081,
  8888 (Jupyter), 9000, 9229 (Node debug), 4321 (Astro), 1313 (Hugo),
  8787 (Cloudflare Workers), 3333, 4444, 7000, 7001
- Scan happens every 10 seconds (configurable)
- Detected servers show in a "Live Servers" sidebar panel
- Each server entry shows: port number, protocol (http/https), response status
- Click any detected server to open it as a new tab
- Custom ports can be added manually
- Option to name a port (e.g., "Frontend :3000", "API :8080")
- Named ports persist across sessions
- Visual indicator: green = server is up, red = server is down
- History: remember ports that were used even if not currently running

**Localhost Quick Bar** [CORE]
- A dedicated "Start" page that shows live local servers
- Replaces the new tab page
- Shows: named servers, recent localhost URLs, pinned servers
- One-click to open any server
- Grouped by project workspace if assigned

**Localhost Aliases** [V2]
- Assign friendly names to localhost:PORT combos
- e.g., "MyShop Frontend" → localhost:3000
- e.g., "MyShop API" → localhost:8080
- These names show in tab titles and address bar
- Aliases are workspace-specific

**Local File Server** [V2]
- Drag and drop a folder onto the app
- App spins up a temporary local HTTP server for that folder
- Opens it in a new tab
- Useful for testing static HTML/CSS/JS without a dev server
- One-click to stop the server
- Configurable port

---

### 7.3 PROJECT WORKSPACES

Workspaces are the core organizational unit of DEVBROWSER. Each workspace
represents a project or context.

**Workspace Basics** [CORE]
- Create a workspace (give it a name and optional color/icon)
- Switch between workspaces via sidebar or keyboard shortcut (Ctrl/Cmd + Shift + 1-9)
- Delete workspace (with confirmation)
- Rename workspace
- Duplicate workspace
- Each workspace has its own:
  - Tab set (completely isolated)
  - Bookmarks
  - Localhost pin list
  - Network log history
  - Custom headers
  - Saved API requests
  - Scratchpad/notes
  - Environment variables
  - Custom CSS rules
  - Last active tab memory

**Workspace State Persistence** [CORE]
- When you close the app, all workspaces save their state
- Reopen → exactly where you left off
- Saves: open tabs + URLs, scroll positions, active tab, pinned tabs
- Configurable: save state on close vs. always save in real-time

**Workspace Switcher** [CORE]
- Sidebar showing all workspaces with colored icons
- Click to switch
- Drag to reorder
- Show tab count per workspace
- Keyboard shortcut cycling

**Workspace Export/Import** [V2]
- Export a workspace as a JSON file
- Import a workspace from JSON
- Share workspace config with a teammate (just share the JSON)
- Useful for reproducing dev environments

**Workspace Templates** [V2]
- Save a workspace as a template
- "New workspace from template" → pre-populates localhost servers,
  bookmarks, and custom headers
- Built-in templates: "React Project", "Next.js Project", "Full-Stack"

---

### 7.4 NETWORK REQUEST LOG

This is a lite version of the Chrome Network tab — not a full DevTools
replacement, but the 20% of features you use 80% of the time.

**Request Log Panel** [CORE]
- Toggle with Ctrl/Cmd + Shift + N or from toolbar
- Shows all HTTP/HTTPS requests made by the current page
- Per-request info:
  - Method (GET, POST, PUT, DELETE, PATCH, etc.)
  - URL
  - Status code (color-coded: green 2xx, yellow 3xx, red 4xx/5xx)
  - Response size
  - Request duration (ms)
  - Content type
  - Initiator (what triggered the request)
  - Timestamp
- Filter by:
  - Method
  - Status code range
  - URL pattern (search/regex)
  - Content type (XHR, fetch, document, image, CSS, JS, font, etc.)
- Click any request to expand details:
  - Request headers
  - Response headers
  - Response body (with syntax highlighting for JSON)
  - Timing waterfall
- Clear log button
- Pause/resume log capture
- Log persists per tab across reloads (toggle)

**Copy Utilities** [CORE]
- Right-click any request → "Copy as cURL"
- Right-click any request → "Copy as fetch()"
- Right-click any request → "Copy URL"
- Right-click any request → "Copy response body"

**Export** [V2]
- Export request log as HAR (HTTP Archive) file
- Export as JSON
- Export as CSV (useful for sharing bug reports)

**Request Blocking** [V2]
- Add URL patterns to block
- Block analytics/tracking in dev (e.g., block *.google-analytics.com)
- Useful for testing "what does the page do if this API is down?"
- Per-workspace block lists

**Network Throttling** [V2]
- Presets: Offline, Slow 3G, Fast 3G, 4G
- Custom: set upload/download/latency manually
- Visual indicator in toolbar showing active throttle
- Per-tab throttling

---

### 7.5 CUSTOM HEADER INJECTION

Developers frequently need to inject headers when testing localhost APIs —
auth tokens, API keys, custom flags.

**Global Header Rules** [CORE]
- Add headers to apply to all requests matching a URL pattern
- Example: Apply `Authorization: Bearer <token>` to all requests to localhost:8080
- Header rules have: name, value, URL pattern (glob or regex), active toggle
- Multiple header rules per workspace
- Headers can override existing headers or add new ones

**Per-Workspace Headers** [CORE]
- Header rules are scoped to a workspace
- Different projects often have different auth tokens
- Workspace switching automatically applies the right headers

**Quick Token Panel** [V2]
- Dedicated "Auth Tokens" quick panel
- Paste your JWT/Bearer token once, it auto-injects everywhere in that workspace
- Token expiry detection (decode JWT, show expiry time, warn when close to expiry)
- One-click token refresh (if refresh endpoint is configured)

**Header Templates** [V2]
- Common header presets: "JSON Content-Type", "Bearer Token", "Basic Auth"
- Click to apply template, then fill in values

---

### 7.6 BUILT-IN DEVELOPER PANELS

These are the small utility tools developers open 10 times a day in Chrome
DevTools or separate apps. DEVBROWSER has them built-in as toggleable panels.

**JSON Viewer/Formatter** [CORE]
- When a URL returns a JSON response, auto-format and display it
- Collapsible tree view
- Syntax highlighting
- Copy entire JSON
- Copy path to any key (e.g., `data.users[0].email`)
- Search/filter keys
- Switch between tree view and raw text
- JSON validation indicator

**JWT Decoder** [CORE]
- Paste a JWT token into the panel
- Shows decoded header, payload, signature sections
- Highlights expiry time
- Shows time until expiry (or "Expired X minutes ago")
- Identifies token type (HS256, RS256, etc.)
- Auto-detects JWT tokens in network requests (optional)
- Does NOT verify signature (that's a security concern, not a dev tool concern)

**Base64 Tool** [CORE]
- Encode: paste text → get base64
- Decode: paste base64 → get text
- Auto-detect if input is base64 (and offer to decode)
- Handle URL-safe base64 variant

**Color Picker** [CORE]
- Pick any color from the current page (eyedropper)
- Shows color in HEX, RGB, HSL, HSB
- Copy to clipboard in any format
- Recent colors history
- Access from toolbar or Ctrl/Cmd + Shift + C

**Local Storage / Session Storage Viewer** [CORE]
- View all keys and values in localStorage
- View all keys and values in sessionStorage
- Edit values inline
- Delete individual keys
- Clear all
- JSON-aware (pretty-print JSON values)
- Refresh button

**Cookie Viewer** [CORE]
- List all cookies for current domain
- Show: name, value, domain, path, expiry, HttpOnly, Secure, SameSite
- Edit cookie values
- Delete cookies
- Add new cookie
- Export cookies as JSON

**Meta Tag Inspector** [CORE]
- Shows all `<meta>` tags from current page
- Groups: SEO, Open Graph (og:), Twitter Card, charset, viewport
- Visual preview of how the page would look when shared on Twitter/LinkedIn
- Checks for missing important tags (title, description, og:image)
- Copy any tag value

**CSS Variables Inspector** [V2]
- List all CSS custom properties (--variables) defined on the page
- Show computed value of each
- Group by scope (`:root`, component, etc.)
- Live edit: change a CSS variable value and see it reflect on the page
- Copy as CSS declaration

**Image Inspector** [V2]
- Click any image on the page to inspect it
- Shows: dimensions (natural + rendered), file format, file size (estimated),
  URL, alt text, loading strategy (lazy/eager)
- Option to open image in new tab
- Check if alt text is present (accessibility)

**Font Inspector** [V2]
- List all fonts loaded by the current page
- Show: font family name, weight, style, format (woff2, woff, etc.), file size
- Identify system fonts vs. web fonts
- Useful for finding font bloat

---

### 7.7 API TESTER (LITE POSTMAN)

A simple request builder. Not Postman — just the core of what most devs need
when testing APIs, especially localhost ones.

**Request Builder** [CORE]
- Access from sidebar or Ctrl/Cmd + Shift + A
- Fields:
  - Method: GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS
  - URL input
  - Headers: key-value table, add/remove rows
  - Body: tabs for JSON, Form Data, URL-encoded, Raw text, None
  - Body editor has JSON syntax highlighting and validation
- Send button (or Ctrl/Cmd + Enter)
- Loading state with cancel option

**Response Viewer** [CORE]
- Status code (color-coded)
- Response time
- Response size
- Response headers table
- Response body:
  - Auto-detect content type
  - JSON: formatted tree view
  - HTML: raw code with syntax highlighting
  - Image: render the image
  - Other: raw text

**Request Collections** [CORE]
- Save any request as a named entry in a collection
- Collections are workspace-scoped
- Folder organization in collections
- Rename, delete, duplicate saved requests

**Environment Variables** [V2]
- Define variables per workspace: {{BASE_URL}}, {{AUTH_TOKEN}}, {{USER_ID}}
- Use them in any request URL, header, or body: GET {{BASE_URL}}/users/{{USER_ID}}
- Multiple environments per workspace: "Development", "Staging", "Production"
- Quick switcher to change active environment
- Variables resolve at send time

**cURL Import** [CORE]
- Paste a cURL command → auto-parse into request builder fields
- Supports headers, body, method detection
- Useful when copying from Chrome DevTools or Stack Overflow

**Request History** [CORE]
- Last 100 requests shown in a history panel
- Re-run any previous request with one click
- History is workspace-scoped

**Response Comparison** [V3]
- Run same request twice (or modify slightly)
- Show diff between two responses
- Useful for catching regressions

---

### 7.8 RESPONSIVE DESIGN TOOLS

DEVBROWSER is not *only* a responsive testing tool (that's Responsively's job),
but it includes responsive tools as a feature, not its entire identity.

**Multi-Viewport Mode** [CORE]
- Toggle from toolbar: single view ↔ multi-viewport
- Show current page in multiple device sizes simultaneously
- Built-in device presets:
  - Mobile: iPhone SE (375), iPhone 14 (390), iPhone 14 Pro Max (430),
    Samsung Galaxy S23 (360), Pixel 7 (412)
  - Tablet: iPad Mini (768), iPad (820), iPad Pro 11" (1024), iPad Pro 12.9" (1366)
  - Laptop: 1280×800, 1366×768, 1440×900, 1920×1080
  - Ultra-wide: 2560×1440
- Custom viewport creator (name, width, height)
- Save custom viewports
- Toggle individual viewports on/off
- Drag to resize viewports

**Viewport Sync** [CORE]
- Scroll sync: scroll in one viewport, all others scroll too (toggle)
- Click sync: click a link in one viewport, all navigate
- Input sync: type in a form field, all viewports fill it (toggle)
- Sync pause button for temporary independent navigation

**Orientation Toggle** [V2]
- Per-viewport: toggle portrait ↔ landscape
- Swaps width/height values

**Screenshot Tool** [V2]
- Capture full-page screenshot of current tab
- Capture visible area
- Capture specific viewport in multi-viewport mode
- Save as PNG
- Copy to clipboard
- Screenshot all viewports as a single combined image (useful for reports)

**Breakpoint Inspector** [V2]
- Draws a ruler above the page showing CSS breakpoints from the loaded stylesheet
- Visual indicators at each media query breakpoint
- Click a breakpoint to set viewport to that exact width
- List view of all detected breakpoints

---

### 7.9 ENVIRONMENT SWITCHER

Developers build locally but test on staging and deploy to prod. Constantly
changing the base URL is tedious.

**Environment Profiles** [V2]
- Define environments per workspace:
  - Name: "Local", "Staging", "Production"
  - Base URL: "localhost:3000", "staging.myapp.com", "myapp.com"
  - Custom headers for that environment
  - Environment variables
- Active environment shown in toolbar
- One-click to switch environments

**URL Substitution** [V2]
- When switching environments, auto-replace the base URL in the current tab
- Example: you're on localhost:3000/users/settings
  Switch to Production → jumps to myapp.com/users/settings
- Preserves the path and query string
- Optionally ask before substituting

**Environment Indicator** [V2]
- Colored badge in the address bar: green = local, yellow = staging, red = prod
- Prevents accidentally submitting a form on prod when you thought you were on local

---

### 7.10 COMMAND PALETTE

A keyboard-driven "everything search" panel. Arc browser has this. No other
dev browser has it built-in.

**Command Palette** [CORE]
- Open with Ctrl/Cmd + K or Ctrl/Cmd + P
- Fuzzy search across:
  - Open tabs (switch to any tab instantly)
  - Bookmarks (open any bookmark)
  - History (reopen any recent page)
  - Commands (run any app action: "Open new tab", "Toggle network log", etc.)
  - Saved API requests (open request in API tester)
  - Workspaces (switch to any workspace)
  - Detected localhost servers
- Keyboard navigation (up/down arrows, Enter to select)
- Recent actions at the top
- Grouped results by category

---

### 7.11 UI & BROWSER CHROME

**Layout Options** [CORE]
- Tab bar layout: Horizontal (top, classic) or Vertical (sidebar, like Arc/Edge)
- Vertical layout: tabs as a sidebar with favicon + title truncated
- Persist last-used layout

**Compact Mode** [CORE]
- Toggle to reduce chrome UI to minimum
- Smaller toolbar, smaller tabs
- More room for page content

**Distraction-Free Mode** [V2]
- Ctrl/Cmd + Shift + F: hide all browser chrome
- Only the page is visible
- Move mouse to top → chrome slides in temporarily
- Full keyboard navigation still works

**Split View** [V2]
- Split current window into two panes
- Each pane has its own tab
- Useful for comparing two pages or referencing docs while building
- Adjustable split ratio
- Horizontal or vertical split

**Theme System** [CORE]
- Dark mode (default)
- Light mode
- System default (follow OS preference)
- Custom accent color
- Custom background color for the browser chrome

**Sidebar** [CORE]
- Left sidebar shows: workspace list, live servers panel
- Collapsible
- Width-adjustable
- Keyboard shortcut to toggle

**Status Bar** [CORE]
- Shows at bottom: page load status, zoom level, security info
- Dev mode info: shows page response time
- Clickable zones for quick actions

---

### 7.12 PRIVACY & SECURITY

**Telemetry: None** [CORE]
- Zero analytics
- Zero crash reporting (or opt-in only, never default)
- Zero user behavior tracking
- No first-launch "help us improve" prompts that collect data

**Account: None** [CORE]
- No sign-in screen
- No sync feature
- All data stays on the user's machine

**Local Data Only** [CORE]
- Workspaces, settings, history, bookmarks all in local files
- User can see, edit, backup, and delete the files directly
- No cloud dependency for any feature

**Clear on Close** [CORE]
- Optional setting: clear all browsing data (history, cookies, cache) on close
- Useful for privacy-conscious workflows

**HTTPS-Only Mode** [V2]
- Optional: block all HTTP (non-secure) connections
- Show warning when navigating to HTTP
- Auto-upgrade HTTP to HTTPS where possible

**Certificate Inspector** [V2]
- Click the lock icon → see full certificate chain
- Show expiry, issuer, SANs
- Warn on self-signed certs (with ability to proceed)
- Self-signed cert acceptance for localhost dev (without security warnings)

**User Agent Switcher** [V2]
- Switch user agent string to simulate different browsers/devices
- Presets: Chrome/Win, Firefox/Mac, Safari/iOS, Chrome/Android, Googlebot
- Custom user agent input
- Per-tab or global

**Ad/Tracker Blocking** [V2]
- Optional built-in blocklist (EasyList-based)
- Off by default (devs sometimes need to see all requests)
- Toggle per tab or globally
- Custom block patterns

---

### 7.13 DEVELOPER UTILITIES (POWER USER TOOLS)

**Custom CSS Injection** [V2]
- Inject CSS rules into any page matching a URL pattern
- Workspace-scoped rules
- Common use cases:
  - Hide cookie banners on frequently-visited sites
  - Override production styles to debug
  - Custom fonts or contrast for readability
- CSS editor with syntax highlighting
- Toggle rules on/off without deleting

**Custom JS Injection** [V2]
- Inject JavaScript into pages matching a URL pattern
- Runs after page load
- Use cases:
  - Auto-fill login forms on localhost
  - Override global variables for testing
  - Inject debug helpers
- WARNING: clearly labeled as "run at own risk" — full power, no sandbox

**URL Rewriting Rules** [V3]
- Define rules: if URL matches pattern X, rewrite to pattern Y
- Use case: redirect production API calls to localhost
  - Example: api.myapp.com/* → localhost:8080/*
- Per-workspace rules
- Toggle rules on/off

**Request/Response Modification** [V3]
- Intercept a request and modify headers or body before it's sent
- Intercept a response and modify the body before the page sees it
- Useful for mocking specific API responses without a mock server

**Quick Notes / Scratchpad** [CORE]
- Small panel accessible from toolbar
- Plain text / markdown notes
- Per-workspace notes persist
- Great for temporary notes while building: "remember to test edge case X"
- Not a full note app — just a quick notepad

**Regex Tester** [V2]
- Quick panel: paste regex pattern and test string
- Shows matches highlighted in real-time
- Common regex patterns library (email, URL, phone, etc.)
- Flags selector (g, i, m, s)
- Copy match groups

**Timestamp Converter** [V2]
- Paste a Unix timestamp → see human-readable date/time
- Paste a date/time → get Unix timestamp
- Supports milliseconds and seconds
- Shows in local timezone and UTC
- Useful when debugging API responses with timestamp fields

**Hash Generator** [V2]
- Input text → generate MD5, SHA1, SHA256, SHA512
- Quick panel in dev tools
- Copy hash button

**URL Encoder/Decoder** [V2]
- Encode any string to URL-safe format
- Decode URL-encoded strings
- Useful for debugging query parameters

**Diff Tool** [V3]
- Paste two JSON/text blobs
- See a visual diff (added/removed lines highlighted)
- Useful for comparing API responses

---

### 7.14 ACCESSIBILITY CHECKER (LITE)

**Basic Accessibility Scan** [V2]
- One-click scan of current page
- Checks:
  - Images without alt text
  - Buttons without accessible labels
  - Color contrast ratio (AA standard)
  - Missing form labels
  - Missing lang attribute on html tag
  - Heading hierarchy issues (skipped levels)
  - Links with no text ("click here" anti-patterns)
- Shows results as a list with links to the offending element
- Click element in list → scroll to and highlight it on the page
- Not as thorough as Polypane's 80+ tests — just the quick wins

---

### 7.15 PERFORMANCE INDICATORS

**Page Load Info** [CORE]
- Show in status bar: page load time, DOM content loaded time, request count
- No popup, just a permanent subtle indicator

**Lighthouse-Lite** [V3]
- Basic performance score without running full Lighthouse
- Core Web Vitals: LCP, FID/INP, CLS
- Show in a quick panel
- Not a replacement for full Lighthouse — just a quick sanity check

---

### 7.16 EXTENSION SYSTEM (V3 ONLY)

**Why defer this:**
- Extensions are complex and add significant binary size
- A bad extension breaks the whole browser experience
- For v1-v2, the built-in tools cover 90% of developer needs

**What the extension system would look like:**
- Not Chrome-compatible extensions (too complex to implement)
- Simple "plugins" that can add panels, inject scripts, add toolbar buttons
- Written in JavaScript/TypeScript using a DEVBROWSER Plugin API
- Loaded from local folders (no marketplace at first)
- Sandboxed (can only communicate via a defined API, not full page access)

---

## 8. VERSIONING ROADMAP

### v0.1 — Alpha Foundation (Start here)
- Core browser: address bar, working webview, basic tab management (open/close/switch)
- Basic keyboard shortcuts (Ctrl+T, Ctrl+W, Ctrl+L, Ctrl+R, Alt+Left/Right)
- Minimal dark UI
- Navigation: back, forward, reload, stop
- History (in-session)
- Find in page
- App builds on Windows, macOS, Linux
- Binary size: target <10MB

### v0.2 — Localhost & Workspaces
- Port scanner (auto-detect running local servers)
- Localhost quick panel (new tab page showing detected servers)
- Workspace system (create, switch, persist workspaces)
- Workspace tab isolation
- Workspace sidebar
- Quick notes/scratchpad per workspace

### v0.3 — Network & Headers
- Network request log panel
- Request filter (by method, status, type)
- Copy as cURL / Copy as fetch
- Custom header injection (per workspace, per URL pattern)
- JWT decoder panel
- Base64 encoder/decoder
- JSON viewer (auto-format JSON responses)
- Cookie viewer

### v0.4 — API Tester
- Request builder (method, URL, headers, body)
- Response viewer (status, headers, formatted body)
- Save requests to collections (workspace-scoped)
- cURL import
- Request history
- Local storage / session storage viewer
- Meta tag inspector

### v0.5 — UI Polish & Power Features
- Command palette (Ctrl/Cmd + K)
- Vertical tab layout option
- Color picker
- Theme system (dark/light/system)
- Bookmarks (full system)
- Download manager
- User agent switcher
- Compact mode / distraction-free mode
- Full keyboard shortcut list
- Settings panel

### v0.6 — Responsive Tools
- Multi-viewport mode
- Device presets
- Viewport sync
- Orientation toggle

### v1.0 — Stable Release
- All v0.1–v0.6 features polished
- Zero known critical bugs
- Good README with screenshots/GIFs
- Cross-platform builds in CI (GitHub Actions)
- Auto-updater
- Website or GitHub Pages landing page
- Launch on r/webdev, Hacker News, Product Hunt

### v1.x — Environment & Injection
- Environment switcher (dev/staging/prod profiles)
- Custom CSS injection
- Custom JS injection
- Screenshot tool
- Breakpoint inspector
- Workspace export/import

### v2.0 — Advanced Dev Tools
- Accessibility checker
- Network throttling
- Request blocking
- URL encoder/decoder
- Regex tester
- Timestamp converter
- Hash generator
- Split view
- Font inspector
- CSS variables inspector
- Image inspector
- Workspace templates

### v3.0 — Power and Extensibility
- Mock server (fake API endpoints locally)
- WebSocket inspector
- URL rewriting rules
- Request/response modification
- Diff tool
- Response comparison
- Lighthouse-lite
- Plugin/extension system
- AI panel (ask about the current page)

---

## 9. GETTING GITHUB STARS: LAUNCH STRATEGY

Stars don't come from building — they come from showing.

### 9.1 README Must-Haves
- Hero GIF at top showing the key features in 30 seconds
  (localhost panel detecting servers, workspaces switching, network log, API tester)
- Binary size badge (show <10MB prominently)
- "No account. No telemetry. Free forever." in the first paragraph
- Feature grid with screenshots
- Installation: one download link, no setup wizard
- Comparison table vs. Responsively, Polypane
- Roadmap section so people see momentum

### 9.2 Launch Posts
- **Hacker News:** "Show HN: I built a minimal browser for devs — 8MB, no account, free"
- **r/webdev:** Post screenshot of localhost panel + workspace feature
- **r/programming:** Tauri binary size story (8MB vs 150MB Electron)
- **Twitter/X:** Short demo video. Tag relevant developer accounts.
- **Dev.to / Hashnode:** Write "Why I Built a Browser for Developers" article

### 9.3 Timing
- Don't launch with v0.1 — launch at v0.5 or v0.6 minimum
- You need the localhost panel, workspaces, and either network log or API tester
  to have a compelling demo
- One good GIF is worth more than 1000 words in the README

### 9.4 What Gets Stars
Looking at similar launches, the story that resonates is:
"Chrome is 200MB and requires a Google account.
This does 80% of what I need in dev — and it's 8MB and has zero sign-in."
That's a tweet. That's a HN submission. That's a star.

---

## 10. AI-ASSISTED BUILD WORKFLOW

### 10.1 Your Setup
- **Planning/Architecture:** Claude (this AI) — free tier
- **Code generation:** OpenCode with Deepseek V3 or Gemini Flash
- **Context problem:** Free tier AIs forget previous sessions

### 10.2 How to Manage Context

**Always start new AI sessions with:**
1. Paste the "QUICK CONTEXT SNAPSHOT" block from the top of this guide
2. Then paste the relevant feature spec section for what you're building
3. Then describe the specific task

**Example prompt structure:**
```
[Paste Quick Context Snapshot]

We are currently working on v0.2 — the Port Scanner feature.
Here is the spec for that feature: [paste section 7.2]

Current task: Write the Rust command in src-tauri/src/commands/ports.rs
that scans a list of ports and returns which ones have a running HTTP server.
It should take a list of ports, attempt TCP connection + HTTP GET, and return
{ port: number, alive: boolean, title: string | null } for each.
```

**Files to always keep updated:**
- This guide (DEVBROWSER_PROJECT_GUIDE.md) — the permanent spec
- A separate `PROGRESS.md` — track what's built and what's broken
- A separate `CURRENT_TASK.md` — what you're actively working on right now

### 10.3 PROGRESS.md Template
Create this file and update it after every session:
```
# DEVBROWSER PROGRESS

## Status: v0.X in progress

## DONE
- [ ] Basic Tauri app scaffolded
- [ ] Webview loads URLs
- [ ] Address bar works
- [ ] Tabs: open, close, switch

## IN PROGRESS
- [ ] Port scanner (Rust command written, not wired to UI yet)

## BLOCKED
- [ ] X feature: blocked by Y reason

## BUGS
- [ ] Bug description

## LAST AI SESSION SUMMARY
Date: YYYY-MM-DD
What was done: ...
Files changed: src-tauri/src/commands/ports.rs, src/components/sidebar/ServerPanel.tsx
What broke: nothing / (describe)
Next task: ...
```

### 10.4 Task Sizing for Free AI
Free AI context windows are limited. Break tasks into:
- **1 Rust command** (one feature in the Rust backend) = 1 AI task
- **1 React component** (one UI component) = 1 AI task
- **1 Zustand store** (one state file) = 1 AI task
Never ask "build the whole workspace system" — ask "write the Zustand store
for workspace state with these exact fields and actions: ..."

### 10.5 Deepseek / Flash Prompting Tips
- Always specify the full file path: "Write the content of src/stores/workspaces.ts"
- Always specify imports you need: "Use Zustand with Immer middleware"
- Always give type definitions first: "Here are the TypeScript types we're using: ..."
- Always specify what NOT to do: "Don't use any global window events"
- Request complete files, not snippets — easier to drop into your editor

---

## 11. FIRST STEPS (EXACTLY WHAT TO DO FIRST)

1. Install Rust: https://rustup.rs/
2. Install Node.js 20+ and pnpm
3. Run: `npm create tauri-app@latest devbrowser`
   - Select: pnpm, React, TypeScript
4. `cd devbrowser && pnpm install`
5. `pnpm tauri dev` — confirm the default app opens
6. Replace the default UI with a minimal browser shell:
   - Address bar at top
   - WebviewWindow loading a URL
   - Tab bar
7. Confirm navigation works (address bar → webview loads URL)
8. That's v0.1 alpha. Now open a GitHub repo and push.

---

## 12. REPOSITORY SETUP

**Repo name suggestions:**
- `devbrowser` (clean, searchable)
- `devchromer` (play on Chrome for devs)
- `localab` (localhost + lab)
- `porthub` (localhost ports hub)

**Required files from day 1:**
- `README.md` (at minimum: what it is, how to run, roadmap)
- `CONTRIBUTING.md` (basic: how to run dev, how to submit PR)
- `LICENSE` (MIT)
- `.github/workflows/build.yml` (CI: build on all three platforms)
- `CHANGELOG.md`

**Tauri CI/CD:**
Use the official Tauri GitHub Action (`tauri-apps/tauri-action`) to build
binaries for Windows, macOS, and Linux on every release tag.
This gives you download links automatically.

---

## 13. CRITICAL RISKS & HOW TO AVOID THEM

**Risk 1: Scope creep → never ships**
- Fix: Only work on the current version's features. All other ideas go in
  this guide's later version sections. They don't exist until you reach that version.

**Risk 2: Webview limitations on macOS/Linux**
- Tauri uses different webview engines per OS. WKWebView on macOS and
  WebKitGTK on Linux have different capabilities than WebView2 on Windows.
- Fix: Test on all three early. Don't assume Chrome behavior everywhere.

**Risk 3: Network log implementation complexity**
- Intercepting HTTP requests inside a Tauri webview is non-trivial.
  The webview doesn't expose the same hooks as Chrome DevTools Protocol.
- Fix approach for MVP: use a local proxy (Rust HTTP proxy that the webview
  routes through). More complex but gives full request visibility.
- Alternative for early version: only log requests initiated via the API Tester
  panel (not from browsed pages). Add page-level logging in a later version.

**Risk 4: Port scanner being too aggressive**
- Scanning too many ports too fast can trip firewalls or look like a port scan attack.
- Fix: Scan only the curated list of known dev ports. Use 500ms timeout per port.
  Let users add custom ports. Never scan ranges automatically.

**Risk 5: Context loss across AI sessions**
- Fix: This document. Update PROGRESS.md after every session.
  Never start a new AI task without pasting the context snapshot.

---

## 14. WHAT SUCCESS LOOKS LIKE

**3 months after launch:**
- 500+ GitHub stars
- Working on Windows and macOS (Linux is bonus)
- At least one HN/Reddit post got traction
- 50+ actual users (GitHub discussions or issues show real people using it)

**6 months after launch:**
- 2,000+ stars
- Regular contributors submitting PRs
- A Reddit thread or YouTube video about it that you didn't make

**1 year:**
- 5,000+ stars
- Mentioned alongside Responsively in "developer browser" conversations
- A "vs Polypane" comparison article someone else wrote

The metric isn't millions of users. It's being genuinely useful to a
specific type of person — and that person telling other people about it.

---

## 15. WHAT THIS PROJECT IS NOT

To keep scope tight, these are explicit non-goals:

- **Not a Chrome extension host** — no extension marketplace
- **Not a sync service** — no cloud features ever
- **Not a privacy browser for regular users** — that's Brave's job
- **Not a testing automation tool** — that's Playwright's job
- **Not a full DevTools replacement** — Chrome DevTools still wins there
- **Not a team collaboration tool** — no shared sessions, no remote access
- **Not mobile** — desktop only for v1-v2

---

*End of DEVBROWSER Project Guide — Version 1.0*
*Maintained by the project owner. Update after major decisions.*
