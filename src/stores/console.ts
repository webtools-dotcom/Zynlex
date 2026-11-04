import { create } from "zustand";
import { recordEntry } from "@/lib/errorGroups";

/** One console message, as console.rs forwards it. */
export interface ConsoleEntry {
  id: string;
  tabId: string;
  /** log/info arrive only while an agent is connected (console.rs) and go to `logsByTab`. */
  level: "error" | "warning" | "info" | "log";
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
  /** Errors and warnings: what the Console panel and badges show. */
  entriesByTab: Record<string, ConsoleEntry[]>;
  /**
   * console.log/info, for an agent's `errors level=…` only. A list of its own,
   * so a chatty page can't push errors out of the cap, and never counted.
   */
  logsByTab: Record<string, ConsoleEntry[]>;
  /** Kept apart from the entries, so the cap never makes the badge undercount. */
  countsByTab: Record<string, ConsoleCounts>;
  add: (entry: Omit<ConsoleEntry, "id" | "ts" | "count">) => void;
  clearTab: (tabId: string) => void;
}

const MAX_ENTRIES_PER_TAB = 300;
const MAX_LOGS_PER_TAB = 200;
let nextId = 0;

export function isFailedRequest(e: Pick<ConsoleEntry, "level" | "source">): boolean {
  return e.level === "error" && e.source === "network";
}

/** Appends, collapsing an identical message in a row into a repeat count. */
function append(
  list: ConsoleEntry[],
  entry: Omit<ConsoleEntry, "id" | "ts" | "count">,
  max: number,
): ConsoleEntry[] {
  const last = list[list.length - 1];
  const repeat =
    last &&
    last.text === entry.text &&
    last.level === entry.level &&
    last.url === entry.url &&
    last.line === entry.line;
  return repeat
    ? [...list.slice(0, -1), { ...last, count: last.count + 1, ts: Date.now() }]
    : [...list, { ...entry, id: `con-${++nextId}`, ts: Date.now(), count: 1 }].slice(-max);
}

export const useConsoleStore = create<ConsoleStore>()((set) => ({
  entriesByTab: {},
  logsByTab: {},
  countsByTab: {},
  add: (entry) => {
    // The agent's grouped log, which outlives page loads (lib/errorGroups.ts).
    recordEntry(entry);
    set((s) => {
      if (entry.level === "info" || entry.level === "log") {
        const logs = append(s.logsByTab[entry.tabId] ?? [], entry, MAX_LOGS_PER_TAB);
        return { logsByTab: { ...s.logsByTab, [entry.tabId]: logs } };
      }
      const counts = { ...(s.countsByTab[entry.tabId] ?? NO_COUNTS) };
      if (isFailedRequest(entry)) counts.failed++;
      else if (entry.level === "error") counts.errors++;
      else counts.warnings++;

      const next = append(s.entriesByTab[entry.tabId] ?? [], entry, MAX_ENTRIES_PER_TAB);
      return {
        entriesByTab: { ...s.entriesByTab, [entry.tabId]: next },
        countsByTab: { ...s.countsByTab, [entry.tabId]: counts },
      };
    });
  },
  clearTab: (tabId) =>
    set((s) => {
      if (!s.entriesByTab[tabId] && !s.countsByTab[tabId] && !s.logsByTab[tabId]) return s;
      const { [tabId]: _e, ...entriesByTab } = s.entriesByTab;
      const { [tabId]: _l, ...logsByTab } = s.logsByTab;
      const { [tabId]: _c, ...countsByTab } = s.countsByTab;
      return { entriesByTab, logsByTab, countsByTab };
    }),
}));
