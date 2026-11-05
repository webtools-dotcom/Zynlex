TASKS = [{"id": i, "title": f"Task {i}"} for i in range(1, 16)]
PAGE_SIZE = 5


def handle(method, path, query, body, cookies):
    if method == "GET" and path == "/api/tasks":
        page = int((query.get("page") or ["1"])[0])
        start = (page - 1) * PAGE_SIZE
        return 200, {"tasks": TASKS[start:start + PAGE_SIZE], "more": start + PAGE_SIZE < len(TASKS)}
    if method == "POST" and path == "/api/feedback":
        return 200, {"ok": True}
    return 404, {"error": "not found"}
