import { create } from "zustand";
import { persist } from "zustand/middleware";

/** A bit of the user's JavaScript, run in the active tab as a command. */
export interface Snippet {
  id: string;
  name: string;
  code: string;
}

interface SnippetsStore {
  snippets: Snippet[];
  add: (snippet: Snippet) => void;
  update: (id: string, patch: Partial<Snippet>) => void;
  remove: (id: string) => void;
}

export const useSnippetsStore = create<SnippetsStore>()(
  persist(
    (set) => ({
      snippets: [],
      add: (snippet) => set((s) => ({ snippets: [...s.snippets, snippet] })),
      update: (id, patch) =>
        set((s) => ({ snippets: s.snippets.map((x) => (x.id === id ? { ...x, ...patch } : x)) })),
      remove: (id) => set((s) => ({ snippets: s.snippets.filter((x) => x.id !== id) })),
    }),
    { name: "zynlex-snippets", version: 1 },
  ),
);
