import { useState, useMemo } from "react";
import { useHeadersStore, genHeaderRuleId, type HeaderRule } from "@/stores/headers";
import { useWorkspacesStore } from "@/stores/workspaces";
import { Plus, Trash2, ToggleLeft, ToggleRight } from "lucide-react";

function RuleRow({
  rule,
  onToggle,
  onDelete,
}: {
  rule: HeaderRule;
  onToggle: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-center gap-1.5 px-2 py-1 text-[11px] font-mono hover:bg-[var(--color-hover)] border-b border-[var(--color-border)] group">
      <button
        onClick={onToggle}
        className="shrink-0 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
        title={rule.enabled ? "Disable" : "Enable"}
      >
        {rule.enabled ? (
          <ToggleRight size={13} className="text-green-400" />
        ) : (
          <ToggleLeft size={13} />
        )}
      </button>
      <span className="truncate flex-1 min-w-0 text-[var(--color-muted-foreground)]" title={rule.pattern}>
        {rule.pattern}
      </span>
      <span className="text-[var(--color-muted-foreground)] shrink-0">→</span>
      <span className="text-cyan-300 shrink-0 truncate max-w-[120px]" title={rule.name}>
        {rule.name}
      </span>
      <span className="text-[var(--color-muted-foreground)] shrink-0">:</span>
      <span className="text-[var(--color-muted-foreground)] truncate max-w-[80px] shrink-0" title={rule.value}>
        {rule.value.length > 12 ? rule.value.slice(0, 12) + "..." : rule.value}
      </span>
      <button
        onClick={onDelete}
        className="opacity-0 group-hover:opacity-100 text-[var(--color-muted-foreground)] hover:text-red-400 px-0.5 shrink-0 transition-opacity"
        title="Delete rule"
      >
        <Trash2 size={11} />
      </button>
    </div>
  );
}

function AddRuleForm({ onAdd }: { onAdd: (rule: HeaderRule) => void }) {
  const [pattern, setPattern] = useState("*");
  const [name, setName] = useState("");
  const [value, setValue] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !value) return;
    onAdd({
      id: genHeaderRuleId(),
      pattern,
      name: name.trim(),
      value: value.trim(),
      enabled: true,
    });
    setPattern("*");
    setName("");
    setValue("");
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-1.5 px-2 py-2 border-b border-[var(--color-border)]">
      <input
        value={pattern}
        onChange={(e) => setPattern(e.target.value)}
        placeholder="URL pattern (*)"
        className="bg-[var(--color-hover)] text-[11px] font-mono px-2 py-1 rounded border border-[var(--color-border)] outline-none focus:border-[var(--color-accent)] text-[var(--color-foreground)] placeholder:text-[var(--color-muted-foreground)]"
      />
      <div className="flex gap-1.5">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Header name"
          className="flex-1 bg-[var(--color-hover)] text-[11px] font-mono px-2 py-1 rounded border border-[var(--color-border)] outline-none focus:border-[var(--color-accent)] text-[var(--color-foreground)] placeholder:text-[var(--color-muted-foreground)]"
        />
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Value"
          className="flex-1 bg-[var(--color-hover)] text-[11px] font-mono px-2 py-1 rounded border border-[var(--color-border)] outline-none focus:border-[var(--color-accent)] text-[var(--color-foreground)] placeholder:text-[var(--color-muted-foreground)]"
        />
      </div>
      <button
        type="submit"
        disabled={!name || !value}
        className="flex items-center justify-center gap-1 text-[10px] px-2 py-1 rounded bg-[var(--color-accent-dim)] text-[var(--color-accent)] hover:bg-[var(--color-accent)] hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        <Plus size={11} /> Add Rule
      </button>
    </form>
  );
}

const EMPTY_RULES: HeaderRule[] = [];

export function HeadersPanel() {
  const activeWorkspaceId = useWorkspacesStore((s) => s.activeWorkspaceId);
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

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-[var(--color-border)]">
        <span className="text-[11px] font-medium text-[var(--color-muted-foreground)]">
          {rules.length} rule{rules.length !== 1 ? "s" : ""}
        </span>
      </div>

      <AddRuleForm onAdd={handleAdd} />

      <div className="flex-1 overflow-y-auto">
        {rules.length === 0 ? (
          <div className="text-[11px] text-[var(--color-muted-foreground)] px-3 py-4 italic">
            No header injection rules. Add one above.
          </div>
        ) : (
          rules.map((rule) => (
            <RuleRow
              key={rule.id}
              rule={rule}
              onToggle={() => handleToggle(rule.id)}
              onDelete={() => handleDelete(rule.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}
