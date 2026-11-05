/**
 * Per-agent setup for connecting an AI coding agent to ZYNLEX's MCP server
 * (zynlex-mcp.exe, a stdio server with no arguments). Shown in Settings → AI
 * agents. The Claude Code, Codex, Antigravity and OpenCode formats are the
 * ones the agent tests ran with (docs/agent-interface.md, "Other agents").
 */

/** DOM id of the Settings section, for the palette command that opens it. */
export const AI_AGENTS_SECTION = "settings-ai-agents";

export const MCP_AGENTS = [
  { id: "claude", name: "Claude Code" },
  { id: "codex", name: "Codex" },
  { id: "antigravity", name: "Antigravity" },
  { id: "opencode", name: "OpenCode" },
  { id: "cursor", name: "Cursor" },
  { id: "other", name: "Other MCP client" },
] as const;

export type McpAgentId = (typeof MCP_AGENTS)[number]["id"];

/** `mcpServers` JSON, the shape most MCP clients read. */
const serversJson = (exe: string) =>
  JSON.stringify({ mcpServers: { zynlex: { command: exe, args: [] } } }, null, 2);

/** The snippet to paste and where it goes. */
export function mcpSetup(agent: McpAgentId, exe: string): { snippet: string; where: string } {
  switch (agent) {
    case "claude":
      return {
        snippet: `claude mcp add zynlex -- "${exe}"`,
        where: "Run once in a terminal. Every Claude Code project then has the zynlex tools.",
      };
    case "codex":
      return {
        // A TOML literal string: backslashes stay as they are.
        snippet: `[mcp_servers.zynlex]\ncommand = '${exe}'\nargs = []`,
        where: "Add to %USERPROFILE%\\.codex\\config.toml, then restart Codex.",
      };
    case "antigravity":
      return {
        snippet: serversJson(exe),
        where:
          "Put in %USERPROFILE%\\.gemini\\config\\mcp_config.json (merge into mcpServers if it has others), then restart Antigravity.",
      };
    case "opencode":
      return {
        snippet: JSON.stringify(
          { mcp: { zynlex: { type: "local", command: [exe], enabled: true } } },
          null,
          2,
        ),
        where:
          'Merge into %USERPROFILE%\\.config\\opencode\\opencode.jsonc under "mcp", then restart OpenCode.',
      };
    case "cursor":
      return {
        snippet: serversJson(exe),
        where:
          "Put in %USERPROFILE%\\.cursor\\mcp.json (merge into mcpServers if it has others), or add it in Cursor's MCP settings.",
      };
    case "other":
      return {
        snippet: serversJson(exe),
        where: "Any MCP client: a stdio server, this command, no arguments.",
      };
  }
}
