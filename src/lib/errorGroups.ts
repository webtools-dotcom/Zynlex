/**
 * Errors and failed requests per tab, grouped for an agent (roadmap M6, M3).
 *
 * The console store keeps only the current page's entries (a page load clears
 * them, for the badge). This log is fed from the same `add` but outlives page
 * loads, so an agent sees what the page logged before it connected and how
 * often an error came back across reloads. Only closing the tab drops it.
 *
 * Identical problems collapse into one group: an error by its message with
 * numbers, ids and URL query strings normalised, plus its source location; a
 * failed request by method + URL path + status. Each group remembers how much
 * of it the agent was already shown, so a repeat costs one short `(+3)` line.
 */
import type { ConsoleEntry } from "@/stores/console";
import type { NetworkLogEntry } from "@/stores/network";

type Recorded = Pick<ConsoleEntry, "tabId" | "level" | "source" | "text" | "url" | "line">;

interface Group {
  failed: boolean;
  /** The first occurrence, as shown. */
  text: string;
  url: string;
  line: number | null;
  /** Failed requests only: "500", "net::ERR_CONNECTION_REFUSED" or "" (not stated). */
  status: string;
  count: number;
  firstTs: number;
  /** Page loads it appeared in. */
  loads: number;
  lastLoad: number;
  /** Per agent (its client id), how many of `count` it has been shown. */
  reported: Map<number, number>;
}

interface TabLog {
  /** Page loads so far; groups note the one they were last seen in. */
  load: number;
  groups: Map<string, Group>;
  /** Failed network rows each agent was shown, by `${client} ${key}` (rows only exist while capture is on). */
  rowsReported: Map<string, number>;
}

/** Oldest-seen groups go first past this; matches the console store's cap. */
const MAX_GROUPS_PER_TAB = 300;

const logs = new Map<string, TabLog>();

function logFor(tabId: string): TabLog {
  let log = logs.get(tabId);
  if (!log) {
    log = { load: 0, groups: new Map(), rowsReported: new Map() };
    logs.set(tabId, log);
  }
  return log;
}

