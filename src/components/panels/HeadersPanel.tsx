import { useState, useEffect, useRef, useCallback } from "react";
import { Shield, Trash2 } from "lucide-react";
import { useWorkspacesStore } from "@/stores/workspaces";
import { useHeadersStore } from "@/stores/headers";
import { updateHeaderRules } from "@/services/browser";

const QUICK_PICKS = [
  "Authorization",
  "Content-Type",
  "X-API-Key",
  "Accept",
  "X-Custom",
];

export function HeadersPanel() {
  const { activeWorkspaceId } = useWorkspacesStore();
  const rules = useHeadersStore((s) => s.rules);
  const addRule = useHeadersStore((s) => s.addRule);
  const removeRule = useHeadersStore((s) => s.removeRule);
  const toggleRule = useHeadersStore((s) => s.toggleRule);

  const wsRules = rules.filter((r) => r.workspaceId === activeWorkspaceId);

  const [showForm, setShowForm] = useState(false);
  const [urlPattern, setUrlPattern] = useState("");
  const [headerName, setHeaderName] = useState("");
  const [headerValue, setHeaderValue] = useState("");
  const listEndRef = useRef<HTMLDivElement>(null);

  // Debounce updateHeaderRules when rules change
  useEffect(() => {
    const timer = setTimeout(() => {
      updateHeaderRules(rules).catch(() => {});
    }, 300);
    return () => clearTimeout(timer);
  }, [rules]);

  const handleAdd = useCallback(() => {
    if (!urlPattern.trim() || !headerName.trim()) return;
    addRule(activeWorkspaceId, urlPattern, headerName, headerValue);
    setUrlPattern("");
    setHeaderName("");
    setHeaderValue("");
    setShowForm(false);
    setTimeout(() => {
      listEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, 50);
  }, [
    activeWorkspaceId,
    urlPattern,
    headerName,
    headerValue,
    addRule,
  ]);

  const handleRemove = useCallback(
    (id: string) => {
      removeRule(id);
    },
    [removeRule]
  );

  const handleToggle = useCallback(
    (id: string) => {
      toggleRule(id);
    },
    [toggleRule]
  );

  if (wsRules.length === 0 && !showForm) {
    return (
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="h-8 flex items-center justify-between px-2 border-b border-[var(--color-border-subtle)] flex-shrink-0">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-text-muted)]">
            Header Injection
          </span>
          <button
            onClick={() => setShowForm(true)}
            className="text-[10px] text-[var(--color-accent)] hover:text-[var(--color-text-primary)] cursor-pointer transition-colors"
          >
            + Add Rule
          </button>
        </div>

        {/* Empty state */}
        <div className="flex-1 flex items-center justify-center px-4">
          <div className="text-center">
            <Shield
              size={28}
              className="mx-auto mb-2 text-[var(--color-text-disabled)]"
            />
            <p className="text-[12px] text-[var(--color-text-muted)]">
              No injection rules yet
            </p>
            <p className="text-[10px] text-[var(--color-text-disabled)] mt-1 max-w-[180px] mx-auto">
              Add a rule to automatically inject headers into matching requests.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="h-8 flex items-center justify-between px-2 border-b border-[var(--color-border-subtle)] flex-shrink-0">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-text-muted)]">
          Header Injection
        </span>
        <button
          onClick={() => setShowForm(!showForm)}
          className="text-[10px] text-[var(--color-accent)] hover:text-[var(--color-text-primary)] cursor-pointer transition-colors"
        >
          {showForm ? "Cancel" : "+ Add Rule"}
        </button>
      </div>

      {/* Rules list */}
      <div className="flex-1 overflow-y-auto px-2 py-1">
        {wsRules.map((rule) => (
          <div
            key={rule.id}
            className={`mb-2 p-2 rounded border border-[var(--color-border-subtle)] hover:border-[var(--color-border)] transition-colors group ${
              rule.enabled ? "" : "opacity-50"
            }`}
          >
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleToggle(rule.id)}
                title="Click to enable/disable"
                className="w-2 h-2 rounded-full shrink-0 cursor-pointer transition-colors"
                style={{
                  backgroundColor: rule.enabled
                    ? "var(--color-success, #22c55e)"
                    : "var(--color-text-disabled)",
                }}
              />
              <span className="flex-1 min-w-0 text-[11px] font-mono text-[var(--color-text-primary)] truncate">
                {rule.urlPattern}
              </span>
              <button
                onClick={() => handleRemove(rule.id)}
                className="opacity-0 group-hover:opacity-100 p-0.5 text-[var(--color-text-muted)] hover:text-[var(--color-danger, #ef4444)] cursor-pointer transition-all"
              >
                <Trash2 size={12} />
              </button>
            </div>
            <div className="mt-1 ml-4">
              <p className="text-[10px] font-mono text-[var(--color-text-muted)]">
                <span className="text-[var(--color-text-primary)]">
                  {rule.headerName}
                </span>
                :{" "}
                <span
                  className="inline-block max-w-[180px] truncate align-bottom"
                  title={rule.headerValue}
                >
                  {rule.headerValue}
                </span>
              </p>
            </div>
            <div className="mt-1 ml-4">
              <button
                onClick={() => handleToggle(rule.id)}
                className={`text-[10px] cursor-pointer transition-colors ${
                  rule.enabled
                    ? "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
                    : "text-[var(--color-accent)] hover:text-[var(--color-text-primary)]"
                }`}
              >
                {rule.enabled ? "Disable" : "Enable"}
              </button>
            </div>
          </div>
        ))}
        <div ref={listEndRef} />
      </div>

      {/* Add Rule Form */}
      {showForm && (
        <div className="border-t border-[var(--color-border-subtle)] p-2 space-y-2">
          {/* URL Pattern */}
          <div>
            <label className="text-[10px] uppercase tracking-widest text-[var(--color-text-muted)] block mb-1">
              URL Pattern
            </label>
            <input
              type="text"
              placeholder="localhost:* or https://api.myapp.com/*"
              value={urlPattern}
              onChange={(e) => setUrlPattern(e.target.value)}
              className="w-full h-7 px-2 text-[11px] rounded border bg-[var(--color-surface)] border-[var(--color-border-subtle)] text-[var(--color-text-primary)]"
            />
            <p className="text-[10px] text-[var(--color-text-disabled)] italic mt-0.5">
              Use * as a wildcard. Matches are case-insensitive.
            </p>
          </div>

          {/* Header Name */}
          <div>
            <label className="text-[10px] uppercase tracking-widest text-[var(--color-text-muted)] block mb-1">
              Header Name
            </label>
            <input
              type="text"
              placeholder="Authorization"
              value={headerName}
              onChange={(e) => setHeaderName(e.target.value)}
              className="w-full h-7 px-2 text-[11px] rounded border bg-[var(--color-surface)] border-[var(--color-border-subtle)] text-[var(--color-text-primary)]"
            />
            <div className="flex flex-wrap gap-1 mt-1">
              {QUICK_PICKS.map((pick) => (
                <button
                  key={pick}
                  onClick={() => setHeaderName(pick)}
                  className="border rounded px-1.5 py-0.5 text-[10px] cursor-pointer hover:bg-[var(--color-hover)] text-[var(--color-text-muted)] border-[var(--color-border-subtle)] transition-colors"
                >
                  {pick}
                </button>
              ))}
            </div>
          </div>

          {/* Header Value */}
          <div>
            <label className="text-[10px] uppercase tracking-widest text-[var(--color-text-muted)] block mb-1">
              Header Value
            </label>
            <textarea
              rows={3}
              placeholder="Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
              value={headerValue}
              onChange={(e) => setHeaderValue(e.target.value)}
              className="w-full px-2 py-1 text-[11px] font-mono rounded border bg-[var(--color-surface)] border-[var(--color-border-subtle)] text-[var(--color-text-primary)] resize-none"
            />
            <p className="text-[10px] italic text-[var(--color-text-disabled)] mt-0.5">
              Tip: paste your JWT token here for Authorization rules.
            </p>
          </div>

          {/* Buttons */}
          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={() => {
                setShowForm(false);
                setUrlPattern("");
                setHeaderName("");
                setHeaderValue("");
              }}
              className="text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] cursor-pointer transition-colors px-2 py-1"
            >
              Cancel
            </button>
            <button
              onClick={handleAdd}
              disabled={!urlPattern.trim() || !headerName.trim()}
              className="text-[11px] px-3 py-1 rounded bg-[var(--color-accent)] text-white disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-opacity"
            >
              Add Rule
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
