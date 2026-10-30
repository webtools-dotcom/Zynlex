# Agent interface (design proposal)

**Status:** Phase 1 (read-only) built; the rest is a proposal. Written 2026-10-30.

ZYNLEX stays a minimal browser for humans. This adds a side door for AI coding
agents (Claude Code, Codex, OpenCode, Antigravity, Cursor, …): a thin MCP server
that lets an agent see and drive the same tabs the developer is looking at. No AI
chat panel, no bundled model.

The goal is narrow: **an agent verifying a web app in ZYNLEX should use fewer
tokens, fewer tool calls and less wall time, and succeed more often, than with
Playwright MCP, chrome-devtools-mcp, playwright-cli or agent-browser.** If a
benchmark (below) doesn't show that, the feature isn't worth keeping.

## Problems this solves

These are the documented failure modes of existing agent browser tools, as of
late 2026:

| Problem | Evidence | ZYNLEX answer |
|---|---|---|
| Context overflow | Playwright MCP returns the full accessibility tree + console after every action; 50–540 KB per page ([playwright-mcp#1233](https://github.com/microsoft/playwright-mcp/issues/1233), [#1216](https://github.com/microsoft/playwright-mcp/issues/1216)). Screenshots stay in context for the rest of the session. | Interactive-only snapshots, "unchanged" replies, diffs, large output written to a file. Screenshots only on request. |
| Running out of steps | Stagehand's benchmark: Playwright MCP tasks failed on step limits, not context ([source](https://www.stagehand.dev/blog/playwright-mcp-token-usage)). One "did my change work?" takes navigate + wait + snapshot + console + network. | `check`: one call does reload → settle → new errors → failed requests → page diff. Every action returns its own consequences. |
| Evidence the agent missed | Other tools only record from the moment they attach. | Console capture is already always on per tab, so errors from before the agent connected (or from the human clicking around) are there. |
| Login walls | Headless browsers start logged out; workarounds are saved-state files and login scripts. | The agent works in the developer's real, already-signed-in dev tab. |
| Guessed waits | Fixed sleeps, "is the dev server up?", HMR still applying. | A settle rule that knows about network, DOM and the dev server, with a hard timeout that says *why* it didn't settle. |
| Human and agent see different browsers | Headless; the developer can't point at the bug. | Same window. Agent-active indicator, stop button, and "flag for agent". |
| Setup | Chromium downloads, flags, MCP vs CLI choice. | WebView2 ships with Windows 11 and is on nearly all Windows 10 machines, and ZYNLEX already requires it. One small MCP binary. |
| Tool-schema overhead | Playwright MCP's 22 tools ≈ 15k tokens; chrome-devtools-mcp ≈ 4.5k. | Target: under 2k tokens of tool definitions. |

## What exists today (and what doesn't)

Built on, unchanged:

- **CDP from Rust:** `cdp()` and `cdp_result()` in
  [browser/mod.rs](../src-tauri/src/commands/browser/mod.rs) wrap
  `CallDevToolsProtocolMethod`. Snapshot, click and type all go through this.
- **Console capture** ([console.rs](../src-tauri/src/commands/browser/console.rs)):
  always on per tab. Exceptions, `console.error`/`warn`, and Chromium's own log,
  which includes failed requests. Entries are emitted to the frontend and live
  in `useConsoleStore`.
- **Screenshots:** `browser_capture_screenshot` already writes a PNG to disk and
  returns the path, which is the shape agents want.
- **Script execution:** `browser_run_script`, `eval_json`.
- **Mocks and header rules** ([net.rs](../src-tauri/src/commands/browser/net.rs)):
  per-tab maps in Rust, pushed wholesale from the frontend stores.
- **Port scanner** (`scan_ports`), **bug report** ([bugReport.ts](../src/lib/bugReport.ts)),
  **network throttling** (`browser_set_network_conditions`).

Correction to an easy assumption: **full network capture is not always on.**
Request/response capture (headers, bodies, timing) is gated by
`NETWORK_CAPTURE_ACTIVE` and only runs while the Network panel is open. Failed
requests *are* always captured, through the console's `Log.entryAdded`. So
before an agent connects, it gets errors and failed-request URLs; bodies and
timing only from when it (or the panel) is attached. An agent session holds a
reference on the same counter while connected — the ref-count was built for
exactly this kind of independent client.

## Architecture

```
agent ──stdio MCP──▶ zynlex-mcp ──named pipe──▶ ZYNLEX (Rust) ──event──▶ frontend dispatcher
                                \\.\pipe\zynlex-agent     ◀──invoke── (stores, existing commands)
```

**`zynlex-mcp.exe`** ([src/bin/zynlex-mcp.rs](../src-tauri/src/bin/zynlex-mcp.rs)) —
a second binary in the `src-tauri` crate. It has to be separate: the app binary
is `windows_subsystem = "windows"` in release, so it has no stdio. It speaks MCP
over stdio (hand-rolled: `initialize`, `tools/list`, `tools/call`, `ping`) and
relays each tool call over the pipe. It connects lazily, so the agent can start
before ZYNLEX, and reconnects once if the app restarted. No browser logic lives
here. MCP is the only front end, since every coding agent speaks it; a plain CLI
can sit on the same pipe later if the benchmark calls for one.

**Named pipe server in the app** ([src/agent.rs](../src-tauri/src/agent.rs),
`tokio::net::windows::named_pipe`). One request per message, JSON in, text out. If the app
isn't running, the tool call returns an error saying so; it does not launch it.

**The frontend is the dispatcher.** Rust forwards each pipe request to the main
window as an event; a TypeScript dispatcher handles it and replies via an
`agent_reply` command. This is main-window IPC, the same trust level as every
other command — no page-originated IPC, no `remote.urls`. Reasons:

- Tabs, workspaces, console entries, network entries, mocks and header rules
  already live in the frontend stores. Going through them keeps one source of
  truth. A mock added by Rust directly would be wiped on the next
  `browser_set_mock_rules` push from the store.
- The dispatcher is plain TypeScript over stores, so it's unit-testable with
  Vitest. Rust-only work (snapshot, input, settle) is exposed as normal
  `#[tauri::command]`s the dispatcher calls.

**No `--remote-debugging-port`.** It would let any local process drive every
tab, including signed-in non-dev ones, and adding it would change the shared
`additionalBrowserArgs`, which architecture.md notes takes a restart and must
match across all webviews.

## Commands

Output is terse line-oriented text by default (cheaper than JSON for a model to
read); `--json` for scripts. Anything over ~8 KB is written to
`%TEMP%\zynlex\agent\` and the reply gives the path plus a summary.

Every response that follows an action ends with a short consequences block:
new errors, new failed requests, and what changed on the page. The agent never
has to make a second call to find out what its action did.

| Command | Does | Notes |
|---|---|---|
| `tabs` | In-scope tabs (id, url, title, workspace) + dev servers found by the port scanner that have no tab | Out-of-scope tabs are counted, not listed |
| `open <url>` | Opens or focuses a tab, then runs `check` | |
| `check [tab] [--reload]` | Optionally reload, settle, then report new errors, failed requests and page diff since the last `check` | The main command |
| `errors [tab] [--since <cursor>]` | Console errors + failed requests since a cursor | Cursor is a timestamp; each reply gives the next one |
| `snapshot [tab] [--full] [--within <ref>]` | Compact page tree, interactive elements only by default, each with a ref | Returns `unchanged` if identical to last |
| `act <ref> click\|type <text>\|select <value>\|press <key>` | Real input events via CDP, then settle + consequences | |
| `network [tab] [--failed] [--match <glob>] [--body <id>]` | Requests with method, status, ms; one body on request | |
| `screenshot [tab] [--ref <ref>] [--full]` | Writes PNG, returns path | Element crop keeps images small |
| `mock add\|list\|clear` | Through the mocks store, so it shows in the UI | |
| `eval <js>` | Escape hatch | In-scope tabs only |

Ten commands. Tool descriptions are written to fit under the 2k-token budget;
the MCP server exposes exactly these, nothing more.

### Snapshot and refs

Built from CDP `Accessibility.getFullAXTree` (not an injected DOM walker — the AX
tree already resolves roles, names and states). Default output keeps only
interactive nodes plus the headings and landmarks needed to say where they are:

```
main "Checkout"
  textbox "Coupon" [e14] value=""
  button "Apply" [e15]
  button "Pay $42.00" [e16] disabled
```

Refs are derived from `backendDOMNodeId`, so they survive React re-renders that
keep the same DOM node — the main cause of "stale ref" failures elsewhere. When
a ref no longer resolves, `act` fails with `stale ref e15` plus a fresh diff,
not a bare error.

Acting resolves the ref with `DOM.getBoxModel`, scrolls into view, and sends
`Input.dispatchMouseEvent` / `Input.insertText` / `Input.dispatchKeyEvent`:
trusted input, the same as a human click, not `element.click()`.

Known ceiling: canvas-rendered UIs expose nothing to the AX tree. Screenshot is
the fallback there.

### Settle rule

"Settled" means all of, for 500 ms:

- `document.readyState === "complete"`
- no in-flight fetch/XHR/document requests (WebSocket, EventSource and
  long-poll requests excluded)
- no DOM mutations (a `MutationObserver` installed with `ExecuteScript` and
  polled, Rust-initiated)

Hard timeout 10 s. On timeout the reply says why instead of hanging:
`not settled after 10s: 2 requests pending (GET /api/feed, GET /api/notifications)`.
HMR needs no special case: after the agent saves a file, `check` without
`--reload` waits for Vite/Next to finish applying the update the same way.

## Permissions and safety

The agent is untrusted by default, and page content is untrusted always.

- **Scope.** By default only tabs on loopback hosts (`localhost`, `127.0.0.1`,
  `[::1]`, `*.localhost`) plus hosts the active workspace lists as its own
  (staging etc.). Other tabs don't appear in `tabs` and every command refuses
  them.
- **Widening scope** is a per-host grant the developer approves in the ZYNLEX UI
  — an in-app bar, never `window.confirm()` (it renders behind the child
  webview). Grants last for the agent session.
- **Pipe access.** Remote clients are rejected (`reject_remote_clients`). The
  default named-pipe DACL gives write access only to the creating user, SYSTEM
  and Administrators (everyone else gets read, which can't send a request).
  `first_pipe_instance` stops a second ZYNLEX from joining the pipe.
  Known ceiling: another local user who starts first could squat the name.
- **Visible.** While an agent is connected, the status bar names the client
  (`● Agent: claude-code`) with a **Stop** button. Stop disconnects every agent
  and refuses further calls ("the user turned off agent access") until the user
  clicks **Turn on**; it lasts until restart. Later: a per-tab marker and an
  activity list (nothing may float over the tab, so not a popover).
- **Page text is labelled as page text.** Snapshot names, console messages and
  response bodies come from the page and may contain prompt-injection attempts.
  Output fences them so the agent can tell page content from ZYNLEX's own
  messages.
- **Tab suspension.** Localhost tabs are already never suspended. Any other
  in-scope tab the agent has touched is exempt while the session is open.

## Human → agent handoff

MCP is pull-based; ZYNLEX can't push into the agent's conversation. So:

- **Flag for agent** (context menu on an element, or a toolbar action on the
  page): the developer types a short note. It's queued and appears at the top of
  the agent's next `check` reply, with the element's ref:
  `user flagged e15 (button "Apply"): "does nothing on mobile"`.
- **Copy for agent**: the existing bug report plus the flagged ref, on the
  clipboard, for pasting into a chat that isn't connected.

## Setup

```
claude mcp add zynlex -- "C:\path\to\zynlex-mcp.exe"
```

Any MCP client takes the same command (no arguments, stdio transport). For now
it's built with `cargo build --release --bin zynlex-mcp`; shipping it in the
installer (and on `PATH`) is still to do. A `SKILL.md` in the repo teaches agents when to use `check` vs
`snapshot` vs `screenshot`; skills are how agents learn to pick a tool, and
chrome-devtools-mcp and agent-browser both ship one.

## Benchmark

Built before launch, not after — it decides whether this ships.

- A fixture app with seeded bugs (in `D:\PROJECT-TESTINGS`): a 500 on coupon
  apply, a broken mobile nav, a console exception on item remove, a form that
  silently fails validation, a slow endpoint that breaks fixed-sleep tools, a
  login-gated page.
- About 10 tasks phrased the way a vibe coder would ("the coupon doesn't work,
  fix it").
- Same agent and model, run against: ZYNLEX, Playwright MCP, playwright-cli,
  chrome-devtools-mcp, agent-browser.
- Measured: success rate, total tokens, tool calls, wall time. Five runs each.

Bar to ship: clearly better on tokens and tool calls, and no worse on success.

## Phases

1. **Read-only. Built.** Pipe, MCP server, frontend dispatcher
   ([src/lib/agent.ts](../src/lib/agent.ts)), localhost-only scope, status-bar
   indicator + Stop. Tools: `tabs`, `check` (no reload), `errors`, `network`,
   `screenshot`. Useful on its own and can't change anything.
2. **Driving.** `snapshot`, `act`, `open`, `check --reload`, settle rule.
3. **MCP + skill + benchmark.** Ship/no-ship decision here.
4. **Developer features.** `mock`, `eval`, flag-for-agent, scope grants UI.

## Not doing

- An AI chat panel or bundled model.
- Headless mode or parallel browsers — that's Playwright's and Cloudflare's job.
- Visual regression or recorded test suites — Playwright Test covers it.
- WebMCP — still an origin trial in Chrome and behind a flag in Edge, so not in
  WebView2.
- macOS/Linux — see ROADMAP.

## Open questions

- Keep full network capture on for the whole agent session, or only during
  `check`/`act`? Bodies up to 64 KB each add memory on busy pages.
- Should `errors` dedupe the way the console store does (`count`), or report
  every occurrence? Dedupe saves tokens but hides "it fired 40 times".
- Ship `zynlex-mcp.exe` in the main installer, or as a separate download?
