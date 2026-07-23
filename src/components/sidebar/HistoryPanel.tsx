import { useMemo } from "react";
import { Clock, Trash2, ExternalLink, Globe } from "lucide-react";
import { useHistoryStore } from "@/stores/history";
import { useWorkspacesStore } from "@/stores/workspaces";
import { useTabsStore } from "@/stores/tabs";
import { VirtualList } from "@/components/ui/VirtualList";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
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
  const entries = useHistoryStore((s) => s.entries);
  const removeEntry = useHistoryStore((s) => s.removeEntry);
  const clearAll = useHistoryStore((s) => s.clearAll);
  const activeWorkspaceId = useWorkspacesStore((s) => s.activeWorkspaceId);
  const addTabToWorkspace = useWorkspacesStore((s) => s.addTabToWorkspace);
  const setActiveTab = useWorkspacesStore((s) => s.setActiveTab);
  const addTab = useTabsStore((s) => s.addTab);

  const flatItems = useMemo(() => {
    const grouped = groupByDate(entries);
    const items: Array<{ __isHeader?: boolean; label?: string; entry?: HistoryEntry }> = [];
    for (const [label, groupEntries] of Object.entries(grouped)) {
      items.push({ __isHeader: true, label });
      for (const entry of groupEntries) {
        items.push({ entry });
      }
    }
    return items;
  }, [entries]);

  function openEntry(url: string) {
    const id = addTab(activeWorkspaceId, { url });
    addTabToWorkspace(activeWorkspaceId, id);
    setActiveTab(activeWorkspaceId, id);
  }

  return (
    <div className="p-2 flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-1 mb-2 flex-shrink-0">
        <p className="text-xs font-bold tracking-[0.09em] text-[var(--color-text-muted)] uppercase">
          History
        </p>
        {entries.length > 0 && (
          <ConfirmButton
            onConfirm={clearAll}
            title="Clear all history"
            className="text-[var(--color-text-disabled)] hover:text-[var(--color-dead)] transition-colors"
          >
            <Trash2 size={12} />
          </ConfirmButton>
        )}
      </div>

      {entries.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center py-4">
            <Clock size={22} className="mx-auto mb-1.5 text-[var(--color-text-disabled)] opacity-40" />
            <p className="text-sm text-[var(--color-text-muted)]">
              No history yet
            </p>
            <p className="text-xs text-[var(--color-text-disabled)] mt-0.5">
              Pages you visit will appear here
            </p>
          </div>
        </div>
      ) : (
        <div className="flex-1 min-h-0">
          <VirtualList items={flatItems} itemHeight={32}>
            {({ style, item }) =>
              item.__isHeader ? (
                <div style={style} className="flex items-center px-1">
                  <span className="text-micro font-semibold tracking-widest text-[var(--color-text-disabled)] uppercase">
                    {item.label}
                  </span>
                </div>
              ) : item.entry ? (() => {
                const entry = item.entry;
                const domain = entry.url
                  .replace(/^https?:\/\/(www\.)?/, "")
                  .split("/")[0];
                return (
                  <div
                    style={style}
                    key={entry.id}
                    className="group flex items-center gap-2 px-2 py-1 rounded hover:bg-[var(--color-hover)] transition-colors"
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
                            className="w-4 h-4 rounded-sm flex-shrink-0"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = "none";
                            }}
                          />
                        ) : (
                          <Globe size={12} className="text-[var(--color-text-disabled)] flex-shrink-0" />
                        )}
                        <span className="text-sm text-[var(--color-text-muted)] truncate font-medium">
                          {entry.title || domain}
                        </span>
                      </div>
                    </button>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                      <span className="text-micro text-[var(--color-text-disabled)]">
                        {relativeTime(entry.timestamp)}
                      </span>
                      <button
                        onClick={() => openEntry(entry.url)}
                        title="Open in new tab"
                        aria-label="Open in new tab"
                        className="text-[var(--color-text-disabled)] hover:text-[var(--color-accent)]"
                      >
                        <ExternalLink size={11} />
                      </button>
                      <button
                        onClick={() => removeEntry(entry.id)}
                        title="Remove"
                        aria-label="Remove from history"
                        className="text-[var(--color-text-disabled)] hover:text-[var(--color-dead)]"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  </div>
                );
              })() : null
            }
          </VirtualList>
        </div>
      )}
    </div>
  );
}
