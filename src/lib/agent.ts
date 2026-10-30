/**
 * Answers AI-agent tool calls (see docs/agent-interface.md). Rust forwards each
 * call from zynlex-mcp as an `agent://request`; the reply goes back through
 * `agent_reply`. Everything is read from the stores the panels already use.
 *
 * Output is terse plain text: it lands in a model's context, so every line
 * costs tokens. Only localhost tabs are visible to an agent.
 */
import type { UnlistenFn } from "@tauri-apps/api/event";
import { getActiveTabId } from "@/hooks/useActiveScope";
import { isLoopbackUrl } from "@/lib/url";
import { useAgentStore } from "@/stores/agent";
import { type ConsoleEntry, isFailedRequest, useConsoleStore } from "@/stores/console";
import { type NetworkLogEntry, useNetworkStore } from "@/stores/network";
import { useServersStore } from "@/stores/servers";
import { useTabsStore } from "@/stores/tabs";
import {
  agentReply,
  captureScreenshot,
  getAgentStatus,
  onAgentRequest,
  onAgentStatus,
} from "@/services/browser";
import type { Tab } from "@/types";

type Args = Record<string, unknown>;

/** Short enough to type, long enough to stay unique across open tabs. */
const shortId = (t: Tab) => t.id.slice(0, 8);

/** Longest response body returned inline. */
const MAX_BODY = 8000;
/** Most rows a `network` list returns. */
const MAX_ROWS = 50;
/** Static assets: noise when debugging an app, so `network` hides them by default. */
const ASSET_TYPES = new Set(["script", "stylesheet", "image", "font", "media", "manifest"]);

function scopedTabs(): Tab[] {
  return Object.values(useTabsStore.getState().tabs).filter((t) => isLoopbackUrl(t.url));
}

/** The tab an id prefix names, else the active tab, else the most recently used localhost tab. */
export function resolveTab(arg: unknown): Tab {
  const tabs = scopedTabs();
  if (typeof arg === "string" && arg) {
    const hits = tabs.filter((t) => t.id.startsWith(arg));
    if (hits.length === 1) return hits[0];
    throw new Error(
      hits.length ? `Tab id "${arg}" is ambiguous.` : `No localhost tab "${arg}". Call tabs.`,
    );
  }
  const active = tabs.find((t) => t.id === getActiveTabId());
  if (active) return active;
  const recent = tabs.sort((a, b) => b.lastActiveAt - a.lastActiveAt)[0];
  if (recent) return recent;
  throw new Error(
    "No localhost tab is open. Ask the user to open their dev server in ZYNLEX (tabs lists running ones).",
  );
}

function header(t: Tab): string {
  return `${t.url} "${t.title}" [${shortId(t)}]${t.isLoading ? " (loading)" : ""}`;
}

/** Continuation lines of a multi-line message (stack traces) indented under it. */
function consoleLine(e: ConsoleEntry): string {
  // A failed request's text doesn't name the URL, so it's the part that matters;
  // an exception's stack usually already carries its location.
  const where = !e.url
    ? ""
    : isFailedRequest(e)
      ? ` ${e.url}`
      : e.text.includes(e.url)
        ? ""
        : ` (${e.url}${e.line != null ? `:${e.line}` : ""})`;
  const times = e.count > 1 ? ` ×${e.count}` : "";
  return `  ${e.text.replace(/\n/g, "\n    ")}${where}${times}`;
}

const netNum = (n: NetworkLogEntry) => Number(n.id.replace(/\D/g, "")) || 0;
const isFailedRow = (n: NetworkLogEntry) => n.statusCode >= 400;
const netLine = (n: NetworkLogEntry) =>
  `  ${n.id} ${n.method} ${n.statusCode} ${n.durationMs}ms ${n.resourceType} ${n.url}${n.mocked ? " (mocked)" : ""}`;

/**
 * Failed requests as two lists that don't repeat each other: network rows have
 * method and status but exist only while capture is on; the console's network
 * errors are always recorded, and cover requests that got no response at all.
 */
function failures(rows: NetworkLogEntry[], consoleFailed: ConsoleEntry[]): string[] {
  const failedRows = rows.filter(isFailedRow);
  const urls = new Set(failedRows.map((n) => n.url));
  return [
    ...failedRows.map(netLine),
    ...consoleFailed.filter((e) => !urls.has(e.url)).map(consoleLine),
  ];
}

function section(title: string, lines: string[]): string[] {
  return lines.length ? [`${lines.length} ${title}:`, ...lines] : [];
}

