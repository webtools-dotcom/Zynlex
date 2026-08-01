<div align="center">

<img src=".github/assets/logo.png" alt="ZYNLEX" width="96" />

# ZYNLEX

**A 3.5 MB browser for developers. Built in Rust and Tauri, not Electron.**

[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)
[![CI](https://github.com/webtools-dotcom/Zynlex/actions/workflows/ci.yml/badge.svg)](https://github.com/webtools-dotcom/Zynlex/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/webtools-dotcom/Zynlex)](https://github.com/webtools-dotcom/Zynlex/releases/latest)
[![Windows](https://img.shields.io/badge/Windows-10%20%7C%2011-blue)](https://github.com/webtools-dotcom/Zynlex/releases/latest)

<img src=".github/assets/demo.gif" alt="Opening a detected dev server, watching the network log fill, and switching to a phone viewport" width="800" />

### [Download for Windows →](https://github.com/webtools-dotcom/Zynlex/releases/latest)

</div>

---

## What it does

New tab shows your running dev servers. ZYNLEX scans localhost, reads the page titles, and lists them. Click one to open it.

The sidebar has the things you'd otherwise keep four apps around for:

- **Network log** — per-tab capture with filters, URL search, pause, and response bodies
- **Device viewports** — one device at a time, rendered at its real pixel size
- **Header rules** — add, override or strip request headers, matched per URL pattern
- **API client** — saved collections, cURL import, runs through Rust so page CORS doesn't apply
- **Inspector** — meta tags, Open Graph previews, and cookies including HttpOnly
- JWT decoder, Base64, user-agent switcher

Workspaces keep each project's tabs, bookmarks, header rules and saved requests apart. `Ctrl+K` finds all of it.

No account. No telemetry. It makes no network calls of its own.

## Why it exists

Two months ago I was watching [a video by @crynta](https://youtu.be/kykgXa7sm1g) and got stuck on a comment thread underneath it, where people were asking for a lightweight, telemetry-free browser. I wanted one too. But the version I actually needed was for development work, so that's the one I built.

Chrome DevTools is good and lives in the wrong place — a drawer inside a browser that has no idea what you're working on. Responsively and Polypane lead with device frames and aren't browsers you'd actually browse in. So the four things I check constantly (which port is that, what did that request return, how does this look on a phone, what happens with this header) lived in four separate windows.

ZYNLEX puts them in the browser chrome instead.

## Size and memory

Measured on one Windows 11 machine, clean profiles, identical pages, same window size:

| | ZYNLEX | Chrome |
|---|---|---|
| Idle, one blank tab | **452 MB** | 689 MB |
| Three tabs — GitHub, YouTube, localhost | **~1.1 GB** | ~1.8 GB |

About a third less, and it holds at idle and under load. The idle gap is roughly **237 MB**.

That is not clever engineering, and it's worth being clear about why. Your tabs run on WebView2, which is Chromium — the same renderer Chrome uses. Heavy pages cost the same in both. The savings come from what ZYNLEX doesn't run: no sync, no Safe Browsing, no prerendering, no extension host, no update service. The app process itself is 27 MB.

The installer is 3.46 MB for the same reason. WebView2 already ships with Windows, so there's no bundled copy of Chromium to download. It's also why there's no macOS or Linux build yet.

## Compared to the alternatives

| | ZYNLEX | Responsively | Polypane | Chrome DevTools |
|---|---|---|---|---|
| Price | Free, Apache-2.0 | Free, MIT | Paid | Free |
| macOS / Linux | **No** | Yes | Yes | Yes |
| Several devices at once | No | **Yes** | **Yes** | Limited |
| Accessibility auditing | No | No | **Yes** | Yes |
| Everyday browsing | Yes | No | Partly | n/a |
| Network log, header rules, API client | Yes | No | Partly | Log only |
| Finds your localhost servers | Yes | No | No | No |

If you need macOS, several viewports side by side, or accessibility audits, one of the others is a better tool. Use it.

## Install

Download the installer from the [latest release](https://github.com/webtools-dotcom/Zynlex/releases/latest) and run it.

Windows 10 or 11. You need the WebView2 runtime, which is already on Windows 11 and most Windows 10 machines; the installer adds it if it's missing.

From source:

```bash
pnpm install
pnpm tauri dev
```

## A look around

Your servers, on the new tab page:

<img src=".github/assets/home.png" alt="New tab page listing three detected local dev servers" width="820" />

Network log. Capture goes through WebView2's native COM API, not a proxy, so there's nothing to configure and no certificate to trust.

<img src=".github/assets/network.png" alt="Network panel showing 231 captured requests with filters and one request expanded" width="820" />

A device viewport at 1:1, next to the chrome:

<img src=".github/assets/viewport.png" alt="A Galaxy S26 Ultra viewport at 412x891 rendering GitHub" width="820" />

API client, saved per workspace:

<img src=".github/assets/api.png" alt="API tester with a saved collection and a JSON response" width="820" />

## Limitations

Worth knowing before you download:

- **Windows only.** Tabs, cookies, network capture, header injection and viewport emulation are written against WebView2 COM APIs. There's no WebKit equivalent yet, so a build for another platform compiles but refuses to start rather than open a browser with none of its tools working. macOS and Linux are planned — [ROADMAP.md](ROADMAP.md).
- Downloads show started and finished, not a percentage. Tauri's download event has no progress callback.
- Header rules don't apply to WebSocket handshakes. WebView2 never raises its request event for them.
- The network log captures fetch and XHR, not images, fonts or stylesheets. That's deliberate; asset noise is what makes a request list useless.
- JWT signatures are decoded, never verified.

## Docs

- [docs/architecture.md](docs/architecture.md) — process model, bounds and resize, viewport emulation, security boundary
- [docs/design-system.md](docs/design-system.md) — tokens, typography, layout rules
- [CONTRIBUTING.md](CONTRIBUTING.md) — build commands and the checks CI runs
- [ROADMAP.md](ROADMAP.md) — what's open

## Contributing

Issues and pull requests welcome. If you're picking up something non-trivial, open an issue first so we don't both write it.

Built with [Tauri](https://tauri.app), React and Rust.

## License

[Apache-2.0](LICENSE)
