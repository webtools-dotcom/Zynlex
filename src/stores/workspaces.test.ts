import { describe, it, expect } from "vitest";
import { useWorkspacesStore } from "@/stores/workspaces";

describe("renameWorkspace", () => {
  it("trims, caps at 40 chars and ignores a blank name", () => {
    const id = useWorkspacesStore.getState().createWorkspace("Project 2");
    const rename = useWorkspacesStore.getState().renameWorkspace;
    const name = () => useWorkspacesStore.getState().workspaces[id].name;

    rename(id, "  Client site  ");
    expect(name()).toBe("Client site");
    rename(id, "   ");
    expect(name()).toBe("Client site");
    rename(id, "x".repeat(60));
    expect(name()).toHaveLength(40);
  });
});
