# Agent interface (design proposal)

**Status:** Phases 1 (read-only) and 2 (driving) built; the rest is a proposal. Written 2026-10-30.

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
  in `useConsoleStore`. While an agent is connected (`CONSOLE_VERBOSE`, a
  ref-count like network capture) `console.log`/`info`/`debug` and Chromium's
  info log are forwarded too; the store keeps them in `logsByTab`, apart from
  errors and warnings, capped at 200 per tab and never counted in the tab badge,
  status bar or Console panel.
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

## Tools

Output is terse plain text (cheaper than JSON for a model to read). Every tool
that acts on a page ends with what the action caused — settle note, URL change,
page diff, new errors and failed requests — so the agent never needs a second
call to find out.

| Tool | Does | Status |
|---|---|---|
| `tabs` | Localhost tabs (id prefix, URL, title, error counts) + running dev servers with no tab; `close` closes a tab the agent opened | Built |
| `open` | Opens a localhost URL (or switches to its tab), settles, returns the page and errors | Built |
| `check` | Settles, then new errors + failed requests since the last report; `reload` reloads first | Built |
| `errors` | Every recorded error and failed request; `level` adds `warning`, `info` or `log` (each includes the levels above it; newest 50 log/info lines) | Built |
| `snapshot` | Interactive elements with refs; `full` adds text; `within` roots at one ref; `unchanged` when nothing changed | Built |
| `act` | `click` / `hover` / `drag` (`ref` onto `to`) / `type` / `select` / `press` / `upload` on a ref with real input, `back` / `forward` in history (localhost entries only), then the consequences (including any tab it opened) | Built (hover, drag, back/forward, upload untested on Windows) |
| `network` | Requests (assets hidden unless `all`); `failed`, `match`; `id` for headers + body | Built |
| `screenshot` | Visible area, one element (`ref`) or the whole page (`full`) to `%TEMP%\zynlex-agent`, returns the path | Built (`ref`, `full` untested on Windows) |
| `viewport` | Device presets or width×height, touch, mobile UA; `reset` | Built |
| `eval` | `Runtime.evaluate` (`awaitPromise`, `returnByValue`, `replMode`): an expression, or a function body when the code has `return`; value as compact JSON cut at 4 KB, exceptions as `Threw: …`, gives up after 10 s | Built, untested on Windows |
| `wait_for` | Polls every 250 ms until all given conditions hold: `text` appears, `gone` disappears (full snapshot + `body.innerText`), `url` contains; `timeout` s (default 10, max 30); says what matched or what's pending, then the consequences | Built, untested on Windows |
| `mock` | `add` a canned response (or, with `header`+`value`, a request-header rule), `list`, `remove` by id, `clear`, through the panels' stores | Built |

### Mocks and header rules

`mock` writes to the same per-workspace stores as the Mocks and Headers panels
([agentRules.ts](../src/lib/agentRules.ts)), so the developer sees every rule
and the bridge pushes them to Rust the normal way; nothing writes the Rust rule
maps directly. Scope matches the panels: the target tab's workspace, applying
to every tab in it. Agent rules carry `agent: true` (an "agent" tag in the
panels; Rust ignores the field):

- the agent can `remove` and `clear` only its own; the developer's are listed
  as "developer's" and refused;
- an agent mock goes first in the list (first enabled match wins), so it's the
  one served;
- they are never persisted, and are dropped when the last agent disconnects,
  so a forgotten canned 500 can't outlive the session.

Blank and bare-`*` patterns are refused for both kinds (a catch-all mock
replaces the page itself; a catch-all header goes to every third party).

`check`, `act` and `open` share one report cursor per tab: whatever one of them
reported, the next one doesn't repeat.

### Large output

A snapshot (or action diff) over 300 lines returns its first 300, then
`… 412 more lines; all of it is in C:\…\zynlex-agent\zynlex-snapshot-<tab>-<ms>.txt.`
A response body over 8 KB returns its first 8,000 characters and the path of
`zynlex-body-<tab>-<request>-<ms>.txt` the same way. The head stays inline so
the refs and the start of the payload are usable without a second call; the
agent reads the file only when it needs the rest. The files are written by
`agent_write_temp` ([agent.rs](../src-tauri/src/agent.rs)), which keeps the
name to letters, digits, `-` and `_` under a `zynlex-` prefix, so it can only
write `.txt` files directly in `%TEMP%\zynlex-agent`, next to the agent's
screenshots. Nothing cleans that folder up yet. Diffs are now taken over the
whole page, so a change past line 300 still shows.

