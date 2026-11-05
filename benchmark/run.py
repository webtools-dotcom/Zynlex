"""Benchmark harness: one headless Claude Code run per (repeat, task, tool).

    python run.py --tools zynlex,playwright,devtools,pwcli,agentbrowser \
        --tasks deals,discount,stock,signup,login,checkout --repeats 5 --tag full

Each run gets a fresh copy of its task's fixture on its own port, the same
prompt, the same model, the file tools, and exactly one browser tool: an MCP
server (named "browser" for every MCP tool) or a CLI the agent may run through
Bash and nothing else. Afterwards grade.mjs checks the fix in a headless Edge.
Results append to results-<tag>.jsonl; transcripts go to runs-<tag>/<id>/.
"""
import argparse, json, os, shutil, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
CHROME = os.environ.get("CHROME", r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe")
# On PATH after the ZYNLEX installer; or set ZYNLEX_MCP, or pass --zynlex-mcp.
ZYNLEX_MCP = os.environ.get("ZYNLEX_MCP", "zynlex-mcp")
BIN = os.path.join(HERE, "node_modules", ".bin")
HOST_PER_RUN = False  # set by --host-per-run
SKILL = None  # set by --skill: a skill folder installed into each run's project
SKILLS_ON = False  # set by --skill or --skills-on: Claude Code's skills enabled

MCP = {
    "zynlex": {"command": ZYNLEX_MCP, "args": []},
    "playwright": {
        "command": "cmd",
        "args": ["/c", "npx", "-y", "@playwright/mcp@0.0.83", "--browser", "chrome", "--headless", "--isolated"],
    },
    "devtools": {
        "command": "cmd",
        "args": ["/c", "npx", "-y", "chrome-devtools-mcp@1.12.0", "--executablePath", CHROME, "--headless", "--isolated"],
    },
}

# CLI tools: the command the agent may run, the env that isolates one run's
# browser session, and how to shut that session down afterwards.
CLI = {
    "pwcli": {
        "cmd": "playwright-cli",
        "env": lambda run_id: {"PLAYWRIGHT_MCP_BROWSER": "chrome", "PLAYWRIGHT_CLI_SESSION": run_id},
        "close": lambda run_id: f"playwright-cli -s={run_id} close",
    },
    "agentbrowser": {
        "cmd": "agent-browser",
        "env": lambda run_id: {"AGENT_BROWSER_SESSION": run_id},
        "close": lambda run_id: f"agent-browser --session {run_id} close",
    },
}

TASKS = {
    # pilot (fixture)
    "coupon": ("fixture", "Applying the coupon SAVE10 to a cart shows \"Something went wrong\" and the total doesn't change."),
    "remove": ("fixture", "Removing an item from the cart doesn't update the total."),
    "search": ("fixture", "Searching for \"lamp\" says \"No results\", but we sell a desk lamp."),
    # full run (fixture2)
    "deals": ("fixture2", "The prices on the Deals list look about a hundred times too high."),
    "discount": ("fixture2", "If I apply the coupon SAVE10 and then add another item, the discount disappears."),
    "stock": ("fixture2", "\"Check stock\" always says \"Out of stock\", but the warehouse says we have plenty."),
    "signup": ("fixture2", "Signing up with jane@example.com says \"Please enter a valid email\"."),
    "login": ("fixture2", "After logging in as test@example.com (password hunter2), My account still says \"Please log in\"."),
    "checkout": ("fixture2", "After closing the promo banner, the Checkout button does nothing."),
    # held out (fixture3): written after ZYNLEX v2, no ZYNLEX changes until it's run
    "iframe": ("fixture3", "In the Feedback section, clicking \"Send feedback\" does nothing: no thank-you message."),
    "confirm": ("fixture3", "Deleting a task asks \"Are you sure?\", but after I confirm, the task is still there."),
    "storage": ("fixture3", "Dark mode doesn't stick: after a reload the page is light again."),
    "enter": ("fixture3", "Pressing Enter in the New task box doesn't add the task (clicking Add works)."),
    "loadmore": ("fixture3", "\"Load more\" under Team tasks just shows the same tasks again."),
}

PROMPT = """You're working on the web app in the current folder. It's already running at {url} \
(server.py serves it and re-reads api.py on every request, so code changes apply without a restart; \
don't edit server.py and don't try to start anything).

A user reports: {symptom}

Reproduce it in the browser with your browser tool, find the cause, fix it in the code, then verify \
the fix in the browser. When you're done, reply with one line: the root cause.{hint}"""

CLI_HINT = "\n\nYour browser tool is the `{cmd}` command-line tool, which you can run with Bash \
(only that command is allowed). Run `{cmd} --help` to see what it can do."


def close_zynlex_tabs():
    """Close the tabs agents opened, so ~1 tab per run doesn't pile up in the
    developer's ZYNLEX. ZYNLEX only lets `tabs close` close agent-opened tabs,
    so the developer's own tabs are safe."""
    import re
    try:
        p = subprocess.Popen([MCP["zynlex"]["command"]], stdin=subprocess.PIPE,
                             stdout=subprocess.PIPE, text=True, encoding="utf-8")

        def call(i, method, params):
            p.stdin.write(json.dumps({"jsonrpc": "2.0", "id": i, "method": method,
                                      "params": params}) + "\n")
            p.stdin.flush()
            return json.loads(p.stdout.readline())

        call(1, "initialize", {"protocolVersion": "2025-06-18", "capabilities": {},
                               "clientInfo": {"name": "bench-cleanup", "version": "0"}})
        r = call(2, "tools/call", {"name": "tabs", "arguments": {}})
        text = "".join(c.get("text", "") for c in r.get("result", {}).get("content", []))
        ids = re.findall(r"\[([0-9a-f]{8})\] \(opened by you\)", text)
        for n, tab in enumerate(ids):
            call(3 + n, "tools/call", {"name": "tabs", "arguments": {"close": tab}})
        p.stdin.close()
        p.wait(10)
    except Exception as e:  # cleanup must never fail a benchmark run
        print(f"tab cleanup skipped: {e}", file=sys.stderr)


def run_one(tag, tool, task, rep, port, model):
    run_id = f"{tool}-{task}-{rep}"
    run_dir = os.path.join(HERE, f"runs-{tag}", run_id)
    app = os.path.join(run_dir, "app")
    fixture, symptom = TASKS[task]
    shutil.rmtree(run_dir, ignore_errors=True)
    shutil.copytree(os.path.join(HERE, fixture), app)
    if SKILL:
        shutil.copytree(SKILL, os.path.join(app, ".claude", "skills", os.path.basename(SKILL)))

    env = dict(os.environ)
    env["PATH"] = BIN + os.pathsep + env["PATH"]
    tools = "Read,Edit,Write,Glob,Grep"
    if SKILLS_ON:
        tools += ",Skill"  # how Claude Code loads a skill
    allowed = tools
    hint = ""
    servers = {}
    if tool in MCP:
        servers = {"browser": MCP[tool]}
        allowed += ",mcp__browser"
    else:
        cli = CLI[tool]
        env.update(cli["env"](run_id))
        tools += ",Bash"
        allowed += f",Bash({cli['cmd']}:*)"
        hint = CLI_HINT.format(cmd=cli["cmd"])
    # For a CLI tool this is empty, so --strict-mcp-config leaves no MCP servers.
    cfg = os.path.join(run_dir, "mcp.json")
    with open(cfg, "w") as f:
        json.dump({"mcpServers": servers}, f)

    server = subprocess.Popen(
        [sys.executable, "server.py", str(port)], cwd=app,
        stderr=open(os.path.join(run_dir, "server.log"), "w"),
    )
    time.sleep(1)
    # A host of its own per run: cookies ignore ports, so on 127.0.0.1 a session
    # cookie from an earlier run (with its fix applied) leaks into the next one
    # in a browser that keeps its profile, as ZYNLEX does. *.localhost
    # resolves to loopback in Chromium.
    url = f"http://run{port}.localhost:{port}/" if HOST_PER_RUN else f"http://127.0.0.1:{port}/"
    cmd = [
        shutil.which("claude"), "-p",
        "--model", model,
        "--mcp-config", cfg, "--strict-mcp-config",
        "--setting-sources", "project",
        # Skills stay off, except the one under test: it loads from the
        # project's .claude/skills like any project skill.
        *([] if SKILLS_ON else ["--disable-slash-commands"]),
        "--no-session-persistence",
        # The same small toolset for every run: the code, plus the browser
        # under test; for CLI tools, Bash limited to that one command.
        "--tools", tools,
        "--allowedTools", allowed,
        "--max-turns", "40",
        "--output-format", "stream-json", "--verbose",
    ]
    t0 = time.time()
    with open(os.path.join(run_dir, "transcript.jsonl"), "w", encoding="utf-8") as out:
        try:
            # The prompt goes in on stdin: claude is a .cmd shim on Windows,
            # which mangles multi-line arguments.
            subprocess.run(cmd, cwd=app, stdout=out, stderr=subprocess.STDOUT, timeout=900, env=env,
                           input=PROMPT.format(url=url, symptom=symptom, hint=hint).encode())
            timed_out = False
        except subprocess.TimeoutExpired:
            timed_out = True
    wall = time.time() - t0

    if tool in CLI:
        subprocess.run(CLI[tool]["close"](run_id), cwd=app, env=env, capture_output=True,
                       timeout=60, shell=True)
    if tool == "zynlex":
        close_zynlex_tabs()
    # Once more if the grader prints nothing (Edge failing to start); keep
    # its stderr, so a crash is visible instead of reading as a FAIL.
    for _ in range(2):
        g = subprocess.run(["node", "grade.mjs", task, str(port)], cwd=HERE,
                           capture_output=True, text=True)
        grade = g.stdout.strip()
        if grade:
            break
        with open(os.path.join(run_dir, "grade-error.log"), "a") as f:
            f.write(g.stderr)
    server.kill()

    stats = summarize(os.path.join(run_dir, "transcript.jsonl"), CLI[tool]["cmd"] if tool in CLI else None)
    row = {"id": run_id, "tool": tool, "task": task, "rep": rep, "model": model,
           "pass": grade == "PASS", "grade": grade, "timed_out": timed_out,
           "wall_s": round(wall, 1), **stats}
    with open(os.path.join(HERE, f"results-{tag}.jsonl"), "a") as f:
        f.write(json.dumps(row) + "\n")
    return row


def summarize(path, cli_cmd):
    """Tool calls, browser output volume and token usage from a stream-json transcript.

    A browser call is an MCP call to the "browser" server, or (CLI tools) a
    Bash call that runs the browser CLI; other Bash calls are refused in those
    runs and count as other calls.
    """
    browser_ids, other_calls, browser_chars, images = set(), 0, 0, 0
    result = {}
    for line in open(path, encoding="utf-8", errors="replace"):
        try:
            ev = json.loads(line)
        except ValueError:
            continue
        content = (ev.get("message") or {}).get("content")
        if ev.get("type") == "assistant":
            for b in content or []:
                if b.get("type") == "tool_use":
                    if b["name"].startswith("mcp__browser__") or (
                        cli_cmd and b["name"] == "Bash"
                        and b["input"].get("command", "").lstrip().startswith(cli_cmd)
                    ):
                        browser_ids.add(b["id"])
                    else:
                        other_calls += 1
        elif ev.get("type") == "user" and isinstance(content, list):
            for b in content:
                if b.get("type") == "tool_result" and b.get("tool_use_id") in browser_ids:
                    c = b.get("content")
                    for x in [{"type": "text", "text": c}] if isinstance(c, str) else c or []:
                        if x.get("type") == "image":
                            images += 1
                        else:
                            browser_chars += len(x.get("text", ""))
        elif ev.get("type") == "result":
            result = ev
    u = result.get("usage", {})
    return {
        "browser_calls": len(browser_ids),
        "other_calls": other_calls,
        "turns": result.get("num_turns"),
        "input_tokens": u.get("input_tokens", 0) + u.get("cache_creation_input_tokens", 0)
        + u.get("cache_read_input_tokens", 0),
        "output_tokens": u.get("output_tokens", 0),
        "cost_usd": result.get("total_cost_usd"),
        "browser_output_chars": browser_chars,
        "screenshots": images,
        "is_error": result.get("is_error"),
        "answer": (result.get("result") or "")[:300],
    }


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--tools", default="zynlex,playwright,devtools,pwcli,agentbrowser")
    ap.add_argument("--tasks", default="deals,discount,stock,signup,login,checkout")
    ap.add_argument("--repeats", type=int, default=1)
    ap.add_argument("--first-rep", type=int, default=0)
    ap.add_argument("--model", default="sonnet")
    ap.add_argument("--tag", default="full")
    # ZYNLEX reuses a tab with the same URL, so no two runs may share a port.
    ap.add_argument("--port-base", type=int, default=5400)
    # Resume an interrupted run: skip ids already in results-<tag>.jsonl.
    # Give it a fresh --port-base, so no run reuses an old run's tab.
    ap.add_argument("--resume", action="store_true")
    ap.add_argument("--host-per-run", action="store_true")
    # Another build's MCP server, e.g. zynlex-v3-target/release/zynlex-mcp.exe.
    ap.add_argument("--zynlex-mcp")
    ap.add_argument("--skill", help="skill folder to install in every run's project")
    # The control for --skill: skills on (Claude Code's built-in ones load
    # too), without the skill under test.
    ap.add_argument("--skills-on", action="store_true")
    a = ap.parse_args()
    HOST_PER_RUN = a.host_per_run
    if a.zynlex_mcp:
        MCP["zynlex"]["command"] = a.zynlex_mcp
    SKILL = a.skill
    SKILLS_ON = bool(a.skill) or a.skills_on
    done = set()
    path = os.path.join(HERE, f"results-{a.tag}.jsonl")
    if a.resume and os.path.exists(path):
        done = {json.loads(line)["id"] for line in open(path)}
    n = 0
    # Repeat-major: an early stop still leaves every (task, tool) evenly covered.
    for rep in range(a.first_rep, a.first_rep + a.repeats):
        for task in a.tasks.split(","):
            for tool in a.tools.split(","):
                if f"{tool}-{task}-{rep}" in done:
                    continue
                n += 1
                row = run_one(a.tag, tool, task, rep, a.port_base + n, a.model)
                print(json.dumps({k: row[k] for k in (
                    "id", "pass", "browser_calls", "other_calls", "input_tokens",
                    "output_tokens", "cost_usd", "wall_s")}), flush=True)
