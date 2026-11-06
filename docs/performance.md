# Size and memory

How ZYNLEX's memory use compares with Chrome, where it goes, and the settings that trade it off.

## Compared with Chrome

Release builds on one Windows 11 machine. Clean profiles, identical pages, same 1280×800 window, 30 seconds after the pages load, median of 3 runs. Memory is summed over the app and every browser process it starts:

| | ZYNLEX 0.14 | Chrome | |
|---|---|---|---|
| Idle, one blank tab | **152 MB** | 348 MB | **56% less** |
| Three tabs (GitHub, YouTube, localhost) | **546 MB** | 692 MB | **21% less** |

That's committed (private) memory, the RAM a process has actually claimed. Working set, what's resident right now, shows the same picture: 410 vs 703 MB idle, 946 vs 1160 MB with three tabs.

## Where the memory goes, and what ZYNLEX does about it

Your tabs run on WebView2, which is Chromium, the same engine Chrome uses, so a heavy page costs about the same in both. The ZYNLEX app itself is about 10 MB. Everything else is WebView2's processes: one that coordinates, one per site, and helpers for networking and storage. ZYNLEX saves memory in four ways:

1. **It runs less.** No sync, no Safe Browsing, no prerendering, no extension host, no update service.
2. **Graphics run in the main browser process.** Chromium normally keeps a separate GPU process, and most of its 140–290 MB is fixed overhead. Moving it in saves 100–200 MB in every scenario, including an empty window.
3. **Hidden tabs are suspended** after 5 minutes. A suspended tab's scripts stop, and Windows pages its memory out of RAM. With 10 tabs open, resident memory drops by about 60%. Click the tab and it picks up where it was.
4. **Hidden tabs are discarded** after 10 minutes. The page is closed and reloads when you click it, with scroll position and form fields restored.

Before and after this work, on the same machine (ZYNLEX 0.13 → 0.14, private memory):

| | 0.13 | 0.14 | 0.14, hidden tabs suspended | 0.14 + low-memory process model |
|---|---|---|---|---|
| One blank tab | 267 MB | **152 MB** (−43%) | 170 MB | 167 MB |
| Three tabs | 758 MB | **546 MB** (−28%) | 496 MB (−35%) | 418 MB (−45%) |
| Ten tabs | 1577 MB | **1341 MB** (−15%) | 1277 MB (−19%) | **776 MB** (−51%) |

## Memory settings

All in **Settings → Memory**:

| Setting | Default | Trade-off |
|---|---|---|
| Suspend hidden tabs | After 5 min | A suspended tab stops updating (chat, dashboards, live logs) until you switch back. `localhost` tabs and tabs playing audio are never suspended. |
| Discard hidden tabs | After 10 min | The page reloads when you return to it. In-page state that isn't in a form field or the URL is lost. |
| GPU in main process | On | If your graphics driver crashes, the whole app closes instead of Chromium quietly restarting its GPU process. Turn it off if that happens to you. |
| Low-memory process model | Off | Turns off site isolation and shares two processes across all tabs: up to half the memory with many tabs open. Sites are less protected from each other (Spectre-class attacks), and one heavy tab can slow the rest. Fine for local development; leave it off for banking and similar. |

The last two take effect after a restart; the panel has a button for it.

The installer is about 4 MB because WebView2 already ships with Windows, so there's no bundled copy of Chromium to download. That's also why there's no macOS or Linux build yet.

If you need macOS, several viewports side by side, or accessibility audits, [Responsively](https://responsively.app) and [Polypane](https://polypane.app) do those and ZYNLEX doesn't.
