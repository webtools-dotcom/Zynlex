"""Summarize a results-<tag>.jsonl: python analyze.py full [zynlex-v2 ...]

Per tool: pass rate, median and mean browser calls, input tokens, wall time
and cost; then input tokens per task, so one task can't hide behind an
average. Medians lead because a single runaway run skews a mean of five.
"""
import json, statistics, sys

TOOLS = ["zynlex", "playwright", "devtools", "pwcli", "agentbrowser"]


def tokens_from_transcript(path):
    """Input tokens of a run that was killed before its final usage report:
    the sum over its model calls, each counted once (stream-json repeats a
    message's usage on every content block)."""
    seen, total = set(), 0
    for line in open(path, encoding="utf-8", errors="replace"):
        try:
            ev = json.loads(line)
        except ValueError:
            continue
        m = ev.get("message") or {}
        if ev.get("type") != "assistant" or m.get("id") in seen:
            continue
        seen.add(m.get("id"))
        u = m.get("usage") or {}
        total += u.get("input_tokens", 0) + u.get("cache_creation_input_tokens", 0)             + u.get("cache_read_input_tokens", 0)
    return total


def load(tags):
    rows = []
    for tag in tags:
        for line in open(f"results-{tag}.jsonl", encoding="utf-8"):
            r = json.loads(line)
            if r.get("timed_out") or not r["input_tokens"]:
                r["input_tokens"] = tokens_from_transcript(f"runs-{tag}/{r['id']}/transcript.jsonl")
            if tag != tags[0]:
                r["tool"] = f"{r['tool']}@{tag}"
            rows.append(r)
    return rows


def fmt_k(n):
    return f"{n / 1000:,.0f}k"


def main(tags):
    rows = load(tags)
    tools = [t for t in TOOLS if any(r["tool"] == t for r in rows)]
    tools += sorted({r["tool"] for r in rows} - set(tools))
    tasks = sorted({r["task"] for r in rows})

    print(f"{'tool':22} {'runs':>4} {'pass':>5} {'t/o':>3} {'calls med':>9} {'calls avg':>9} "
          f"{'input med':>9} {'input avg':>9} {'wall med':>8} {'cost avg':>8}")
    for t in tools:
        rs = [r for r in rows if r["tool"] == t]
        calls = [r["browser_calls"] for r in rs]
        tok = [r["input_tokens"] for r in rs]
        wall = [r["wall_s"] for r in rs]
        cost = [r["cost_usd"] or 0 for r in rs]
        print(f"{t:22} {len(rs):4} {sum(r['pass'] for r in rs) / len(rs):5.0%} "
              f"{sum(bool(r.get('timed_out')) for r in rs):3} "
              f"{statistics.median(calls):9.1f} {statistics.mean(calls):9.1f} "
              f"{fmt_k(statistics.median(tok)):>9} {fmt_k(statistics.mean(tok)):>9} "
              f"{statistics.median(wall):7.0f}s {statistics.mean(cost):8.2f}")

    print("\nmedian input tokens per task (pass rate)")
    print(f"{'task':10}" + "".join(f"{t:>22}" for t in tools))
    for task in tasks:
        cells = []
        for t in tools:
            rs = [r for r in rows if r["tool"] == t and r["task"] == task]
            if not rs:
                cells.append(f"{'-':>22}")
                continue
            med = statistics.median(r["input_tokens"] for r in rs)
            ok = sum(r["pass"] for r in rs)
            cells.append(f"{fmt_k(med) + f' ({ok}/{len(rs)})':>22}")
        print(f"{task:10}" + "".join(cells))

    fails = [r for r in rows if not r["pass"]]
    if fails:
        print("\nfailures")
        for r in fails:
            print(f"  {r['id']:28} {r['grade'][:90]}")


if __name__ == "__main__":
    main(sys.argv[1:] or ["full"])
