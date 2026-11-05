import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * A persisted, per-workspace list of rules — the shape shared by header
 * injection and response mocking. The bridge resolves each tab's workspace
 * rules into a per-tab map for Rust (see useWebviewBridge).
 *
 * `agent` marks a rule an AI agent added (src/lib/agentRules.ts). Those are
 * never persisted: a restart (or a crash before the agent's disconnect cleanup)
 * must not leave the developer's app answering with an agent's canned 500.
 */
export interface WorkspaceRulesStore<T extends { id: string; agent?: boolean }> {
  rulesByWs: Record<string, T[]>;
  /** `first` puts the rule ahead of the others (for mocks: the first enabled match wins). */
  addRule: (wsId: string, rule: T, first?: boolean) => void;
  updateRule: (wsId: string, id: string, patch: Partial<T>) => void;
  removeRule: (wsId: string, id: string) => void;
}

/** What gets saved: everything but the agents' rules. */
export function withoutAgentRules<T extends { agent?: boolean }>(
  rulesByWs: Record<string, T[]>,
): Record<string, T[]> {
  return Object.fromEntries(
    Object.entries(rulesByWs).map(([ws, rules]) => [ws, rules.filter((r) => !r.agent)]),
  );
}

export function createWorkspaceRulesStore<T extends { id: string; agent?: boolean }>(name: string) {
  const edit = (s: WorkspaceRulesStore<T>, wsId: string, fn: (rules: T[]) => T[]) => ({
    rulesByWs: { ...s.rulesByWs, [wsId]: fn(s.rulesByWs[wsId] ?? []) },
  });
  return create<WorkspaceRulesStore<T>>()(
    persist(
      (set) => ({
        rulesByWs: {},
        addRule: (wsId, rule, first) =>
          set((s) => edit(s, wsId, (rules) => (first ? [rule, ...rules] : [...rules, rule]))),
        updateRule: (wsId, id, patch) =>
          set((s) =>
            edit(s, wsId, (rules) => rules.map((r) => (r.id === id ? { ...r, ...patch } : r))),
          ),
        removeRule: (wsId, id) =>
          set((s) => edit(s, wsId, (rules) => rules.filter((r) => r.id !== id))),
      }),
      {
        name,
        version: 1,
        partialize: (s) => ({ rulesByWs: withoutAgentRules(s.rulesByWs) }),
      },
    ),
  );
}
