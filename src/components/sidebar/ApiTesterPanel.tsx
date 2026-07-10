/**
 * ApiTesterPanel — sidebar launcher card for the API Tester.
 *
 * The full API Tester UI is too cramped inside the 210px sidebar.
 * This panel shows a button to open the full-page modal plus a small
 * "Recent Requests" card (shared with the full tester via the
 * useApiHistoryStore).
 */
import { ArrowRight, Code2, Clock, Trash2 } from "lucide-react";
import { useUIStore } from "@/stores/ui";
import { useApiHistoryStore } from "@/stores/apiHistory";

const METHOD_COLORS: Record<string, string> = {
  GET: "#22c55e",
  POST: "#f59e0b",
  PUT: "#3b82f6",
  DELETE: "#ef4444",
  PATCH: "#a855f7",
  HEAD: "#71717a",
  OPTIONS: "#06b6d4",
};

export function ApiTesterPanel() {
  const openOverlay = useUIStore((s) => s.openOverlay);
  const history = useApiHistoryStore((s) => s.history);
  const clearHistory = useApiHistoryStore((s) => s.clearHistory);

  return (
    <div className="p-2 flex flex-col gap-2">
      {/* Header */}
      <div className="flex items-center justify-between px-1">
        <p className="text-[12px] font-semibold tracking-widest text-[var(--color-text-disabled)] uppercase">
          API Tester
        </p>
      </div>

      {/* Open button card */}
      <button
        onClick={() => openOverlay("api-tester")}
        className="flex items-center gap-2 p-3 rounded-md text-left border border-[var(--color-border)] bg-[var(--color-elevated)] hover:border-[var(--color-accent)] hover:bg-[var(--color-hover)] transition-colors"
      >
        <Code2 size={18} className="text-[var(--color-accent)] flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-[13px] text-[var(--color-text-primary)] font-medium">
            Open API Tester
          </div>
          <div className="text-[12px] text-[var(--color-text-disabled)]">
            Full editor in a centered window
          </div>
        </div>
        <ArrowRight size={14} className="text-[var(--color-text-disabled)] flex-shrink-0" />
      </button>

      {/* Method reference cheat sheet */}
      <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-elevated)] p-2">
        <div className="text-[11px] font-semibold tracking-widest text-[var(--color-text-disabled)] uppercase mb-1.5">
          Methods
        </div>
        <div className="grid grid-cols-2 gap-1">
          {Object.entries(METHOD_COLORS).map(([m, c]) => (
            <div
              key={m}
              className="flex items-center gap-1.5 text-[12px] font-mono"
            >
              <span
                className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                style={{ background: c }}
              />
              <span style={{ color: c }}>{m}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Recent requests */}
      <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-elevated)] overflow-hidden">
        <div className="flex items-center justify-between px-2 py-1.5 border-b border-[var(--color-border)]">
          <div className="flex items-center gap-1.5">
            <Clock size={12} className="text-[var(--color-text-disabled)]" />
            <span className="text-[11px] font-semibold tracking-widest text-[var(--color-text-disabled)] uppercase">
              Recent ({history.length})
            </span>
          </div>
          {history.length > 0 && (
            <button
              onClick={clearHistory}
              title="Clear history"
              aria-label="Clear request history"
              className="text-[var(--color-text-disabled)] hover:text-[var(--color-dead)]"
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>
        {history.length === 0 ? (
          <div className="px-2 py-3 text-center">
            <p className="text-[12px] text-[var(--color-text-disabled)]">
              No requests yet
            </p>
            <p className="text-[11px] text-[var(--color-text-disabled)] mt-0.5">
              Open the tester and send one
            </p>
          </div>
        ) : (
          <div className="max-h-32 overflow-y-auto">
            {history.slice(0, 5).map((h) => (
              <button
                key={h.id}
                onClick={() => openOverlay("api-tester")}
                className="w-full flex items-center gap-1.5 px-2 py-1 text-left hover:bg-[var(--color-hover)] transition-colors"
              >
                <span
                  className="text-[11px] font-bold flex-shrink-0"
                  style={{ color: METHOD_COLORS[h.method] ?? "#999" }}
                >
                  {h.method}
                </span>
                <span className="text-[12px] text-[var(--color-text-muted)] font-mono flex-1 min-w-0 truncate">
                  {h.url}
                </span>
                <span
                  className="text-[11px] font-mono flex-shrink-0"
                  style={{
                    color:
                      h.status >= 200 && h.status < 300
                        ? "var(--color-live)"
                        : h.status >= 400
                          ? "var(--color-dead)"
                          : "var(--color-warn)",
                    fontFeatureSettings: '"tnum" 1',
                  }}
                >
                  {h.status}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default ApiTesterPanel;