### Snapshot and refs

Built from CDP `Accessibility.getFullAXTree`
([agentSnapshot.ts](../src/lib/agentSnapshot.ts)), not an injected DOM walker:
the AX tree already resolves roles, names and states. Default output keeps
interactive nodes, plus headings, landmarks that contain something actionable,
and `alert`/`status` text (validation and toast messages):

```
main
  h1 "Checkout"
  form
    textbox "Coupon" [e3] value=""
    combobox "Plan" [e4] value="Basic" collapsed
      option "Basic" [e25] selected
      option "Pro" [e28]
    button "Apply" [e8]
  link "Back home" [e33]
```

Refs are `e` + `backendDOMNodeId`, so they survive re-renders that keep the same
DOM node. A reload or navigation makes a new document and new refs. `focused`
is left out: it moves on every click and would put two noise lines in every
diff. After an action the agent gets a multiset line diff (`-`/`+`), or the
whole page when the diff would be longer than it.

A stale ref fails with `Stale ref e8: that element is gone` plus the current
page. WebView2 reports every CDP error as `E_INVALIDARG` and drops CDP's own
message, so for an element-scoped call that HRESULT is read as "node gone".

Acting is real input, not `element.click()`: `DOM.scrollIntoViewIfNeeded` +
`DOM.getContentQuads` + `Input.dispatchMouseEvent` at the centre for clicks;
`DOM.focus`, select-all and `Input.insertText` for typing (replaces the value);
a `change` + `input` event pair for `<select>`; `Input.dispatchKeyEvent` for
keys; `DOM.setFileInputFiles` for `upload`, which takes absolute paths on the
developer's machine (not checked for existence) and fires the page's `input`
and `change` events. Its ref can be the `<input type=file>` itself, a `<label>`
for one, or an element holding one (styled inputs are often hidden, so they
have no ref of their own); anything else is refused, as are several files for
an input without `multiple`. `hover` is a lone `mouseMoved` at the centre; `drag` presses on `ref`,
moves in five steps and releases on `to` (button held, `buttons: 1`), after the
same covered-element check `click` makes (and one on the drop target, done
before anything is pressed). `back`/`forward` read `Page.getNavigationHistory`
and go to the neighbouring entry with `Page.navigateToHistoryEntry`, refusing
an entry that isn't on localhost. An action brings its tab to the front so the
developer sees it happen.

Ceilings: canvas UIs expose nothing to the AX tree (use `screenshot`);
cross-origin iframes aren't walked; a snapshot over 300 lines spills to a
file (see Large output).

`screenshot ref=e12` scrolls the element into view, takes the box around its
`DOM.getContentQuads` plus the scroll offset (`Page.getLayoutMetrics`), and
captures just that area with `captureBeyondViewport`; `full` captures the whole
page (up to Chromium's 16,384 px), as the Screenshot command does for people.

### Iframes

`Accessibility.getFullAXTree` returns one frame's tree. When the page's tree
has `Iframe` nodes (and only then, so a page without iframes costs no extra
calls), `axTree` in [agent.ts](../src/lib/agent.ts) reads `Page.getFrameTree`,
finds each iframe's frame with `DOM.describeNode`, and fetches that frame's
tree with `getFullAXTree({ frameId })` when its `securityOrigin` equals the top
page's. `mergeFrames` ([agentSnapshot.ts](../src/lib/agentSnapshot.ts)) hangs
each frame's root under its iframe node (frame node ids are prefixed, since
they restart per frame), so frames nest at any depth, up to 20 per snapshot:

```
main
  button "Save" [e12]
  iframe "Feedback widget"
    textbox "Message" [e40] value=""
    button "Send" [e41]
iframe "Payment" (cross-origin, not shown)
```

