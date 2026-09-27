import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Plus, ToggleLeft, ToggleRight, Trash2 } from "lucide-react";
import { useMocksStore, type MockRule } from "@/stores/mocks";
import { useWorkspacesStore } from "@/stores/workspaces";
import { useTabsStore } from "@/stores/tabs";
import { getLiveWorkspaceActiveTab } from "@/lib/workspaceTabs";
import { originOf } from "@/lib/url";
import { statusColor } from "@/lib/format";

const METHODS = ["", "GET", "POST", "PUT", "PATCH", "DELETE"];
const COMMON_STATUSES = [200, 201, 204, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503];

const INPUT =
  "bg-[var(--color-hover)] text-micro font-mono px-2 py-1 rounded border border-[var(--color-border)] outline-none focus:border-[var(--color-accent)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)]";

const LABEL = "flex flex-col gap-0.5 text-micro text-[var(--color-text-muted)]";

/** Mirrors Rust's `find_mock`: these patterns would replace the page itself, so they never match. */
function isCatchAll(pattern: string): boolean {
  const p = pattern.trim();
  return p === "" || p === "*";
}

function jsonError(rule: Pick<MockRule, "body" | "contentType">): string | null {
  const ct = rule.contentType.trim().toLowerCase();
  if (!rule.body.trim() || (ct && !ct.includes("json"))) return null;
  try {
    JSON.parse(rule.body);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : "Invalid JSON";
  }
}

/** Status, delay, content type and body — shared by the add form and the row editor. */
function ResponseFields({
  rule,
  onChange,
}: {
  rule: Pick<MockRule, "status" | "delayMs" | "contentType" | "body">;
  onChange: (patch: Partial<MockRule>) => void;
}) {
  const err = jsonError(rule);
  return (
    <>
      <div className="grid grid-cols-2 gap-1.5">
        <label className={LABEL}>
          Status
          <input
            type="number"
            list="zynlex-mock-statuses"
            min={100}
            max={599}
            value={rule.status}
            // Select on focus so typing replaces the code — `|| 200` would
            // otherwise snap an emptied field straight back to 200.
            onFocus={(e) => e.target.select()}
            onChange={(e) => onChange({ status: Number(e.target.value) || 200 })}
            className={INPUT}
          />
        </label>
        <label className={LABEL}>
          Delay ms
          <input
            type="number"
            min={0}
            max={60000}
            step={100}
            value={rule.delayMs}
            onFocus={(e) => e.target.select()}
            onChange={(e) => onChange({ delayMs: Math.max(0, Number(e.target.value) || 0) })}
            className={INPUT}
          />
        </label>
        <label className={`${LABEL} col-span-2`}>
          Content-Type
          <input
            value={rule.contentType}
            onChange={(e) => onChange({ contentType: e.target.value })}
            placeholder="application/json"
            className={INPUT}
          />
        </label>
      </div>
      <textarea
        value={rule.body}
        onChange={(e) => onChange({ body: e.target.value })}
        placeholder='{"ok": true}'
        spellCheck={false}
        rows={5}
        className={`${INPUT} resize-y`}
      />
      {err && <div className="text-micro text-amber-400">Not valid JSON: {err}</div>}
    </>
  );
}

