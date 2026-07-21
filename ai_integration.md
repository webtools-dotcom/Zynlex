# AI Assistant Integration — Complete Research and Architecture Document

> **Project:** XEVO (v1.32.1-dev)
> **Stack:** Tauri v2.11.2 + React 19 + TypeScript + Rust 1.96.0
> **Architecture:** Tab-per-WebviewWindow (each browser tab = separate `WebviewWindow`)
> **OS:** Windows (WebView2)
> **Date:** 2026-07-20
> **Research Method:** NotebookLM deep research across 10+ GitHub repos + 120+ web sources + codebase audit

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Research Sources](#2-research-sources)
3. [XEVO Architecture Analysis (Codebase Audit)](#3-xevo-architecture-analysis)
4. [Three Page Content Extraction Approaches](#4-three-page-content-extraction-approaches)
5. [Chosen Approach: Eval-on-Demand + IPC Callback](#5-chosen-approach)
6. [Provider Abstraction Layer](#6-provider-abstraction-layer)
7. [Content Extraction Pipeline](#7-content-extraction-pipeline)
8. [Conversation / Follow-up Model](#8-conversation--follow-up-model)
9. [Full Implementation Plan](#9-full-implementation-plan)
10. [Security Considerations](#10-security-considerations)
11. [Reference Implementation (Code)](#11-reference-implementation)
12. [Appendix: Source Summaries](#12-appendix-source-summaries)

---

## 1. Executive Summary

**Is it feasible?** Yes — fully feasible. The separate-WebviewWindow architecture is not a blocker; it just means all communication must route through the Rust backend as a central message broker.

**The core pattern:** The React frontend cannot overlay UI on the browser webviews (they are separate OS windows). Instead, the React sidebar calls Rust commands via `invoke()`, Rust injects/extracts content from the browser webview via `eval()` + IPC callback, Rust calls the AI API with streaming, and results stream back to the React sidebar via Tauri events.

**Key insight:** The `eval()` → `invoke()` callback pattern (using `tokio::sync::oneshot` channels with `DashMap`) is battle-tested in production by **tauri-pilot**, **Victauri**, and **Agentic Browser**. It solves the fundamental problem that Tauri's `eval()` is fire-and-forget and returns no direct result.

**Lowest effort wins:** The ponytail-optimal approach adds ~295 lines across 8 files, reusing 100% of XEVO's existing IPC infrastructure. No complex COM API or CDP integration needed.

---

## 2. Research Sources

### 2.1 GitHub Repos (Directly Analyzed)

| # | Repo | Stars | Stack | Relevance |
|---|------|-------|-------|-----------|
| 1 | [Agentic Browser](https://github.com/AIAnytime/agent-browser) | 22 | Tauri + React + Node.js agent | **Most relevant.** React sidebar + AI assistant that queries webview content via `eval()` + IPC. Uses ReAct agent pattern. |
| 2 | [ai-desktop-copilot (CatDesk)](https://github.com/AlexisBERT-Work/ai-desktop-copilot) | — | Tauri 2 + React 19 + Ollama | Local-first AI copilot. Floating overlay, screen reading, file analysis, RAG. 100% local via Ollama. |
| 3 | [AI-Browser](https://github.com/kaduxo/AI-Browser) | — | Electron + LM Studio | Electron but same concept: AI sidebar that summarizes pages, analyzes selections, automates tasks. Shows UX patterns. |
| 4 | [Jarvis](https://github.com/nobodyme1206/Jarvis) | 2 | Tauri v2 + React + Rust | Multi-agent workbench. Browser Agent for web reading + controlled automation. 6 specialized agents. |
| 5 | [Bushido](https://github.com/visualstudioblyat/bushido) | — | Tauri + React | **Same architecture as XEVO** (Tauri browser). Reader mode, ad blocking via COM, vertical tabs. Proves page-content extraction from separate WebviewWindow is viable. |
| 6 | [Victauri](https://github.com/4DA-Systems/Victauri) | — | Tauri MCP server | DOM, IPC, Rust backend through embedded MCP server. `eval_js` + `dom_snapshot` tools prove DOM access from Rust. 35 tools total. |
| 7 | [dom_smoothie](https://github.com/niklak/dom_smoothie) | 210 | Rust | **Mozilla Readability port to Rust.** Extracts readable content (title, byline, content, excerpt, site name, published time). Markdown output. Perfect for clean extraction. |
| 8 | [OpenAgent](https://github.com/BANG404/openagent) | — | Tauri + SvelteKit + Rust | Multi-agent delegation, MCP, skills. Proves Tauri as AI agent host. |
| 9 | [Kairox](https://github.com/Z-Only/kairox) | — | Tauri + Vue + Rust | Local-first AI agent workbench. Shared Rust core, TUI + desktop GUI. |
| 10 | [Sable Code](https://github.com/MaliosDark/Sable-Code) | — | Tauri + React | AI coding agent with Tauri desktop app. Model routing across 6+ providers. |

### 2.2 Technical References (Web)

| # | Source | Topic |
|---|--------|-------|
| 1 | Tauri Docs `WebviewWindow` | `eval_with_callback` API, `add_child`, `initialization_script` |
| 2 | Tauri Docs `wry` | IPC architecture, platform-specific webview behavior |
| 3 | Tauri Docs IPC Process Model | Security, multi-process, capability-based ACL |
| 4 | Tauri Docs Calling Frontend from Rust | `app.emit()`, events, channels |
| 5 | Tauri Discussion #9626 | How to access contents of a webview — community solutions |
| 6 | Tauri Issue #5441 | Feature request for `eval_with_callback` — the exact pattern needed |
| 7 | Tauri GHSA-7gmj-67g7-phm9 | Origin confusion vulnerability — security context isolation |
| 8 | tauri-pilot article (dev.to) | Proven `eval()` → oneshot channel → callback pattern |
| 9 | Wry Issue #474 | `eval_with_callback` implementation details |
| 10 | Wry Issue #583 | Deadlock on Windows COM STA — must not block main thread |
| 11 | StackOverflow | WebView2 ExecuteScript COM STA wait patterns |
| 12 | Microsoft WebView2 Docs | `ICoreWebView2.ExecuteScript`, COM `HRESULT` handling |

### 2.3 Key Technical Insights from Research

1. **`eval()` is fire-and-forget** — returns no data. This is the #1 constraint and the hardest lesson. All approaches must work around this.
2. **The callback pattern is proven** — `tauri-pilot` uses oneshot channels stored in a map. JS calls `invoke()` back to Rust, which resolves the oneshot.
3. **Init scripts are wrapped in IIFE** — Tauri wraps `initialization_script` code in `(function() { ... })()`. Must explicitly bind to `window` to make functions accessible.
4. **Tauri v2.11+ has `eval_with_callback`** — newer API that directly supports callbacks. XEVO uses Tauri 2.11.2 so this is available.
5. **Windows COM STA deadlocks** — blocking the main thread during `eval()` causes the WebView2 message pump to deadlock. Always use async channels.
6. **Remote origin security** — calling `invoke()` from a remote-origin webview is blocked by Tauri's ACL. The IPC route from browser webview → Rust → frontend is the intended pattern.
7. **IPC Channel for streaming** — Tauri v2's `tauri::ipc::Channel` provides zero-copy streaming, far better than `app.emit()` for high-frequency token data. However, `app.emit()` is simpler and sufficient for token-level streaming.
8. **Ollama is the simplest AI backend** — OpenAI-compatible endpoint, no API keys, local. But the user wants BYOK (bring your own key) so we need multi-provider support from day 1.

---

## 3. XEVO Architecture Analysis

### 3.1 How XEVO Currently Works

**Tab-per-WebviewWindow architecture:**
- Each tab = `WebviewWindow` with label `browser-{tabId}`
- Created lazily on first navigation via `create_webview_for_tab`
- Hidden/shown on switch — never destroyed (only on close or 10min discard)
- Parent window is the main XEVO window
- Shared WebView2 data directory for process reuse

**Init scripts (4 injected per tab):**
1. `tab_id_init` — sets `window.__XEVO_TAB_ID`
2. `CORE_SCRIPT` — tab info reporting, title observation, shortcut forwarding
3. `CHROME_FEATURES_SCRIPT` — find-in-page, bookmark shortcut
4. `JSON_VIEWER_SCRIPT` — collapsible JSON viewer on JSON pages

**IPC patterns:**
- Frontend → Rust: `invoke("command_name", { args })` via `@tauri-apps/api/core`
- Rust → Frontend: `app.emit("event-name", payload)` via `Emitter` trait
- Rust → Frontend: frontend listens with `listen("event-name", callback)` via `@tauri-apps/api/event`
- Browser webview → Rust: `window.__TAURI_INTERNALS__.invoke("command_name", { data })` from injected scripts
- Browser webview → Rust (COM): Native WebView2 COM event handlers for network capture

**Managed state:**
- `BrowserState` struct with: `active_tab_label`, `user_agent`, `webviews: HashMap<String, WebviewWindow>`
- All in `Mutex` for thread safety

**Sidebar panel system:**
- 12 panels registered via `PanelId` union type + `PANELS` array + conditional rendering
- React.lazy for all panels with `Suspense` + `PanelSkeleton` fallback
- Zustand stores (12) with optional `persist` middleware
- Settings is a right-side slide-in overlay (not sidebar)

**Key file locations:**
- Rust commands: `src-tauri/src/commands/browser.rs` (40+ commands)
- Command registration: `src-tauri/src/lib.rs` (all in `generate_handler![]`)
- Frontend IPC wrappers: `src/services/browser.ts`
- Event hub: `src/hooks/useWebviewBridge.ts`
- Sidebar panels: `src/components/sidebar/`
- Overlay panels: `src/components/panels/`
- Zustand stores: `src/stores/`
- Init scripts: Hardcoded in `src-tauri/src/commands/browser.rs` as `const` strings

### 3.2 What Already Exists That We Reuse

| Component | Status | Use for AI |
|-----------|--------|------------|
| `invoke()` / `listen()` IPC | ✅ Battle-tested | AI command call + streaming events |
| `webview.eval()` | ✅ Used in 10+ commands | Trigger extraction JS in browser tab |
| `window.__TAURI_INTERNALS__.invoke()` | ✅ Used in CORE_SCRIPT | Send extracted content back to Rust |
| Sidebar panel system | ✅ 12 panels exist | Add 13th panel for AI Assistant |
| Zustand stores | ✅ 12 stores exist | `ai.ts` store for conversation state |
| Settings overlay | ✅ SettingsPanel exists | Add AI provider config fields |
| Event streaming | ✅ Network panel streams 500+ events | `ai://chunk` event for token streaming |
| `app.emit()` | ✅ Used everywhere | Stream AI tokens to frontend |
| COM API integration | ✅ Network capture | Optional for CDP-based extraction (future) |

### 3.3 What Needs to Be Added

| Component | Missing | Complexity |
|-----------|---------|------------|
| HTTP client in Rust | No `reqwest` in Cargo.toml | Low (add 1 dep) |
| Thread-safe async map | No `dashmap` in Cargo.toml | Low (add 1 dep) |
| Stream parsing | No `futures-util` in Cargo.toml | Low (add 1 dep) |
| AI provider abstraction | Doesn't exist | Medium |
| Content extraction JS | Doesn't exist | Medium (smart extraction) |
| AI commands (Rust) | Doesn't exist | Medium (oneshot + HTTP + streaming) |
| AI chat UI (React) | Doesn't exist | Medium |
| Settings UI for API keys | Doesn't exist | Low (extend SettingsPanel) |

---

## 4. Three Page Content Extraction Approaches

### 4.1 Approach A: Injected Init Scripts

**How it works:** Register an `initialization_script` on every tab's `WebviewWindowBuilder` that runs on every page load. The script adds a function to `window` that can be called later.

**Pros:**
- Always available (runs on every page load)
- No eval overhead at call time
- Can set up event listeners, MutationObservers
- Cross-platform compatible

**Cons:**
- Execution cost on EVERY page load (performance hit)
- Tauri wraps scripts in IIFE — must explicitly bind to `window`
- Historical bug: calling `invoke()` from init script caused `TypeError` before Tauri 2.2.2 (fixed in current version)
- Race condition: init script may run before Tauri's core injection completes
- Harder to update (requires app update to change script)

**Verdict:** Good for one-time setup hooks, but using it for extraction functions adds unnecessary overhead to pages that may never use the AI feature.

### 4.2 Approach B: Eval-on-Demand (Chosen Approach)

**How it works:** When the user clicks "Summarize", Rust calls `webview.eval()` on the specific tab, which injects and executes the extraction JS on demand. The JS calls back to Rust via `invoke()` to return the content.

**Pros:**
- **Zero cost when not in use** — no overhead on page loads
- Updated dynamically via eval (no app update needed for extraction logic tweaks)
- Tauri v2.11.2 supports `eval_with_callback` directly
- Well-proven pattern (tauri-pilot, Agentic Browser, Victauri all use this)
- Can be wrapped in try/catch for reliability

**Cons:**
- On Windows WebView2, exceptions raised during `eval()` are silently ignored — must use JS-level try/catch
- Requires async channel infrastructure (oneshot + DashMap)
- Slight latency on first use (eval + invoke round trip)

**The callback pattern (critical detail):**

```
Rust (summarize_page)                        Browser WebviewWindow
        │                                           │
        │  webview.eval("extractAndReturn()")       │
        │──────────────────────────────────────────>│
        │                                           │
        │  (eval is fire-and-forget, returns void)  │
        │                                           │
        │                                           │  extractPage()
        │                                           │  document.body.innerText
        │                                           │
        │  invoke("ai_page_content_callback", data)  │
        │<──────────────────────────────────────────│
        │                                           │
        │  oneshot::Sender resolves                 │
        │  summarize_page wakes up with data        │
        │                                           │
        │  [Now calls AI API with extracted text]   │
        │                                           │
```

**Verdict:** The best approach. Zero cost when idle, proven in production, simple infrastructure.

### 4.3 Approach C: Rust-Side Content Extraction via WebView2 COM API

**How it works:** Use `wv.with_webview()` → `platform.controller().CoreWebView2()` → COM interface to call Chrome DevTools Protocol commands like `DOM.getOuterHTML` or `Runtime.evaluate`.

**Pros:**
- Bypasses JS execution environment — immune to page scripts
- Can access internal browser state (performance metrics, DOM in depth)
- No origin restriction (COM runs in the WebView2 process)
- XEVO already has this pattern for network capture

**Cons:**
- **Windows-only** (COM APIs don't exist on macOS/Linux)
- COM STA deadlock risk if not handled properly
- Significantly more complex code
- Returns raw HTML that must be parsed (vs. clean text from JS)
- Platform fragmentation — need separate implementation per OS

**XEVO's existing COM code (reference):**

```rust
// Pattern from register_webview_network_capture in browser.rs
wv.with_webview(move |platform| {
    #[cfg(windows)]
    unsafe {
        let core = platform.controller().CoreWebView2()?;
        // ... COM operations
    }
});
```

**Verdict:** Overkill for text extraction. The COM API is appropriate for network capture (where no JS alternative exists) but the JS `eval()` path is simpler, cross-platform, and sufficient for extracting page text.

---

## 5. Chosen Approach

### Decision: Approach B — Eval-on-Demand + IPC Callback

**Rationale:**
1. **Zero cost when idle** — no init script overhead on every page load
2. **Cross-platform** — works on Windows, macOS, Linux without changes
3. **Proven** — tauri-pilot, Victauri, Agentic Browser all use this exact pattern
4. **Simple** — ~50 lines of Rust infrastructure (oneshot + DashMap)
5. **Extensible** — extraction logic can be updated via eval without app update

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    XEVO Main Window (React)                     │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Main Shell (RootLayout)                                  │  │
│  │  ┌──────────────┐  ┌────────────────────────────────────┐ │  │
│  │  │  Sidebar      │  │  Browser Chrome (Toolbar, Tabs)    │ │  │
│  │  │  ├─ Servers   │  │  ┌──────────────────────────────┐  │ │  │
│  │  │  ├─ Bookmarks │  │  │  Content Area (empty)         │  │ │  │
│  │  │  ├─ Network   │  │  │  (WebviewWindow is SEPARATE   │  │ │  │
│  │  │  ├─ ...       │  │  │   OS window, not here)        │  │ │  │
│  │  │  └─ AI ★ NEW  │  │  └──────────────────────────────┘  │ │  │
│  │  └──────────────┘  └────────────────────────────────────┘ │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
         │                                      ▲
         │ invoke('ai_chat_send')               │ listen('ai://chunk')
         │                                      │ listen('ai://done')
         ▼                                      │
┌─────────────────────────────────────────────────────────────────┐
│                    Rust Backend (AI State)                      │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │pending_reqs  │  │page_cache    │  │conversations         │   │
│  │DashMap        │  │DashMap       │  │DashMap               │   │
│  │tabId→Sender  │  │tabId→Content │  │tabId→Vec<Message>    │   │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘   │
│         │                 │                      │              │
│         ▼                 ▼                      ▼              │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  ai_chat_send command:                                   │   │
│  │  1. Extract page content (or use cache)                  │   │
│  │  2. Build messages with system prompt                    │   │
│  │  3. Route to provider (OpenAI-compatible)                │   │
│  │  4. Stream response via app.emit('ai://chunk')           │   │
│  │  5. Store conversation                                   │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
         │                                      ▲
         │ webview.eval(...)                    │ invoke('ai_page_content_callback')
         ▼                                      │
┌─────────────────────────────────────────────────────────────────┐
│              Browser Tab (WebviewWindow)                        │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  window.__xevoAI_extract()                               │   │
│  │  {                                                       │   │
│  │    title: document.title,                                │   │
│  │    content: document.body.innerText,                     │   │
│  │    metadata: { description, author, og:image, ...}       │   │
│  │  }                                                       │   │
│  │  window.__TAURI_INTERNALS__.invoke(...)                  │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 6. Provider Abstraction Layer

### 6.1 Supported Providers (Day 1)

All **OpenAI-compatible** APIs — they all use the same `/v1/chat/completions` endpoint format with the same request/response schema:

| Provider | Base URL | Auth |
|----------|----------|------|
| OpenAI | `https://api.openai.com/v1` | `Authorization: Bearer {key}` |
| DeepSeek | `https://api.deepseek.com/v1` | `Authorization: Bearer {key}` |
| MiniMax | `https://api.minimax.chat/v1` | `Authorization: Bearer {key}` |
| Groq | `https://api.groq.com/openai/v1` | `Authorization: Bearer {key}` |
| Together | `https://api.together.xyz/v1` | `Authorization: Bearer {key}` |
| OpenRouter | `https://openrouter.ai/api/v1` | `Authorization: Bearer {key}` |
| Ollama (local) | `http://localhost:11434/v1` | None |
| Any custom | User-provided base URL | `Authorization: Bearer {key}` |

### 6.2 Provider Config (Stored in Settings)

```typescript
interface AIConfig {
  provider: string;       // "openai" | "openai-compatible"
  baseUrl: string;        // API base URL
  model: string;          // Model name (e.g., "gpt-4o-mini", "deepseek-chat")
  apiKey: string;         // User's API key
}
```

Because all supported providers use the OpenAI-compatible format, the **entire provider abstraction is just a `baseUrl` + `model` + `apiKey` tuple**. No per-provider adapter needed.

### 6.3 Future Providers (Not Implemented in Phase 1 — Tracked for Later)

- **Anthropic Claude** — uses `/v1/messages` with `x-api-key` header, different message format (system as separate field, content blocks)
- **Google Gemini** — uses `/v1beta/models/{model}:streamGenerateContent` with `key` query param, different message format
- **LiteLLM / proxy** — would work with OpenAI-compatible mode by pointing baseUrl at the proxy

These would require separate adapter functions that convert between the universal message format and each provider's format. The pattern:

```rust
fn build_provider_request(
    provider: &str,
    messages: Vec<ChatMessage>,
    api_key: &str,
    model: &str,
    base_url: &str,
) -> Result<(String, HeaderMap, serde_json::Value), String> {
    match provider {
        "openai" | "openai-compatible" => {
            // POST {base_url}/chat/completions
            // Headers: Authorization: Bearer {api_key}
            // Body: { model, messages, stream: true }
        }
        "anthropic" => {
            // POST {base_url}/messages
            // Headers: x-api-key: {api_key}, anthropic-version: 2023-06-01
            // Body: { model, system, messages, stream: true }
        }
        "google" => {
            // POST {base_url}/models/{model}:streamGenerateContent?key={api_key}
            // Body: { contents: [...] }
        }
    }
}
```

### 6.4 Streaming Response Handling

**OpenAI-compatible streaming format** (Server-Sent Events):

```
data: {"id":"...","object":"chat.completion.chunk","choices":[{"delta":{"content":"Hello"},"index":0}]}
data: {"id":"...","object":"chat.completion.chunk","choices":[{"delta":{"content":" world"},"index":0}]}
data: [DONE]
```

**Parsing:** Read the byte stream line by line (or by `\n\n`), parse each `data: {...}` JSON line, extract `choices[0].delta.content`, emit to frontend.

**Ponytail simplification:** Use `reqwest`'s `bytes_stream()` and parse each chunk. No need for a full SSE parser library — each line is either `data: {...}` JSON or `data: [DONE]`.

---

## 7. Content Extraction Pipeline

### 7.1 Phase 1: Smart Extraction (Day 1)

A lightweight JS function injected on-demand via eval. Extracts clean content from the page.

```
window.__xevoAI_extract = function() {
    // 1. Get title
    const title = document.title || '';

    // 2. Get page content (priority: article > main > body)
    const article = document.querySelector('article');
    const main = document.querySelector('main');
    const content = article || main || document.body;

    // 3. Get text content, strip excessive whitespace
    let text = content ? content.innerText : '';

    // 4. Get meta description
    const desc = document.querySelector('meta[name="description"]')?.content || '';

    // 5. Get meta author
    const author = document.querySelector('meta[name="author"]')?.content || '';

    // 6. Get OG metadata
    const ogTitle = document.querySelector('meta[property="og:title"]')?.content || '';
    const ogDesc = document.querySelector('meta[property="og:description"]')?.content || '';

    // 7. Extract links with visible text (for reference)
    const links = Array.from(document.querySelectorAll('a[href]'))
        .filter(a => a.href && a.textContent.trim())
        .slice(0, 20)
        .map(a => ({ text: a.textContent.trim(), href: a.href }));

    // 8. Get page URL
    const url = window.location.href;

    return {
        title,
        content: text.substring(0, 25000), // Cap at ~25KB
        metadata: {
            description: desc,
            author,
            ogTitle,
            ogDesc,
            url,
        },
        links,
    };
};
```

**Why this is good enough:** The `<article>` element covers ~80% of content sites. The `document.body.innerText` fallback covers the rest. The metadata extraction provides context. The 25KB cap keeps IPC payloads small. Links provide source references.

### 7.2 Phase 2: dom_smoothie Integration (Future)

The `dom_smoothie` Rust crate (Mozilla Readability port) can extract even cleaner content:

```rust
use dom_smoothie::{Article, Config, Readability};

fn extract_article(html: &str, url: &str) -> Result<Article, Error> {
    let config = Config { max_elements_to_parse: 9000, ..Default::default() };
    let mut readability = Readability::new(html, Some(url), Some(config))?;
    let article: Article = readability.parse()?;
    // Article has: title, byline, content, text_content, excerpt,
    //              site_name, dir, published_time, image, url
    Ok(article)
}
```

To use this, we'd need to extract the page's HTML (instead of just text) and send it to Rust via IPC. This increases payload size but provides much cleaner article text.

**When to upgrade:** If users report noisy summaries from Phase 1's raw extraction. The ponytail approach is to start simple and only add complexity when needed.

---

## 8. Conversation / Follow-up Model

### 8.1 How Conversations Work

The AI assistant supports **follow-up conversations** about a page. The user can:
1. Click "Summarize" → gets summary
2. Ask "What are the key arguments?" → AI answers based on same page content
3. Ask "Compare this with X" → AI maintains context

**State maintained per tab:**
```
AIState.conversations: DashMap<String, Vec<Message>>
  Key: tabId
  Value: [{role: "system", content: PAGE_CONTEXT}, {role: "user", ...}, {role: "assistant", ...}, ...]
```

**Flow:**
1. User's first message: Rust extracts page content, creates `[{role: "system", content: PAGE_CONTEXT}, {role: "user", content: "..."}]`
2. User sends follow-up: Rust fetches existing conversation for that tab, appends new user message, sends full history to AI
3. AI responds: Rust appends assistant response to conversation
4. Tab switch: Conversation for the new tab's page is loaded (or empty if never used)

**System prompt template:**
```
You are a helpful AI assistant integrated into XEVO, a browser and developer toolbox.

Below is the content of the page the user is currently viewing:

--- PAGE TITLE: {title} ---
--- PAGE URL: {url} ---

{page_content}

---

Answer the user's questions based on this page content. If you don't know something or if it's not in the page, say so. Be concise but thorough.

The user's first message will usually be "Summarize this page" — provide a clear, structured summary.
```

### 8.2 Context Window Management

For Phase 1, we don't implement token counting. The page content is capped at 25KB, which together with conversation history fits comfortably within most model's context windows (128K+ for modern models).

**Ponytail:** If the user has a very long conversation, the accumulated history + page content might exceed the context window. We handle this by... not handling it. The AI provider will truncate or error. We can add smart truncation if it becomes a real issue.

---

## 9. Full Implementation Plan

### 9.1 Files to Create

| # | File | Type | Lines | Description |
|---|------|------|-------|-------------|
| 1 | `src-tauri/src/commands/ai.rs` | New | ~80 | `ai_chat_send` + `ai_page_content_callback` + streaming |
| 2 | `src/components/panels/AIAssistant.tsx` | New | ~120 | Chat UI panel with streaming text |
| 3 | `src/stores/ai.ts` | New | ~30 | In-memory Zustand store for AI state |

### 9.2 Files to Modify

| # | File | Type | Lines | Change |
|---|------|------|-------|--------|
| 1 | `src-tauri/Cargo.toml` | Edit | +3 | Add `reqwest`, `dashmap`, `futures-util` |
| 2 | `src-tauri/src/lib.rs` | Edit | +10 | Register AI state + commands |
| 3 | `src/types/index.ts` | Edit | +1 | Add `"ai"` to `PanelId` |
| 4 | `src/components/sidebar/Sidebar.tsx` | Edit | +5 | Add AI panel to PANELS array + lazy import |
| 5 | `src/components/panels/SettingsPanel.tsx` | Edit | +30 | AI provider config fields |
| 6 | `src/stores/settings.ts` | Edit | +10 | AI config types + defaults |

### 9.3 Detailed File Changes

#### 9.3.1 `src-tauri/Cargo.toml` (+3 lines)

```toml
reqwest = { version = "0.12", features = ["json", "stream"] }
dashmap = "6.1"
futures-util = "0.3"
```

#### 9.3.2 `src-tauri/src/commands/ai.rs` (New, ~80 lines)

**State struct:**
```rust
use dashmap::DashMap;
use tokio::sync::oneshot;
use std::sync::Arc;

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct PageContent {
    pub title: String,
    pub content: String,
    pub metadata: Option<serde_json::Value>,
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct ChatMessage {
    pub role: String,   // "system", "user", "assistant"
    pub content: String,
}

pub struct AIState {
    pub pending_extractions: Arc<DashMap<String, oneshot::Sender<PageContent>>>,
    pub page_cache: Arc<DashMap<String, PageContent>>,
    pub conversations: Arc<DashMap<String, Vec<ChatMessage>>>,
}
```

**Commands:**
1. `ai_extract_page(handle, state, tabId)` — gets webview by label `browser-{tabId}`, creates oneshot channel, evals extraction JS, waits 5s for callback
2. `ai_page_content_callback(state, tabId, content)` — resolves the oneshot, caches content
3. `ai_chat_send(handle, state, tabId, message, apiKey, model, baseUrl)` — gets cached/extracted page content, builds conversation, streams to OpenAI API via `reqwest`, emits `ai://chunk` per token, stores conversation

**Streaming helper:**
```rust
async fn stream_openai_compatible(
    handle: &AppHandle,
    api_key: &str,
    base_url: &str,
    model: &str,
    messages: Vec<ChatMessage>,
) -> Result<String, String> {
    let client = reqwest::Client::new();
    let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));

    let mut response = client.post(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .json(&serde_json::json!({
            "model": model,
            "messages": messages,
            "stream": true,
        }))
        .send()
        .await
        .map_err(|e| format!("API request failed: {}", e))?;

    use futures_util::StreamExt;
    let mut full_response = String::new();

    while let Some(chunk) = response.chunk().await.map_err(|e| format!("Stream error: {}", e))? {
        let text = String::from_utf8_lossy(&chunk);
        // Parse SSE format: "data: {...}\n\n"
        for line in text.lines() {
            if let Some(json_str) = line.strip_prefix("data: ") {
                if json_str.trim() == "[DONE]" {
                    break;
                }
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(json_str) {
                    if let Some(content) = val["choices"][0]["delta"]["content"].as_str() {
                        full_response.push_str(content);
                        let _ = handle.emit("ai://chunk", content.to_string());
                    }
                }
            }
        }
    }

    Ok(full_response)
}
```

#### 9.3.3 `src-tauri/src/lib.rs` (+10 lines)

```rust
mod commands;
mod ai;  // NEW

use ai::{AIState, ai_chat_send, ai_page_content_callback};

pub fn run() {
    tauri::Builder::default()
        .manage(AIState { /* init */ })
        .invoke_handler(tauri::generate_handler![
            // ... existing 41 commands
            commands::ai::ai_chat_send,          // NEW
            commands::ai::ai_page_content_callback,  // NEW
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

#### 9.3.4 `src/types/index.ts` (+1 line)

```typescript
export type PanelId =
  | "servers"
  | "bookmarks"
  | "history"
  | "network"
  | "api"
  | "notes"
  | "jwt"
  | "base64"
  | "headers"
  | "inspector"
  | "ua"
  | "viewport"
  | "ai";  // NEW
```

#### 9.3.5 `src/components/sidebar/Sidebar.tsx` (+5 lines)

```typescript
// Add to PANELS array
{ id: "ai", Icon: Sparkles, label: "AI Assistant" },

// Add lazy import
const AIAssistantPanel = lazy(() =>
  import("@/components/panels/AIAssistantPanel").then(m => ({ default: m.AIAssistantPanel }))
);

// Add conditional render
{activePanel === "ai" && <AIAssistantPanel />}
```

#### 9.3.6 `src/components/panels/AIAssistantPanel.tsx` (New, ~120 lines)

**Key features:**
- Chat message list (user + assistant bubbles)
- Streaming text with animated cursor
- Text input at bottom with send button
- "Summarize this page" quick action button
- Loading/streaming state indicator
- Settings gear icon to configure provider
- Error state display

**Core logic:**
```tsx
// Listen for streaming tokens
useEffect(() => {
    const unlisten = listen<string>("ai://chunk", (event) => {
        addChunk(event.payload);
    });
    const unlistenDone = listen("ai://done", () => {
        setStreaming(false);
    });
    return () => { unlisten.then(f => f()); unlistenDone.then(f => f()); };
}, []);

// Send message
const handleSend = async () => {
    const msg = input.trim();
    if (!msg) return;
    addMessage({ role: "user", content: msg });
    setInput("");
    setStreaming(true);
    const { baseUrl, model, apiKey } = useSettingsStore.getState().settings;
    await invoke("ai_chat_send", {
        tabId: activeTabId,
        message: msg,
        apiKey,
        model,
        baseUrl,
    });
};
```

#### 9.3.7 `src/stores/ai.ts` (New, ~30 lines)

```typescript
import { create } from 'zustand';

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface AIStore {
  conversation: ChatMessage[];
  isStreaming: boolean;
  streamingContent: string;
  addMessage: (msg: ChatMessage) => void;
  addChunk: (chunk: string) => void;
  startStreaming: () => void;
  stopStreaming: () => void;
  clearConversation: () => void;
}

export const useAIStore = create<AIStore>((set) => ({
  conversation: [],
  isStreaming: false,
  streamingContent: '',
  addMessage: (msg) => set((s) => ({
    conversation: [...s.conversation, msg],
    streamingContent: '',
  })),
  addChunk: (chunk) => set((s) => ({
    streamingContent: s.streamingContent + chunk,
  })),
  startStreaming: () => set({ isStreaming: true, streamingContent: '' }),
  stopStreaming: () => set((s) => ({
    isStreaming: false,
    conversation: s.streamingContent
      ? [...s.conversation, { role: 'assistant', content: s.streamingContent }]
      : s.conversation,
    streamingContent: '',
  })),
  clearConversation: () => set({ conversation: [], streamingContent: '' }),
}));
```

#### 9.3.8 Settings Additions (`SettingsPanel.tsx` + `settings.ts`)

```typescript
// In settings.ts type
interface AIConfig {
  provider: string;
  baseUrl: string;
  model: string;
  apiKey: string;
}

interface AppSettings {
  // ... existing fields
  ai: AIConfig;
}

// Defaults
const defaultSettings: AppSettings = {
  // ... existing defaults
  ai: {
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    apiKey: "",
  },
};
```

### 9.4 Data Flow Summary

```
[User clicks "Summarize" in AI sidebar]
  → aiStore.addMessage({role: "user", content: "Summarize this page"})
  → aiStore.startStreaming()
  → invoke("ai_extract_page", { tabId })

[Rust: ai_extract_page]
  → find webview: app.get_webview_window("browser-{tabId}")
  → create oneshot channel, store in AIState.pending_extractions
  → webview.eval("window.__xevoAI_extractPage()")
  → AWAIT oneshot (5s timeout)

[Browser tab: injected JS runs]
  → window.__xevoAI_extractPage()
    → extracts title, content, metadata
    → window.__TAURI_INTERNALS__.invoke("ai_page_content_callback", { tabId, title, content, metadata })
  → (continues normal page operation)

[Rust: ai_page_content_callback]
  → receives content
  → resolves oneshot (wakes up ai_extract_page)
  → stores in page_cache
  → now ai_extract_page has the content

[Rust: ai_extract_page (resumed)]
  → has PageContent { title, content }
  → creates AIState.conversations entry if not exists
  → builds messages: [{role: "system", content: SYSTEM_PROMPT + page_content}, {role: "user", content: "Summarize this page"}]
  → calls stream_openai_compatible(messages, apiKey, model, baseUrl)
    → reqwest POST to {baseUrl}/chat/completions with streaming
    → for each SSE chunk: app.emit("ai://chunk", content)
    → on completion: app.emit("ai://done")
    → stores assistant response in conversation

[React sidebar: listens]
  → aiStore.addChunk(token) → appends to streamingContent in UI
  → aiStore.stopStreaming() → finalizes assistant message, clears streaming flag
  → User sees summary appearing token by token
  → User can type follow-up question

[Follow-up]
  → invoke("ai_chat_send", { tabId, message: "Tell me more", ... })
    → Rust fetches existing conversation from AIState.conversations[tabId]
    → appends user message
    → sends full history (system prompt + page content + prior messages + new message)
    → streams response, appends to conversation
```

---

## 10. Security Considerations

### 10.1 API Key Storage

**Ponytail:** Store the API key in the Zustand persist store (localStorage). This is what the user expects ("bring your own key") and localStorage is sandboxed per origin. For production, consider:

- **Phase 1:** Store in plaintext in localStorage (same as any web app storing settings)
- **Phase 2:** Use Tauri's `tauri-plugin-store` with encrypted storage
- **Phase 3:** Windows Credential Manager / macOS Keychain via Rust

**Security note:** The API key is sent from the frontend to Rust in every `invoke()` call. Tauri's IPC is inter-process and not exposed to the webview's DOM, but the key will be in the Tauri process memory. This is acceptable for a developer tool where the user brings their own key.

### 10.2 Remote Origin Isolation

The extraction JS is injected via `eval()` — it runs in the context of whatever page the user is viewing (potentially a malicious site). However:

1. The extracted data flows **one way** — from page → Rust. The page cannot inject commands into Rust.
2. Tauri's ACL blocks remote origins from calling arbitrary `invoke()` commands.
3. The AI API call is made from Rust, not from the page's JS context.
4. The system prompt is controlled by XEVO, not by the page content.

**No injection risk.** The page content is sent to the AI API as data, not as code.

### 10.3 Content Privacy

- The page content is sent to the user's chosen AI provider
- The user opted in by providing their API key
- No data goes through XEVO's servers (there are none)
- The content stays in memory (not persisted to disk in Phase 1)

---

## 11. Reference Implementation

### 11.1 Real Rust Code: `ai_extract_page` with Oneshot Pattern

```rust
use tauri::{AppHandle, Emitter, Manager, State};
use dashmap::DashMap;
use tokio::sync::oneshot;
use std::sync::Arc;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PageContent {
    pub title: String,
    pub content: String,
    pub metadata: Option<serde_json::Value>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

pub struct AIState {
    pub pending_extractions: Arc<DashMap<String, oneshot::Sender<PageContent>>>,
    pub page_cache: Arc<DashMap<String, PageContent>>,
    pub conversations: Arc<DashMap<String, Vec<ChatMessage>>>,
}

impl AIState {
    pub fn new() -> Self {
        Self {
            pending_extractions: Arc::new(DashMap::new()),
            page_cache: Arc::new(DashMap::new()),
            conversations: Arc::new(DashMap::new()),
        }
    }
}

const EXTRACTION_SCRIPT: &str = r#"
(function() {
    try {
        const title = document.title || '';
        const article = document.querySelector('article');
        const main = document.querySelector('main');
        const content = article || main || document.body;
        const text = content ? content.innerText : '';

        const desc = (document.querySelector('meta[name="description"]') || {}).content || '';
        const author = (document.querySelector('meta[name="author"]') || {}).content || '';
        const ogTitle = (document.querySelector('meta[property="og:title"]') || {}).content || '';
        const ogDesc = (document.querySelector('meta[property="og:description"]') || {}).content || '';

        const links = Array.from(document.querySelectorAll('a[href]'))
            .filter(a => a.href && a.textContent.trim())
            .slice(0, 20)
            .map(a => ({ text: a.textContent.trim().substring(0, 100), href: a.href }));

        window.__TAURI_INTERNALS__.invoke('ai_page_content_callback', {
            tabId: window.__XEVO_TAB_ID || '',
            title: title,
            content: text.substring(0, 25000),
            metadata: JSON.stringify({
                description: desc,
                author: author,
                ogTitle: ogTitle,
                ogDesc: ogDesc,
                url: window.location.href,
                links: links,
            }),
        });
    } catch (e) {
        console.error('[XEVO AI] Extraction failed:', e);
    }
})();
"#;

#[tauri::command]
pub async fn ai_extract_page(
    handle: AppHandle,
    state: State<'_, AIState>,
    tab_id: String,
) -> Result<PageContent, String> {
    let webview_label = format!("browser-{}", tab_id);

    // Get the webview window for this tab
    let webview = handle
        .get_webview_window(&webview_label)
        .ok_or_else(|| format!("Tab '{}' not found", tab_id))?;

    // Create oneshot channel for the callback
    let (tx, rx) = oneshot::channel();
    state.pending_extractions.insert(tab_id.clone(), tx);

    // Fire the extraction script (fire-and-forget)
    webview
        .eval(EXTRACTION_SCRIPT)
        .map_err(|e| format!("Failed to inject extraction script: {}", e))?;

    // Wait for the callback with 5s timeout
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(5),
        rx,
    )
    .await
    .map_err(|_| "Page content extraction timed out".to_string())?
    .map_err(|_| "Extraction channel closed".to_string())?;

    // Cache the result
    state.page_cache.insert(tab_id.clone(), result.clone());

    Ok(result)
}

#[tauri::command]
pub async fn ai_page_content_callback(
    state: State<'_, AIState>,
    tab_id: String,
    title: String,
    content: String,
    metadata: Option<String>,
) -> Result<(), String> {
    let parsed_metadata = metadata
        .and_then(|m| serde_json::from_str(&m).ok());

    let page_content = PageContent {
        title,
        content,
        metadata: parsed_metadata,
    };

    // Resolve the pending oneshot, if any
    if let Some((_, tx)) = state.pending_extractions.remove(&tab_id) {
        let _ = tx.send(page_content);
    }

    Ok(())
}

#[tauri::command]
pub async fn ai_chat_send(
    handle: AppHandle,
    state: State<'_, AIState>,
    tab_id: String,
    message: String,
    api_key: String,
    model: String,
    base_url: String,
) -> Result<(), String> {
    // Get cached page content or extract on demand
    let page = state
        .page_cache
        .get(&tab_id)
        .map(|p| p.clone())
        .or_else(|| {
            // If not cached, this is a follow-up with no extraction yet
            None
        });

    let page = match page {
        Some(p) => p,
        None => {
            // Trigger extraction first
            return Err("No page content cached. Call ai_extract_page first.".to_string());
        }
    };

    // Build the system prompt with page context
    let system_prompt = format!(
        "You are a helpful AI assistant integrated into XEVO Browser. \
         Answer questions based on this page content. Be concise but thorough.\n\n\
         --- PAGE TITLE: {title} ---\n\
         --- PAGE URL: {url} ---\n\n\
         {content}\n\n\
         ---\n\n\
         If the information is not in the page, say so.",
        title = page.title,
        url = page.metadata.as_ref()
            .and_then(|m| m.get("url"))
            .and_then(|v| v.as_str())
            .unwrap_or("unknown"),
        content = page.content,
    );

    // Get or create conversation
    let mut conversation = state
        .conversations
        .entry(tab_id.clone())
        .or_insert_with(Vec::new)
        .value()
        .clone();

    // If this is the first message, add the system prompt
    if conversation.is_empty() {
        conversation.push(ChatMessage {
            role: "system".to_string(),
            content: system_prompt,
        });
    }

    // Add user message
    conversation.push(ChatMessage {
        role: "user".to_string(),
        content: message,
    });

    // Call the AI API
    let full_response = stream_openai_compatible(
        &handle, &api_key, &base_url, &model, &conversation,
    )
    .await?;

    // Add assistant response to conversation
    conversation.push(ChatMessage {
        role: "assistant".to_string(),
        content: full_response,
    });

    // Store updated conversation
    state.conversations.insert(tab_id.clone(), conversation);

    // Signal completion
    let _ = handle.emit("ai://done", ());

    Ok(())
}

async fn stream_openai_compatible(
    handle: &AppHandle,
    api_key: &str,
    base_url: &str,
    model: &str,
    messages: Vec<ChatMessage>,
) -> Result<String, String> {
    let client = reqwest::Client::new();
    let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));

    let response = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({
            "model": model,
            "messages": messages.iter().map(|m| {
                serde_json::json!({
                    "role": m.role,
                    "content": m.content,
                })
            }).collect::<Vec<_>>(),
            "stream": true,
        }))
        .send()
        .await
        .map_err(|e| format!("API request failed: {}", e))?;

    use futures_util::StreamExt;
    let mut full = String::new();

    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Stream error: {}", e))?;
        let text = String::from_utf8_lossy(&chunk);

        for line in text.lines() {
            let line = line.trim();
            if let Some(json_str) = line.strip_prefix("data: ") {
                if json_str.trim() == "[DONE]" {
                    break;
                }
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(json_str) {
                    if let Some(content) = val["choices"][0]["delta"]["content"].as_str() {
                        full.push_str(content);
                        let _ = handle.emit("ai://chunk", content.to_string());
                    }
                }
            }
        }
    }

    Ok(full)
}
```

### 11.2 Real TypeScript: AIAssistantPanel Component

```tsx
import { useEffect, useState, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { useAIStore } from '@/stores/ai';
import { useSettingsStore } from '@/stores/settings';
import { useTabsStore } from '@/stores/tabs';

export function AIAssistantPanel() {
  const {
    conversation, isStreaming, streamingContent,
    addMessage, addChunk, startStreaming, stopStreaming, clearConversation,
  } = useAIStore();
  const settings = useSettingsStore((s) => s.settings);
  const activeTabId = useTabsStore((s) => s.activeTabId);
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [extracting, setExtracting] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const un1 = listen<string>('ai://chunk', (e) => addChunk(e.payload));
    const un2 = listen('ai://done', () => {
      stopStreaming();
      setExtracting(false);
    });
    return () => { un1.then((f) => f()); un2.then((f) => f()); };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [conversation, streamingContent]);

  const handleSummarize = async () => {
    if (!activeTabId || isStreaming) return;
    setError('');
    setExtracting(true);
    startStreaming();

    addMessage({ role: 'user', content: 'Summarize this page' });

    try {
      await invoke('ai_extract_page', { tabId: activeTabId });
      await invoke('ai_chat_send', {
        tabId: activeTabId,
        message: 'Summarize this page',
        apiKey: settings.ai.apiKey,
        model: settings.ai.model,
        baseUrl: settings.ai.baseUrl,
      });
    } catch (err) {
      setError(String(err));
      stopStreaming();
      setExtracting(false);
    }
  };

  const handleSend = async () => {
    const msg = input.trim();
    if (!msg || !activeTabId || isStreaming) return;
    setInput('');
    setError('');
    startStreaming();

    addMessage({ role: 'user', content: msg });

    try {
      await invoke('ai_chat_send', {
        tabId: activeTabId,
        message: msg,
        apiKey: settings.ai.apiKey,
        model: settings.ai.model,
        baseUrl: settings.ai.baseUrl,
      });
    } catch (err) {
      setError(String(err));
      stopStreaming();
    }
  };

  return (
    <div className="flex flex-col h-full bg-base-200 text-sm">
      <div className="flex items-center justify-between px-3 py-2 border-b border-base-300">
        <span className="font-semibold">AI Assistant</span>
        <button onClick={clearConversation} className="text-xs text-muted-foreground hover:text-foreground">
          Clear
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {conversation.filter((m) => m.role !== 'system').map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-lg px-3 py-2 whitespace-pre-wrap ${
              msg.role === 'user'
                ? 'bg-primary text-primary-foreground'
                : 'bg-base-300 text-base-content'
            }`}>
              {msg.content}
            </div>
          </div>
        ))}

        {streamingContent && (
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded-lg px-3 py-2 bg-base-300 text-base-content whitespace-pre-wrap">
              {streamingContent}
              <span className="animate-pulse">▊</span>
            </div>
          </div>
        )}

        {error && (
          <div className="text-destructive text-xs p-2 bg-destructive/10 rounded">
            {error}
          </div>
        )}

        {conversation.length === 0 && !extracting && (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground space-y-4">
            <p className="text-sm">Ask about the current page</p>
            <button
              onClick={handleSummarize}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90"
            >
              Summarize this page
            </button>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="p-3 border-t border-base-300">
        <div className="flex gap-2">
          <input
            className="flex-1 px-3 py-2 bg-base-300 rounded-lg outline-none text-sm"
            placeholder="Ask a question about this page..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            disabled={isStreaming || extracting}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isStreaming || extracting}
            className="px-3 py-2 bg-primary text-primary-foreground rounded-lg disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
```

---

## 12. Appendix: Source Summaries

### 12.1 GitHub Repo: Agentic Browser (AIAnytime/agent-browser)

**Stack:** Tauri + React + Node.js agent backend + OpenAI API

**Pattern:** React frontend with embedded browser and AI sidebar. The AI assistant uses a ReAct agent pattern to answer questions about web pages, click buttons, extract data. Communication flow: React → invoke() → Rust → eval() → browser webview → invoke() back → Rust → Node.js agent → OpenAI → stream back to React.

**Key takeaway:** This is the closest pattern to what XEVO needs. The sidebar + webview separation is handled by Rust as the intermediary.

---

### 12.2 GitHub Repo: ai-desktop-copilot / CatDesk (AlexisBERT-Work/ai-desktop-copilot)

**Stack:** Tauri 2 + React 19 + Ollama (local LLM)

**Pattern:** Floating overlay desktop copilot. Local-first — all AI runs via Ollama on localhost. Screen reading (OCR via Tesseract), file analysis (PDF, DOCX, CSV), RAG over personal documents. Tauri 2 capability-based permissions, risk-level gating.

**Key takeaway:** Proves that Ollama integration with Tauri is production-ready. The risk-level permission system is a good pattern for AI tool access control.

---

### 12.3 GitHub Repo: AI-Browser (kaduxo/AI-Browser)

**Stack:** Electron + TypeScript + Tailwind + LM Studio

**Pattern:** Context-aware AI chat, page summarization, selection analysis, and Agent Mode for task automation. Uses LM Studio for local LLMs or user-configured cloud APIs (tested with Anthropic). Privacy-first, no cloud tracking by default.

**Key takeaway:** UX patterns for AI browser assistant — summarize button, "use selected text" checkbox, follow-up conversation thread. The Electron/BrowserView pattern is analogous to Tauri's WebviewWindow separation.

---

### 12.4 GitHub Repo: Jarvis (nobodyme1206/Jarvis)

**Stack:** Tauri v2 + React + Rust + SQLite

**Pattern:** 6 specialized agents (Jarvis, App, Computer, Browser, File, Search) with delegation and handoff. Browser Agent reads web pages and performs controlled interactions. Tauri IPC bridge for Rust ↔ React communication. Local-first with SQLite-backed knowledge.

**Key takeaway:** Multi-agent architecture shows how to separate concerns. Browser Agent is the specific pattern XEVO needs. The Tauri IPC patterns (invoke + events) are exactly what XEVO already uses.

---

### 12.5 GitHub Repo: Bushido (visualstudioblyat/bushido)

**Stack:** Tauri v2 + React + adblock-rust

**Pattern:** Privacy-focused browser built on Tauri. Same tab-per-webview architecture as XEVO. Features: reader mode (Ctrl+Shift+R) that strips pages to clean text and images, vertical tabs, ad blocking via WebView2 COM interception, download manager, web panels. **Notably has no AI assistant** — the author explicitly lists "No AI assistants" as a design choice.

**Key takeaway:** This is the closest architecture to XEVO. The reader mode proves that page content extraction from separate WebviewWindows works. The ad-blocking COM interception shows advanced WebView2 integration patterns.

---

### 12.6 GitHub Repo: Victauri (4DA-Systems/Victauri)

**Stack:** Tauri MCP server plugin

**Pattern:** Embedded MCP server inside Tauri process. 35 tools including `eval_js`, `dom_snapshot`, `find_elements`, `screenshot`. Runs inside the Tauri process — same memory space, <1ms tool response. Tools available via MCP protocol or REST API.

**Key takeaway:** `eval_js` + `dom_snapshot` prove that JS evaluation and DOM access from Tauri's Rust backend is reliable and fast. The embedded architecture (<1ms response) shows the advantage of in-process vs external AI agents.

---

### 12.7 GitHub Repo: dom_smoothie (niklak/dom_smoothie)

**Stack:** Rust (Mozilla Readability port)

**Pattern:** Extracts readable content from HTML. Returns: title, byline, content (HTML), text_content, excerpt, site_name, published_time, image, url. Supports Markdown output. Follows readability.js closely.

**Key takeaway:** The ideal tool for Phase 2 content extraction. Can process HTML from the webview and output clean article text. Adding this would improve summary quality but requires sending full HTML (not just text) from webview to Rust.

---

### 12.8 Technical Article: tauri-pilot (dev.to/mpiton)

**Key insight:** "The tricky part was getting return values from `webview.eval()`. In Tauri v2, `eval()` is fire-and-forget. There's no way to get a result back directly. So every JS evaluation wraps the script in a try/catch, calls back into Rust via IPC (`invoke('plugin:pilot|__callback', {id, result})`), and the Rust side waits on a oneshot channel with a 10-second timeout."

This is the exact pattern XEVO needs. The article confirms:
- `eval()` returns no data → must use IPC callback
- Oneshot channels with timeout work reliably
- JS-level try/catch is required for Windows WebView2 (exceptions are silently ignored)

---

### 12.9 Tauri Docs: WebviewWindowBuilder

**Key details:**
- `initialization_script`: Runs after global object created, before HTML parsed. On Windows, injected into all subframes.
- Wrapped in `(function() { ... })()` — variables don't leak to global scope.
- `eval_with_callback` (Tauri v2.11+): Evaluates JS and calls a Rust closure with the result string.
- `on_page_load`: Hook for page load events (Started/Finished).

---

### 12.10 Tauri Security: GHSA-7gmj-67g7-phm9 (Origin Confusion)

**Key insight:** Remote origins can exploit confusion between custom protocol schemes and subdomain patterns to invoke local-only IPC commands. Tauri v2 mitigates this with ACL-based capability validation on every IPC message.

**Implication for XEVO AI:** The browser tabs load remote content. The injected extraction JS calls `__TAURI_INTERNALS__.invoke()` which is the low-level IPC bridge. In Tauri v2, this call is validated against the capability ACL. The `ai_page_content_callback` command must be explicitly permitted for the browser webview windows.

**Solution:** Add the AI commands to the capability file with appropriate window scope.

---

## Document History

| Date | Author | Changes |
|------|--------|---------|
| 2026-07-20 | AI Research | Initial document — all research compiled |
