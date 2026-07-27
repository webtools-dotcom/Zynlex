import { useState, useRef, useEffect, useMemo } from "react";
import {
  useNetworkStore,
  type NetworkLogEntry,
  formatDuration,
  resourceTypeLabel,
} from "@/stores/network";
import { useWorkspacesStore } from "@/stores/workspaces";
import { useTabsStore } from "@/stores/tabs";
import { getLiveWorkspaceActiveTab } from "@/lib/workspaceTabs";
import { entryToCurl, entryToFetch } from "@/lib/networkCopy";
import { copyToClipboard } from "@/lib/clipboard";
import { formatBytes } from "@/lib/format";
import { hostOf } from "@/lib/url";
import { useCopy } from "@/hooks/useCopy";
import { setNetworkCapture } from "@/services/browser";

const METHOD_COLORS: Record<string, string> = {
  GET: "text-method-get",
  POST: "text-method-post",
  PUT: "text-method-put",
  PATCH: "text-method-patch",
  DELETE: "text-method-delete",
  HEAD: "text-method-head",
  OPTIONS: "text-method-options",
};

/* One definition — the header row and every entry row share it, so columns cannot drift.
   URL keeps a real minimum instead of minmax(0,…): at the default 240px sidebar width the
   fixed columns alone exceed that, so a 0-minimum let URL collapse to nothing. The row/header
   wrapper below scrolls horizontally once the panel is narrower than this, same as it would
   in any other network inspector. */
const GRID_COLS = "2.75rem 2rem 2.25rem minmax(6rem,1fr) 6rem 3.5rem 2.5rem 1.75rem";
const GRID_MIN_WIDTH = "31rem";

const TYPE_COLORS: Record<string, string> = {
  document: "bg-blue-500/20 text-blue-300",
  stylesheet: "bg-purple-500/20 text-purple-300",
  script: "bg-yellow-500/20 text-yellow-300",
  image: "bg-green-500/20 text-green-300",
  media: "bg-pink-500/20 text-pink-300",
  font: "bg-indigo-500/20 text-indigo-300",
  xhr: "bg-cyan-500/20 text-cyan-300",
  fetch: "bg-teal-500/20 text-teal-300",
  websocket: "bg-orange-500/20 text-orange-300",
  manifest: "bg-gray-500/20 text-gray-300",
  ping: "bg-rose-500/20 text-rose-300",
  other: "bg-gray-500/20 text-gray-400",
};

function statusColor(code: number): string {
  if (code >= 200 && code < 300) return "text-status-2xx";
  if (code >= 300 && code < 400) return "text-status-3xx";
  if (code >= 400 && code < 500) return "text-status-4xx";
  if (code >= 500) return "text-status-5xx";
  return "text-[var(--color-text-disabled)]";
}

const SLOW_THRESHOLD_MS = 1000;

function entryIsError(e: NetworkLogEntry): boolean {
  return e.statusCode >= 400;
}

function entryIsSlow(e: NetworkLogEntry): boolean {
  return e.durationMs > SLOW_THRESHOLD_MS;
}

function entryIsApi(e: NetworkLogEntry): boolean {
  return e.resourceType === "xhr" || e.resourceType === "fetch";
}

const BODY_PREVIEW_MAX = 500;

function bodyPreview(body: string): string {
  if (!body) return "";
  if (body.length > BODY_PREVIEW_MAX) return body.slice(0, BODY_PREVIEW_MAX) + "...";
  return body;
}

type Filter = "all" | "errors" | "api" | "slow";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "errors", label: "Errors" },
  { id: "api", label: "API" },
  { id: "slow", label: "Slow" },
];

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

/** Same 17 types Rust classifies, in the order they matter for triage. */
const RESOURCE_TYPES = [
  "document",
  "stylesheet",
  "script",
  "xhr",
  "fetch",
  "image",
  "media",
  "font",
  "websocket",
  "manifest",
  "ping",
  "eventsource",
  "texttrack",
  "signedexchange",
  "cspviolationreport",
  "other",
];

