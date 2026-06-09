import { useMemo } from "react";
import { Clock, Trash2, ExternalLink, Globe } from "lucide-react";
import { useHistoryStore } from "@/stores/history";
import { useWorkspacesStore } from "@/stores/workspaces";
import { useTabsStore } from "@/stores/tabs";
import type { HistoryEntry } from "@/types";

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function groupByDate(entries: HistoryEntry[]) {
  const now = new Date();
  const today = now.toDateString();
  const yesterday = new Date(now.getTime() - 86_400_000).toDateString();

  const groups: Record<string, HistoryEntry[]> = {};
  for (const e of entries) {
    const d = new Date(e.timestamp).toDateString();
    let label: string;
    if (d === today) label = "Today";
    else if (d === yesterday) label = "Yesterday";
    else label = d;
    if (!groups[label]) groups[label] = [];
    groups[label].push(e);
  }
  return groups;
}

export function HistoryPanel() {
  const { entries, removeEntry, clearAll } = useHistoryStore();
  const { activeWorkspaceId, addTabToWorkspace, setActiveTab } = useWorkspacesStore();
  const { addTab } = useTabsStore();

  const grouped = useMemo(() => groupByDate(entries), [entries]);

  function openEntry(url: string) {
    const id = addTab(activeWorkspaceId, { url });
    addTabToWorkspace(activeWorkspaceId, id);
    setActiveTab(activeWorkspaceId, id);
  }

  return (
    <div className="p-2">
      {/* Header */}
      <div className="flex items-center justify-between px-1 mb-2">
        <p className="text-[10px] font-bold tracking-[0.09em] text-[var(--xevo-text-muted)] uppercase">
          History
        </p>
        {entries.length > 0 && (
          <button
            onClick={() => {
              if (window.confirm("Clear all history?")) clearAll();
            }}
            title="Clear all history"
            className="text-[var(--xevo-text-faint)] hover:text-[var(--xevo-danger)] transition-colors"
          >
            <Trash2 size={10} />
          </button>
        )}
      </div>

      {entries.length === 0 ? (
        <div className="text-center py-4">
          <Clock size={20} className="mx-auto mb-1.5 text-[var(--xevo-text-faint)] opacity-40" />
          <p className="text-[11px] text-[var(--xevo-text-muted)]">
            No history yet
          </p>
          <p className="text-[10px] text-[var(--xevo-text-faint)] mt-0.5">
            Pages you visit will appear here
          </p>
        </div>
      ) : (
        Object.entries(grouped).map(([label, items]) => (
          <div key={label} className="mb-2">
            <p className="text-[9px] font-semibold tracking-widest text-[var(--xevo-text-faint)] uppercase px-1 mb-1">
              {label}
            </p>
            {items.map((entry) => {
              const domain = entry.url
                .replace(/^https?:\/\/(www\.)?/, "")
                .split("/")[0];
              return (
                <div
                  key={entry.id}
                  className="group flex items-center gap-2 px-2 py-1.5 rounded hover:bg-[rgba(255,255,255,0.04)] transition-colors"
                >
                  <button
                    onClick={() => openEntry(entry.url)}
                    className="flex-1 min-w-0 text-left"
                    title={entry.url}
                  >
                    <div className="flex items-center gap-1.5">
                      {entry.favicon ? (
                        <img
                          src={entry.favicon}
                          alt=""
                          className="w-3 h-3 rounded-sm flex-shrink-0"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = "none";
                          }}
                        />
                      ) : (
                        <Globe size={10} className="text-[var(--xevo-text-faint)] flex-shrink-0" />
                      )}
                      <span className="text-[11px] text-[var(--xevo-text-muted)] truncate font-medium">
                        {entry.title || domain}
                      </span>
                    </div>
                    <span className="text-[9px] text-[var(--xevo-text-faint)] font-mono truncate block">
                      {domain}
                    </span>
                  </button>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                    <span className="text-[8px] text-[var(--xevo-text-faint)]">
                      {relativeTime(entry.timestamp)}
                    </span>
                    <button
                      onClick={() => openEntry(entry.url)}
                      title="Open in new tab"
                      className="text-[var(--xevo-text-faint)] hover:text-[var(--xevo-accent)]"
                    >
                      <ExternalLink size={9} />
                    </button>
                    <button
                      onClick={() => removeEntry(entry.id)}
                      title="Remove"
                      className="text-[var(--xevo-text-faint)] hover:text-[var(--xevo-danger)]"
                    >
                      <Trash2 size={9} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ))
      )}
    </div>
  );
}
