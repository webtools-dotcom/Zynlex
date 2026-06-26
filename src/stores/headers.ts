import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { persist } from "zustand/middleware";
import type { HeaderRule } from "@/types";

function genId(): string {
  return `rule-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

interface HeadersStore {
  rules: HeaderRule[];

  addRule: (
    workspaceId: string,
    urlPattern: string,
    headerName: string,
    headerValue: string
  ) => HeaderRule;
  removeRule: (id: string) => void;
  toggleRule: (id: string) => void;
  updateRule: (
    id: string,
    changes: Partial<
      Pick<HeaderRule, "urlPattern" | "headerName" | "headerValue" | "enabled">
    >
  ) => void;
  getRulesForWorkspace: (workspaceId: string) => HeaderRule[];
}

export const useHeadersStore = create<HeadersStore>()(
  persist(
    immer((set, get) => ({
      rules: [],

      addRule: (workspaceId, urlPattern, headerName, headerValue) => {
        const id = genId();
        const rule: HeaderRule = {
          id,
          urlPattern: urlPattern.trim(),
          headerName: headerName.trim(),
          headerValue,
          enabled: true,
          workspaceId,
          createdAt: Date.now(),
        };
        set((s) => {
          s.rules.push(rule);
        });
        return rule;
      },

      removeRule: (id) =>
        set((s) => {
          s.rules = s.rules.filter((r) => r.id !== id);
        }),

      toggleRule: (id) =>
        set((s) => {
          const rule = s.rules.find((r) => r.id === id);
          if (rule) rule.enabled = !rule.enabled;
        }),

      updateRule: (id, changes) =>
        set((s) => {
          const rule = s.rules.find((r) => r.id === id);
          if (rule) {
            if (changes.urlPattern !== undefined)
              rule.urlPattern = changes.urlPattern;
            if (changes.headerName !== undefined)
              rule.headerName = changes.headerName;
            if (changes.headerValue !== undefined)
              rule.headerValue = changes.headerValue;
            if (changes.enabled !== undefined)
              rule.enabled = changes.enabled;
          }
        }),

      getRulesForWorkspace: (workspaceId) =>
        get().rules.filter((r) => r.workspaceId === workspaceId),
    })),
    {
      name: "xevo-header-rules",
      partialize: (state) => ({ rules: state.rules }),
    }
  )
);
