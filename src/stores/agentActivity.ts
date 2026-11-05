import { create } from "zustand";

/** One agent tool call, as the activity panel lists it (roadmap S6). */
export interface AgentCall {
  id: number;
  /** When the call arrived (ms). */
  at: number;
  tool: string;
  /** The tab it ran against, when one could be told; null for tab-less calls. */
  tabId: string | null;
  /** Short id or URL for display; survives the tab closing. */
  tabLabel: string;
  /** Its arguments on one line. */
  summary: string;
  /** First line of the error it returned, or null on success. */
  error: string | null;
  /** How long it took, including any time held by a pause. */
  ms: number;
  /** Set when a pause held it: "ran after takeover" or "paused, not run". */
  note: string | null;
}

/** Most calls kept; older ones drop off. */
export const MAX_CALLS = 50;

const MAX_SUMMARY = 90;
const MAX_VALUE = 40;

function clip(s: string, max: number): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

/** `action=click ref=e12 text="hi"`: the arguments minus `tab` (shown in its own column). */
export function summarizeCall(args: Record<string, unknown>): string {
  const parts = Object.entries(args)
    .filter(([k, v]) => k !== "tab" && v !== undefined && v !== null && v !== "")
    .map(([k, v]) => {
      const text = typeof v === "string" ? JSON.stringify(clip(v, MAX_VALUE)) : JSON.stringify(v);
      // Bare words read better than quoted ones: action=click, not action="click".
      const bare = typeof v === "string" && /^[\w./:-]+$/.test(v) && v.length <= MAX_VALUE;
      return `${k}=${bare ? v : clip(text ?? String(v), MAX_VALUE)}`;
    });
  return clip(parts.join(" "), MAX_SUMMARY);
}

export const firstLine = (text: string) => clip(text.split("\n")[0] ?? "", 160);

interface AgentActivityState {
  /** Newest first. */
  calls: AgentCall[];
  /** Per tab id, when an agent last acted on it: the "agent was here" marker. */
  touched: Record<string, number>;
  record: (call: Omit<AgentCall, "id">, acted: boolean) => void;
  clear: () => void;
}

let nextId = 1;

export const useAgentActivityStore = create<AgentActivityState>()((set) => ({
  calls: [],
  touched: {},
  record: (call, acted) =>
    set((s) => ({
      calls: [{ ...call, id: nextId++ }, ...s.calls].slice(0, MAX_CALLS),
      touched: acted && call.tabId ? { ...s.touched, [call.tabId]: call.at } : s.touched,
    })),
  clear: () => set({ calls: [], touched: {} }),
}));
