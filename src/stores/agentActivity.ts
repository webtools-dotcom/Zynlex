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
  /** For `act`, what it did, by role and name ("Clicked button "Export""); else "". */
  what: string;
  /** What it caused, in a few words ("+ status "Exported 6 orders" · 1 new error"); "" when not told. */
  outcome: string;
  /** The agent's own reason (`act` why), or "". */
  why: string;
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

/** `action=click ref=e12 text="hi"`: the arguments minus `tab` and `why` (shown on their own). */
export function summarizeCall(args: Record<string, unknown>): string {
  const parts = Object.entries(args)
    .filter(([k, v]) => k !== "tab" && k !== "why" && v !== undefined && v !== null && v !== "")
    .map(([k, v]) => {
      const text = typeof v === "string" ? JSON.stringify(clip(v, MAX_VALUE)) : JSON.stringify(v);
      // Bare words read better than quoted ones: action=click, not action="click".
      const bare = typeof v === "string" && /^[\w./:-]+$/.test(v) && v.length <= MAX_VALUE;
      return `${k}=${bare ? v : clip(text ?? String(v), MAX_VALUE)}`;
    });
  return clip(parts.join(" "), MAX_SUMMARY);
}

export const firstLine = (text: string) => clip(text.split("\n")[0] ?? "", 160);

/** The lines an `act` reply opens with, one per action (agent.ts doStep / answerDialog). */
const DID =
  /^(Clicked|Typed|Selected|Pressed|Hovered|Dragged|Attached|Went|Accepted|Dismissed|Stopped before) /;
const noRef = (l: string) => l.replace(/ \[e\d+\]/g, "");

/** What an `act` did, from its reply: `Clicked button "Export" · Typed "a" into textbox "Email"`. */
export function actDid(reply: string): string {
  return clip(
    reply
      .split("\n")
      .filter((l) => DID.test(l))
      .map(noRef)
      .join(" · "),
    200,
  );
}

/** Diff lines worth naming first: messages and headings say what happened. */
const TELLING = /^[+-] (alert|status|heading|h\d|dialog)\b/;

/**
 * What a call caused, from the reply of an action or `check`: where it
 * navigated, tabs it opened, an open dialog, the most telling page change and
 * how many more, new errors and failed requests.
 */
export function outcomeOf(reply: string): string {
  const lines = reply.split("\n");
  const out: string[] = [];
  const nav = lines.find((l) => l.startsWith("Navigated to "));
  if (nav) out.push(`→ ${nav.slice("Navigated to ".length)}`);
  const tabs = lines.filter((l) => l.startsWith("Opened new tab")).length;
  if (tabs) out.push(tabs === 1 ? "opened a tab" : `opened ${tabs} tabs`);
  for (const l of lines) {
    const d = /^(Downloaded|Downloading|Download failed:) (\S+)/.exec(l);
    if (d)
      out.push(`${d[1] === "Download failed:" ? "download failed" : d[1].toLowerCase()} ${d[2]}`);
  }
  const dialog = /^A (\w+) dialog is open/m.exec(reply);
  if (dialog) out.push(`${dialog[1]} dialog open`);
  if (lines.some((l) => l.startsWith("Not settled"))) out.push("not settled");
  const at = lines.indexOf("Page changes:");
  if (at >= 0) {
    const diff = lines.slice(at + 1).filter((l) => /^[+-] /.test(l));
    const top = diff.find((l) => TELLING.test(l)) ?? diff.find((l) => l.startsWith("+")) ?? diff[0];
    if (top) {
      const more = diff.length - 1;
      out.push(`${clip(noRef(top), 60)}${more ? ` (+${more} more)` : ""}`);
    }
  } else if (lines.includes("Page unchanged.")) {
    out.push("page unchanged");
  } else if (!nav && lines.includes("Page:") && lines.some((l) => DID.test(l))) {
    out.push("page redrawn");
  }
  let errors = 0;
  let failed = 0;
  for (const l of lines) {
    const m = /^(\d+) (errors|failed requests):$/.exec(l);
    if (m) {
      if (m[2] === "errors") errors += Number(m[1]);
      else failed += Number(m[1]);
    }
  }
  if (errors) out.push(`${errors} new error${errors > 1 ? "s" : ""}`);
  if (failed) out.push(`${failed} failed request${failed > 1 ? "s" : ""}`);
  if (!errors && !failed && lines.includes("No new errors or failed requests.")) {
    out.push("no new errors");
  }
  return out.join(" · ");
}

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