const STATUS_RANGES = [
  { id: "2xx", label: "2xx", test: (c: number) => c >= 200 && c < 300 },
  { id: "3xx", label: "3xx", test: (c: number) => c >= 300 && c < 400 },
  { id: "4xx", label: "4xx", test: (c: number) => c >= 400 && c < 500 },
  { id: "5xx", label: "5xx", test: (c: number) => c >= 500 },
];

const SELECT_CLASS =
  "text-micro bg-[var(--color-elevated)] text-[var(--color-text-muted)] rounded outline-none border border-[var(--color-border)] px-1 py-0.5";

function DetailTabs({ entry, onClose }: { entry: NetworkLogEntry; onClose: () => void }) {
  const [tab, setTab] = useState<"headers" | "body" | "copy">("headers");
  const { copiedLabel: copied, copy: handleCopy } = useCopy();

  return (
    <div className="border-t border-[var(--color-border)] bg-[var(--color-surface)] text-micro font-mono">
      <div className="flex items-center justify-between px-3 py-1 border-b border-[var(--color-border)]">
        <div className="flex gap-1">
          {(["headers", "body", "copy"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-2 py-0.5 rounded text-micro uppercase tracking-wider ${tab === t ? "bg-[var(--color-hover)] text-[var(--color-text-primary)]" : "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"}`}
            >
              {t}
            </button>
          ))}
        </div>
        <button
          onClick={onClose}
          className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] text-sm leading-none px-1"
        >
          &times;
        </button>
      </div>
      <div className="max-h-48 overflow-y-auto p-3">
        {tab === "headers" && (
          <div className="space-y-1">
            <div className="flex gap-3">
              <span className="text-[var(--color-text-muted)]">URL:</span>
              <span className="break-all">{entry.url}</span>
            </div>
            <div className="flex gap-3">
              <span className="text-[var(--color-text-muted)]">Status:</span>
              <span className={statusColor(entry.statusCode)}>
                {entry.statusCode} {entry.reasonPhrase}
              </span>
            </div>
            <div className="flex gap-3">
              <span className="text-[var(--color-text-muted)]">Type:</span>
              <span>{entry.resourceType}</span>
            </div>
            <div className="flex gap-3">
              <span className="text-[var(--color-text-muted)]">Size:</span>
              <span>{formatBytes(entry.contentLength)}</span>
            </div>
            <div className="flex gap-3">
              <span className="text-[var(--color-text-muted)]">Time:</span>
              <span>{formatDuration(entry.durationMs)}</span>
            </div>
            {entry.referrer && (
              <div className="flex gap-3">
                <span className="text-[var(--color-text-muted)]">Referrer:</span>
                <span className="break-all">{entry.referrer}</span>
              </div>
            )}
            <div className="pt-2 border-t border-[var(--color-border)]">
              <div className="text-[var(--color-text-muted)] mb-1">Response Headers:</div>
              {Object.keys(entry.headers).length === 0 ? (
                <div className="text-[var(--color-text-muted)] italic">(none)</div>
              ) : (
                <div className="space-y-0.5">
                  {Object.entries(entry.headers).map(([k, v]) => (
                    <div key={k} className="flex gap-2 text-micro">
                      <span className="text-[var(--color-text-muted)] shrink-0">{k}:</span>
                      <span className="truncate">{v}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
        {tab === "body" && (
          <div>
            {entry.body ? (
              <pre className="whitespace-pre-wrap break-all text-micro text-[var(--color-text-muted)] bg-[var(--color-hover)] rounded p-1.5 max-h-40 overflow-y-auto">
                {bodyPreview(entry.body)}
              </pre>
            ) : (
              <div className="text-[var(--color-text-muted)] italic">(no response body)</div>
            )}
          </div>
        )}
        {tab === "copy" && (
          <div className="space-y-2">
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[var(--color-text-muted)]">cURL</span>
                <button
                  onClick={() => handleCopy(entryToCurl(entry), "curl")}
                  className="text-micro px-2 py-0.5 rounded bg-[var(--color-hover)] hover:bg-[var(--color-border)]"
                >
                  {copied === "curl" ? "Copied!" : "Copy"}
                </button>
              </div>
              <pre className="whitespace-pre-wrap break-all text-micro text-[var(--color-text-muted)] bg-[var(--color-hover)] rounded p-1.5 max-h-32 overflow-y-auto">
                {entryToCurl(entry)}
              </pre>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[var(--color-text-muted)]">fetch()</span>
                <button
                  onClick={() => handleCopy(entryToFetch(entry), "fetch")}
                  className="text-micro px-2 py-0.5 rounded bg-[var(--color-hover)] hover:bg-[var(--color-border)]"
                >
                  {copied === "fetch" ? "Copied!" : "Copy"}
                </button>
              </div>
              <pre className="whitespace-pre-wrap break-all text-micro text-[var(--color-text-muted)] bg-[var(--color-hover)] rounded p-1.5 max-h-32 overflow-y-auto">
                {entryToFetch(entry)}
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function EntryRow({
  entry,
  isSelected,
  onClick,
}: {
  entry: NetworkLogEntry;
  isSelected: boolean;
  onClick: () => void;
}) {
  const handleCopyCurl = (e: React.MouseEvent) => {
    e.stopPropagation();
    copyToClipboard(entryToCurl(entry, true));
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      style={{ gridTemplateColumns: GRID_COLS, minWidth: GRID_MIN_WIDTH }}
      className={`grid items-center gap-1.5 px-2 h-[var(--spacing-row-xs)] text-xs font-mono cursor-pointer group odd:bg-white/[0.014] hover:bg-[var(--color-hover)] ${isSelected ? "bg-[var(--color-accent-dim)] shadow-[inset_2px_0_0_var(--color-accent)]" : ""}`}
    >
      <span
        className={`font-semibold ${METHOD_COLORS[entry.method] ?? "text-[var(--color-text-disabled)]"}`}
      >
        {entry.method}
      </span>
      <span className={`text-right tabular-nums ${statusColor(entry.statusCode)}`}>
        {entry.statusCode !== undefined ? entry.statusCode : "---"}
      </span>
      <span
        className={`text-micro px-1 rounded-[var(--radius-sm)] justify-self-start truncate ${TYPE_COLORS[entry.resourceType] ?? "bg-gray-500/20 text-gray-400"}`}
      >
        {resourceTypeLabel(entry.resourceType)}
      </span>
      <span
        className="truncate text-[var(--color-text-secondary)] group-hover:text-[var(--color-text-primary)]"
        title={entry.url}
      >
        {entry.url}
      </span>
      <span className="truncate text-[var(--color-text-muted)]" title={entry.referrer || undefined}>
        {hostOf(entry.referrer, entry.referrer || "—")}
      </span>
      <span className="text-right tabular-nums whitespace-nowrap text-[var(--color-text-muted)]">
        {formatBytes(entry.contentLength)}
      </span>
      <span
        className={`text-right tabular-nums whitespace-nowrap ${entry.durationMs > 1000 ? "text-[var(--color-warn)]" : "text-[var(--color-text-muted)]"}`}
      >
        {formatDuration(entry.durationMs)}
      </span>
      <button
        onClick={handleCopyCurl}
        className="opacity-0 group-hover:opacity-100 text-micro text-[var(--color-text-disabled)] hover:text-[var(--color-text-primary)] justify-self-end transition-opacity"
        title="Copy as cURL"
      >
        cURL
      </button>
    </div>
  );
}

export function NetworkPanel() {
  const { workspaces, activeWorkspaceId } = useWorkspacesStore();
  const tabs = useTabsStore((s) => s.tabs);
  const ws = workspaces[activeWorkspaceId];
  const activeTab = getLiveWorkspaceActiveTab(ws, tabs);
  const activeTabId = activeTab?.id;

  const entriesByTab = useNetworkStore((s) => s.entriesByTab);
  const clearTab = useNetworkStore((s) => s.clearTab);
  const entries = activeTabId ? (entriesByTab[activeTabId] ?? []) : [];

  const paused = useNetworkStore((s) => s.paused);
  const setPaused = useNetworkStore((s) => s.setPaused);
  const preserveLog = useNetworkStore((s) => s.preserveLog);
  const setPreserveLog = useNetworkStore((s) => s.setPreserveLog);

  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [methodFilter, setMethodFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevLength = useRef(0);

  // The Rust-side handlers stay registered per tab always, but do the actual
  // capture work (COM reads, body fetch, IPC emit) only while this panel is
  // mounted — closed panel costs nothing. This panel remounts on tab switch
  // (key={activeTabId} in Sidebar.tsx), so this toggles off->on across a
  // switch too; harmless and idempotent.
  useEffect(() => {
    setNetworkCapture(true).catch(() => {});
    return () => {
      setNetworkCapture(false).catch(() => {});
    };
  }, []);

  // All filters compose: the chip narrows first, then each dropdown/search.
  const filtered = useMemo(() => {
    let out = entries;
    if (filter === "errors") out = out.filter(entryIsError);
    else if (filter === "api") out = out.filter(entryIsApi);
    else if (filter === "slow") out = out.filter(entryIsSlow);

    if (methodFilter) out = out.filter((e) => e.method === methodFilter);
    if (typeFilter) out = out.filter((e) => e.resourceType === typeFilter);
    if (statusFilter) {
      const range = STATUS_RANGES.find((r) => r.id === statusFilter);
      if (range) out = out.filter((e) => range.test(e.statusCode));
    }
    const q = search.trim().toLowerCase();
    if (q) out = out.filter((e) => e.url.toLowerCase().includes(q));

    return out;
  }, [entries, filter, methodFilter, typeFilter, statusFilter, search]);

  const totalSize = useMemo(() => {
    let sum = 0;
    for (const e of entries) {
      if (e.contentLength > 0) sum += e.contentLength;
    }
    return sum;
  }, [entries]);

  const errorCount = useMemo(() => entries.filter(entryIsError).length, [entries]);
  const slowCount = useMemo(() => entries.filter(entryIsSlow).length, [entries]);
  const apiCount = useMemo(() => entries.filter(entryIsApi).length, [entries]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (entries.length <= prevLength.current) return;
    prevLength.current = entries.length;
    const threshold = 80;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - threshold) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
  }, [entries.length]);

  const selected = filtered.find((e) => e.id === selectedId) ?? null;

  return (
    <div className="flex flex-col h-full">
      {/* Summary Bar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-[var(--color-border)]">
        <span className="text-micro font-medium text-[var(--color-text-muted)]">
          {filtered.length}/{entries.length} request{entries.length !== 1 ? "s" : ""}
          {totalSize > 0 && <span className="ml-2 font-normal">({formatBytes(totalSize)})</span>}
        </span>
        <div className="flex items-center gap-2 text-micro">
          {errorCount > 0 && <span className="text-[var(--color-dead)]">{errorCount} err</span>}
          {slowCount > 0 && <span className="text-[var(--color-warn)]">{slowCount} slow</span>}
          {apiCount > 0 && <span className="text-[var(--color-accent)]">{apiCount} API</span>}
          <button
            onClick={() => setPaused(!paused)}
            title={paused ? "Resume capture" : "Pause capture"}
            className={`px-1.5 py-0.5 rounded hover:bg-[var(--color-hover)] ${
              paused
                ? "text-[var(--color-warn)]"
                : "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
            }`}
          >
            {paused ? "Paused" : "Pause"}
          </button>
          {entries.length > 0 && activeTabId && (
            <button
              onClick={() => {
                clearTab(activeTabId);
                setSelectedId(null);
                prevLength.current = 0;
              }}
              className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] px-1.5 py-0.5 rounded hover:bg-[var(--color-hover)]"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Search + method/status/type filters */}
      <div className="flex items-center gap-1 px-2 py-1 border-b border-[var(--color-border)]">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter URL"
          aria-label="Filter by URL"
          className="flex-1 min-w-0 text-micro bg-[var(--color-elevated)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-disabled)] rounded outline-none border border-[var(--color-border)] focus:border-[var(--color-accent)] px-1.5 py-0.5"
        />
        <select
          value={methodFilter}
          onChange={(e) => setMethodFilter(e.target.value)}
          aria-label="Filter by method"
          className={SELECT_CLASS}
        >
          <option value="">Method</option>
          {METHODS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          aria-label="Filter by status range"
          className={SELECT_CLASS}
        >
          <option value="">Status</option>
          {STATUS_RANGES.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          aria-label="Filter by resource type"
          className={SELECT_CLASS}
        >
          <option value="">Type</option>
          {RESOURCE_TYPES.map((t) => (
            <option key={t} value={t}>
              {resourceTypeLabel(t)}
            </option>
          ))}
        </select>
        <label
          className="flex items-center gap-1 text-micro text-[var(--color-text-muted)] whitespace-nowrap cursor-pointer"
          title="Keep the log across page loads"
        >
          <input
            type="checkbox"
            checked={preserveLog}
            onChange={(e) => setPreserveLog(e.target.checked)}
            className="accent-[var(--color-accent)]"
          />
          Preserve
        </label>
      </div>

      {/* Filter Chips */}
      <div className="flex gap-1 px-2 py-1 border-b border-[var(--color-border)]">
        {FILTERS.map((f) => {
          let count = entries.length;
          if (f.id === "errors") count = errorCount;
          else if (f.id === "api") count = apiCount;
          else if (f.id === "slow") count = slowCount;
          return (
            <button
              key={f.id}
              onClick={() => {
                setFilter(f.id);
                setSelectedId(null);
              }}
              className={`text-xs px-2.5 py-0.5 rounded-full transition-colors ${
                filter === f.id
                  ? "bg-[var(--color-accent-dim)] text-[var(--color-accent)]"
                  : "text-[var(--color-text-disabled)] hover:text-[var(--color-text-muted)] hover:bg-[var(--color-hover)]"
              }`}
            >
              {f.label}
              {count > 0 ? ` (${count})` : ""}
            </button>
          );
        })}
      </div>

      {/* Header + rows share one horizontal scroll region so columns stay aligned
          even when the panel is narrower than GRID_MIN_WIDTH. */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden flex flex-col min-h-0">
        <div
          style={{ gridTemplateColumns: GRID_COLS, minWidth: GRID_MIN_WIDTH }}
          className="grid items-center gap-1.5 px-2 h-6 text-micro font-medium text-[var(--color-text-disabled)] uppercase tracking-[0.09em] border-b border-[var(--color-border)] shrink-0"
        >
          <span>Method</span>
          <span className="text-right">Status</span>
          <span>Type</span>
          <span>URL</span>
          <span>Referrer</span>
          <span className="text-right">Size</span>
          <span className="text-right">Time</span>
          <span />
        </div>

        <div
          ref={scrollRef}
          style={{ minWidth: GRID_MIN_WIDTH }}
          className="flex-1 overflow-y-auto"
        >
          {filtered.length === 0 ? (
            <div className="text-micro text-[var(--color-text-muted)] px-3 py-4 italic">
              {entries.length === 0
                ? "No network requests captured yet. Navigate to a page to see requests."
                : "No requests match the current filter."}
            </div>
          ) : (
            filtered.map((entry) => (
              <EntryRow
                key={entry.id}
                entry={entry}
                isSelected={selectedId === entry.id}
                onClick={() => setSelectedId(selectedId === entry.id ? null : entry.id)}
              />
            ))
          )}
        </div>
      </div>

      {/* Detail Pane */}
      {selected && <DetailTabs entry={selected} onClose={() => setSelectedId(null)} />}
    </div>
  );
}
