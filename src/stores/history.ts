import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { HistoryEntry } from "@/types";

const MAX_HISTORY = 1000;

interface HistoryStore {
  entries: HistoryEntry[];
  addEntry: (entry: Omit<HistoryEntry, "id">) => void;
  /** The page's real title arrives after its URL — patch it onto the entry. */
  setTitle: (url: string, workspaceId: string, title: string) => void;
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
      setTitle: (url, workspaceId, title) =>
        set((s) => {
          const i = s.entries.findIndex((e) => e.url === url && e.workspaceId === workspaceId);
          if (i === -1 || !title || s.entries[i].title === title) return s;
          const entries = [...s.entries];
          entries[i] = { ...entries[i], title };
          return { entries };
        }),
      removeEntry: (id) => set((s) => ({ entries: s.entries.filter((e) => e.id !== id) })),
      clearForWorkspace: (workspaceId) =>
        set((s) => ({
          entries: s.entries.filter((e) => e.workspaceId !== workspaceId),
        })),
      clearAll: () => set({ entries: [] }),
    }),
    { name: "zynlex-history" },
  ),
);
