import { useState, useCallback } from "react";
import { Wifi, ChevronDown, ChevronRight } from "lucide-react";
import { useWorkspacesStore } from "@/stores/workspaces";
import { useTabsStore } from "@/stores/tabs";
import { useNetworkStore, getFilteredEntries } from "@/stores/network";
import { getLiveWorkspaceActiveTab } from "@/lib/workspaceTabs";
import type { NetworkLogEntry } from "@/types";

const METHOD_COLORS: Record<string, string> = {
  GET: "#3b82f6",
  POST: "#22c55e",
  PUT: "#f59e0b",
  PATCH: "#f97316",
  DELETE: "#ef4444",
  HEAD: "#8b5cf6",
  OPTIONS: "#6b7280",
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function truncateUrl(url: string, maxLen = 40): string {
  try {
    const u = new URL(url);
    const path = u.pathname + u.search;
    if (path.length <= maxLen) return path;
    return (
      path.slice(0, Math.floor(maxLen / 2)) +
      "…" +
      path.slice(-Math.floor(maxLen / 2))
    );
  } catch {
    if (url.length <= maxLen) return url;
    return (
      url.slice(0, Math.floor(maxLen / 2)) +
      "…" +
      url.slice(-Math.floor(maxLen / 2))
    );
  }
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      className="text-[10px] px-1.5 py-0.5 rounded border text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-hover)] border-[var(--color-border-subtle)] cursor-pointer transition-colors"
    >
      {copied ? "Copied!" : "Copy cURL"}
    </button>
  );
}

function generateCurl(entry: NetworkLogEntry): string {
  const parts = [`curl -X ${entry.method} "${entry.url}"`];
  for (const [k, v] of Object.entries(entry.requestHeaders)) {
    parts.push(`  -H "${k}: ${v}"`);
  }
  if (entry.requestBody) {
    parts.push(`  -d ${JSON.stringify(entry.requestBody)}`);
  }
  return parts.join(" \\\n");
}

function HeaderTable({
  headers,
  highlight,
}: {
  headers: Record<string, string>;
  highlight?: string[];
}) {
  const keys = Object.keys(headers);
  if (keys.length === 0)
    return (
      <p className="text-[10px] text-[var(--color-text-disabled)] italic px-2 py-1">
        —
      </p>
    );
  return (
    <div className="px-2 py-1">
      {keys.map((k) => (
        <div key={k} className="flex gap-2 text-[10px] leading-[18px]">
          <span
            className={`font-mono shrink-0 ${
              highlight?.includes(k.toLowerCase())
                ? "text-[var(--color-text-primary)]"
                : "text-[var(--color-text-muted)]"
            }`}
          >
            {k}:
          </span>
          <span className="font-mono text-[var(--color-text-primary)] break-all min-w-0">
            {headers[k]}
          </span>
        </div>
      ))}
    </div>
  );
}

function EntryRow({
  entry,
  isExpanded,
  onToggle,
}: {
  entry: NetworkLogEntry;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const methodColor =
    METHOD_COLORS[entry.method] ?? METHOD_COLORS.OPTIONS;
  const statusColor =
    entry.status === 0
      ? "var(--color-text-disabled)"
      : entry.status < 300
      ? "var(--color-success, #22c55e)"
      : entry.status < 400
      ? "#3b82f6"
      : entry.status < 500
      ? "#f59e0b"
      : "var(--color-danger, #ef4444)";

  return (
    <div>
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-1.5 h-7 px-2 text-left hover:bg-[var(--color-hover)] transition-colors cursor-pointer"
        style={{
          background: isExpanded ? "var(--color-elevated)" : undefined,
        }}
      >
        <span
          className="w-[36px] shrink-0 text-[10px] font-bold font-mono text-center"
          style={{ color: methodColor }}
        >
          {entry.method}
        </span>
        <span
          className="flex-1 min-w-0 text-[11px] font-mono text-[var(--color-text-muted)] truncate"
          title={entry.url}
        >
          {truncateUrl(entry.url)}
        </span>
        <span
          className="w-[32px] shrink-0 text-[10px] font-mono text-right tabular-nums"
          style={{ color: statusColor }}
        >
          {entry.status === 0 ? "ERR" : entry.status}
        </span>
        <span className="w-[48px] shrink-0 text-[10px] text-[var(--color-text-disabled)] text-right tabular-nums">
          {formatDuration(entry.duration)}
        </span>
        <span className="w-[42px] shrink-0 text-[10px] text-[var(--color-text-disabled)] text-right tabular-nums">
          {formatSize(entry.responseSize)}
        </span>
        <span className="w-[28px] shrink-0 text-[9px] text-[var(--color-text-disabled)] text-center uppercase">
          {entry.entryType === "fetch" ? "fet" : "xhr"}
        </span>
        {isExpanded ? (
          <ChevronDown size={10} className="shrink-0 text-[var(--color-text-disabled)]" />
        ) : (
          <ChevronRight size={10} className="shrink-0 text-[var(--color-text-disabled)]" />
        )}
      </button>

      {isExpanded && (
        <div className="border-t border-[var(--color-border-subtle)] text-left">
          <div className="py-1">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-text-disabled)] px-2 py-0.5">
              Request Headers
            </p>
            <HeaderTable headers={entry.requestHeaders} />
          </div>
          <div className="py-1 border-t border-[var(--color-border-subtle)]">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-text-disabled)] px-2 py-0.5">
              Response Headers
            </p>
            <HeaderTable
              headers={entry.responseHeaders}
              highlight={["content-type", "cache-control"]}
            />
          </div>
          <div className="py-1 border-t border-[var(--color-border-subtle)]">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-text-disabled)] px-2 py-0.5">
              Response Body
            </p>
            <div className="px-2 py-1 max-h-[200px] overflow-y-auto">
              <pre className="text-[10px] font-mono text-[var(--color-text-muted)] whitespace-pre-wrap break-all m-0">
                {entry.responseBody === "[binary content not shown]" ||
                entry.responseBody === "[body unreadable]" ? (
                  <span className="italic text-[var(--color-text-disabled)]">
                    {entry.responseBody}
                  </span>
                ) : entry.responseHeaders["content-type"]?.includes("json") ? (
                  (() => {
                    try {
                      const parsed = JSON.parse(entry.responseBody);
                      return JSON.stringify(parsed, null, 2);
                    } catch {
                      return entry.responseBody.slice(0, 5000);
                    }
                  })()
                ) : (
                  entry.responseBody.slice(0, 5000)
                )}
              </pre>
            </div>
          </div>
          <div className="px-2 py-1.5 border-t border-[var(--color-border-subtle)]">
            <CopyButton text={generateCurl(entry)} />
          </div>
        </div>
      )}
    </div>
  );
}

