# Agent roadmap: from "cheapest for debugging localhost" to a Playwright alternative

Where ZYNLEX's agent side door stands against Playwright MCP and the other
agent browsers, what's missing, and what makes it hard to copy. Measured
results so far: [agent-interface.md](agent-interface.md) (cheapest of five
tools on every benchmark task; works with Claude Code, Antigravity, Codex).

Rule for every item: it ships with a unit test, a live check on Windows, and
(for anything that changes how agents spend tokens) a benchmark run.

Status: **todo** · **doing** · **done**.

## 1. Parity: what agents can do with Playwright MCP and not with ZYNLEX

| # | Feature | Why it matters | Status |
|---|---|---|---|
| P1 | **Viewport / mobile emulation** (`viewport` tool: device presets, width×height, touch, back to normal) | "Does it break on mobile?" is one of the most common checks. ZYNLEX has a viewport panel for people, not for agents. | todo |
| P2 | **`eval`** (run JS in the page, return a value; localhost tabs only) | Escape hatch for anything the other tools don't cover. | todo |
| P3 | **`hover`, `back`/`forward`, drag** | Hover menus, history navigation. | todo |
| P4 | **`wait_for`** (text appears/disappears, URL changes, timeout) | Long async flows beyond the settle rule. | todo |
| P5 | **Tabs and popups** (follow `target=_blank` and `window.open`, list/switch/close tabs the agent opened) | OAuth popups, "open in new tab" links. | todo |
| P6 | **Iframes in the snapshot** (same-origin frames walked, refs that work inside them) | Embedded widgets, payment forms. | todo |
| P7 | **File upload** (`act` upload on an `<input type=file>`) | Upload forms. | todo |
| P8 | **Screenshots: element crop, full page** | Smaller images, whole-page layout checks. | todo |
| P9 | **Large output to a file** (snapshot over 300 lines, bodies over 8 KB written to `%TEMP%`, path returned) | Big pages and payloads without blowing the context. | todo |
| P10 | **Network mocking and header rules for agents** (`mock` add/list/clear through the existing stores) | Test error states and auth without a backend change. ZYNLEX already has both for people. | todo |
| P11 | **Console at all levels** (`errors` can include log/info on request) | Debug-print driven debugging. | todo |
| P12 | **Staging hosts** (per-workspace list of non-localhost hosts the agent may use, granted in the UI) | Test what's deployed, not only localhost. | todo |

Not planned: headless mode, parallel browsers, CI runs, cross-browser
(Firefox/WebKit). Those are Playwright's and Cloudflare's job; ZYNLEX is the
developer's own browser.

## 2. Shipping: what stops people from using it

| # | Item | Status |
|---|---|---|
| S1 | Settings → AI agents setup snippets + palette command (`feat/agent-setup-button`) | done, not merged |
| S2 | `zynlex-mcp.exe` on `PATH` from the installer, so the setup is just `zynlex-mcp` | todo |
| S3 | Signed release (code-signing certificate; stops antivirus quarantining the build) and the updater signing key in CI | todo (needs a certificate purchase) |
| S4 | Public, reproducible benchmark (harness, apps, graders, raw results in a repo) | todo |
| S5 | Benchmark with a second model family (e.g. GPT or Gemini through Codex/Antigravity, or Haiku) | todo |
| S6 | Per-tab "agent was here" marker and an agent activity list (in the chrome, never over the tab) | todo |

## 3. The moat: what a headless tool can't copy

Token efficiency is the headline, and it can be copied: compact outlines,
diffs after each action and settle-waiting are ideas, not secrets. What
Playwright, DevTools MCP and a vendor's built-in browser can't easily copy is
that ZYNLEX is **the developer's own browser, shared live with the agent**.
Each item below leans on that.

| # | Feature | Why a headless tool can't do it | Status |
|---|---|---|---|
| M1 | **Flag for agent**: right-click an element (or press a key), type a note; the agent's next reply starts with it and the element's ref ("user flagged e15, button 'Apply': does nothing on mobile") | The agent sees what the person points at, in the page they're looking at. | todo |
| M2 | **Show the agent what I did**: record the developer's own clicks and typing in a tab as `act` steps plus the errors and requests each caused; the agent replays or reads them | Bug reproduction straight from a human session, no "steps to reproduce" typed out. | todo |
| M3 | **Evidence from before the agent arrived**: errors and failed requests the page logged while the developer was using it, kept per tab and offered in the first `check` | A browser the agent launches only sees from launch onward. | partly done (console) |
| M4 | **Dev state the agent can use**: workspaces, environments (local/staging), mocks, header rules, saved API requests, all one tool call away | Lives in the developer's ZYNLEX, not in a fresh profile. | todo (P10, P12 first) |
| M5 | **Shared control**: the developer sees every agent action live, can take over mid-flow (agent pauses, resumes after) and stop it | Headless runs are invisible. | partly done (Stop) |
| M6 | **Agent-aware error grouping**: identical errors collapsed across reloads with counts and first-seen time, so every reply stays short as a session gets long | Built on ZYNLEX's always-on capture. | todo |

The benchmark is the proof, and publishing it (S4) is the marketing: the
claim is checkable.

## Order

1. S1 merge, then P1–P4 and P10 (most-asked gaps), with M1 alongside.
2. P5–P9, P11.
3. M2, M5, M6, S6.
4. S2, S4, S5, then S3 when there's a certificate.
5. P12 and staging, once the agent permission model for non-localhost is designed.
