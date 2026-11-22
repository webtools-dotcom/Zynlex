/**
 * Per-agent setup for connecting an AI coding agent to ZYNLEX's MCP server
 * (zynlex-mcp.exe, a stdio server; it starts ZYNLEX when an agent needs it and
 * it isn't running, unless given `--no-open`). Shown in Settings → AI
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

/**
 * The snippet to paste and where it goes. With `open` false, `--no-open`: the
 * agent asks the developer to open ZYNLEX instead of zynlex-mcp starting it.
 */
export function mcpSetup(
  agent: McpAgentId,
  exe: string,
  open = true,
): { snippet: string; where: string } {
  const args = open ? [] : ["--no-open"];
  // `mcpServers` JSON, the shape most MCP clients read.
  const serversJson = () =>
    JSON.stringify({ mcpServers: { zynlex: { command: exe, args } } }, null, 2);
  switch (agent) {
    case "claude":
      return {
        // No "--" when there's no argument: PowerShell drops it on the way into
        // npm's claude.ps1, and Claude Code then reads the argument as its own.
        snippet: open
          ? `claude mcp add zynlex "${exe}"`
          : `claude mcp add zynlex -- "${exe}" --no-open`,
        where: open
          ? "Run once in a terminal. Every Claude Code project then has the zynlex tools."
          : "Run once in a Command Prompt (cmd): PowerShell can drop the --. Every Claude Code project then has the zynlex tools.",
      };
    case "codex":
      return {
        // A TOML literal string: backslashes stay as they are.
        snippet: `[mcp_servers.zynlex]\ncommand = '${exe}'\nargs = [${args.map((a) => `"${a}"`).join(", ")}]`,
        where: "Add to %USERPROFILE%\\.codex\\config.toml, then restart Codex.",
      };
    case "antigravity":
      return {
        snippet: serversJson(),
        where:
          "Put in %USERPROFILE%\\.gemini\\config\\mcp_config.json (merge into mcpServers if it has others), then restart Antigravity.",
      };
    case "opencode":
      return {
        snippet: JSON.stringify(
          { mcp: { zynlex: { type: "local", command: [exe, ...args], enabled: true } } },
          null,
          2,
        ),
        where:
          'Merge into %USERPROFILE%\\.config\\opencode\\opencode.jsonc under "mcp", then restart OpenCode.',
      };
    case "cursor":
      return {
        snippet: serversJson(),
        where:
          "Put in %USERPROFILE%\\.cursor\\mcp.json (merge into mcpServers if it has others), or add it in Cursor's MCP settings.",
      };
    case "other":
      return {
        snippet: serversJson(),
        where: `Any MCP client: a stdio server, this command, ${open ? "no arguments" : "with --no-open"}.`,
      };
  }
}
