import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { persist } from "zustand/middleware";
import type { Workspace } from "@/types";

const COLORS = [
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
  "#f97316",
  "#10b981",
  "#f59e0b",
  "#06b6d4",
  "#ef4444",
];

const INITIAL_WORKSPACE: Workspace = {
  id: "ws-default",
  name: "Personal",
  color: "#3b82f6",
  icon: "🌐",
  createdAt: Date.now(),
  tabIds: [],
  activeTabId: null,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function sanitizeWorkspace(
  workspaceId: string,
  workspace: Partial<Workspace> | undefined,
): Workspace {
  return {
    id: typeof workspace?.id === "string" ? workspace.id : workspaceId,
    name: typeof workspace?.name === "string" ? workspace.name : INITIAL_WORKSPACE.name,
    color: typeof workspace?.color === "string" ? workspace.color : INITIAL_WORKSPACE.color,
    icon: typeof workspace?.icon === "string" ? workspace.icon : INITIAL_WORKSPACE.icon,
    createdAt: typeof workspace?.createdAt === "number" ? workspace.createdAt : Date.now(),
    tabIds: Array.isArray(workspace?.tabIds)
      ? workspace!.tabIds.filter((id): id is string => typeof id === "string")
      : [],
    activeTabId: typeof workspace?.activeTabId === "string" ? workspace.activeTabId : null,
  };
}

function sanitizeWorkspaceMap(
  workspaces: Record<string, Partial<Workspace>> | undefined,
): Record<string, Workspace> {
  const next: Record<string, Workspace> = {};
  const source = workspaces ?? {};

  Object.entries(source).forEach(([workspaceId, workspace]) => {
    next[workspaceId] = sanitizeWorkspace(workspaceId, workspace);
  });

  if (!next[INITIAL_WORKSPACE.id]) {
    next[INITIAL_WORKSPACE.id] = sanitizeWorkspace(INITIAL_WORKSPACE.id, INITIAL_WORKSPACE);
  }

  return next;
}

interface WorkspacesStore {
  workspaces: Record<string, Workspace>;
  workspaceOrder: string[];
  activeWorkspaceId: string;

  createWorkspace: (name: string, color?: string, icon?: string) => string;
  deleteWorkspace: (id: string) => void;
  renameWorkspace: (id: string, name: string) => void;
  setActiveWorkspace: (id: string) => void;
  addTabToWorkspace: (wsId: string, tabId: string) => void;
  removeTabFromWorkspace: (wsId: string, tabId: string) => void;
  setActiveTab: (wsId: string, tabId: string | null) => void;
  reorderTabs: (wsId: string, tabIds: string[]) => void;
  reorderWorkspaces: (order: string[]) => void;
}

export const useWorkspacesStore = create<WorkspacesStore>()(
  persist(
    immer((set, get) => ({
      workspaces: { [INITIAL_WORKSPACE.id]: INITIAL_WORKSPACE },
      workspaceOrder: [INITIAL_WORKSPACE.id],
      activeWorkspaceId: INITIAL_WORKSPACE.id,

      createWorkspace: (name, color, icon = "📁") => {
        const idx = Object.keys(get().workspaces).length % COLORS.length;
        const id = crypto.randomUUID();
        set((s) => {
          s.workspaces[id] = {
            id,
            name,
            icon,
            color: color ?? COLORS[idx],
            createdAt: Date.now(),
            tabIds: [],
            activeTabId: null,
          };
          s.workspaceOrder.push(id);
        });
        return id;
      },

      deleteWorkspace: (id) => {
        if (get().workspaceOrder.length <= 1) return;
        set((s) => {
          delete s.workspaces[id];
          s.workspaceOrder = s.workspaceOrder.filter((i: string) => i !== id);
          if (s.activeWorkspaceId === id) {
            s.activeWorkspaceId = s.workspaceOrder[0];
          }
        });
      },

      renameWorkspace: (id, name) => {
        set((s) => {
          if (s.workspaces[id]) s.workspaces[id].name = name;
        });
      },

      setActiveWorkspace: (id) => {
        set((s) => {
          s.activeWorkspaceId = id;
        });
      },

      addTabToWorkspace: (wsId, tabId) => {
        set((s) => {
          const ws = s.workspaces[wsId];
          if (ws && !ws.tabIds.includes(tabId)) {
            ws.tabIds.push(tabId);
            if (!ws.activeTabId) ws.activeTabId = tabId;
          }
        });
      },

      removeTabFromWorkspace: (wsId, tabId) => {
        set((s) => {
          const ws = s.workspaces[wsId];
          if (!ws) return;
          ws.tabIds = ws.tabIds.filter((id: string) => id !== tabId);
          if (ws.activeTabId === tabId) {
            ws.activeTabId = ws.tabIds[ws.tabIds.length - 1] ?? null;
          }
        });
      },

      setActiveTab: (wsId, tabId) => {
        set((s) => {
          if (s.workspaces[wsId]) s.workspaces[wsId].activeTabId = tabId;
        });
      },

      reorderTabs: (wsId, tabIds) => {
        set((s) => {
          if (s.workspaces[wsId]) s.workspaces[wsId].tabIds = tabIds;
        });
      },

      reorderWorkspaces: (order) => {
        set((s) => {
          s.workspaceOrder = order;
        });
      },
    })),
    {
      name: "zynlex-workspaces",
      version: 2,
      migrate: (persistedState) => {
        const state = isRecord(persistedState)
          ? (persistedState as {
              workspaces?: unknown;
              workspaceOrder?: unknown;
              activeWorkspaceId?: unknown;
            })
          : {};

        const workspaces = sanitizeWorkspaceMap(
          isRecord(state.workspaces)
            ? (state.workspaces as Record<string, Partial<Workspace>>)
            : undefined,
        );

        const workspaceOrder = isStringArray(state.workspaceOrder)
          ? state.workspaceOrder.filter((id) => id in workspaces)
          : [INITIAL_WORKSPACE.id];

        if (!workspaceOrder.includes(INITIAL_WORKSPACE.id)) {
          workspaceOrder.unshift(INITIAL_WORKSPACE.id);
        }

        const activeWorkspaceId =
          typeof state.activeWorkspaceId === "string" && state.activeWorkspaceId in workspaces
            ? state.activeWorkspaceId
            : (workspaceOrder[0] ?? INITIAL_WORKSPACE.id);

        return {
          workspaces,
          workspaceOrder,
          activeWorkspaceId,
        };
      },
      partialize: (s) => ({
        workspaces: Object.fromEntries(
          Object.entries(s.workspaces).map(([workspaceId, workspace]) => [
            workspaceId,
            sanitizeWorkspace(workspaceId, workspace),
          ]),
        ),
        workspaceOrder: s.workspaceOrder,
        activeWorkspaceId: s.activeWorkspaceId,
      }),
      // Tab references are kept across restarts (session restore). Stale ids
      // with no matching tab in the session snapshot are dropped on read by
      // getLiveWorkspaceTabIds() in lib/workspaceTabs.ts.
      onRehydrateStorage: () => (_state, error) => {
        if (error) {
          console.error("[zynlex] Workspace persistence hydration failed:", error);
        }
      },
    },
  ),
);
