/**
 * Settings → Environments: the active workspace's environments, in switcher
 * order (which is also the Alt+Shift+1..4 order).
 */
import { useState } from "react";
import { X } from "lucide-react";
import { displayOrigin, matchEnv, normalizeOrigin } from "@/lib/envSwitch";
import { isLoopbackUrl, hostOf } from "@/lib/url";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { useActiveTabId } from "@/hooks/useActiveScope";
import { useEnvironmentsStore } from "@/stores/environments";
import { useTabsStore } from "@/stores/tabs";
import { useWorkspacesStore } from "@/stores/workspaces";

const input =
  "min-w-0 px-1.5 py-0.5 text-xs border rounded text-[var(--color-text-primary)] placeholder:text-[var(--color-text-disabled)] outline-none focus:border-[var(--color-accent)]";
const inputStyle = { background: "var(--color-elevated)", borderColor: "var(--color-border)" };

/** "local" for a dev server, else the first label of the host ("staging" for staging.acme.com). */
function guessName(url: string): string {
  if (isLoopbackUrl(url)) return "local";
  const host = hostOf(url).replace(/^www\./, "");
  const labels = host.split(".");
  return labels.length > 2 ? labels[0] : "prod";
}

export function EnvironmentsSettings() {
  const wsId = useWorkspacesStore((s) => s.activeWorkspaceId);
  const wsName = useWorkspacesStore((s) => s.workspaces[s.activeWorkspaceId]?.name ?? "");
  const envs = useEnvironmentsStore((s) => s.rulesByWs[wsId]) ?? [];
  const { addRule, updateRule, removeRule } = useEnvironmentsStore();
  const tabId = useActiveTabId();
  const tabUrl = useTabsStore((s) => (tabId ? s.tabs[tabId]?.url : "")) ?? "";

  const suggest = tabUrl && normalizeOrigin(tabUrl) && !matchEnv(tabUrl, envs) ? tabUrl : "";
  const [name, setName] = useState("");
  const [origin, setOrigin] = useState("");
  const [error, setError] = useState("");

  const effectiveName = name || (suggest ? guessName(suggest) : "");
  const effectiveOrigin = origin || (suggest ? displayOrigin(normalizeOrigin(suggest) ?? "") : "");

  function add() {
    const normalized = normalizeOrigin(effectiveOrigin);
    if (!normalized) return setError("Enter an http(s) address, like localhost:3000.");
    if (!effectiveName.trim()) return setError("Give it a name.");
    if (matchEnv(normalized, envs)) return setError("That address is already an environment.");
    addRule(wsId, {
      id: crypto.randomUUID(),
      name: effectiveName.trim(),
      origin: normalized,
      isProd: false,
    });
    setName("");
    setOrigin("");
    setError("");
  }

  return (
    <div>
      <span className="text-xs text-[var(--color-text-disabled)] block mb-2">
        The same app on different addresses, for {wsName || "this workspace"}. With two or more, the
        toolbar switches the current page between them (Alt+Shift+1–4).
      </span>

      <div className="space-y-1">
        {envs.map((env) => (
          <div key={env.id} className="flex items-center gap-1">
            <input
              aria-label="Environment name"
              value={env.name}
              onChange={(e) => updateRule(wsId, env.id, { name: e.target.value })}
              className={`${input} w-[64px]`}
              style={inputStyle}
            />
            <span
              className="flex-1 min-w-0 truncate text-xs text-[var(--color-text-muted)]"
              title={displayOrigin(env.origin)}
            >
              {displayOrigin(env.origin)}
            </span>
            <label
              className="flex items-center gap-1 text-micro shrink-0"
              style={{ color: env.isProd ? "var(--color-env-prod)" : "var(--color-text-disabled)" }}
              title="Production: marked in red; switching to it from the toolbar or a shortcut asks first"
            >
              <input
                type="checkbox"
                checked={env.isProd}
                onChange={(e) => updateRule(wsId, env.id, { isProd: e.target.checked })}
              />
              prod
            </label>
            <ConfirmButton
              onConfirm={() => removeRule(wsId, env.id)}
              title={`Remove ${env.name}`}
              className="w-5 h-5 flex items-center justify-center rounded text-[var(--color-text-disabled)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-hover)]"
            >
              <X size={12} />
            </ConfirmButton>
          </div>
        ))}
      </div>

      <form
        className="flex items-center gap-1 mt-2"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input
          aria-label="New environment name"
          placeholder="name"
          value={effectiveName}
          onChange={(e) => setName(e.target.value)}
          className={`${input} w-[64px]`}
          style={inputStyle}
        />
        <input
          aria-label="New environment address"
          placeholder="localhost:3000"
          value={effectiveOrigin}
          onChange={(e) => setOrigin(e.target.value)}
          className={`${input} flex-1`}
          style={inputStyle}
        />
        <button
          type="submit"
          className="px-2 py-0.5 text-xs rounded border whitespace-nowrap text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
          style={inputStyle}
        >
          Add
        </button>
      </form>
      {error && <div className="text-xs mt-1 text-[var(--color-warn)]">{error}</div>}
    </div>
  );
}
