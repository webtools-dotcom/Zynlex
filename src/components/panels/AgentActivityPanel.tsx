/**
 * AgentActivityPanel — the last MAX_CALLS calls AI agents made over MCP
 * (newest first), fed by the dispatcher in src/lib/agent.ts, with the
 * take-over (Pause/Resume) control. A sidebar panel rather than a popover:
 * nothing may float over the tab.
 */
import { toggleAgentPause } from "@/lib/agentPause";
import { useAgentStore } from "@/stores/agent";
import { type AgentCall, MAX_CALLS, useAgentActivityStore } from "@/stores/agentActivity";
import { useTabsStore } from "@/stores/tabs";
import { useWorkspacesStore } from "@/stores/workspaces";

const button =
  "px-1.5 py-0.5 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-hover)]";

function goToTab(tabId: string) {
  const tab = useTabsStore.getState().tabs[tabId];
  if (!tab) return;
  const ws = useWorkspacesStore.getState();
  if (ws.activeWorkspaceId !== tab.workspaceId) ws.setActiveWorkspace(tab.workspaceId);
  ws.setActiveTab(tab.workspaceId, tabId);
}

function CallRow({ call }: { call: AgentCall }) {
  const open = useTabsStore((s) => (call.tabId ? !!s.tabs[call.tabId] : false));
  const time = new Date(call.at).toLocaleTimeString([], { hour12: false });
  return (
    <div className="px-3 py-1.5 border-b border-[var(--color-border-subtle)] text-xs">
      <div className="flex items-baseline gap-1.5">
        <span className="shrink-0 text-micro tabular-nums text-[var(--color-text-disabled)]">
          {time}
        </span>
        <span className="shrink-0 font-medium text-[var(--color-text-primary)]">{call.tool}</span>
        <span
          className="flex-1 min-w-0 truncate text-[var(--color-text-secondary)]"
          title={call.what ? `${call.what}\n${call.summary}` : call.summary}
        >
          {call.what || call.summary}
        </span>
        <span className="shrink-0 text-micro tabular-nums text-[var(--color-text-disabled)]">
          {call.ms < 1000 ? `${call.ms} ms` : `${(call.ms / 1000).toFixed(1)} s`}
        </span>
      </div>
      {call.why && (
        <div className="mt-0.5 text-micro italic break-words text-[var(--color-text-muted)]">
          {call.why}
        </div>
      )}
      {call.outcome && (
        <div
          className="mt-0.5 text-micro truncate text-[var(--color-text-secondary)]"
          title={call.outcome}
        >
          {call.outcome}
        </div>
      )}
      {call.tabLabel &&
        (open && call.tabId ? (
          <button
            type="button"
            onClick={() => goToTab(call.tabId as string)}
            className="block max-w-full mt-0.5 text-micro truncate text-left text-[var(--color-text-muted)] hover:underline"
            title={`Switch to ${call.tabLabel}`}
          >
            {call.tabLabel}
          </button>
        ) : (
          <div className="mt-0.5 text-micro truncate text-[var(--color-text-disabled)]">
            {call.tabLabel}
          </div>
        ))}
      {call.note && (
        <div className="mt-0.5 text-micro text-[var(--color-text-muted)]">{call.note}</div>
      )}
      {call.error && (
        <div className="mt-0.5 text-micro break-words select-text text-[var(--color-text-primary)]">
          ✕ {call.error}
        </div>
      )}
    </div>
  );
}

export function AgentActivityPanel() {
  const calls = useAgentActivityStore((s) => s.calls);
  const clear = useAgentActivityStore((s) => s.clear);
  const { enabled, clients, pausedAt } = useAgentStore();
  const canPause = pausedAt != null || (enabled && clients.length > 0);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-[var(--color-border)]">
        <span className="text-micro font-medium text-[var(--color-text-muted)]">
          {pausedAt != null
            ? "Agent paused: page actions wait"
            : clients.length
              ? `Agent: ${clients.join(", ")}`
              : "No agent connected"}
        </span>
        <div className="flex items-center gap-1 text-micro">
          {canPause && (
            <button
              type="button"
              onClick={toggleAgentPause}
              className={button}
              title={
                pausedAt != null
                  ? "Let the agent carry on; its waiting call runs and is told what changed"
                  : "Take over: the agent's page actions wait while you use the page"
              }
            >
              {pausedAt != null ? "Resume" : "Pause"}
            </button>
          )}
          {calls.length > 0 && (
            <button
              type="button"
              onClick={clear}
              className={button}
              title="Clear the list and the tab markers"
            >
              Clear
            </button>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {calls.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-[var(--color-text-disabled)]">
            No agent calls yet. The last {MAX_CALLS} show here.
          </div>
        ) : (
          calls.map((c) => <CallRow key={c.id} call={c} />)
        )}
      </div>
    </div>
  );
}
