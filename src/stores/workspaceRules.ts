import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * A persisted, per-workspace list of rules — the shape shared by header
 * injection and response mocking. The bridge resolves each tab's workspace
 * rules into a per-tab map for Rust (see useWebviewBridge).
 */
export interface WorkspaceRulesStore<T extends { id: string }> {
  rulesByWs: Record<string, T[]>;
  addRule: (wsId: string, rule: T) => void;
  updateRule: (wsId: string, id: string, patch: Partial<T>) => void;
  removeRule: (wsId: string, id: string) => void;
}

export function createWorkspaceRulesStore<T extends { id: string }>(name: string) {
  const edit = (s: WorkspaceRulesStore<T>, wsId: string, fn: (rules: T[]) => T[]) => ({
    rulesByWs: { ...s.rulesByWs, [wsId]: fn(s.rulesByWs[wsId] ?? []) },
  });
  return create<WorkspaceRulesStore<T>>()(
    persist(
      (set) => ({
        rulesByWs: {},
        addRule: (wsId, rule) => set((s) => edit(s, wsId, (rules) => [...rules, rule])),
        updateRule: (wsId, id, patch) =>
          set((s) =>
            edit(s, wsId, (rules) => rules.map((r) => (r.id === id ? { ...r, ...patch } : r))),
          ),
        removeRule: (wsId, id) =>
          set((s) => edit(s, wsId, (rules) => rules.filter((r) => r.id !== id))),
      }),
      { name, version: 1 },
    ),
  );
}
