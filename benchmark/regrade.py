"""Re-grade runs whose grade came back empty (the grader crashed, e.g. Edge
failed to start), using the run's own fixed app:

    python regrade.py heldout-v3

Rewrites results-<tag>.jsonl in place; a re-graded row keeps a note in
"regraded". Grades that came back PASS or FAIL are never touched.
"""
import json, os, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
PORT = 7095


def regrade(tag):
    path = os.path.join(HERE, f"results-{tag}.jsonl")
    rows = [json.loads(line) for line in open(path)]
    for r in rows:
        if r["grade"]:
            continue
        app = os.path.join(HERE, f"runs-{tag}", r["id"], "app")
        server = subprocess.Popen([sys.executable, "server.py", str(PORT)], cwd=app,
                                  stderr=subprocess.DEVNULL)
        time.sleep(1.5)
        out = subprocess.run(["node", "grade.mjs", r["task"], str(PORT)], cwd=HERE,
                             capture_output=True, text=True)
        server.kill()
        r["grade"] = out.stdout.strip()
        r["pass"] = r["grade"] == "PASS"
        r["regraded"] = "first grader run printed nothing"
        print(r["id"], r["grade"] or f"still empty: {out.stderr.strip()[:200]}")
    with open(path, "w") as f:
        f.writelines(json.dumps(r) + "\n" for r in rows)


if __name__ == "__main__":
    regrade(sys.argv[1])