Refs inside a frame are ordinary refs: backendDOMNodeIds are unique across
the frames of one renderer target, so `DOM.resolveNode`, `getContentQuads`
and `scrollIntoViewIfNeeded` take them unchanged. Content quads of a
same-process frame are already in the top page's viewport, which is what
`Input.dispatchMouseEvent` wants; the covered-element hit test subtracts each
enclosing frame's content-box offset before `elementFromPoint`, which works
in the frame's own coordinates. A cross-origin frame (or one whose tree can't
be read, e.g. out-of-process) is listed with its title and not walked. The
settle rule's DOM-stillness probe watches the top document only.

### Tabs and popups

A page's new-window request (`target=_blank`, `window.open`) is denied as a
window and opened as a tab, as it always was for people
(`browser://open-new-tab` → `openTab` in
[useWebviewBridge.ts](../src/hooks/useWebviewBridge.ts)); the event now
carries the opener's tab id, and the bridge notes each popup in
[agentTabs.ts](../src/lib/agentTabs.ts). `act` (and dialog `accept`/`dismiss`)
takes a mark before the input and, after settling, reports the popups its tab
opened since:

```
Clicked link "Terms" [e9]
Opened new tab [3f2a91c0] http://localhost:5173/terms, now the default tab; pass tab="a1b2c3d4" to stay on this one.
```

The popup opens in front, so it becomes the default tab for the next call.
A non-localhost popup (an OAuth provider) is reported but stays out of scope
like any other tab: `Opened new tab [id] https://…: not localhost, so you
can't use it`. Popups an action caused, and tabs `open` created, are the
agent's: `tabs` marks them `(opened by you)` and `tabs close=<id>` closes them.
Any other tab is refused, and the lookup only searches the agent's tabs, so
an id prefix says nothing about tabs it can't see. Known ceiling: the window is
denied and reopened as a tab, so the popup has no `window.opener`; an OAuth
flow that `postMessage`s back to its opener won't complete.

### Settle rule

Settled means all of: the tab isn't loading, `document.readyState` is
`complete`, no request is pending, and the DOM has been still for 500 ms — with
a 300 ms floor so an action's own requests have time to start. Pending requests
come from the network-capture map in Rust (`browser_pending_requests`), skipping
WebSocket, EventSource, media and ping, and anything pending over 8 s (more
likely aborted than slow). DOM stillness comes from a `MutationObserver` the
probe installs once per document (in the page's world, so the page can see
`__zynlexQuiet`).

Hard timeout 10 s, and the reply says why:
`Not settled after 10s: 2 requests pending (…)`, `still loading`, or `the DOM
keeps changing (animation or polling?)`. HMR needs no special case: `check`
without `reload` waits for the update to finish applying.

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
  (`● Agent: claude-code`) with **Pause** and **Stop**. Stop disconnects every
  agent and refuses further calls ("the user turned off agent access") until
  the user clicks **Turn on**; it lasts until restart. Pause is a take-over,
  see [Shared control](#shared-control-take-over-and-activity). Tabs an agent
  acted on carry a marker, and every call is listed in the Agent Activity panel.
- **Page text is data.** Snapshot names, console messages and response bodies
  come from the page and may carry prompt-injection attempts. The MCP server's
  instructions tell the agent to treat them as data; fencing them in the
  output is not done yet.
- **Tab suspension.** Every in-scope tab is localhost, and localhost tabs are
  never suspended.

## Shared control: take over and activity

Built (roadmap M5, S6), untested on Windows. Pause state, the hold and the
activity list are all frontend:
[agentPause.ts](../src/lib/agentPause.ts),
[agentActivity.ts](../src/stores/agentActivity.ts), wired into the
dispatcher's `runAgentTool`/`handleAgentCall` in [agent.ts](../src/lib/agent.ts).

**Take over.** **Pause** in the status bar's agent indicator (or the Agent
Activity panel, or the palette's "Pause or Resume the AI Agent") pauses the
agent; the indicator then shows `❚❚ Agent paused 12 s · 1 waiting` and
**Resume**. While paused:

- Calls that act on a page **wait**: `act` (every action, dialog answers
  included), `open`, `check reload=true`, `eval`, `wait_for`, `viewport`,
  `mock` (all but `action=list`) and `tabs close=…`.
- Reads **still answer**: `tabs` (list), `check` (no reload), `snapshot`,
  `errors`, `network`, `screenshot`, `mock action=list`.
- On **Resume** each waiting call runs, and its reply starts with
  `The developer took over for 42 s and resumed; the page may have changed.`
  (counted from Pause), then the page's diff against the agent's last snapshot
  of that tab (`Page changes since your last look:`, the whole page when the
  diff would be longer, or `Page unchanged since your last look.`), then the
  call's own reply. No diff for `open`, `tabs close`, a tab the agent never
  looked at, or a tab paused by a dialog. Refs stay valid: they're backend node
  ids, and the stored snapshot is replaced by the fresh one.
- A call waits **at most 45 s** (`PAUSE_HOLD_MS`), then gets
  `Paused by the developer; call again later.` and is **never run**. Clients
  give up on a tool call long before a 10-minute pause ends (Codex's default
  is reported as 60 s), and a call the client abandoned must not run later
  behind the agent's back. So the hold sits under 60 s, and the agent retries.
  Rust's bridge timeout (`REPLY_TIMEOUT` in agent.rs) went from 30 s to 90 s
  so it can't cut a held call short: a call timed out in Rust still runs in the
  frontend. Known edge: a call released near the end of its 45 s hold that
  then runs a long `wait_for` can go past a 60 s client limit.
- **Stop** while paused, or the last agent disconnecting, ends the pause; the
  waiting calls fail with "The developer stopped the agent while it was
  paused." and don't run. Pause needs a connected agent (the indicator that
  shows it hides otherwise).

