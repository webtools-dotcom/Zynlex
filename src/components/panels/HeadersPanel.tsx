import { useState, useMemo } from "react";
import { useHeadersStore, type HeaderRule } from "@/stores/headers";
import { useWorkspacesStore } from "@/stores/workspaces";
import { useTabsStore } from "@/stores/tabs";
import { getLiveWorkspaceActiveTab } from "@/lib/workspaceTabs";
import { originOf } from "@/lib/url";
import { Plus, Trash2, ToggleLeft, ToggleRight, AlertTriangle } from "lucide-react";

function RuleRow({
  rule,
  onToggle,
  onDelete,
  onEditValue,
}: {
  rule: HeaderRule;
  onToggle: () => void;
  onDelete: () => void;
  onEditValue: (value: string) => void;
}) {
  const isWildcard = rule.enabled && (rule.pattern.trim() === "" || rule.pattern.trim() === "*");
  return (
    <div className="flex items-center gap-1.5 px-2 py-1 text-micro font-mono hover:bg-[var(--color-hover)] border-b border-[var(--color-border)] group">
      <button
        onClick={onToggle}
        className="shrink-0 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
        title={rule.enabled ? "Disable" : "Enable"}
      >
        {rule.enabled ? (
          <ToggleRight size={13} className="text-green-400" />
        ) : (
          <ToggleLeft size={13} />
        )}
      </button>
      {isWildcard && (
        <span
          className="shrink-0 text-amber-400 inline-flex"
          title="Matches every origin — this header is sent to every request the tab makes, including third-party scripts"
        >
          <AlertTriangle size={11} />
        </span>
      )}
      <span className="truncate flex-1 min-w-0 text-[var(--color-text-muted)]" title={rule.pattern}>
        {rule.pattern}
      </span>
      <span className="text-[var(--color-text-muted)] shrink-0">→</span>
      <span className="text-cyan-300 shrink-0 truncate max-w-[120px]" title={rule.name}>
        {rule.name}
      </span>
      <span className="text-[var(--color-text-muted)] shrink-0">:</span>
      <input
        value={rule.value}
        onChange={(e) => onEditValue(e.target.value)}
        title="Click to edit"
        className="text-[var(--color-text-muted)] bg-transparent w-[80px] shrink-0 outline-none focus:w-[160px] focus:bg-[var(--color-hover)] focus:text-[var(--color-text-primary)] rounded px-0.5 transition-all"
      />
      <button
        onClick={onDelete}
        className="opacity-0 group-hover:opacity-100 text-[var(--color-text-muted)] hover:text-red-400 px-0.5 shrink-0 transition-opacity"
        title="Delete rule"
      >
        <Trash2 size={11} />
      </button>
    </div>
  );
}

function AddRuleForm({
  onAdd,
  defaultPattern,
}: {
  onAdd: (rule: HeaderRule) => void;
  defaultPattern: string;
}) {
  const [pattern, setPattern] = useState(defaultPattern);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !value) return;
    onAdd({
      id: crypto.randomUUID(),
      pattern,
      name: name.trim(),
      value: value.trim(),
      enabled: true,
    });
    setPattern(defaultPattern);
    setName("");
    setValue("");
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-1.5 px-2 py-2 border-b border-[var(--color-border)]">
      <input
        value={pattern}
        onChange={(e) => setPattern(e.target.value)}
        placeholder="URL pattern (defaults to current tab's origin)"
        className="bg-[var(--color-hover)] text-micro font-mono px-2 py-1 rounded border border-[var(--color-border)] outline-none focus:border-[var(--color-accent)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)]"
      />
      <div className="flex gap-1.5">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Header name"
          className="flex-1 bg-[var(--color-hover)] text-micro font-mono px-2 py-1 rounded border border-[var(--color-border)] outline-none focus:border-[var(--color-accent)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)]"
        />
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Value"
          className="flex-1 bg-[var(--color-hover)] text-micro font-mono px-2 py-1 rounded border border-[var(--color-border)] outline-none focus:border-[var(--color-accent)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)]"
        />
      </div>
      <button
        type="submit"
        disabled={!name || !value}
        className="flex items-center justify-center gap-1 text-micro px-2 py-1 rounded bg-[var(--color-accent-dim)] text-[var(--color-accent)] hover:bg-[var(--color-accent)] hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        <Plus size={11} /> Add Rule
      </button>
    </form>
  );
}

const EMPTY_RULES: HeaderRule[] = [];

export function HeadersPanel() {
  const activeWorkspaceId = useWorkspacesStore((s) => s.activeWorkspaceId);
  const workspaces = useWorkspacesStore((s) => s.workspaces);
  const tabs = useTabsStore((s) => s.tabs);
  const activeTab = getLiveWorkspaceActiveTab(workspaces[activeWorkspaceId], tabs);
  const defaultPattern = activeTab?.url ? originOf(activeTab.url, "*") : "*";

  const rulesByWs = useHeadersStore((s) => s.rulesByWs);
  const rules = useMemo(() => rulesByWs[activeWorkspaceId] ?? EMPTY_RULES, [rulesByWs, activeWorkspaceId]);
  const addRule = useHeadersStore((s) => s.addRule);
  const updateRule = useHeadersStore((s) => s.updateRule);
  const removeRule = useHeadersStore((s) => s.removeRule);

  const handleAdd = (rule: HeaderRule) => {
    addRule(activeWorkspaceId, rule);
  };

  const handleToggle = (id: string) => {
    const rule = rules.find((r) => r.id === id);
    if (rule) {
      updateRule(activeWorkspaceId, id, { enabled: !rule.enabled });
    }
  };

  const handleDelete = (id: string) => {
    removeRule(activeWorkspaceId, id);
  };

  const handleEditValue = (id: string, value: string) => {
    updateRule(activeWorkspaceId, id, { value });
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-[var(--color-border)]">
        <span className="text-micro font-medium text-[var(--color-text-muted)]">
          {rules.length} rule{rules.length !== 1 ? "s" : ""}
        </span>
      </div>

      <AddRuleForm onAdd={handleAdd} defaultPattern={defaultPattern} />

      <div className="flex-1 overflow-y-auto">
        {rules.length === 0 ? (
          <div className="text-micro text-[var(--color-text-muted)] px-3 py-4 italic">
            No header injection rules. Add one above. Note: WebSocket connections aren't
            covered — only regular HTTP/HTTPS requests.
          </div>
        ) : (
          rules.map((rule) => (
            <RuleRow
              key={rule.id}
              rule={rule}
              onToggle={() => handleToggle(rule.id)}
              onDelete={() => handleDelete(rule.id)}
              onEditValue={(value) => handleEditValue(rule.id, value)}
            />
          ))
        )}
      </div>
    </div>
  );
}
