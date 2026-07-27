import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface HeaderRule {
  id: string;
  pattern: string;
  name: string;
  value: string;
  enabled: boolean;
}

interface HeadersStore {
  rulesByWs: Record<string, HeaderRule[]>;
  setRules: (wsId: string, rules: HeaderRule[]) => void;
  addRule: (wsId: string, rule: HeaderRule) => void;
  updateRule: (wsId: string, id: string, patch: Partial<HeaderRule>) => void;
  removeRule: (wsId: string, id: string) => void;
  getRules: (wsId: string) => HeaderRule[];
}

export const useHeadersStore = create<HeadersStore>()(
  persist(
    (set, get) => ({
      rulesByWs: {},
      setRules: (wsId, rules) =>
        set((s) => ({ rulesByWs: { ...s.rulesByWs, [wsId]: rules } })),
      addRule: (wsId, rule) =>
        set((s) => {
          const existing = s.rulesByWs[wsId] ?? [];
          return {
            rulesByWs: { ...s.rulesByWs, [wsId]: [...existing, rule] },
          };
        }),
      updateRule: (wsId, id, patch) =>
        set((s) => {
          const existing = s.rulesByWs[wsId] ?? [];
          return {
            rulesByWs: {
              ...s.rulesByWs,
              [wsId]: existing.map((r) =>
                r.id === id ? { ...r, ...patch } : r
              ),
            },
          };
        }),
      removeRule: (wsId, id) =>
        set((s) => {
          const existing = s.rulesByWs[wsId] ?? [];
          return {
            rulesByWs: {
              ...s.rulesByWs,
              [wsId]: existing.filter((r) => r.id !== id),
            },
          };
        }),
      getRules: (wsId) => get().rulesByWs[wsId] ?? [],
    }),
    {
      name: "xevo-header-rules",
      version: 1,
    }
  )
);
