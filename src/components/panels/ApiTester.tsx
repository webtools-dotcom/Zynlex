/**
 * ApiTester — Postman-style API testing panel.
 *
 * MVP features:
 *   - Method selector (GET/POST/PUT/DELETE/PATCH/HEAD/OPTIONS)
 *   - URL input
 *   - Tabbed request editor: Headers, Body, cURL Import
 *   - Send button (routed through the Rust `api_fetch` command — the main
 *     window's own `fetch()` is bound by the app's CSP to localhost, so a
 *     real HTTP client on the Rust side is what makes cross-origin requests work)
 *   - Response viewer: status, duration, size, headers, body
 *   - JSON auto-formatting in the response body
 *   - Per-session request history (last 50), shared with the sidebar
 *     launcher card via useApiHistoryStore
 *   - Two layouts: full-page modal (embedded=false) and sidebar (embedded=true)
 *
 * History is in-memory only for the v1 MVP. Persisting the history
 * is a future enhancement.
 */
import { useState, useRef, useMemo, useEffect } from "react";
import {
  Send, Plus, X, Trash2, Clock, ChevronDown, ChevronUp,
  History, Code2, FileText, Clipboard, Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useServersStore } from "@/stores/servers";
import { useApiHistoryStore } from "@/stores/apiHistory";
import { apiFetch } from "@/services/browser";
import type { HttpMethod, ApiHeader, ApiHistoryEntry } from "@/types";

const METHODS: HttpMethod[] = [
  "GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS",
];

const METHOD_COLORS: Record<HttpMethod, string> = {
  GET: "#22c55e",
  POST: "#f59e0b",
  PUT: "#3b82f6",
  DELETE: "#ef4444",
  PATCH: "#a855f7",
  HEAD: "#71717a",
  OPTIONS: "#06b6d4",
};

