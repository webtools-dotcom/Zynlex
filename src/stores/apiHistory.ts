/**
 * ApiHistory store — in-memory, session-only.
 *
 * Lifted out of ApiTester.tsx so the full-page modal and the sidebar
 * launcher card can share the same history. Newest first, capped at 50.
 */
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { ApiHistoryEntry } from "@/types";

function genId(): string {
  return `h-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

interface ApiHistoryStore {
  history: ApiHistoryEntry[];
  addHistory: (entry: Omit<ApiHistoryEntry, "id" | "createdAt">) => void;
  clearHistory: () => void;
}

export const useApiHistoryStore = create<ApiHistoryStore>()(
  immer((set) => ({
    history: [],
    addHistory: (entry) => {
      set((s) => {
        s.history.unshift({
          ...entry,
          id: genId(),
          createdAt: Date.now(),
        });
        if (s.history.length > 50) {
          s.history = s.history.slice(0, 50);
        }
      });
    },
    clearHistory: () => {
      set((s) => {
        s.history = [];
      });
    },
  }))
);
