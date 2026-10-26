import { create } from "zustand";

/** One console message, as console.rs forwards it. */
export interface ConsoleEntry {
  id: string;
  tabId: string;
  level: "error" | "warning";
  /** "exception", "console", or Chromium's log source ("network", "security", …). */
  source: string;
  text: string;
  url: string;
  line: number | null;
  ts: number;
  /** Identical messages in a row collapse into one entry. */
  count: number;
}

interface ConsoleCounts {
  errors: number;
  warnings: number;
  /** Requests that failed or got a 4xx/5xx — Chromium logs these as network errors. */
  failed: number;
}

const NO_COUNTS: ConsoleCounts = { errors: 0, warnings: 0, failed: 0 };

interface ConsoleStore {
  entriesByTab: Record<string, ConsoleEntry[]>;
  /** Kept apart from the entries, so the cap never makes the badge undercount. */
  countsByTab: Record<string, ConsoleCounts>;
  add: (entry: Omit<ConsoleEntry, "id" | "ts" | "count">) => void;
  clearTab: (tabId: string) => void;
}

const MAX_ENTRIES_PER_TAB = 300;
let nextId = 0;

export function isFailedRequest(e: Pick<ConsoleEntry, "level" | "source">): boolean {
  return e.level === "error" && e.source === "network";
}

export const useConsoleStore = create<ConsoleStore>()((set) => ({
  entriesByTab: {},
  countsByTab: {},
  add: (entry) =>
    set((s) => {
      const counts = { ...(s.countsByTab[entry.tabId] ?? NO_COUNTS) };
      if (isFailedRequest(entry)) counts.failed++;
      else if (entry.level === "error") counts.errors++;
      else counts.warnings++;

      const list = s.entriesByTab[entry.tabId] ?? [];
      const last = list[list.length - 1];
      const repeat =
        last &&
        last.text === entry.text &&
        last.level === entry.level &&
        last.url === entry.url &&
        last.line === entry.line;
      const next = repeat
        ? [...list.slice(0, -1), { ...last, count: last.count + 1, ts: Date.now() }]
        : [...list, { ...entry, id: `con-${++nextId}`, ts: Date.now(), count: 1 }].slice(
            -MAX_ENTRIES_PER_TAB,
          );

      return {
        entriesByTab: { ...s.entriesByTab, [entry.tabId]: next },
        countsByTab: { ...s.countsByTab, [entry.tabId]: counts },
      };
    }),
  clearTab: (tabId) =>
    set((s) => {
      if (!s.entriesByTab[tabId] && !s.countsByTab[tabId]) return s;
      const { [tabId]: _e, ...entriesByTab } = s.entriesByTab;
      const { [tabId]: _c, ...countsByTab } = s.countsByTab;
      return { entriesByTab, countsByTab };
    }),
}));
