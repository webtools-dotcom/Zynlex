import { useState, useRef, useEffect, useMemo } from "react";
import { useNetworkStore, type NetworkLogEntry, formatSize, formatDuration, resourceTypeLabel, entryIsError, entryIsSlow, entryIsApi } from "@/stores/network";
import { useWorkspacesStore } from "@/stores/workspaces";
import { useTabsStore } from "@/stores/tabs";
import { getLiveWorkspaceActiveTab } from "@/lib/workspaceTabs";
import { entryToCurl, entryToCurlCompact, entryToFetch, copyToClipboard } from "@/lib/networkCopy";

const METHOD_COLORS: Record<string, string> = {
  GET: "text-green-400",
  POST: "text-blue-400",
  PUT: "text-orange-400",
  PATCH: "text-yellow-400",
  DELETE: "text-red-400",
  HEAD: "text-gray-400",
  OPTIONS: "text-purple-400",
};

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
  if (code >= 200 && code < 300) return "text-green-400";
  if (code >= 300 && code < 400) return "text-yellow-400";
  if (code >= 400 && code < 500) return "text-orange-400";
  if (code >= 500) return "text-red-400";
  return "text-gray-400";
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

function DetailTabs({ entry, onClose }: { entry: NetworkLogEntry; onClose: () => void }) {
  const [tab, setTab] = useState<"headers" | "body" | "copy">("headers");
  const [copied, setCopied] = useState<string | null>(null);

  const handleCopy = async (label: string, text: string) => {
    await copyToClipboard(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <div className="border-t border-[var(--color-border)] bg-[var(--color-surface)] text-[11px] font-mono">
      <div className="flex items-center justify-between px-3 py-1 border-b border-[var(--color-border)]">
        <div className="flex gap-1">
          {(["headers", "body", "copy"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-2 py-0.5 rounded text-[10px] uppercase tracking-wider ${tab === t ? "bg-[var(--color-hover)] text-[var(--color-foreground)]" : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"}`}
            >
              {t}
            </button>
          ))}
        </div>
        <button onClick={onClose} className="text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] text-[13px] leading-none px-1">&times;</button>
      </div>
      <div className="max-h-48 overflow-y-auto p-3">
        {tab === "headers" && (
          <div className="space-y-1">
            <div className="flex gap-3">
              <span className="text-[var(--color-muted-foreground)]">URL:</span>
              <span className="break-all">{entry.url}</span>
            </div>
            <div className="flex gap-3">
              <span className="text-[var(--color-muted-foreground)]">Status:</span>
              <span className={statusColor(entry.statusCode)}>{entry.statusCode} {entry.reasonPhrase}</span>
            </div>
            <div className="flex gap-3">
              <span className="text-[var(--color-muted-foreground)]">Type:</span>
              <span>{entry.resourceType}</span>
            </div>
            <div className="flex gap-3">
              <span className="text-[var(--color-muted-foreground)]">Size:</span>
              <span>{formatSize(entry.contentLength)}</span>
            </div>
            <div className="flex gap-3">
              <span className="text-[var(--color-muted-foreground)]">Time:</span>
              <span>{formatDuration(entry.durationMs)}</span>
            </div>
            <div className="pt-2 border-t border-[var(--color-border)]">
              <div className="text-[var(--color-muted-foreground)] mb-1">Response Headers:</div>
              {Object.keys(entry.headers).length === 0 ? (
                <div className="text-[var(--color-muted-foreground)] italic">(none)</div>
              ) : (
                <div className="space-y-0.5">
                  {Object.entries(entry.headers).map(([k, v]) => (
                    <div key={k} className="flex gap-2 text-[10px]">
                      <span className="text-[var(--color-muted-foreground)] shrink-0">{k}:</span>
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
              <pre className="whitespace-pre-wrap break-all text-[10px] text-[var(--color-muted-foreground)] bg-[var(--color-hover)] rounded p-1.5 max-h-40 overflow-y-auto">{bodyPreview(entry.body)}</pre>
            ) : (
              <div className="text-[var(--color-muted-foreground)] italic">(no response body)</div>
            )}
          </div>
        )}
        {tab === "copy" && (
          <div className="space-y-2">
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[var(--color-muted-foreground)]">cURL</span>
                <button
                  onClick={() => handleCopy("curl", entryToCurl(entry))}
                  className="text-[10px] px-2 py-0.5 rounded bg-[var(--color-hover)] hover:bg-[var(--color-border)]"
                >
                  {copied === "curl" ? "Copied!" : "Copy"}
                </button>
              </div>
              <pre className="whitespace-pre-wrap break-all text-[10px] text-[var(--color-muted-foreground)] bg-[var(--color-hover)] rounded p-1.5 max-h-32 overflow-y-auto">{entryToCurl(entry)}</pre>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[var(--color-muted-foreground)]">fetch()</span>
                <button
                  onClick={() => handleCopy("fetch", entryToFetch(entry))}
                  className="text-[10px] px-2 py-0.5 rounded bg-[var(--color-hover)] hover:bg-[var(--color-border)]"
                >
                  {copied === "fetch" ? "Copied!" : "Copy"}
                </button>
              </div>
              <pre className="whitespace-pre-wrap break-all text-[10px] text-[var(--color-muted-foreground)] bg-[var(--color-hover)] rounded p-1.5 max-h-32 overflow-y-auto">{entryToFetch(entry)}</pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function EntryRow({ entry, isSelected, onClick }: { entry: NetworkLogEntry; isSelected: boolean; onClick: () => void }) {
  const handleCopyCurl = (e: React.MouseEvent) => {
    e.stopPropagation();
    copyToClipboard(entryToCurlCompact(entry));
  };

  return (
    <div
      onClick={onClick}
      className={`flex items-center gap-1.5 px-2 py-1 text-[11px] font-mono hover:bg-[var(--color-hover)] cursor-pointer border-b border-[var(--color-border)] group ${isSelected ? "bg-[var(--color-hover)]" : ""}`}
    >
      <span className={`font-semibold w-12 shrink-0 ${METHOD_COLORS[entry.method] ?? "text-gray-400"}`}>
        {entry.method}
      </span>
      <span className={`w-8 shrink-0 text-right ${statusColor(entry.statusCode)}`}>
        {entry.statusCode !== undefined ? entry.statusCode : "---"}
      </span>
      <span className={`text-[9px] px-1 rounded shrink-0 ${TYPE_COLORS[entry.resourceType] ?? "bg-gray-500/20 text-gray-400"}`}>
        {resourceTypeLabel(entry.resourceType)}
      </span>
      <span className="truncate text-[var(--color-muted-foreground)] flex-1 min-w-0" title={entry.url}>
        {entry.url}
      </span>
      <span className="text-[10px] text-[var(--color-muted-foreground)] w-14 text-right shrink-0">
        {formatSize(entry.contentLength)}
      </span>
      <span className={`text-[10px] w-10 text-right shrink-0 ${entry.durationMs > 1000 ? "text-yellow-400" : "text-[var(--color-muted-foreground)]"}`}>
        {formatDuration(entry.durationMs)}
      </span>
      <button
        onClick={handleCopyCurl}
        className="opacity-0 group-hover:opacity-100 text-[9px] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] px-1 shrink-0 transition-opacity"
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

  const [filter, setFilter] = useState<Filter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevLength = useRef(0);

  const filtered = useMemo(() => {
    switch (filter) {
      case "errors": return entries.filter(entryIsError);
      case "api": return entries.filter(entryIsApi);
      case "slow": return entries.filter((e) => entryIsSlow(e));
      default: return entries;
    }
  }, [entries, filter]);

  const totalSize = useMemo(() => {
    let sum = 0;
    for (const e of entries) {
      if (e.contentLength > 0) sum += e.contentLength;
    }
    return sum;
  }, [entries]);

  const errorCount = useMemo(() => entries.filter(entryIsError).length, [entries]);
  const slowCount = useMemo(() => entries.filter((e) => entryIsSlow(e)).length, [entries]);
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
        <span className="text-[11px] font-medium text-[var(--color-muted-foreground)]">
          {filtered.length}/{entries.length} request{entries.length !== 1 ? "s" : ""}
          {totalSize > 0 && <span className="ml-2 font-normal">({formatSize(totalSize)})</span>}
        </span>
        <div className="flex items-center gap-2 text-[10px]">
          {errorCount > 0 && <span className="text-red-400">{errorCount} err</span>}
          {slowCount > 0 && <span className="text-yellow-400">{slowCount} slow</span>}
          {apiCount > 0 && <span className="text-cyan-400">{apiCount} API</span>}
          {entries.length > 0 && activeTabId && (
            <button
              onClick={() => { clearTab(activeTabId); setSelectedId(null); prevLength.current = 0; }}
              className="text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] px-1.5 py-0.5 rounded hover:bg-[var(--color-hover)]"
            >
              Clear
            </button>
          )}
        </div>
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
              onClick={() => { setFilter(f.id); setSelectedId(null); }}
              className={`text-[10px] px-2 py-0.5 rounded-full transition-colors ${
                filter === f.id
                  ? "bg-[var(--color-hover)] text-[var(--color-foreground)]"
                  : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
              }`}
            >
              {f.label}{count > 0 ? ` (${count})` : ""}
            </button>
          );
        })}
      </div>

      {/* Column Headers */}
      <div className="flex items-center gap-1.5 px-2 py-0.5 text-[9px] text-[var(--color-muted-foreground)] uppercase tracking-wider border-b border-[var(--color-border)]">
        <span className="w-12">Method</span>
        <span className="w-8 text-right">Status</span>
        <span className="w-8">Type</span>
        <span className="flex-1">URL</span>
        <span className="w-14 text-right">Size</span>
        <span className="w-10 text-right">Time</span>
        <span className="w-8" />
      </div>

      {/* Request List */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="text-[11px] text-[var(--color-muted-foreground)] px-3 py-4 italic">
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

      {/* Detail Pane */}
      {selected && <DetailTabs entry={selected} onClose={() => setSelectedId(null)} />}
    </div>
  );
}
