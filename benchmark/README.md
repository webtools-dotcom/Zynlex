# Browser tools for AI coding agents: a benchmark

How much does it cost Claude Code to find and fix a bug in a local web app,
depending on the browser tool it has? This folder has everything needed to
check the numbers in ZYNLEX's README: the harness, the three buggy apps, the
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
| `playwright` | [Playwright MCP](https://github.com/microsoft/playwright-mcp), Chrome, headless, isolated | 0.0.83 |
| `devtools` | [Chrome DevTools MCP](https://github.com/ChromeDevTools/chrome-devtools-mcp), headless, isolated | 1.12.0 |
| `pwcli` | [playwright-cli](https://www.npmjs.com/package/@playwright/cli), through Bash | 0.1.22 |
| `agentbrowser` | [agent-browser](https://www.npmjs.com/package/agent-browser), through Bash | 0.41.0 |

## Tasks

- **Tuned set** (`fixture`, `fixture2`; `deals`, `discount`, `stock`, `signup`,
  `login`, `checkout`): the tasks ZYNLEX was developed against. Expect ZYNLEX
  to look its best here.
- **Held-out set** (`fixture3`; `iframe`, `confirm`, `storage`, `enter`,
  `loadmore`): written after ZYNLEX's tools were frozen, to check the lead
  isn't an artefact of tuning. ZYNLEX changed afterwards (dialog support,
  multi-step `act`), so later held-out rounds are no longer blind; the
  same-day comparison below reruns Playwright MCP too.

## Results

All rows: Claude Code, `sonnet`, one Windows 11 laptop, 5 repeats per task and
tool. "Tokens" is the median input tokens per task, cache reads included: most
of it is Claude Code re-sending its own context every turn, so a tool that
needs fewer turns wins even when its replies are the same size.

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