function MockRow({
  rule,
  onChange,
  onDelete,
}: {
  rule: MockRule;
  onChange: (patch: Partial<MockRule>) => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-[var(--color-border)]">
      <div className="flex items-center gap-1.5 px-2 py-1 text-micro font-mono hover:bg-[var(--color-hover)] group">
        <button
          onClick={() => onChange({ enabled: !rule.enabled })}
          className="shrink-0 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
          title={rule.enabled ? "Disable" : "Enable"}
        >
          {rule.enabled ? (
            <ToggleRight size={13} className="text-green-400" />
          ) : (
            <ToggleLeft size={13} />
          )}
        </button>
        <button
          onClick={() => setOpen(!open)}
          className="flex items-center gap-1.5 flex-1 min-w-0 text-left"
          title={open ? "Collapse" : "Edit response"}
        >
          {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          <span className="shrink-0 w-[42px] text-[var(--color-text-muted)]">
            {rule.method || "ANY"}
          </span>
          <span className={`shrink-0 tabular-nums ${statusColor(rule.status)}`}>{rule.status}</span>
          {rule.delayMs > 0 && <span className="shrink-0 text-amber-400">+{rule.delayMs}ms</span>}
          <span className="truncate text-[var(--color-text-secondary)]" title={rule.pattern}>
            {rule.pattern}
          </span>
        </button>
        <button
          onClick={onDelete}
          className="opacity-0 group-hover:opacity-100 text-[var(--color-text-muted)] hover:text-red-400 px-0.5 shrink-0 transition-opacity"
          title="Delete mock"
        >
          <Trash2 size={11} />
        </button>
      </div>
      {open && (
        <div className="flex flex-col gap-1.5 px-2 pb-2">
          <div className="flex gap-1.5">
            <select
              value={rule.method}
              onChange={(e) => onChange({ method: e.target.value })}
              className={`${INPUT} w-[76px]`}
            >
              {METHODS.map((m) => (
                <option key={m} value={m}>
                  {m || "ANY"}
                </option>
              ))}
            </select>
            <input
              value={rule.pattern}
              onChange={(e) => onChange({ pattern: e.target.value })}
              className={`${INPUT} flex-1 min-w-0`}
            />
          </div>
          <ResponseFields rule={rule} onChange={onChange} />
        </div>
      )}
    </div>
  );
}

const BLANK = { method: "", status: 200, delayMs: 0, contentType: "", body: "" };

function AddMockForm({
  defaultPattern,
  onAdd,
}: {
  defaultPattern: string;
  onAdd: (rule: MockRule) => void;
}) {
  const [pattern, setPattern] = useState(defaultPattern);
  const [draft, setDraft] = useState(BLANK);
  const invalid = isCatchAll(pattern);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (invalid) return;
    onAdd({ id: crypto.randomUUID(), pattern: pattern.trim(), enabled: true, ...draft });
    setPattern(defaultPattern);
    setDraft(BLANK);
  };

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-1.5 px-2 py-2 border-b border-[var(--color-border)]"
    >
      <div className="flex gap-1.5">
        <select
          value={draft.method}
          onChange={(e) => setDraft({ ...draft, method: e.target.value })}
          className={`${INPUT} w-[76px]`}
        >
          {METHODS.map((m) => (
            <option key={m} value={m}>
              {m || "ANY"}
            </option>
          ))}
        </select>
        <input
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          placeholder="localhost:8000/api/users*"
          className={`${INPUT} flex-1 min-w-0`}
        />
      </div>
      <ResponseFields rule={draft} onChange={(patch) => setDraft({ ...draft, ...patch })} />
      <button
        type="submit"
        disabled={invalid}
        title={
          invalid
            ? "A mock needs a URL pattern — a catch-all would replace the page itself"
            : undefined
        }
        className="flex items-center justify-center gap-1 text-micro px-2 py-1 rounded bg-[var(--color-accent-dim)] text-[var(--color-accent)] hover:bg-[var(--color-accent)] hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        <Plus size={11} /> Add Mock
      </button>
    </form>
  );
}

const EMPTY_RULES: MockRule[] = [];

export function MocksPanel() {
  const activeWorkspaceId = useWorkspacesStore((s) => s.activeWorkspaceId);
  const workspaces = useWorkspacesStore((s) => s.workspaces);
  const tabs = useTabsStore((s) => s.tabs);
  const activeTab = getLiveWorkspaceActiveTab(workspaces[activeWorkspaceId], tabs);
  const origin = activeTab?.url ? originOf(activeTab.url) : "";
  const defaultPattern = origin ? `${origin.replace(/^[a-z]+:\/\//i, "")}/api/*` : "";

  const rulesByWs = useMocksStore((s) => s.rulesByWs);
  const rules = useMemo(
    () => rulesByWs[activeWorkspaceId] ?? EMPTY_RULES,
    [rulesByWs, activeWorkspaceId],
  );
  const addRule = useMocksStore((s) => s.addRule);
  const updateRule = useMocksStore((s) => s.updateRule);
  const removeRule = useMocksStore((s) => s.removeRule);
  const active = rules.filter((r) => r.enabled).length;

  return (
    <div className="flex flex-col h-full">
      <datalist id="zynlex-mock-statuses">
        {COMMON_STATUSES.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-[var(--color-border)]">
        <span className="text-micro font-medium text-[var(--color-text-muted)]">
          {rules.length} mock{rules.length !== 1 ? "s" : ""}
          {rules.length > 0 && ` · ${active} active`}
        </span>
      </div>

      <AddMockForm
        key={defaultPattern}
        defaultPattern={defaultPattern}
        onAdd={(r) => addRule(activeWorkspaceId, r)}
      />

      <div className="flex-1 overflow-y-auto">
        {rules.length === 0 ? (
          <div className="text-micro text-[var(--color-text-muted)] px-3 py-4 italic space-y-2">
            <p>
              Matching requests get this response instead of reaching the network. No proxy, no
              certificate. The first enabled match wins.
            </p>
            <p>
              Patterns work like header rules: no <code>*</code> means a prefix match, and{" "}
              <code>*</code> is a wildcard. Tip: pick a request in the Network panel and click{" "}
              <span className="not-italic">Mock this</span> to start from the real response.
            </p>
          </div>
        ) : (
          rules.map((rule) => (
            <MockRow
              key={rule.id}
              rule={rule}
              onChange={(patch) => updateRule(activeWorkspaceId, rule.id, patch)}
              onDelete={() => removeRule(activeWorkspaceId, rule.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}
