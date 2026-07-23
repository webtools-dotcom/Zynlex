/**
 * ApiHistory store — persisted across restarts.
 *
 * Lifted out of ApiTester.tsx so the full-page modal and the sidebar
 * launcher card can share the same history. Newest first, capped at 100.
 */
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { persist } from "zustand/middleware";
import type { ApiHistoryEntry } from "@/types";

const MAX_HISTORY = 100;

function genId(): string {
  return `h-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

interface ApiHistoryStore {
  history: ApiHistoryEntry[];
  addHistory: (entry: Omit<ApiHistoryEntry, "id" | "createdAt">) => void;
  clearHistory: () => void;
}

export const useApiHistoryStore = create<ApiHistoryStore>()(
  persist(
    immer((set) => ({
      history: [],
      addHistory: (entry) => {
        set((s) => {
          s.history.unshift({
            ...entry,
            id: genId(),
            createdAt: Date.now(),
          });
          if (s.history.length > MAX_HISTORY) {
            s.history = s.history.slice(0, MAX_HISTORY);
          }
        });
      },
      clearHistory: () => {
        set((s) => {
          s.history = [];
        });
      },
    })),
    {
      name: "xevo-api-history",
      version: 1,
      partialize: (s) => ({ history: s.history }) as unknown as ApiHistoryStore,
    }
  )
);