function genId(): string {
  return `h-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function defaultHeaders(): ApiHeader[] {
  return [
    { id: genId(), key: "Content-Type", value: "application/json", enabled: true },
    { id: genId(), key: "Accept", value: "application/json", enabled: true },
  ];
}

// ── cURL parser ──────────────────────────────────────────────────────
// Handles:  curl [-X METHOD] [URL] [-H 'k: v']... [-d 'BODY'] [--data-raw 'BODY'] [-u user:pass]
//          [-F 'k=v'] [--cookie 'x=y'] [-b 'x=y'] [-A 'UA'] [--header 'k: v']
// Single-quoted, double-quoted, and unquoted arguments are all supported.

interface ParsedCurl {
  method: HttpMethod;
  url: string;
  headers: ApiHeader[];
  body: string;
}

export function parseCurl(input: string): ParsedCurl {
  const result: ParsedCurl = {
    method: "GET",
    url: "",
    headers: [],
    body: "",
  };
  const tokens = tokenizeCurl(input);
  let i = 0;
  while (i < tokens.length) {
    const tok = tokens[i];
    const next = (): string | undefined => tokens[++i];

    if (tok === "-X" || tok === "--request") {
      const v = next();
      if (v) {
        const m = v.toUpperCase() as HttpMethod;
        if (METHODS.includes(m)) result.method = m;
      }
    } else if (tok === "-H" || tok === "--header") {
      const v = next();
      if (v) {
        const idx = v.indexOf(":");
        if (idx > 0) {
          result.headers.push({
            id: genId(),
            key: v.slice(0, idx).trim(),
            value: v.slice(idx + 1).trim(),
            enabled: true,
          });
        }
      }
    } else if (tok === "-d" || tok === "--data" || tok === "--data-raw" || tok === "--data-binary" || tok === "--data-urlencode") {
      const v = next();
      if (v != null) {
        result.body += result.body ? "\n" + v : v;
        if (result.method === "GET") result.method = "POST";
      }
    } else if (tok === "-F" || tok === "--form") {
      const v = next();
      if (v) {
        const idx = v.indexOf("=");
        if (idx > 0) {
          result.headers.push({
            id: genId(),
            key: v.slice(0, idx).trim(),
            value: v.slice(idx + 1).trim(),
            enabled: true,
          });
        }
      }
    } else if (tok === "-u" || tok === "--user") {
      const v = next();
      if (v) {
        const encoded = btoa(v);
        result.headers.push({
          id: genId(),
          key: "Authorization",
          value: `Basic ${encoded}`,
          enabled: true,
        });
      }
    } else if (tok === "-A" || tok === "--user-agent") {
      const v = next();
      if (v) {
        result.headers.push({
          id: genId(),
          key: "User-Agent",
          value: v,
          enabled: true,
        });
      }
    } else if (tok === "-b" || tok === "--cookie") {
      const v = next();
      if (v) {
        result.headers.push({
          id: genId(),
          key: "Cookie",
          value: v,
          enabled: true,
        });
      }
    } else if (tok === "-L" || tok === "--location" || tok === "-k" || tok === "--insecure" || tok === "-s" || tok === "--silent" || tok === "-i" || tok === "--include") {
      // skip flags we don't surface
    } else if (tok.startsWith("-") && tok.length > 2) {
      // combined short flags like -sSL, -iL - skip
    } else if (tok.startsWith("--")) {
      // unknown long flag - skip the value if it doesn't start with -
      const v = next();
      if (v && v.startsWith("-")) i--;
    } else if (!result.url) {
      result.url = tok;
    }
    i++;
  }
  return result;
}

function tokenizeCurl(input: string): string[] {
  const out: string[] = [];
  const re = /\s*('([^'\\]*(?:\\.[^'\\]*)*)'|"([^"\\]*(?:\\.[^"\\]*)*)"|(\S+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) {
    out.push(m[2] ?? m[3] ?? m[4] ?? "");
  }
  return out;
}

// ── JSON formatter ───────────────────────────────────────────────────

function tryFormatJson(input: string): { ok: true; formatted: string } | { ok: false } {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false };
  try {
    const parsed = JSON.parse(trimmed);
    return { ok: true, formatted: JSON.stringify(parsed, null, 2) };
  } catch {
    return { ok: false };
  }
}

// ── Main component ──────────────────────────────────────────────────

interface ApiTesterProps {
  embedded?: boolean;
  onClose?: () => void;
}

type EditorTab = "headers" | "body" | "curl";
type ResponseTab = "body" | "headers";

export function ApiTester({ embedded = false, onClose }: ApiTesterProps) {
  const { servers } = useServersStore();
  const history = useApiHistoryStore((s) => s.history);
  const addHistory = useApiHistoryStore((s) => s.addHistory);
  const clearHistory = useApiHistoryStore((s) => s.clearHistory);

  const [method, setMethod] = useState<HttpMethod>("GET");
  const [url, setUrl] = useState<string>("");
  const [headers, setHeaders] = useState<ApiHeader[]>(() => defaultHeaders());
  const [body, setBody] = useState<string>("");
  const [curlInput, setCurlInput] = useState<string>("");
  const [editorTab, setEditorTab] = useState<EditorTab>("headers");

  const [sending, setSending] = useState<boolean>(false);
  const [response, setResponse] = useState<{
    status: number;
    statusText: string;
    headers: Record<string, string>;
    body: string;
    durationMs: number;
    size: number;
    isJson: boolean;
    formattedBody: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [responseTab, setResponseTab] = useState<ResponseTab>("body");
  const [historyOpen, setHistoryOpen] = useState<boolean>(!embedded);
  const [copied, setCopied] = useState<boolean>(false);

  const urlInputRef = useRef<HTMLInputElement>(null);

  // Esc to close the modal (only when not embedded and onClose is provided)
  useEffect(() => {
    if (embedded || !onClose) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose?.();
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [embedded, onClose]);

  // Build a list of quick-pick URL suggestions from live servers
  const quickUrls = useMemo(
    () =>
      servers
        .filter((s) => s.isAlive)
        .map((s) => `${s.protocol}://localhost:${s.port}`)
        .slice(0, 6),
    [servers]
  );

  async function send() {
    if (!url.trim()) {
      setError("URL is required");
      return;
    }
    if (sending) return;
    setSending(true);
    setError(null);
    setResponse(null);

    // Build the headers object, filtering out disabled rows
    const hdrObj: Record<string, string> = {};
    for (const h of headers) {
      if (h.enabled && h.key.trim()) {
        hdrObj[h.key.trim()] = h.value;
      }
    }

    const hasBody =
      body.trim().length > 0 &&
      method !== "GET" &&
      method !== "HEAD";

    try {
      const res = await apiFetch({
        method,
        url,
        headers: hdrObj,
        body: hasBody ? body : undefined,
      });

      const formatResult = tryFormatJson(res.body);
      const formatted = formatResult.ok ? formatResult.formatted : res.body;

      setResponse({
        status: res.status,
        statusText: res.statusText,
        headers: res.headers,
        body: res.body,
        durationMs: res.durationMs,
        size: new Blob([res.body]).size,
        isJson: formatResult.ok,
        formattedBody: formatted,
      });
      setResponseTab("body");

      addHistory({
        method,
        url,
        status: res.status,
        statusText: res.statusText,
        durationMs: res.durationMs,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`Network error: ${msg}`);
    } finally {
      setSending(false);
    }
  }

  function addHeaderRow() {
    setHeaders((h) => [
      ...h,
      { id: genId(), key: "", value: "", enabled: true },
    ]);
  }

  function updateHeader(id: string, patch: Partial<ApiHeader>) {
    setHeaders((h) => h.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  function removeHeader(id: string) {
    setHeaders((h) => h.filter((row) => row.id !== id));
  }

  function importCurl() {
    if (!curlInput.trim()) return;
    const parsed = parseCurl(curlInput);
    setMethod(parsed.method);
    setUrl(parsed.url);
    setHeaders(parsed.headers.length > 0 ? parsed.headers : defaultHeaders());
    setBody(parsed.body);
    setCurlInput("");
    setEditorTab("headers");
  }

  function loadFromHistory(entry: ApiHistoryEntry) {
    setMethod(entry.method);
    setUrl(entry.url);
  }

  function onClearHistory() {
    clearHistory();
  }

  function copyResponse() {
    if (!response) return;
    navigator.clipboard.writeText(response.body).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  }

  const statusColor = response
    ? response.status >= 200 && response.status < 300
      ? "var(--color-live)"
      : response.status >= 400
        ? "var(--color-dead)"
        : "var(--color-warn)"
    : "var(--color-text-disabled)";

  // ── Render ──────────────────────────────────────────────────────

  const sharedProps: BodySharedProps = {
    method,
    setMethod,
    url,
    setUrl,
    urlInputRef,
    sending,
    error,
    send,
    editorTab,
    setEditorTab,
    headers,
    addHeaderRow,
    updateHeader,
    removeHeader,
    body,
    setBody,
    curlInput,
    setCurlInput,
    importCurl,
    response,
    statusColor,
    responseTab,
    setResponseTab,
    copyResponse,
    copied,
    history,
    historyOpen,
    setHistoryOpen,
    loadFromHistory,
    onClearHistory,
    quickUrls,
  };

  if (embedded) {
    return (
      <div className="flex flex-col h-full overflow-hidden">
        <EmbeddedBody {...sharedProps} />
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <FullPageBody {...sharedProps} onClose={onClose} />
    </div>
  );
}

// ── Body sub-components ─────────────────────────────────────────────

interface BodySharedProps {
  method: HttpMethod;
  setMethod: (m: HttpMethod) => void;
  url: string;
  setUrl: (u: string) => void;
  urlInputRef: React.RefObject<HTMLInputElement | null>;
  sending: boolean;
  error: string | null;
  send: () => void;
  editorTab: EditorTab;
  setEditorTab: (t: EditorTab) => void;
  headers: ApiHeader[];
  addHeaderRow: () => void;
  updateHeader: (id: string, patch: Partial<ApiHeader>) => void;
  removeHeader: (id: string) => void;
  body: string;
  setBody: (b: string) => void;
  curlInput: string;
  setCurlInput: (s: string) => void;
  importCurl: () => void;
  response: {
    status: number;
    statusText: string;
    headers: Record<string, string>;
    body: string;
    durationMs: number;
    size: number;
    isJson: boolean;
    formattedBody: string;
  } | null;
  statusColor: string;
  responseTab: ResponseTab;
  setResponseTab: (t: ResponseTab) => void;
  copyResponse: () => void;
  copied: boolean;
  history: ApiHistoryEntry[];
  historyOpen: boolean;
  setHistoryOpen: (b: boolean) => void;
  loadFromHistory: (entry: ApiHistoryEntry) => void;
  onClearHistory: () => void;
  quickUrls: string[];
}

function MethodSelector({
  method,
  setMethod,
}: {
  method: HttpMethod;
  setMethod: (m: HttpMethod) => void;
}) {
  return (
    <div className="relative flex-shrink-0">
      <select
        value={method}
        onChange={(e) => setMethod(e.target.value as HttpMethod)}
        className="appearance-none h-9 pl-2 pr-7 text-[12px] font-bold rounded border outline-none cursor-pointer"
        style={{
          background: METHOD_COLORS[method] + "22",
          borderColor: METHOD_COLORS[method] + "66",
          color: METHOD_COLORS[method],
        }}
      >
        {METHODS.map((m) => (
          <option key={m} value={m} style={{ color: "var(--color-text-primary)" }}>
            {m}
          </option>
        ))}
      </select>
      <ChevronDown
        size={13}
        className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none"
        style={{ color: METHOD_COLORS[method] }}
      />
    </div>
  );
}

function RequestEditor(p: BodySharedProps) {
  const canHaveBody = p.method !== "GET" && p.method !== "HEAD";

  return (
    <div className="border-b" style={{ borderColor: "var(--color-border)" }}>
      {/* Tabs */}
      <div
        className="flex items-center gap-1 px-3 py-2 border-b"
        style={{ borderColor: "var(--color-border)" }}
      >
        <TabButton
          active={p.editorTab === "headers"}
          onClick={() => p.setEditorTab("headers")}
          icon={<FileText size={13} />}
          label={`Headers (${p.headers.length})`}
        />
        <TabButton
          active={p.editorTab === "body"}
          onClick={() => p.setEditorTab("body")}
          icon={<Code2 size={13} />}
          label="Body"
          disabled={!canHaveBody}
        />
        <TabButton
          active={p.editorTab === "curl"}
          onClick={() => p.setEditorTab("curl")}
          icon={<Clipboard size={13} />}
          label="cURL Import"
        />
      </div>

      {/* Tab content */}
      <div className="p-3 max-h-64 overflow-y-auto">
        {p.editorTab === "headers" && (
          <div className="space-y-1.5">
            {p.headers.map((h) => (
              <div key={h.id} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={h.enabled}
                  onChange={(e) =>
                    p.updateHeader(h.id, { enabled: e.target.checked })
                  }
                  className="accent-[var(--color-accent)] flex-shrink-0"
                />
                <input
                  type="text"
                  value={h.key}
                  onChange={(e) => p.updateHeader(h.id, { key: e.target.value })}
                  placeholder="Header name"
                  className="flex-1 min-w-0 px-2 py-1 text-[13px] font-mono bg-[var(--color-elevated)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-disabled)] rounded outline-none border focus:border-[var(--color-accent)]"
                  style={{ borderColor: "var(--color-border)" }}
                />
                <input
                  type="text"
                  value={h.value}
                  onChange={(e) => p.updateHeader(h.id, { value: e.target.value })}
                  placeholder="Value"
                  className="flex-1 min-w-0 px-2 py-1 text-[13px] font-mono bg-[var(--color-elevated)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-disabled)] rounded outline-none border focus:border-[var(--color-accent)]"
                  style={{ borderColor: "var(--color-border)" }}
                />
                <button
                  onClick={() => p.removeHeader(h.id)}
                  aria-label="Remove header"
                  className="w-6 h-6 flex items-center justify-center rounded text-[var(--color-text-disabled)] hover:text-[var(--color-dead)] hover:bg-[var(--color-hover)]"
                >
                  <X size={13} />
                </button>
              </div>
            ))}
            <button
              onClick={p.addHeaderRow}
              className="flex items-center gap-1 text-[13px] text-[var(--color-text-disabled)] hover:text-[var(--color-text-primary)] mt-1"
            >
              <Plus size={13} /> Add header
            </button>
          </div>
        )}

        {p.editorTab === "body" && canHaveBody && (
          <textarea
            value={p.body}
            onChange={(e) => p.setBody(e.target.value)}
            placeholder='{"key": "value"}'
            spellCheck={false}
            className="w-full h-40 px-2 py-1.5 text-[13px] font-mono bg-[var(--color-elevated)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-disabled)] rounded outline-none border resize-none"
            style={{ borderColor: "var(--color-border)" }}
          />
        )}

        {p.editorTab === "body" && !canHaveBody && (
          <p className="text-[13px] text-[var(--color-text-disabled)] text-center py-4">
            {p.method} requests cannot have a body
          </p>
        )}

        {p.editorTab === "curl" && (
          <div className="space-y-2">
            <textarea
              value={p.curlInput}
              onChange={(e) => p.setCurlInput(e.target.value)}
              placeholder={`curl -X POST 'https://api.example.com/users' -H 'Content-Type: application/json' -d '{"name":"John"}'`}
              spellCheck={false}
              className="w-full h-32 px-2 py-1.5 text-[13px] font-mono bg-[var(--color-elevated)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-disabled)] rounded outline-none border resize-none"
              style={{ borderColor: "var(--color-border)" }}
            />
            <button
              onClick={p.importCurl}
              disabled={!p.curlInput.trim()}
              className="w-full h-8 text-[12px] font-medium rounded text-white bg-[var(--color-accent)] hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Import
            </button>
            <p className="text-[12px] text-[var(--color-text-disabled)]">
              Pastes a cURL command and parses it into the request fields.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function ResponseViewer(p: BodySharedProps) {
  if (p.error) {
    return (
      <div
        className="p-3 text-[13px] font-mono"
        style={{ color: "var(--color-dead)" }}
      >
        {p.error}
      </div>
    );
  }
  if (!p.response) {
    return (
      <div className="p-6 text-center text-[13px] text-[var(--color-text-disabled)]">
        Send a request to see the response
      </div>
    );
  }

  const r = p.response;
  return (
    <div className="flex flex-col h-full">
      {/* Status bar */}
      <div
        className="flex items-center gap-3 px-3 py-2 border-b text-[13px]"
        style={{ borderColor: "var(--color-border)" }}
      >
        <span
          className="font-bold px-1.5 py-0.5 rounded"
          style={{
            background: p.statusColor + "22",
            color: p.statusColor,
            fontFeatureSettings: '"tnum" 1',
          }}
        >
          {r.status}
        </span>
        <span className="text-[var(--color-text-primary)] truncate">
          {r.statusText || "(no status text)"}
        </span>
        <span className="ml-auto flex items-center gap-3 text-[var(--color-text-disabled)]">
          <span className="flex items-center gap-1" style={{ fontFeatureSettings: '"tnum" 1' }}>
            <Clock size={12} /> {r.durationMs}ms
          </span>
          <span style={{ fontFeatureSettings: '"tnum" 1' }}>{formatBytes(r.size)}</span>
        </span>
      </div>

      {/* Tabs */}
      <div
        className="flex items-center gap-1 px-3 py-1.5 border-b"
        style={{ borderColor: "var(--color-border)" }}
      >
        <TabButton
          active={p.responseTab === "body"}
          onClick={() => p.setResponseTab("body")}
          label="Body"
          badge={r.isJson ? "JSON" : undefined}
        />
        <TabButton
          active={p.responseTab === "headers"}
          onClick={() => p.setResponseTab("headers")}
          label="Headers"
          badge={String(Object.keys(r.headers).length)}
        />
        <button
          onClick={p.copyResponse}
          className="ml-auto flex items-center gap-1 px-2 py-0.5 text-[12px] rounded text-[var(--color-text-disabled)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-hover)]"
        >
          {p.copied ? <Check size={12} /> : <Clipboard size={12} />}
          {p.copied ? "Copied" : "Copy"}
        </button>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-auto p-3">
        {p.responseTab === "body" ? (
          <pre className="text-[13px] font-mono text-[var(--color-text-primary)] whitespace-pre-wrap break-all">
            {r.formattedBody}
          </pre>
        ) : (
          <div className="space-y-0.5">
            {Object.entries(r.headers).map(([k, v]) => (
              <div key={k} className="flex text-[13px] font-mono">
                <span className="text-[var(--color-accent)] mr-2 flex-shrink-0">
                  {k}:
                </span>
                <span className="text-[var(--color-text-primary)] break-all">{v}</span>
              </div>
            ))}
            {Object.keys(r.headers).length === 0 && (
              <p className="text-[13px] text-[var(--color-text-disabled)]">No headers</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function HistoryPanel(p: BodySharedProps) {
  if (!p.historyOpen) {
    return (
      <button
        onClick={() => p.setHistoryOpen(true)}
        className="flex items-center gap-1 text-[12px] text-[var(--color-text-disabled)] hover:text-[var(--color-text-primary)] px-2 py-1"
      >
        <ChevronUp size={12} /> History ({p.history.length})
      </button>
    );
  }
  return (
    <div
      className="border-t"
      style={{ borderColor: "var(--color-border)" }}
    >
      <div className="flex items-center justify-between px-3 py-1.5">
        <span className="text-[12px] font-semibold tracking-wider text-[var(--color-text-disabled)] uppercase flex items-center gap-1">
          <History size={12} /> History
        </span>
        <div className="flex items-center gap-1">
          {p.history.length > 0 && (
            <button
              onClick={p.onClearHistory}
              aria-label="Clear request history"
              className="text-[12px] text-[var(--color-text-disabled)] hover:text-[var(--color-dead)] px-1"
            >
              <Trash2 size={12} />
            </button>
          )}
          <button
            onClick={() => p.setHistoryOpen(false)}
            aria-label="Collapse history"
            className="text-[12px] text-[var(--color-text-disabled)] hover:text-[var(--color-text-primary)]"
          >
            <ChevronDown size={12} />
          </button>
        </div>
      </div>
      <div className="max-h-32 overflow-y-auto">
        {p.history.length === 0 ? (
          <p className="text-[12px] text-[var(--color-text-disabled)] text-center py-2">
            No requests yet
          </p>
        ) : (
          p.history.map((h) => (
            <button
              key={h.id}
              onClick={() => p.loadFromHistory(h)}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-[var(--color-hover)]"
            >
              <span
                className="text-[12px] font-bold flex-shrink-0"
                style={{ color: METHOD_COLORS[h.method] }}
              >
                {h.method}
              </span>
              <span className="text-[13px] text-[var(--color-text-muted)] font-mono flex-1 min-w-0 truncate">
                {h.url}
              </span>
              <span
                className="text-[12px] font-mono flex-shrink-0"
                style={{
                  color: h.status >= 200 && h.status < 300
                    ? "var(--color-live)"
                    : h.status >= 400
                      ? "var(--color-dead)"
                      : "var(--color-warn)",
                  fontFeatureSettings: '"tnum" 1',
                }}
              >
                {h.status}
              </span>
              <span className="text-[12px] text-[var(--color-text-disabled)] flex-shrink-0" style={{ fontFeatureSettings: '"tnum" 1' }}>
                {h.durationMs}ms
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function QuickUrls(p: BodySharedProps) {
  if (p.quickUrls.length === 0) return null;
  return (
    <div
      className="flex items-center gap-1 flex-wrap px-3 py-2 border-t"
      style={{ borderColor: "var(--color-border)" }}
    >
      <span className="text-[12px] text-[var(--color-text-disabled)] mr-1">
        Quick:
      </span>
      {p.quickUrls.map((u) => (
        <button
          key={u}
          onClick={() => p.setUrl(u)}
          className="px-1.5 py-0.5 text-[12px] font-mono rounded border text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-hover)]"
          style={{ borderColor: "var(--color-border)" }}
        >
          {u}
        </button>
      ))}
    </div>
  );
}

function TopBar(p: BodySharedProps) {
  return (
    <div
      className="flex items-center gap-1.5 p-2 border-b"
      style={{ borderColor: "var(--color-border)" }}
    >
      <MethodSelector method={p.method} setMethod={p.setMethod} />
      <input
        ref={p.urlInputRef}
        type="text"
        value={p.url}
        onChange={(e) => p.setUrl(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            p.send();
          }
        }}
        placeholder="https://api.example.com/endpoint"
        spellCheck={false}
        className="flex-1 min-w-0 h-9 px-2 text-[12px] font-mono bg-[var(--color-elevated)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-disabled)] rounded outline-none border focus:border-[var(--color-accent)]"
        style={{ borderColor: "var(--color-border)" }}
      />
      <button
        onClick={p.send}
        disabled={p.sending || !p.url.trim()}
        className="h-9 px-3 text-[12px] font-medium rounded text-white bg-[var(--color-accent)] hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
      >
        {p.sending ? (
          <span className="animate-pulse">Sending…</span>
        ) : (
          <>
            <Send size={12} /> Send
          </>
        )}
      </button>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
  disabled,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  icon?: React.ReactNode;
  label: string;
  disabled?: boolean;
  badge?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex items-center gap-1 px-2 py-1 text-[13px] rounded transition-colors",
        active
          ? "bg-[var(--color-hover)] text-[var(--color-text-primary)]"
          : "text-[var(--color-text-disabled)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-hover)]",
        disabled && "opacity-40 cursor-not-allowed"
      )}
    >
      {icon}
      {label}
      {badge && (
        <span
          className="px-1 text-[11px] rounded font-mono"
          style={{
            background: "var(--color-elevated)",
            color: "var(--color-text-muted)",
          }}
        >
          {badge}
        </span>
      )}
    </button>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function EmbeddedBody(p: BodySharedProps) {
  return (
    <>
      <TopBar {...p} />
      <RequestEditor {...p} />
      <div className="flex-1 overflow-hidden flex flex-col min-h-0">
        <ResponseViewer {...p} />
      </div>
      <HistoryPanel {...p} />
      <QuickUrls {...p} />
    </>
  );
}

function FullPageBody(p: BodySharedProps & { onClose?: () => void }) {
  return (
    <div
      className="w-[900px] h-[700px] max-w-[95vw] max-h-[95vh] flex flex-col rounded-[6px] overflow-hidden border"
      style={{
        background: "var(--color-elevated)",
        borderColor: "var(--color-border)",
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className="flex items-center justify-between h-10 px-3 border-b"
        style={{ borderColor: "var(--color-border)" }}
      >
        <span className="text-[12px] font-semibold text-[var(--color-text-primary)] flex items-center gap-1.5">
          <Code2 size={13} /> API Tester
        </span>
        <button
          onClick={p.onClose}
          className="text-[var(--color-text-disabled)] hover:text-[var(--color-text-primary)]"
          title="Close (Esc)"
          aria-label="Close API Tester"
        >
          <X size={14} />
        </button>
      </div>
      <EmbeddedBody {...p} />
    </div>
  );
}

export default ApiTester;
