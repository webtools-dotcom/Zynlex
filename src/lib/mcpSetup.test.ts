import { describe, expect, it } from "vitest";
import { MCP_AGENTS, mcpSetup } from "./mcpSetup";

const exe = String.raw`C:\Users\Me\AppData\Local\ZYNLEX\zynlex-mcp.exe`;

describe("mcpSetup", () => {
  it("quotes the path for a shell command, with no -- (PowerShell drops it)", () => {
    expect(mcpSetup("claude", exe).snippet).toBe(`claude mcp add zynlex "${exe}"`);
  });

  it("keeps backslashes in Codex's TOML literal string", () => {
    expect(mcpSetup("codex", exe).snippet).toContain(`command = '${exe}'`);
  });

  it("produces JSON that parses back to the same path", () => {
    for (const agent of ["antigravity", "cursor", "other"] as const) {
      const cfg = JSON.parse(mcpSetup(agent, exe).snippet);
      expect(cfg.mcpServers.zynlex.command).toBe(exe);
    }
    expect(JSON.parse(mcpSetup("opencode", exe).snippet).mcp.zynlex.command).toEqual([exe]);
  });

  it("adds --no-open in each format when opening is off, and nothing otherwise", () => {
    expect(mcpSetup("claude", exe, false).snippet).toBe(
      `claude mcp add zynlex -- "${exe}" --no-open`,
    );
    expect(mcpSetup("codex", exe, false).snippet).toContain('args = ["--no-open"]');
    expect(mcpSetup("codex", exe).snippet).toContain("args = []");
    for (const agent of ["antigravity", "cursor", "other"] as const) {
      expect(JSON.parse(mcpSetup(agent, exe, false).snippet).mcpServers.zynlex.args).toEqual([
        "--no-open",
      ]);
      expect(JSON.parse(mcpSetup(agent, exe).snippet).mcpServers.zynlex.args).toEqual([]);
    }
    expect(JSON.parse(mcpSetup("opencode", exe, false).snippet).mcp.zynlex.command).toEqual([
      exe,
      "--no-open",
    ]);
  });

  it("covers every listed agent with a snippet and a place to put it", () => {
    for (const { id } of MCP_AGENTS) {
      const { snippet, where } = mcpSetup(id, exe);
      expect(snippet).toContain("zynlex");
      expect(where.length).toBeGreaterThan(10);
    }
  });
});
