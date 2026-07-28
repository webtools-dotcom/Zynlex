import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { HistoryEntry } from "@/types";

const MAX_HISTORY = 100;

interface HistoryStore {
  entries: HistoryEntry[];
  addEntry: (entry: Omit<HistoryEntry, "id">) => void;
  removeEntry: (id: string) => void;
  clearForWorkspace: (workspaceId: string) => void;
  clearAll: () => void;
}

export const useHistoryStore = create<HistoryStore>()(
  persist(
    (set) => ({
      entries: [],
      addEntry: (entry) =>
        set((s) => {
          const newEntry: HistoryEntry = { ...entry, id: crypto.randomUUID() };
          const filtered = s.entries.filter(
            (e) => !(e.url === newEntry.url && e.workspaceId === newEntry.workspaceId),
          );
          return { entries: [newEntry, ...filtered].slice(0, MAX_HISTORY) };
        }),
      removeEntry: (id) => set((s) => ({ entries: s.entries.filter((e) => e.id !== id) })),
      clearForWorkspace: (workspaceId) =>
        set((s) => ({
          entries: s.entries.filter((e) => e.workspaceId !== workspaceId),
        })),
      clearAll: () => set({ entries: [] }),
    }),
    { name: "xevo-history" },
  ),
);
