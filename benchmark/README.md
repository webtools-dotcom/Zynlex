# Browser tools for AI coding agents: a benchmark

How much does it cost Claude Code to find and fix a bug in a local web app,
depending on the browser tool it has? This folder has everything needed to
check the numbers in ZYNLEX's README: the harness, the four buggy apps, the
graders and every result row.

## What one run is

1. A fresh copy of a small web app with one planted bug starts on its own port.
2. Headless Claude Code (`claude -p`, model `sonnet`) gets the bug report as
   the user would write it (for example *"Pressing Enter in the New task box
   doesn't add the task (clicking Add works)."*), file tools (Read, Edit,
   Write, Glob, Grep) and exactly **one** browser tool: an MCP server, or a
   CLI it may run through Bash and nothing else. No skills, no slash commands,
   no project settings except the MCP config.
3. When the agent stops, `grade.mjs` checks the fix in headless Edge with
   Playwright and prints PASS or FAIL.
4. The row records pass/fail, input and output tokens, cost, wall time, tool
   calls and turns (from Claude Code's own transcript).

Each tool gets the same prompt, the same model and the same app copy.

## Tools compared

| Name in results | Tool | Version |
|---|---|---|
| `zynlex` | ZYNLEX's MCP server, `zynlex-mcp` | see each results file |
| `playwright` | [Playwright MCP](https://github.com/microsoft/playwright-mcp), Chrome, headless, isolated | 0.0.83; 0.0.85 on the fresh set |
| `devtools` | [Chrome DevTools MCP](https://github.com/ChromeDevTools/chrome-devtools-mcp), headless, isolated | 1.12.0; 1.13.0 on the fresh set |
| `pwcli` | [playwright-cli](https://www.npmjs.com/package/@playwright/cli), through Bash | 0.1.22 |
| `agentbrowser` | [agent-browser](https://www.npmjs.com/package/agent-browser), through Bash | 0.41.0; 0.43.0 on the fresh set |
| `kitesurf` | Playwright MCP over CDP to [Kitesurf](https://github.com/cloudflare/kitesurf), Cloudflare's WebAssembly browser engine, run locally with `wrangler dev` | MCP 0.0.83, Kitesurf `c7b1301` |
| `browse` | [OpenCode Browse](https://github.com/anomalyco/browse): MCP server + extension in a Chromium with its own profile; Claude Code gets its `execute` tool | 0.1.0; 0.1.1 on the fresh set |

## Tasks

- **Tuned set** (`fixture`, `fixture2`; `deals`, `discount`, `stock`, `signup`,
  `login`, `checkout`): the tasks ZYNLEX was developed against. Expect ZYNLEX
  to look its best here.
- **Held-out set** (`fixture3`; `iframe`, `confirm`, `storage`, `enter`,
  `loadmore`): written after ZYNLEX's tools were frozen, to check the lead
  isn't an artefact of tuning. ZYNLEX changed afterwards (dialog support,
  multi-step `act`), so later held-out rounds are no longer blind; the
  same-day comparison below reruns Playwright MCP too.
- **Fresh set** (`fixture4`, a team-events app; `evsearch`, `details`, `price`,
  `seats`, `comments`, `cancel`, `settings`, `mobile`): eight bugs written on
  2026-11-17 by an agent told nothing about ZYNLEX or any browser tool, with
  their grader (`grade4.mjs`). Each fix was checked to turn its grader from
  FAIL to PASS on its own; the solutions are kept out of this folder so no
  agent can read them.

## Results

All rows: Claude Code, `sonnet`, one Windows 11 laptop, 5 repeats per task and
tool (3 on the fresh set). "Tokens" is the median input tokens per task, cache reads included: most
of it is Claude Code re-sending its own context every turn, so a tool that
needs fewer turns wins even when its replies are the same size.

### Fresh set, 8 tasks (2026-11-17)

`results/fresh-2026-11-17.jsonl`, 3 repeats, every tool the same day.
`zynlex` is main at `0ffb7b2`, blind to these bugs. `zynlex-0.19` is the
0.19.0 build, with the fixes its runs pointed to (`zynlex-round2` is the
round before the last one, kept for the record): a script's
`goto` to another site opens its own tab (the old one reused the active tab,
so the 375 px emulation from a `mobile` run leaked into later runs), `type()`
sends one input event per key (so `evsearch`'s keystroke race reproduces),
`goto` reaches another `#route` of the open page, and `boundingBox`,
`elementHandle`, `context().cookies()`, `waitForResponse`, single-key
`press` and XPath selectors exist, and `setViewportSize` before `goto` sizes
the script's own tab (the last round: it had sized the old tab, so phone-only
bugs didn't show). Those were made with these bugs in view.

| Tool | Fixed | Tokens | Turns | Browser calls | Cost per task | Total cost |
|---|---|---|---|---|---|---|
| ZYNLEX 0.19 | 24/24 | 176k | 8 | 2 | $0.167 | $4.01 |
| ZYNLEX, round 2 | 24/24 | 170k | 8.5 | 3 | $0.170 | $4.07 |
| ZYNLEX, blind | 24/24 | 222k | 11.5 | 5.5 | $0.210 | $5.05 |
| OpenCode Browse 0.1.1 | 24/24 | 290k | 13.5 | 7.5 | $0.232 | $5.56 |
| Playwright MCP 0.0.85 | 24/24 | 511k | 19.5 | 14.5 | $0.384 | $9.22 |
| agent-browser 0.43.0 | 24/24 | 541k | 21.5 | 15 | $0.354 | $8.49 |
| Chrome DevTools MCP 1.13.0 | 23/24 | 565k | 19 | 14 | $0.382 | $9.16 |

All 24 runs, not just the middle one: total input tokens, the cheapest and
dearest run, and time (wall clock, from Claude Code starting to the agent
stopping):

| Tool | Tokens, all runs | Cheapest run | Dearest run | Time per run (median) | Time, all runs |
|---|---|---|---|---|---|
| ZYNLEX 0.19 | 4.35M | 128k | 272k | 42 s | 18.6 min |
| ZYNLEX, round 2 | 4.49M | 128k | 383k | 46 s | 20.2 min |
| ZYNLEX, blind | 6.16M | 128k | 900k | 57 s | 25.2 min |
| OpenCode Browse 0.1.1 | 6.69M | 129k | 598k | 55 s | 24.4 min |
| Playwright MCP 0.0.85 | 14.84M | 379k | 1,239k | 66 s | 29.4 min |
| agent-browser 0.43.0 | 13.98M | 328k | 1,035k | 132 s | 55.6 min |
| Chrome DevTools MCP 1.13.0 | 14.63M | 293k | 1,446k | 61 s | 26.3 min |

Per bug, every tool fixed all 3 runs, except DevTools MCP on `evsearch`
(2 of 3). Median time per bug, in seconds:

| Task | ZYNLEX 0.19 | ZYNLEX, blind | Browse | Playwright MCP | agent-browser | DevTools MCP |
|---|---|---|---|---|---|---|
| `evsearch` | 38 | 86 | 76 | 61 | 131 | 66 |
| `details` | 27 | 33 | 31 | 64 | 120 | 35 |
| `price` | 51 | 58 | 50 | 65 | 79 | 47 |
| `seats` | 49 | 46 | 82 | 112 | 162 | 73 |
| `comments` | 36 | 31 | 56 | 70 | 181 | 44 |
| `cancel` | 42 | 94 | 65 | 58 | 165 | 68 |
| `settings` | 61 | 56 | 68 | 72 | 132 | 60 |
| `mobile` | 42 | 59 | 50 | 62 | 98 | 78 |

What "tokens" counts: every input token of the whole Claude Code run, every
turn (cache reads and writes included), so the system prompt, each tool's
instructions and tool list, and every retry or failed call inside the run are
in it. Output tokens are in the results file, not these tables. A run that
didn't fix its bug stays in the medians and totals (DevTools MCP's failed
`evsearch` run is its dearest, 1.45M).

How this round was run, and what the next one changes: the tools ran one
after another (all of ZYNLEX's runs, then Playwright MCP's, and so on), not
interleaved. The other tools start a clean browser per run; ZYNLEX's runs
shared one app, each on its own host and origin (so separate storage), and
that sharing is how the `mobile` run's viewport leaked into later runs before
the fix. The next round freezes ZYNLEX before it starts, uses bugs it hasn't
seen, interleaves the tools in random order, and closes the app's tabs and
emulation between runs.

Median tokens per bug:

| Task | ZYNLEX 0.19 | ZYNLEX, blind | Browse | Playwright MCP | agent-browser | DevTools MCP |
|---|---|---|---|---|---|---|
| `evsearch` | 131k | 329k | 330k | 414k | 459k | 704k |
| `details` | 129k | 186k | 154k | 540k | 418k | 327k |
| `price` | 250k | 252k | 294k | 479k | 371k | 472k |
| `seats` | 212k | 169k | 334k | 1,097k | 584k | 695k |
| `comments` | 169k | 128k | 263k | 598k | 757k | 462k |
| `cancel` | 156k | 257k | 318k | 467k | 691k | 637k |
| `settings` | 211k | 180k | 336k | 499k | 644k | 552k |
| `mobile` | 176k | 317k | 216k | 440k | 512k | 761k |

Blind ZYNLEX was cheapest on six of eight bugs (Browse won `details` and
`mobile`); ZYNLEX 0.19 on all eight. Round 2 had lost `mobile` (224k vs 216k):
its agents set the phone size on the old tab, or in separate calls. Bugs
vary run to run by how much code the agent reads, so the ZYNLEX columns trade
places on single bugs (blind was lower on `seats`, `comments` and `settings`);
its browser calls didn't go up. The one
failure is DevTools MCP's first `evsearch` run.

### Tuned set, 6 tasks (2026-10-31 to 11-01)

`results/tuned.jsonl`. ZYNLEX at that point had 8 tools and no dialog support.

| Tool | Fixed | Timed out | Tokens | Turns | Browser calls | Cost per task |
|---|---|---|---|---|---|---|
| ZYNLEX | 30/30 | 0 | 258k | 15 | 9 | $0.171 |
| Playwright MCP | 30/30 | 0 | 370k | 16.5 | 10.5 | $0.256 |
| agent-browser | 30/30 | 0 | 385k | 14 | 8 | $0.274 |
| playwright-cli | 30/30 | 0 | 387k | 17.5 | 11 | $0.240 |
| Chrome DevTools MCP | 30/30 | 0 | 404k | 16.5 | 11 | $0.283 |

### Held-out set, 5 tasks (2026-11-01)

`results/heldout-2026-11-01.jsonl`, `results/heldout-zynlex-v3-2026-11-01.jsonl`. The first ZYNLEX row is the build the tasks were written against. It had no dialog support, so `confirm` hung until the 15-minute limit: 3 runs timed out (the grader still passed them, because the fix had been made). Their tokens are rebuilt from the transcripts; turns and cost leave them out. v3 added dialog support.

| Tool | Fixed | Timed out | Tokens | Turns | Browser calls | Cost per task |
|---|---|---|---|---|---|---|
| ZYNLEX, blind build | 25/25 | 3 | 179k | 11 | 6 | $0.124 |
| ZYNLEX v3, dialogs | 25/25 | 0 | 186k | 12 | 7 | $0.131 |
| Playwright MCP | 25/25 | 0 | 278k | 14 | 9 | $0.199 |
| agent-browser | 25/25 | 0 | 323k | 13 | 6 | $0.241 |
| playwright-cli | 25/25 | 0 | 365k | 18 | 11 | $0.221 |
| Chrome DevTools MCP | 25/25 | 0 | 396k | 16 | 11 | $0.243 |

### Held-out set, same day (2026-11-05)

Playwright MCP rerun the same day as ZYNLEX, because the model behind `sonnet` had changed since 11-01. Three ZYNLEX builds: all 13 tools; shorter tool descriptions (two rounds, 50 runs); and `act` with `steps`, several actions in one call.

| Tool | Fixed | Timed out | Tokens | Turns | Browser calls | Cost per task |
|---|---|---|---|---|---|---|
| ZYNLEX, act `steps` | 25/25 | 0 | 173k | 10 | 5 | $0.119 |
| ZYNLEX, short descriptions | 50/50 | 0 | 190k | 11 | 7 | $0.137 |
| ZYNLEX, 13 tools | 25/25 | 0 | 198k | 11 | 6 | $0.133 |
| Playwright MCP | 25/25 | 0 | 240k | 12 | 7 | $0.187 |

### Held-out set, same day (2026-11-09)

`results/heldout-2026-11-09.jsonl`. ZYNLEX 0.18 (release build of `main` at 77a57e7: actions shown in the page, port owners, WebSocket frames, web vitals, per-agent views), with Playwright MCP again the same day.

| Tool | Fixed | Timed out | Tokens | Turns | Browser calls | Cost per task |
|---|---|---|---|---|---|---|
| ZYNLEX 0.18 | 25/25 | 0 | 176k | 10 | 5 | $0.124 |
| Playwright MCP | 25/25 | 0 | 262k | 13 | 8 | $0.196 |

ZYNLEX used fewer tokens on all five bugs. Two of its five `loadmore` runs cost about twice the usual (387k and 399k): after fixing the code the agent re-opened its tab with `open`, which switched to it without reloading, so it tested the old script. Since 0.18, `open` reloads a tab the agent opened.

### Kitesurf, held-out set (2026-11-15)

`results/kitesurf-2026-11-15.jsonl`, 3 repeats. The same agent and Playwright MCP, once on Chrome and once on Kitesurf, with ZYNLEX (build of `f1b678d`: 0.18 plus memory work) the same day.

| Tool | Fixed | Timed out | Tokens | Turns | Browser calls | Cost per task |
|---|---|---|---|---|---|---|
| ZYNLEX | 15/15 | 0 | 177k | 10 | 6 | $0.133 |
| Playwright MCP on Chrome | 15/15 | 0 | 264k | 13 | 8 | $0.190 |
| Playwright MCP on Kitesurf | 15/15 | 1 | 491k | 19 | 16 | $0.274 |

Median tokens per bug, ZYNLEX / Chrome / Kitesurf: `iframe` 174k / 268k / 1,113k, `storage` 197k / 277k / 1,108k, `confirm` 177k / 263k / 491k, `loadmore` 217k / 265k / 311k, `enter` 157k / 212k / 241k.

The agent fixed every bug on Kitesurf, but where the bug needed the browser to confirm, it struggled:

- `iframe`: evaluating inside a same-origin iframe never returns over CDP, so all three runs used their 40 turns trying to look inside it and stopped without a final answer (the code fix was already made).
- `storage`: `localStorage` is kept per document, so a value is gone after a reload, and `Object.keys(localStorage)` lists the method names. One run hit the 15-minute limit; its tokens are rebuilt from the transcript, turns and cost leave it out.
- `confirm`: `confirm()` isn't supported yet, which Kitesurf already notes.

Kitesurf launched in August 2026 and is still experimental; this measures it as an agent's browser today, not where it is going. The storage and iframe issues are reported to Kitesurf with minimal reproductions: [cloudflare/kitesurf#133](https://github.com/cloudflare/kitesurf/issues/133), [cloudflare/kitesurf#134](https://github.com/cloudflare/kitesurf/issues/134).

### Script tool and OpenCode Browse, held-out set (2026-11-17)

`results/heldout-2026-11-17.jsonl`, 3 repeats, all the same day. OpenCode Browse's `execute` tool runs a whole Playwright-style script per call, and it beat ZYNLEX's `act` on four of five bugs that morning. ZYNLEX's answer is `script` (see [docs/agent-interface.md](../docs/agent-interface.md#scripts)); `zynlex-script` is ZYNLEX with it.

| Tool | Fixed | Ran out of turns | Tokens | Turns | Browser calls | Cost per task | Total cost |
|---|---|---|---|---|---|---|---|
| ZYNLEX with `script` | 15/15 | 0 | 108k | 7 | 2 | $0.097 | $1.53 |
| OpenCode Browse 0.1.0 | 15/15 | 3 | 128k | 9 | 3 | $0.118 | $3.57 |
| ZYNLEX without `script` | 15/15 | 0 | 175k | 10 | 5 | $0.122 | $1.96 |
| Playwright MCP | 15/15 | 0 | 283k | 14 | 9 | $0.211 | $3.13 |

Median tokens per bug, ZYNLEX with `script` / Browse: `confirm` 127k / 1,112k, `enter` 106k / 108k, `iframe` 107k / 125k, `loadmore` 108k / 128k, `storage` 129k / 128k. On `confirm`, all three Browse runs fixed the code but ran out of turns: its `dialog` tool reports "No dialog is open" while the page is blocked on one. Leaving `confirm` out, ZYNLEX with `script` used 1.35M tokens and $1.20 in all, Browse 1.51M and $1.41.

Not blind: `script`'s instructions were tuned over three rounds on these five bugs (the rounds, 163k and 109k median, are what led to telling agents to read the code before scripting, listing the page's controls when a selector misses, `frameLocator`, and reloading past the cache). A new held-out set is the next check.

## Caveats

- One machine, one model family, small apps written for this. Five repeats
  per cell: differences of a few percent are noise.
- Our own harness and our own tasks; that's why everything is here to rerun.
- The ZYNLEX runs use the developer's real ZYNLEX window (that's the product),
  the others a headless browser each. Wall time isn't comparable for that
  reason; tokens and cost are.
- Until 2026-11-05 a dev-build bug made ZYNLEX occasionally run a tool call
  twice in the page right after startup. The agent only ever saw the first
  reply, so token counts aren't affected.

## Running it

Windows, Python 3.12+, Node 20+, Claude Code signed in, Chrome and Edge.

```bash
npm install
python run.py --tools zynlex,playwright --tasks iframe,confirm,storage,enter,loadmore --repeats 5 --tag mine --host-per-run
```

ZYNLEX must be open; its MCP server is found on `PATH` (the installer puts it
there), or set `ZYNLEX_MCP`. `--host-per-run` gives each run its own
`runNNNN.localhost` host, because cookies ignore ports and ZYNLEX keeps one
real profile. Results append to `results-<tag>.jsonl`, transcripts go to
`runs-<tag>/`. Each run bills your Claude account.