function tabsTool(): string {
  const tabs = scopedTabs();
  const counts = useConsoleStore.getState().countsByTab;
  const activeId = getActiveTabId();
  const lines = tabs.map((t) => {
    const c = counts[t.id];
    const problems = c && c.errors + c.failed ? ` — ${c.errors} errors, ${c.failed} failed` : "";
    return `${t.id === activeId ? "*" : " "} ${header(t)}${problems}`;
  });
  const open = new Set(tabs.map((t) => new URL(t.url).port));
  const idle = useServersStore
    .getState()
    .servers.filter((s) => s.isAlive && !open.has(String(s.port)))
    .map((s) => `  ${s.protocol}://localhost:${s.port}${s.title ? ` "${s.title}"` : ""}`);
  const hidden = Object.keys(useTabsStore.getState().tabs).length - tabs.length;
  return [
    tabs.length ? "Localhost tabs (* = active):" : "No localhost tabs open.",
    ...lines,
    ...section("dev servers without a tab", idle),
    hidden ? `${hidden} other tabs hidden (not localhost).` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Per tab, what `check` already reported: each console entry's repeat count
 * (an entry seen again with a higher count is news) and the newest network
 * row number. Ids, not timestamps: two messages in one millisecond are common.
 */
const cursors = new Map<string, { seen: Map<string, number>; net: number; at: number }>();

function checkTool(args: Args): string {
  const tab = resolveTab(args.tab);
  const since = cursors.get(tab.id);
  const entries = useConsoleStore.getState().entriesByTab[tab.id] ?? [];
  const rows = useNetworkStore.getState().entriesByTab[tab.id] ?? [];
  const fresh = entries.filter((e) => since?.seen.get(e.id) !== e.count);
  const freshRows = rows.filter((n) => netNum(n) > (since?.net ?? 0));
  cursors.set(tab.id, {
    seen: new Map(entries.map((e) => [e.id, e.count])),
    net: Math.max(since?.net ?? 0, ...rows.map(netNum)),
    at: Date.now(),
  });

  const errors = fresh.filter((e) => e.level === "error" && !isFailedRequest(e)).map(consoleLine);
  const failed = failures(freshRows, fresh.filter(isFailedRequest));
  const when = since
    ? `Since last check ${Math.round((Date.now() - since.at) / 1000)}s ago:`
    : "First check, everything recorded so far:";
  const body = [...section("errors", errors), ...section("failed requests", failed)];
  return [header(tab), when, ...(body.length ? body : ["No new errors or failed requests."])].join(
    "\n",
  );
}

function errorsTool(args: Args): string {
  const tab = resolveTab(args.tab);
  const entries = useConsoleStore.getState().entriesByTab[tab.id] ?? [];
  const rows = useNetworkStore.getState().entriesByTab[tab.id] ?? [];
  const errors = entries.filter((e) => e.level === "error" && !isFailedRequest(e)).map(consoleLine);
  const warnings = entries.filter((e) => e.level === "warning");
  const body = [
    ...section("errors", errors),
    ...section("failed requests", failures(rows, entries.filter(isFailedRequest))),
    ...(args.warnings ? section("warnings", warnings.map(consoleLine)) : []),
  ];
  return [
    header(tab),
    ...(body.length ? body : ["No errors or failed requests recorded."]),
    !args.warnings && warnings.length
      ? `(${warnings.length} warnings hidden; pass warnings=true)`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function requestDetail(n: NetworkLogEntry): string {
  const body = n.bodyEvicted
    ? "(body dropped to save memory; only the 50 newest requests keep theirs)"
    : n.body.length > MAX_BODY
      ? `${n.body.slice(0, MAX_BODY)}\n… (${n.body.length - MAX_BODY} more chars cut)`
      : n.body || "(empty)";
  return [
    `${n.method} ${n.statusCode} ${n.reasonPhrase} ${n.url}`.trim(),
    `${n.resourceType}, ${n.durationMs}ms${n.mocked ? ", served by a ZYNLEX mock" : ""}${n.bodyTruncated ? ", body capped at 64 KB" : ""}`,
    "Response headers:",
    ...n.headers.map(([k, v]) => `  ${k}: ${v}`),
    "Body:",
    body,
  ].join("\n");
}

function networkTool(args: Args): string {
  const tab = resolveTab(args.tab);
  const rows = useNetworkStore.getState().entriesByTab[tab.id] ?? [];
  if (typeof args.id === "string" && args.id) {
    const hit = rows.find((n) => n.id === args.id);
    if (!hit) throw new Error(`No request ${args.id} in this tab.`);
    return requestDetail(hit);
  }
  if (!rows.length) {
    return `${header(tab)}\nNo requests recorded. Capture starts when an agent connects; requests the page made before that aren't here (failed ones are, in errors).`;
  }
  const match = typeof args.match === "string" ? args.match.toLowerCase() : "";
  const shown = rows.filter(
    (n) =>
      (args.all || !ASSET_TYPES.has(n.resourceType)) &&
      (!args.failed || isFailedRow(n)) &&
      (!match || n.url.toLowerCase().includes(match)),
  );
  const rest = shown.length - MAX_ROWS;
  return [
    header(tab),
    ...(shown.length ? shown.slice(-MAX_ROWS).map(netLine) : ["No matching requests."]),
    rest > 0 ? `(${rest} older not shown; narrow with match)` : "",
    "id method status time type url. Pass id for headers and body.",
  ]
    .filter(Boolean)
    .join("\n");
}

async function screenshotTool(args: Args): Promise<string> {
  const tab = resolveTab(args.tab);
  const path = await captureScreenshot(tab.id, "agent");
  return `${header(tab)}\nSaved ${path}`;
}

export async function runAgentTool(tool: string, args: Args): Promise<string> {
  switch (tool) {
    case "tabs":
      return tabsTool();
    case "check":
      return checkTool(args);
    case "errors":
      return errorsTool(args);
    case "network":
      return networkTool(args);
    case "screenshot":
      return screenshotTool(args);
    default:
      throw new Error(`Unknown tool "${tool}".`);
  }
}

/** Subscribes the dispatcher and the status mirror. */
export function listenForAgents(): Promise<UnlistenFn>[] {
  getAgentStatus()
    .then((s) => useAgentStore.setState(s))
    .catch(() => {});
  return [
    onAgentStatus((s) => useAgentStore.setState(s)),
    onAgentRequest(async ({ id, tool, args }) => {
      let ok = true;
      let text: string;
      try {
        text = await runAgentTool(tool, args ?? {});
      } catch (err) {
        ok = false;
        text = err instanceof Error ? err.message : String(err);
      }
      agentReply(id, ok, text).catch(() => {});
    }),
  ];
}
