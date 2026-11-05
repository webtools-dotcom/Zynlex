import { create } from "zustand";

/** An element the developer pointed at for the agent, with their note. */
export interface AgentFlag {
  id: number;
  tabId: string;
  /** The agent's ref for it: `e` + backendDOMNodeId, the same as a snapshot's. */
  ref: string;
  /** From the accessibility tree ("button"), or the tag name when it has no useful role. */
  role: string;
  /** Accessible name; may be empty. */
  name: string;
  note: string;
}

/** The element picked in a "Flag for agent" flow, waiting for its note. */
export type FlagTarget = Pick<AgentFlag, "ref" | "role" | "name">;

/**
 * A "Flag for agent" flow in progress: inspect mode on in `tabId` until the
 * developer clicks something (`target` unset), then the note input.
 */
interface FlagPick {
  tabId: string;
  target?: FlagTarget;
}

interface AgentFlagsStore {
  /** Waiting for the next agent call that touches their tab, oldest first. */
  flags: AgentFlag[];
  pick: FlagPick | null;
  add: (flag: Omit<AgentFlag, "id">) => void;
  /** Removes and returns the flags on these tabs, so each is delivered once. */
  take: (tabIds: string[]) => AgentFlag[];
  clear: () => void;
  setPick: (pick: FlagPick | null) => void;
}

let nextId = 1;

/** Not persisted: a flag is about the page as it is now, and a restart reloads it. */
export const useAgentFlagsStore = create<AgentFlagsStore>()((set, get) => ({
  flags: [],
  pick: null,
  add: (flag) => set((s) => ({ flags: [...s.flags, { ...flag, id: nextId++ }] })),
  take: (tabIds) => {
    const want = new Set(tabIds);
    const taken = get().flags.filter((f) => want.has(f.tabId));
    if (taken.length) set((s) => ({ flags: s.flags.filter((f) => !want.has(f.tabId)) }));
    return taken;
  },
  clear: () => set({ flags: [] }),
  setPick: (pick) => set({ pick }),
}));