**Activity.** Every call the dispatcher answers is recorded, newest first, last
50 (`MAX_CALLS`): time, tool, tab (`[short id] url`, a link while the tab is
open), the arguments on one line (`action=click ref=e12`), duration, the first
line of any error, and `ran after takeover` / `paused, not run`. It's the
**Agent Activity** sidebar panel (robot icon), opened from the indicator's
agent name, from a tab's marker, or from the palette; not a popover, because
nothing may float over the tab. **Agent was here**: a small robot glyph in the
tab strip, before the error badge, on every tab a page-acting call named
(reads don't mark), titled with the last time. Clear in the panel empties the
list and the markers. Neither is persisted.

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

Any MCP client takes the same command (no arguments, stdio transport). The NSIS
installer ships `zynlex-mcp.exe` next to `zynlex.exe` (Cargo builds every bin
target and the bundler packs them all); it isn't put on `PATH`. The MCP
server's `instructions` give the short version of when to use which tool.

The longer version is an agent skill,
[agent/skills/zynlex/SKILL.md](../agent/skills/zynlex/SKILL.md): the
open → act → fix → check loop, which replies need a different next step (an
open dialog, a covered element, a stale ref, a page that won't settle), and
iframes. It's built from what the benchmark transcripts show agents wasting
calls on. For Claude Code, copy the `zynlex` folder to `~/.claude/skills/` (all
projects) or a project's `.claude/skills/`. Other agents: paste its body into
their instructions file (`AGENTS.md` and the like).

Measured, it adds nothing the MCP `instructions` don't already give (see "Agent
skill" under Benchmark), so it's optional: worth installing only in a client
that ignores a server's `instructions`.

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

### Pilot (2026-10-30)

Harness, fixture and graders live in `D:\PROJECT-TESTINGS\agent-bench`
(`run.py`, `grade.mjs`). Each run: headless Claude Code (Sonnet), a fresh copy
of the fixture, the same prompt, file tools plus exactly one browser MCP server,
no shell, no plugins. A headless-Edge grader checks the fix. Three tasks (500 on
coupon apply, exception on item remove, search URL typo) × three tools × one
run:

| Tool | Pass | Browser calls | Input tokens | Wall time | Cost |
|---|---|---|---|---|---|
| ZYNLEX | 3/3 | 8.3 | 224k | 53 s | $0.16 |
| Playwright MCP 0.0.83 (Edge) | 3/3 | 12.0 | 351k | 59 s | $0.24 |
| chrome-devtools-mcp 1.12.0 (Edge) | 3/3 | 13.0 | 475k | 62 s | $0.27 |

What the pilot found and fixed in ZYNLEX: a tab activated while the window was
minimized never got its webview (the switch gave up after ~400 ms); an agent
action now restores the window without taking focus. `check reload` repeated a
failure from before the reload. Action diffs only covered interactive
elements, so a changed total was invisible and the agent fell back to
`snapshot full`; diffs now cover all text, and `check reload` returns the new
page.

Not yet evidence: one run per cell, three tasks, and ZYNLEX was tuned against
these same tasks (its coupon and search runs predate the last two fixes). All
three bugs can also be found by reading the code. The full run needs new
tasks that only the running app reveals (layout, timing, data from the API),
five repeats, and playwright-cli and agent-browser added.

### Full run (2026-10-31 to 11-01)

Six new tasks in `fixture2`, each a bug the running page shows: deal prices
in cents, a discount reset on add, a 1 s timeout on a 1.5 s endpoint, an email
pattern that rejects `.com`, a session cookie scoped to `Path=/api/login`, and
a closed promo that still covers Checkout. Five tools (adding playwright-cli
0.1.22 and agent-browser 0.41.0, both CLIs the agent runs through Bash limited
to that one command), five repeats each: 150 runs, then 30 more for ZYNLEX v2.
External tools drive installed Chrome, headless, with a fresh profile per run.
Harness, fixtures, raw results and transcripts: `D:\PROJECT-TESTINGS\agent-bench`
(`run.py`, `grade.mjs`, `analyze.py`, `results-*.jsonl`, `runs-*`).

**Baseline** (ZYNLEX at 1dfa3d1) and **ZYNLEX v2** (022991d, the click fix
below). All 180 runs passed the grader.

| Tool | Pass | Browser calls (avg) | Input tokens (median) | Input tokens (avg) | Wall (median) | Cost (avg) |
|---|---|---|---|---|---|---|
| **ZYNLEX v2** | 30/30 | 7.5 | **213k** | **223k** | **43 s** | **$0.16** |
| ZYNLEX baseline | 30/30 | 13.6 | 258k | 429k | 48 s | $0.28 |
| Playwright MCP | 30/30 | 10.8 | 370k | 355k | 52 s | $0.26 |
| chrome-devtools-mcp | 30/30 | 11.1 | 404k | 424k | 46 s | $0.28 |
| playwright-cli | 30/30 | 10.6 | 387k | 388k | 116 s | $0.25 |
| agent-browser | 30/30 | 7.6 | 385k | 391k | 88 s | $0.28 |

Median input tokens per task:

| Task | ZYNLEX v2 | ZYNLEX baseline | Playwright MCP | DevTools MCP | playwright-cli | agent-browser |
|---|---|---|---|---|---|---|
| deals | **196k** | 180k | 229k | 298k | 280k | 272k |
| discount | **261k** | 261k | 472k | 531k | 473k | 553k |
| stock | **158k** | 217k | 329k | 362k | 319k | 409k |
| checkout | **226k** | 229k | 339k | 403k | 444k | 301k |
| login | **215k** | 943k | 369k | 501k | 370k | 393k |
| signup | **202k** | 851k | 393k | 406k | 409k | 363k |

ZYNLEX v2 is cheapest on every task: 42% fewer input tokens than the next tool
at the median, about 40% lower cost, and the fastest. Browser calls tie with
agent-browser; ZYNLEX's calls each return more of what the agent needs, so
fewer turns re-read context.

What the baseline exposed and v2 fixed: on login and signup the submit button
sat under a fixed promo bar after `DOM.scrollIntoViewIfNeeded`, the click
landed on the bar, and `act` said "Page unchanged"; agents retried for 20+
calls. `click` now hit-tests the element's centre (`elementFromPoint`),
re-scrolls it to the middle when covered, and otherwise fails with what covers
it (`e18 is covered by div#promo "Promo" … Nothing was clicked`). Verified live
on both tasks.

Caveats, in order of weight:

- ZYNLEX was improved against these same tasks. The fix is generic (Playwright
  does the same check), but a held-out set of new tasks is the honest next test.
- Login for v2 ran with a host per run (`run<port>.localhost`). On
  `127.0.0.1`, ZYNLEX's persistent profile kept the session cookie a previous
  run had set after fixing the bug (cookies ignore ports), so the bug didn't
  reproduce and agents lost calls on it. The other tools start a fresh profile
  per run and weren't affected. Real use has the same trait: the profile that
  keeps you signed in can also hide a cookie bug.
- The CLI tools ran without the agent skill files they ship (the agent got
  `--help`); with them they may need fewer calls.
- One model (Sonnet), one small app, one grader check per task, Windows only.

### Held-out run (2026-11-01, 125 runs)

Answers the first caveat above. Five tasks written *after* ZYNLEX v2, in a new
app (`fixture3`, a task board), including areas ZYNLEX was never built or tuned
for. Rule: no ZYNLEX changes until the run is finished, whatever it shows.

| Task | Symptom | Tests |
|---|---|---|
| iframe | "Send feedback" (in an iframe) does nothing | ZYNLEX snapshots don't walk iframes |
| confirm | Confirming "Delete …?" doesn't delete | Native `confirm()`; ZYNLEX has no dialog tool |
| storage | Dark mode doesn't survive a reload | Reload + localStorage |
| enter | Enter in "New task" doesn't add it | Keyboard input |
| loadmore | "Load more" repeats the first page | Only visible in network requests |

Same harness, ZYNLEX v2 build, every tool on its own host per run
(`--host-per-run`), five repeats.

All 125 runs passed the grader. ZYNLEX was killed at the 900 s cap on 3 of its
5 confirm runs (fix already written each time, so they still graded as passes).

| Tool | Browser calls (median) | Input tokens (median) | Wall (median) | Timeouts |
|---|---|---|---|---|
| **ZYNLEX v2** | 6 | **179k** | **34 s** | 3 |
| Playwright MCP | 9 | 278k | 42 s | 0 |
| chrome-devtools-mcp | 11 | 396k | 44 s | 0 |
| playwright-cli | 11 | 365k | 88 s | 0 |
| agent-browser | 6 | 323k | 64 s | 0 |

Median input tokens per task:

| Task | ZYNLEX v2 | Playwright MCP | DevTools MCP | playwright-cli | agent-browser |
|---|---|---|---|---|---|
| iframe | **206k** | 278k | 355k | 372k | 384k |
| enter | **162k** | 220k | 391k | 324k | 228k |
| loadmore | **167k** | 305k | 403k | 330k | 299k |
| storage | **164k** | 260k | 341k | 248k | 292k |
| confirm | 1,038k | **296k** | 396k | 422k | 358k |

On tasks it was never tuned for, ZYNLEX is still cheapest on four of five, by
26–45% against the next tool, including iframe, which its page outline
doesn't even reach (the network log carried it). The fifth is the one gap the
held-out set was built to find:

**ZYNLEX can't handle a native dialog.** Once `confirm()` is
open, the page's script is paused, so every call that touches the page waits
until the 30 s bridge timeout and returns "ZYNLEX didn't answer"; ZYNLEX
neither reports the dialog nor can accept or dismiss it. Agents fix it from
the code alone after 11+ timeouts (smoke run: 1.13M tokens, 896 s; held-out
run: killed at the 900 s cap, fix already written, so the grader passed it).
The other four tools report the dialog and let the agent answer it. Costs of
killed runs aren't reported, so the tables use tokens.

Dialog support followed in 116188d (v3, below).

### Dialog support, v3 (2026-11-01, 25 runs)

ZYNLEX now subscribes to `Page.javascriptDialogOpening/Closed` per tab. While
a dialog is open, page tools reply at once with its type and message instead
of waiting on the paused page; a click or key press that opens one returns as
soon as it opens; `act` gains `accept`/`dismiss` (with `text` for `prompt()`)
through `Page.handleJavaScriptDialog`. Checked live: the click returns in
0.1–0.2 s with "A confirm dialog is open: …", `accept` and `dismiss` close it,
and a person still sees the same native dialog: `Page.enable` doesn't hide it
(window captures of v2 and v3 match).

ZYNLEX v3 on the same five held-out tasks, five repeats:

| | Pass | Timeouts | Browser calls (median) | Input tokens (median) | Input tokens (avg) | Wall (median) |
|---|---|---|---|---|---|---|
| **ZYNLEX v3** | 25/25 | 0 | 7 | **186k** | **191k** | 39 s |
| ZYNLEX v2 | 25/25 | 3 | 6 | 179k | 345k | 34 s |
| Playwright MCP | 25/25 | 0 | 9 | 278k | 275k | 42 s |

| Task | ZYNLEX v3 | ZYNLEX v2 | Best other tool |
|---|---|---|---|
| confirm | **179k** | 1,038k | 296k (Playwright MCP) |
| storage | **128k** | 164k | 248k (playwright-cli) |
| loadmore | **169k** | 167k | 299k (agent-browser) |
| iframe | **223k** | 206k | 278k (Playwright MCP) |
| enter | **198k** | 162k | 220k (Playwright MCP) |

ZYNLEX v3 is cheapest on all five, a third fewer input tokens than the next
tool on average, with no timeouts. Caveats: `confirm` is no longer held out
for v3 (the fix came after seeing it fail); `enter` and `iframe` moved by
about 20k between v2 and v3 with no related code change, which is
run-to-run noise at five repeats. One v3 run (`iframe-0`) was re-graded:
its first grader run printed nothing (Edge didn't start, right after a
reboot) and passed when re-run on the run's own files (`regrade.py`); the
harness now retries the grader and keeps its errors.

### Agent skill (2026-11-02, 50 runs)

Does `agent/skills/zynlex/SKILL.md` make agents cheaper? ZYNLEX v3 on the five
held-out tasks, five repeats per arm. Turning skills on also loads Claude
Code's own built-in skills, so the comparison needs a control arm with skills
on but without this one.

| Arm | Pass | Input tokens (median) | Input tokens (avg) | Browser calls (avg) |
|---|---|---|---|---|
| Skills off (v3, above) | 25/25 | 186k | 191k | 6.8 |
| Skills on, without ZYNLEX's (control) | 25/25 | 194k | 201k | 6.0 |
| Skills on, with ZYNLEX's | 25/25 | 224k | 221k | 6.4 |

No benefit. Agents loaded the skill in only 8 of 25 runs. Those 8 cost no
more than the 17 that didn't load it (222k vs 231k median; 5.9 vs 6.7 browser
calls), yet both sit above the control, so the arm-to-arm gap is run-to-run
noise, not the skill's text, and five repeats can't resolve an effect this
small. The tool descriptions and the server's `instructions` already teach the
loop; the skill stays as an optional extra (see Setup). 21 control runs were
re-run after the account's usage limit cut them off mid-run.

### Other agents (2026-11-02)

Every run above used Claude Code. Single manual runs with other MCP clients,
same app, prompt and grader (kit: `D:\PROJECT-TESTINGS\agent-try`), ZYNLEX v3:

| Agent | Task | Connected | Grader | Notes |
|---|---|---|---|---|
| Antigravity | confirm | yes (asked to allow each tool) | **PASS** | Used ZYNLEX, not its own browser. One-line fix (`=== "true"` removed). Root cause in its words: "strictly compared the boolean return value of confirm() against the string 'true', which always evaluated to false." |
| OpenCode | confirm | yes (`opencode mcp list`) | not run | CLI: every free model answered "Free usage limit reached". To run from the desktop app. |
| Codex (app) | confirm | yes (asked to approve each tool) | **PASS** | About 1 minute. Same one-line fix. Has its own browser plugin, but ZYNLEX held the active tab on its test app afterwards, so the browser work went through ZYNLEX. |

With Claude Code, that's three agents from three vendors working through the
same MCP server unchanged. No token counts here: these are "does it work with
another client" checks, not benchmark runs.

## Phases

1. **Read-only. Built.** Pipe, MCP server, frontend dispatcher
   ([src/lib/agent.ts](../src/lib/agent.ts)), localhost-only scope, status-bar
   indicator + Stop (later Pause/take-over and the activity panel). Tools: `tabs`, `check` (no reload), `errors`, `network`,
   `screenshot`. Useful on its own and can't change anything.
2. **Driving. Built.** `snapshot`, `act`, `open`, `check` with `reload`, settle
   rule ([agentSnapshot.ts](../src/lib/agentSnapshot.ts)).
3. **MCP + skill + benchmark. Done.** MCP server, tuned and held-out
   benchmarks, dialog support (v3), and the agent skill (measured: no
   benefit over the MCP instructions; kept as optional).
4. **Developer features.** `mock` and console levels done (untested on
   Windows); `eval`, flag-for-agent, scope grants UI to do.

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
- Put `zynlex-mcp.exe` on `PATH` from the installer, or have a "Copy MCP
  setup command" button in ZYNLEX that fills in the real path?