export function NetworkPanel() {
  const { workspaces, activeWorkspaceId } = useWorkspacesStore();
  const tabs = useTabsStore((s) => s.tabs);
  const ws = workspaces[activeWorkspaceId];
  const activeTab = getLiveWorkspaceActiveTab(ws, tabs);
  const activeTabId = activeTab?.id ?? null;

  const isCapturing = useNetworkStore((s) => s.isCapturing);
  const methodFilter = useNetworkStore((s) => s.methodFilter);
  const urlFilter = useNetworkStore((s) => s.urlFilter);
  const setIsCapturing = useNetworkStore((s) => s.setIsCapturing);
  const setMethodFilter = useNetworkStore((s) => s.setMethodFilter);
  const setUrlFilter = useNetworkStore((s) => s.setUrlFilter);
  const clearTab = useNetworkStore((s) => s.clearTab);

  const [expandedId, setExpandedId] = useState<string | null>(null);

  const entries = activeTabId
    ? getFilteredEntries(useNetworkStore.getState(), activeTabId)
    : [];

  if (!activeTabId || !activeTab?.url) {
    return (
      <div className="flex items-center justify-center h-full px-4">
        <div className="text-center">
          <Wifi
            size={28}
            className="mx-auto mb-2 text-[var(--color-text-disabled)]"
          />
          <p className="text-[12px] text-[var(--color-text-muted)]">
            Open a URL to start monitoring
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="h-8 flex items-center justify-between px-2 border-b border-[var(--color-border-subtle)] flex-shrink-0">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-text-muted)]">
          Network
        </span>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setIsCapturing(!isCapturing)}
            title={isCapturing ? "Pause capturing" : "Resume capturing"}
            className="w-2 h-2 rounded-full cursor-pointer transition-colors"
            style={{
              backgroundColor: isCapturing
                ? "var(--color-success, #22c55e)"
                : "var(--color-text-disabled)",
              animation: isCapturing ? "live-pulse 2s infinite" : "none",
            }}
          />
          <button
            onClick={() => {
              if (activeTabId) clearTab(activeTabId);
              setExpandedId(null);
            }}
            className="text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-danger, #ef4444)] cursor-pointer transition-colors"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-1.5 px-2 py-1 border-b border-[var(--color-border-subtle)] flex-shrink-0">
        <select
          value={methodFilter ?? "ALL"}
          onChange={(e) =>
            setMethodFilter(e.target.value === "ALL" ? null : e.target.value)
          }
          className="h-6 px-1 text-[10px] rounded border bg-[var(--color-surface)] border-[var(--color-border-subtle)] text-[var(--color-text-primary)] flex-shrink-0 w-20 cursor-pointer"
        >
          <option value="ALL">ALL</option>
          <option value="GET">GET</option>
          <option value="POST">POST</option>
          <option value="PUT">PUT</option>
          <option value="PATCH">PATCH</option>
          <option value="DELETE">DELETE</option>
          <option value="FETCH">FETCH</option>
          <option value="XHR">XHR</option>
        </select>
        <div className="flex-1 relative">
          <input
            type="text"
            placeholder="Filter URL..."
            value={urlFilter}
            onChange={(e) => setUrlFilter(e.target.value)}
            className="h-6 w-full px-2 text-[10px] rounded border bg-[var(--color-surface)] border-[var(--color-border-subtle)] text-[var(--color-text-primary)]"
          />
          {urlFilter && (
            <button
              onClick={() => setUrlFilter("")}
              className="absolute right-1 top-1/2 -translate-y-1/2 text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] cursor-pointer"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* Entry List */}
      <div className="flex-1 overflow-y-auto">
        {entries.length === 0 ? (
          <div className="flex items-center justify-center h-full px-4">
            <div className="text-center">
              <Wifi
                size={28}
                className="mx-auto mb-2 text-[var(--color-text-disabled)]"
              />
              <p className="text-[12px] text-[var(--color-text-muted)] mt-2">
                No requests captured
              </p>
              <p className="text-[10px] text-[var(--color-text-disabled)] text-center max-w-[160px] mt-1">
                Navigate to a page to start capturing fetch and XHR requests.
              </p>
            </div>
          </div>
        ) : (
          entries.map((entry) => (
            <EntryRow
              key={entry.id}
              entry={entry}
              isExpanded={expandedId === entry.id}
              onToggle={() =>
                setExpandedId(expandedId === entry.id ? null : entry.id)
              }
            />
          ))
        )}
      </div>
    </div>
  );
}
