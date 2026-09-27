# Security Policy

This policy covers ZYNLEX, a browser for local web development (see the
[README](README.md) for what it does).

Several of its features act on the traffic of the page you have open — the
network log, header rules, mock responses, the cookie inspector — and the API
Tester sends requests on your behalf. A bug there can mean more than a crash, so
please report vulnerabilities privately rather than in a public issue.

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
boundary between the frontend and the Rust backend, header rules, mock
responses, cookie handling, and the API Tester's outbound request path.

Out of scope: vulnerabilities in WebView2 itself, or in sites the browser
merely renders.

## Design posture

Page-originated IPC is intentionally disabled — no capability declares a
`remote` scope, so Tauri never injects `__TAURI_INTERNALS__` into `https://`
content, and a compromised or malicious page cannot invoke any Tauri command
directly. See [docs/architecture.md](docs/architecture.md#security-model) for
the full reasoning. If you find a path that bypasses this boundary, that is a
high-priority report.
