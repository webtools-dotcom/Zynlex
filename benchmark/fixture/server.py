"""Fixture server. Serves ./public and routes /api/* to api.py, re-read on
every request so a fix to api.py applies without a restart. Not part of the
bug hunt: do not edit."""
import http.server, json, sys, os, importlib.util
from urllib.parse import urlparse, parse_qs

ROOT = os.path.dirname(os.path.abspath(__file__))

def load_api():
    spec = importlib.util.spec_from_file_location("api", os.path.join(ROOT, "api.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=os.path.join(ROOT, "public"), **k)
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()
    def log_message(self, *a):
        pass
    def api(self, method):
        url = urlparse(self.path)
        n = int(self.headers.get("Content-Length") or 0)
        body = json.loads(self.rfile.read(n) or b"null") if n else None
        try:
            status, data = load_api().handle(method, url.path, parse_qs(url.query), body)
        except Exception as e:
            status, data = 500, {"error": "internal error"}
            print(f"500 on {method} {url.path}: {type(e).__name__}: {e}", file=sys.stderr, flush=True)
        out = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(out)))
        self.end_headers()
        self.wfile.write(out)
    def do_GET(self):
        if self.path.startswith("/api/"):
            return self.api("GET")
        super().do_GET()
    def do_POST(self):
        self.api("POST")

http.server.ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1])), H).serve_forever()
