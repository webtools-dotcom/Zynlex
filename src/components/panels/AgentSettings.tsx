/**
 * Settings → AI agents: the snippet that connects a coding agent to ZYNLEX's
 * MCP server, with this install's real path filled in. See
 * docs/agent-interface.md for what the agent can then do.
 */
import { useEffect, useState } from "react";
import { useCopy } from "@/hooks/useCopy";
import { MCP_AGENTS, type McpAgentId, mcpSetup } from "@/lib/mcpSetup";
import { getMcpPath } from "@/services/browser";

export function AgentSettings() {
  // undefined: still asking; null: zynlex-mcp.exe isn't next to the app.
  const [exe, setExe] = useState<string | null | undefined>(undefined);
  const [agent, setAgent] = useState<McpAgentId>("claude");
  const { copiedLabel, copy } = useCopy();

  useEffect(() => {
    getMcpPath()
      .then(setExe)
      .catch(() => setExe(null));
  }, []);

  const intro = (
    <span className="text-xs text-[var(--color-text-disabled)] block">
      Let an AI coding agent see and test your localhost tabs: open pages, click, read errors and
      requests. Other sites stay out of its reach.
    </span>
  );
  if (exe === undefined) return intro;
  if (exe === null) {
    return (
      <>
        {intro}
        <span className="text-xs text-[var(--color-text-muted)] block mt-2">
          zynlex-mcp.exe isn't next to ZYNLEX. Reinstall ZYNLEX to get it.
        </span>
      </>
    );
  }

  const { snippet, where } = mcpSetup(agent, exe);
  return (
    <>
      {intro}
      <div className="flex justify-between items-center mt-3">
        <span className="text-sm text-[var(--color-text-muted)]">Agent</span>
        <select
          aria-label="Agent"
          value={agent}
          onChange={(e) => setAgent(e.target.value as McpAgentId)}
          className="px-1.5 py-0.5 text-xs border rounded text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
          style={{ background: "var(--color-elevated)", borderColor: "var(--color-border)" }}
        >
          {MCP_AGENTS.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </div>
      <pre
        className="mt-2 p-2 text-xs font-mono border rounded whitespace-pre-wrap break-all select-text text-[var(--color-text-primary)]"
        style={{ background: "var(--color-elevated)", borderColor: "var(--color-border)" }}
      >
        {snippet}
      </pre>
      <div className="flex justify-between items-start gap-2 mt-1">
        <span className="text-xs text-[var(--color-text-disabled)]">{where}</span>
        <button
          type="button"
          onClick={() => copy(snippet, agent)}
          className="px-2 py-1 text-xs rounded border whitespace-nowrap text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
          style={{ background: "var(--color-elevated)", borderColor: "var(--color-border)" }}
        >
          {copiedLabel === agent ? "Copied!" : "Copy"}
        </button>
      </div>
    </>
  );
}