/** A URL without its query string and fragment. */
const urlPath = (url: string) => url.split(/[?#]/)[0];

/**
 * A message reduced to what stays the same between occurrences: URLs lose
 * their query and fragment (cache busters, tokens), uuids and long hex ids
 * become `<id>`, standalone numbers `<n>`.
 */
export function normalizeMessage(text: string): string {
  return (
    text
      // The query only: a stack frame's ":42:7" after it stays.
      .replace(/\b[a-z][\w+.-]*:\/\/[^\s'"()<>]+/gi, (u) => u.replace(/[?#][^\s:'"()<>]*/, ""))
      .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<id>")
      .replace(/\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{8,}\b/gi, "<id>")
      .replace(/\b\d+(?:\.\d+)?\b/g, "<n>")
  );
}

/** A failed request's status, from Chromium's console text. */
export function statusOf(text: string): string {
  return text.match(/status of (\d{3})\b/)?.[1] ?? text.match(/net::ERR_\w+/)?.[0] ?? "";
}

const isFailedRequestEntry = (e: Pick<Recorded, "level" | "source">) =>
  e.level === "error" && e.source === "network";

/** Group key: errors by normalised message and location, failures by URL path and status. */
export function groupKey(e: Omit<Recorded, "tabId">): string {
  return isFailedRequestEntry(e)
    ? `failed ${urlPath(e.url)} ${statusOf(e.text)}`
    : `error ${normalizeMessage(e.text)} @${urlPath(e.url)}:${e.line ?? ""}`;
}

/** Records one console entry. Only errors (failed requests included) are kept. */
export function recordEntry(e: Recorded, ts = Date.now()): void {
  if (e.level !== "error") return;
  const log = logFor(e.tabId);
  const key = groupKey(e);
  const g = log.groups.get(key);
  if (g) {
    g.count++;
    if (g.lastLoad !== log.load) {
      g.loads++;
      g.lastLoad = log.load;
    }
    // Re-inserted, so the map's order is least recently seen first.
    log.groups.delete(key);
    log.groups.set(key, g);
    return;
  }
  const failed = isFailedRequestEntry(e);
  log.groups.set(key, {
    failed,
    text: e.text,
    url: e.url,
    line: e.line,
    status: failed ? statusOf(e.text) : "",
    count: 1,
    firstTs: ts,
    loads: 1,
    lastLoad: log.load,
    reported: new Map(),
  });
  if (log.groups.size > MAX_GROUPS_PER_TAB) {
    log.groups.delete(log.groups.keys().next().value as string);
  }
}

/** A page started loading in the tab (reloads included). */
export function notePageLoad(tabId: string): void {
  logFor(tabId).load++;
}

/** The tab is gone. */
export function forgetTab(tabId: string): void {
  logs.delete(tabId);
}

/** Every agent left: the next one to connect starts from nothing reported. */
export function forgetReported(): void {
  for (const log of logs.values()) {
    log.rowsReported.clear();
    for (const g of log.groups.values()) g.reported.clear();
  }
}

/** The browser's own favicon probe isn't the app's failure (console.rs drops it too). */
export const isFailedRow = (n: NetworkLogEntry) =>
  n.statusCode >= 400 && !/\/favicon\.ico$/.test(urlPath(n.url));

/** One line's worth of problem, ready to report. */
export interface Problem {
  failed: boolean;
  /** First line, with location (errors) or method/status/URL (failures). */
  head: string;
  /** Continuation lines (a stack), already indented; "" for none. */
  rest: string;
  count: number;
  /** When first seen; null for a network row with no console line behind it. */
  firstTs: number | null;
  loads: number;
  /** Seen on the page that's loaded now. */
  current: boolean;
  reported: number;
  /** Marks all of `count` as shown to the agent. */
  markReported: () => void;
}

/** `url` without `origin` when it's on the tab's own origin: "/api/cart". */
function short(url: string, origin: string): string {
  return origin && url.startsWith(`${origin}/`) ? url.slice(origin.length) : url;
}

function errorProblem(g: Group, log: TabLog, origin: string, client: number): Problem {
  const [first, ...more] = g.text.split("\n");
  // An exception's stack usually already names the file.
  const where =
    !g.url || g.text.includes(urlPath(g.url))
      ? ""
      : ` at ${short(urlPath(g.url), origin)}${g.line != null ? `:${g.line}` : ""}`;
  return {
    failed: false,
    head: `${first}${where}`,
    rest: more.map((l) => `\n    ${l}`).join(""),
    count: g.count,
    firstTs: g.firstTs,
    loads: g.loads,
    current: g.lastLoad === log.load,
    reported: g.reported.get(client) ?? 0,
    markReported: () => {
      g.reported.set(client, g.count);
    },
  };
}

function consoleFailureHead(g: Group, origin: string): string {
  const url = short(g.url, origin);
  if (g.status) return `${g.status} ${url}`;
  return g.text.includes(g.url) ? g.text : `${g.text} ${url}`;
}

/**
 * Every error and failed request of the tab, grouped. Failed requests come
 * from two places that mustn't repeat each other: the console's (always
 * recorded, before the agent too, but without a method) and the network rows
 * (method and id, only while capture is on). A row group takes over the
 * console group with the same path and status, and its count is the larger of
 * the two, since both usually saw the same requests.
 */
export function tabProblems(
  tabId: string,
  rows: NetworkLogEntry[],
  origin: string,
  client = 0,
): Problem[] {
  const log = logFor(tabId);
  const groups = [...log.groups.values()].sort((a, b) => a.firstTs - b.firstTs);
  const failedGroups = groups.filter((g) => g.failed);

  const rowGroups = new Map<string, NetworkLogEntry[]>();
  for (const n of rows.filter(isFailedRow)) {
    const key = `${n.method} ${urlPath(n.url)} ${n.statusCode}`;
    rowGroups.set(key, [...(rowGroups.get(key) ?? []), n]);
  }
  const absorbed = new Set<Group>();
  const fromRows: Problem[] = [...rowGroups].map(([key, same]) => {
    const last = same[same.length - 1];
    const path = urlPath(last.url);
    const status = String(last.statusCode);
    // The console's text may not state the status; then the path alone matches.
    const g = failedGroups.find(
      (c) => !absorbed.has(c) && urlPath(c.url) === path && (c.status === status || !c.status),
    );
    if (g) absorbed.add(g);
    const count = Math.max(same.length, g?.count ?? 0);
    return {
      failed: true,
      head: `${last.id} ${last.method} ${status} ${short(last.url, origin)}${last.mocked ? " (mocked)" : ""}`,
      rest: "",
      count,
      firstTs: g?.firstTs ?? null,
      loads: g?.loads ?? 1,
      current: true,
      reported: Math.max(
        g?.reported.get(client) ?? 0,
        log.rowsReported.get(`${client} ${key}`) ?? 0,
      ),
      markReported: () => {
        log.rowsReported.set(`${client} ${key}`, count);
        g?.reported.set(client, g.count);
      },
    };
  });

  return [
    ...groups.filter((g) => !g.failed).map((g) => errorProblem(g, log, origin, client)),
    ...fromRows,
    ...failedGroups
      .filter((g) => !absorbed.has(g))
      .map((g) => ({
        ...errorProblem(g, log, origin, client),
        failed: true,
        head: consoleFailureHead(g, origin),
        rest: "",
      })),
  ];
}

/** "14:02", local time. */
export const clock = (ts: number) => new Date(ts).toTimeString().slice(0, 5);

/**
 * One problem as report lines. `delta` (for `check`): one already shown is
 * just its head and how many more times it happened.
 */
export function problemLine(p: Problem, delta: boolean): string {
  if (delta && p.reported > 0) return `  ${p.head} (+${p.count - p.reported})`;
  const extra = [
    p.count > 1 ? `×${p.count}${p.firstTs != null ? ` since ${clock(p.firstTs)}` : ""}` : "",
    p.loads > 1 ? `across ${p.loads} page loads` : "",
  ].filter(Boolean);
  return `  ${p.head}${extra.length ? ` (${extra.join(", ")})` : ""}${p.rest}`;
}

function sections(list: Problem[], delta: boolean): string[] {
  const out: string[] = [];
  for (const [failed, title] of [
    [false, "errors"],
    [true, "failed requests"],
  ] as const) {
    const lines = list.filter((p) => p.failed === failed).map((p) => problemLine(p, delta));
    if (lines.length) out.push(`${lines.length} ${title}:`, ...lines);
  }
  return out;
}

/**
 * The report, and everything in it marked as shown. `delta`: only what's new
 * or grew since the last report (`check`, actions); otherwise what the current
 * page logged plus anything not yet shown (`errors`). Problems first seen
 * before `connectedAt` and never shown go under their own header, which so
 * appears only on the agent's first look at the tab.
 */
export function report(problems: Problem[], delta: boolean, connectedAt: number | null): string[] {
  const shown = problems.filter((p) => p.count > p.reported || (!delta && p.current));
  const before = shown.filter(
    (p) => p.reported === 0 && connectedAt != null && p.firstTs != null && p.firstTs < connectedAt,
  );
  const after = shown.filter((p) => !before.includes(p));
  for (const p of shown) p.markReported();
  if (!before.length) return sections(after, delta);
  return [
    "Before you connected:",
    ...sections(before, delta),
    ...(after.length ? ["Since you connected:", ...sections(after, delta)] : []),
  ];
}
