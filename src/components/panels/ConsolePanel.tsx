/**
 * ConsolePanel — the active tab's JS errors, console.error/warn and failed
 * requests (captured by console.rs over CDP). Cleared on every page load.
 * For stepping through code, "DevTools" opens the full Chromium DevTools.
 */
import { useMemo, useState } from "react";
import { Bug } from "lucide-react";
import { useActiveTabId } from "@/hooks/useActiveScope";
import { type ConsoleEntry, isFailedRequest, useConsoleStore } from "@/stores/console";
import { openDevtools } from "@/services/browser";

type Filter = "all" | "errors" | "warnings" | "network";

const FILTERS: { id: Filter; label: string; test: (e: ConsoleEntry) => boolean }[] = [
  { id: "all", label: "All", test: () => true },
  { id: "errors", label: "Errors", test: (e) => e.level === "error" && !isFailedRequest(e) },
  { id: "warnings", label: "Warnings", test: (e) => e.level === "warning" },
  { id: "network", label: "Failed requests", test: isFailedRequest },
];

const EMPTY: ConsoleEntry[] = [];

/** "http://localhost:3000/src/app.tsx" → "app.tsx", for the location column. */
function fileOf(url: string): string {
  const path = url.split(/[?#]/)[0];
  return path.slice(path.lastIndexOf("/") + 1) || url;
}

export function ConsolePanel() {
  const tabId = useActiveTabId();
  const entries = useConsoleStore((s) => (tabId ? s.entriesByTab[tabId] : undefined)) ?? EMPTY;
  const clearTab = useConsoleStore((s) => s.clearTab);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");

  const shown = useMemo(() => {
    const test = FILTERS.find((f) => f.id === filter)?.test ?? (() => true);
    const q = search.trim().toLowerCase();
    return entries.filter(
      (e) => test(e) && (!q || e.text.toLowerCase().includes(q) || e.url.toLowerCase().includes(q)),
    );
  }, [entries, filter, search]);

  const chip = (active: boolean) =>
    `px-1.5 py-0.5 rounded ${
      active
        ? "bg-[var(--color-accent-dim)] text-[var(--color-text-primary)]"
        : "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-hover)]"
    }`;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-[var(--color-border)]">
        <span className="text-micro font-medium text-[var(--color-text-muted)]">
          {shown.length}/{entries.length} message{entries.length !== 1 ? "s" : ""}
        </span>
        <div className="flex items-center gap-1 text-micro">
          {tabId && (
            <button
              type="button"
              onClick={() => openDevtools(tabId).catch(() => {})}
              title="Open DevTools (F12)"
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-hover)]"
            >
              <Bug size={11} /> DevTools
            </button>
          )}
          {entries.length > 0 && tabId && (
            <button
              type="button"
              onClick={() => clearTab(tabId)}
              className="px-1.5 py-0.5 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-hover)]"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1 px-2 py-1 border-b border-[var(--color-border)] text-micro">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={chip(filter === f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>
      <div className="px-2 py-1 border-b border-[var(--color-border)]">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter messages"
          className="w-full px-2 py-0.5 text-xs border rounded text-[var(--color-text-primary)] placeholder:text-[var(--color-text-disabled)] outline-none focus:border-[var(--color-accent)]"
          style={{ background: "var(--color-elevated)", borderColor: "var(--color-border)" }}
        />
      </div>

      <div className="flex-1 overflow-y-auto">
        {shown.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-[var(--color-text-disabled)]">
            {entries.length === 0
              ? "No errors, warnings or failed requests on this page."
              : "Nothing matches this filter."}
          </div>
        ) : (
          shown.map((e) => (
            <div
              key={e.id}
              className="px-3 py-1.5 border-b border-[var(--color-border-subtle)] text-xs"
              style={{
                color:
                  e.level === "error" ? "var(--color-console-error)" : "var(--color-console-warn)",
              }}
            >
              <div className="flex items-start gap-1.5">
                <span className="flex-1 min-w-0 whitespace-pre-wrap break-words font-mono select-text">
                  {e.text}
                </span>
                {e.count > 1 && (
                  <span className="shrink-0 px-1 rounded-[2px] text-micro tabular-nums bg-[var(--color-hover)] text-[var(--color-text-muted)]">
                    {e.count}
                  </span>
                )}
              </div>
              {e.url && (
                <div
                  className="mt-0.5 text-micro truncate text-[var(--color-text-disabled)]"
                  title={e.url}
                >
                  {fileOf(e.url)}
                  {e.line != null && `:${e.line}`}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
