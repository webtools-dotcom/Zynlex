# Security Policy

ZYNLEX is a developer tool that intercepts and modifies live web traffic: it injects
arbitrary HTTP headers, captures network requests via native WebView2 COM APIs,
reads and edits cookies (including HttpOnly cookies), decodes JWTs, and makes
outbound HTTP requests on the user's behalf through the API Tester. Bugs in any
of that surface can mean more than a crash, so please report vulnerabilities
responsibly rather than opening a public issue.

## Reporting a vulnerability

Please report security issues privately via GitHub's
[private vulnerability reporting](../../security/advisories/new) on this
repository, rather than a public issue. Include:

- A description of the vulnerability and its impact
- Steps to reproduce
- The ZYNLEX version and Windows build you tested against

We'll acknowledge reports within a few days and follow up once a fix is ready.

## Scope

In scope: the Tauri command surface (`src-tauri/src/commands/`), the IPC
boundary between the frontend and the Rust backend, header injection, cookie
handling, and the API Tester's outbound request path.

Out of scope: vulnerabilities in WebView2 itself, or in sites the browser
merely renders.

## Design posture

Page-originated IPC is intentionally disabled — no capability declares a
`remote` scope, so Tauri never injects `__TAURI_INTERNALS__` into `https://`
content, and a compromised or malicious page cannot invoke any Tauri command
directly. See [docs/architecture.md](docs/architecture.md#security-model) for
the full reasoning. If you find a path that bypasses this boundary, that is a
high-priority report.
