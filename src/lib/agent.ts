/**
 * Answers AI-agent tool calls (see docs/agent-interface.md). Rust forwards each
 * call from zynlex-mcp as an `agent://request`; the reply goes back through
 * `agent_reply`. Everything is read from the stores the panels already use.
 *
 * Output is terse plain text: it lands in a model's context, so every line
 * costs tokens. Only localhost tabs, and environments the developer granted
 * (agentScope.ts), are visible to an agent. Every call that
 * acts on a page returns what the action caused, so the agent never needs a
 * second call to find out.
 */
import type { UnlistenFn } from "@tauri-apps/api/event";
import { DEVICE_PRESETS, type DevicePreset } from "@/components/panels/ViewportPresets";
import { getActiveTabId } from "@/hooks/useActiveScope";
import { withFlags } from "@/lib/agentFlags";
import { clipRect, cutForInline, MAX_BODY, MAX_LINES, uploadPaths } from "@/lib/agentOutput";
import {
  actsOnPage,
  cancelPause,
  holdWhilePaused,
  PAUSED_REPLY,
  tookOverLine,
} from "@/lib/agentPause";
import { dropAgentRules, mockTool } from "@/lib/agentRules";
import { agentCanUse, SCOPE } from "@/lib/agentScope";
import {
  type AXNode,
  diffSnapshot,
  type FrameTrees,
  formatSnapshot,
  isIframe,
  mergeFrames,
} from "@/lib/agentSnapshot";
import {
  forgetAgentTab,
  isAgentOpened,
  markAgentOpened,
  popupMark,
  takePopups,
} from "@/lib/agentTabs";
import { forgetReported, isFailedRow, report, tabProblems } from "@/lib/errorGroups";
import { recordingTool } from "@/lib/recorder";
import { closeTab, openTab } from "@/lib/tabActions";
import { isLoopbackUrl } from "@/lib/url";
import {
  type AgentStatus,
  agentReady,
  agentReply,
  agentWriteTemp,
  captureScreenshot,
  getAgentStatus,
  onAgentRequest,
  onAgentStatus,
  onDialog,
  type PortOwner,
  pendingRequests,
  portOwners,
  revealWindow,
  tabCdp,
  webviewReload,
} from "@/services/browser";
import { useAgentStore } from "@/stores/agent";
import {
  actDid,
  firstLine,
  outcomeOf,
  summarizeCall,
  useAgentActivityStore,
} from "@/stores/agentActivity";
import { useAgentFlagsStore } from "@/stores/agentFlags";
import { type ConsoleEntry, useConsoleStore } from "@/stores/console";
import { type DownloadItem, useDownloadsStore } from "@/stores/downloads";
import {
  MAX_FRAMES as MAX_WS_FRAMES,
  type NetworkLogEntry,
  type SocketLog,
  useNetworkStore,
  withBody,
} from "@/stores/network";
import { useServersStore } from "@/stores/servers";
import { useTabsStore } from "@/stores/tabs";
import { useWorkspacesStore } from "@/stores/workspaces";
import type { Tab } from "@/types";

type Args = Record<string, unknown>;

/** Short enough to type, long enough to stay unique across open tabs. */
const shortId = (t: Tab) => t.id.slice(0, 8);

/** Most rows a `network` list returns. */
const MAX_ROWS = 50;
/** Static assets: noise when debugging an app, so `network` hides them by default. */
const ASSET_TYPES = new Set(["script", "stylesheet", "image", "font", "media", "manifest"]);

function scopedTabs(): Tab[] {
  return Object.values(useTabsStore.getState().tabs).filter((t) =>
    agentCanUse(t.url, t.workspaceId),
  );
}

/** The tab an id prefix names, else the active tab, else the most recently used one in scope. */
export function resolveTab(arg: unknown): Tab {
  const tabs = scopedTabs();
  if (typeof arg === "string" && arg) {
    const hits = tabs.filter((t) => t.id.startsWith(arg));
    if (hits.length === 1) return hits[0];
    throw new Error(
      hits.length ? `Tab id "${arg}" is ambiguous.` : `No tab "${arg}" you can use. Call tabs.`,
    );
  }
  const active = tabs.find((t) => t.id === getActiveTabId());
  if (active) return active;
  const recent = tabs.sort((a, b) => b.lastActiveAt - a.lastActiveAt)[0];
  if (recent) return recent;
  throw new Error(
    `No tab you can use is open (${SCOPE}). Ask the user to open their dev server in ZYNLEX (tabs lists running ones).`,
  );
}

/**
 * A tab as one agent sees it. Several agents can be connected at once, each
 * with its own pipe session (`client`); what each was last shown of a tab
 * (snapshot, check cursor, errors) is its own, so one agent's look never
 * hides a change or an error from another.
 */
type AgentTab = Tab & { client?: number };

/** The agent's id, carried on a call's args under a key that's never shown or logged. */
const CLIENT = Symbol("client");
const clientOf = (args: Args) => ((args as Record<symbol, unknown>)[CLIENT] as number) ?? 0;

/** `resolveTab`, as seen by the agent making the call. */
const tabOf = (args: Args): AgentTab => ({ ...resolveTab(args.tab), client: clientOf(args) });

/** Key for an agent's own view of a tab. */
const view = (t: AgentTab) => `${t.client ?? 0}:${t.id}`;

/** Drops every agent's view of a tab. */
function forgetViews(tabId: string): void {
  for (const m of [snapshots, cursors]) {
    for (const k of m.keys()) if (k.endsWith(`:${tabId}`)) m.delete(k);
  }
}

function header(t: Tab): string {
  const vp = emulated.get(t.id);
  const as = vp ? ` (as ${vp.label}, ${vp.width}×${vp.height})` : "";
  return `${t.url} "${t.title}" [${shortId(t)}]${as}${t.isLoading ? " (loading)" : ""}`;
}

/**
 * Per tab, the device an agent is emulating, plus the user agent the tab had
 * before (navigator.userAgent, which includes a ZYNLEX user-agent setting),
 * so `reset` puts back exactly what was there.
 */
const emulated = new Map<string, DevicePreset & { originalUa: string }>();

const ALL_DEVICES = Object.values(DEVICE_PRESETS).flat();

/** A preset by name, forgiving about case and spacing ("iphone16" finds "iPhone 16"); exact matches win. */
export function findDevice(name: string): DevicePreset | undefined {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const want = norm(name);
  return (
    ALL_DEVICES.find((d) => norm(d.label) === want) ??
    ALL_DEVICES.find((d) => norm(d.label).startsWith(want))
  );
}

/** Continuation lines of a multi-line message (stack traces) indented under it. */
function consoleLine(e: ConsoleEntry): string {
  // A stack usually already carries its location.
  const where =
    !e.url || e.text.includes(e.url) ? "" : ` (${e.url}${e.line != null ? `:${e.line}` : ""})`;
  const times = e.count > 1 ? ` ×${e.count}` : "";
  return `  ${e.text.replace(/\n/g, "\n    ")}${where}${times}`;
}

const netLine = (n: NetworkLogEntry) =>
  `  ${n.id} ${n.method} ${n.statusCode} ${n.durationMs}ms ${n.resourceType} ${n.url}${n.mocked ? " (mocked)" : ""}`;

function section(title: string, lines: string[]): string[] {
  return lines.length ? [`${lines.length} ${title}:`, ...lines] : [];
}

/**
 * `text` as is when it fits `limit`; otherwise its head, and the whole of it
 * written to %TEMP%\zynlex-agent for the agent to read if it needs the rest.
 */
async function inlineOrFile(
  text: string,
  name: string,
  limit: { lines: number } | { chars: number },
  hint = "",
): Promise<string> {
  const cut = cutForInline(text, limit);
  if (!cut) return text;
  const where = await agentWriteTemp(`${name}-${Date.now()}`, text).then(
    (path) => `all of it is in ${path}`,
    (err) => `couldn't write it to a file (${err instanceof Error ? err.message : String(err)})`,
  );
  return `${cut.head}\n… ${cut.more}; ${where}.${hint}`;
}

/** A snapshot for the agent: the first MAX_LINES lines, the rest in a file. */
const showPage = (tab: Tab, text: string) =>
  inlineOrFile(
    text,
    `snapshot-${shortId(tab)}`,
    { lines: MAX_LINES },
    " Or pass within=<ref of a landmark> to see one part.",
  );

/** How long ago, roughly: "40s", "12m", "3h", "2d". */
function age(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

/**
 * Who serves a port, so an agent can tell its own project's dev server from
 * a stale one: `node.exe in D:\work\shop (pid 4120, up 2h)`. Several when
 * IPv4 and IPv6 are held by different processes.
 */
export function ownerText(owners: PortOwner[], now: number): string {
  return owners
    .map((o) => {
      if (!o.name) return `pid ${o.pid} (another user's or elevated, can't read it)`;
      const up = o.startedMs == null ? "" : `, up ${age(now - o.startedMs)}`;
      return `${o.name}${o.cwd ? ` in ${o.cwd}` : ""} (pid ${o.pid}${up})`;
    })
    .join("; ");
}

/** The port a URL's server listens on; null for one not on this machine. */
function localPort(url: string): number | null {
  if (!isLoopbackUrl(url)) return null;
  try {
    const u = new URL(url);
    return Number(u.port || (u.protocol === "https:" ? 443 : 80));
  } catch {
    return null;
  }
}

async function tabsTool(args: Args = {}): Promise<string> {
  if (typeof args.close === "string" && args.close) return closeAgentTab(args.close);
  const tabs = scopedTabs();
  const counts = useConsoleStore.getState().countsByTab;
  const activeId = getActiveTabId();
  const open = new Set(tabs.map((t) => new URL(t.url).port));
  const servers = useServersStore
    .getState()
    .servers.filter((s) => s.isAlive && !open.has(String(s.port)));
  const ports = [...tabs.map((t) => localPort(t.url)), ...servers.map((s) => s.port)];
  // Show, never kill. A failed lookup just means no "served by" lines.
  const owners = await portOwners([...new Set(ports.filter((p): p is number => p != null))]).catch(
    () => [] as PortOwner[],
  );
  const now = Date.now();
  const servedBy = (port: number | null) => {
    const mine = owners.filter((o) => o.port === port);
    return mine.length ? [`    served by ${ownerText(mine, now)}`] : [];
  };
  const lines = tabs.flatMap((t) => {
    const c = counts[t.id];
    const problems = c && c.errors + c.failed ? ` — ${c.errors} errors, ${c.failed} failed` : "";
    const yours = isAgentOpened(t.id) ? " (opened by you)" : "";
    return [
      `${t.id === activeId ? "*" : " "} ${header(t)}${yours}${problems}`,
      ...servedBy(localPort(t.url)),
    ];
  });
  const idle = servers.flatMap((s) => [
    `  ${s.protocol}://localhost:${s.port}${s.title ? ` "${s.title}"` : ""}`,
    ...servedBy(s.port),
  ]);
  const hidden = Object.keys(useTabsStore.getState().tabs).length - tabs.length;
  return [
    tabs.length ? "Tabs you can use (* = active):" : `No tabs you can use (${SCOPE}).`,
    ...lines,
    ...(servers.length ? [`${servers.length} dev servers without a tab:`, ...idle] : []),
    hidden ? `${hidden} other tabs hidden (out of scope).` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Closes a tab the agent opened (with `open`, or a popup one of its actions
 * caused). The developer's own tabs are refused. Searches only the agent's
 * tabs, so an id prefix reveals nothing about other tabs.
 */
async function closeAgentTab(arg: string): Promise<string> {
  const all = Object.values(useTabsStore.getState().tabs);
  const hits = all.filter((t) => isAgentOpened(t.id) && t.id.startsWith(arg));
  if (hits.length > 1) throw new Error(`Tab id "${arg}" is ambiguous.`);
  const t = hits[0];
  if (!t) {
    const theirs = scopedTabs().some((x) => x.id.startsWith(arg));
    throw new Error(
      theirs
        ? `Tab "${arg}" is the developer's; you can only close tabs you opened.`
        : `No tab you opened is "${arg}". Call tabs.`,
    );
  }
  closeTab(t.id);
  forgetAgentTab(t.id);
  for (const m of [emulated, dialogs, flaggedRefs]) m.delete(t.id);
  forgetViews(t.id);
  return `Closed [${shortId(t)}] ${t.url}\n${await tabsTool()}`;
}

/** Per tab, when its problems were last reported (for "Since last check Ns ago"). */
const cursors = new Map<string, { at: number }>();

/**
 * When the current agent session began: problems first seen before it are
 * evidence from before the agent arrived (roadmap M3). Set when the first
 * agent connects, or on the first call if that status event hasn't landed yet.
 */
let connectedAt: number | null = null;

function origin(tab: Tab): string {
  try {
    return new URL(tab.url).origin;
  } catch {
    return "";
  }
}

/**
 * The tab's errors and failed requests, grouped (lib/errorGroups.ts), as
 * lines, and marked as shown. `delta`: only what's new or grew since the last
 * report; otherwise everything on the current page too.
 */
function problemReport(tab: AgentTab, delta: boolean): string[] {
  const rows = useNetworkStore.getState().entriesByTab[tab.id] ?? [];
  if (delta) cursors.set(view(tab), { at: Date.now() });
  return report(tabProblems(tab.id, rows, origin(tab), tab.client ?? 0), delta, connectedAt);
}

/** Errors and failed requests since the last report, as lines (none: empty). */
const newProblems = (tab: AgentTab) => problemReport(tab, true);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Per tab, the alert/confirm/prompt that has paused its page. While one is
 * open the page answers no DevTools calls that need its main thread (input,
 * evaluate, the accessibility tree), so every page tool reports the dialog
 * instead of waiting on a page that can't reply.
 */
const dialogs = new Map<string, { type: string; message: string }>();

function dialogNote(tabId: string): string | null {
  const d = dialogs.get(tabId);
  if (!d) return null;
  const reply = d.type === "prompt" ? " (text = your reply)" : "";
  return `A ${d.type} dialog is open: "${d.message}". The page is paused until it's answered: act action="accept" or action="dismiss"${reply}.`;
}

const DIALOG = Symbol("dialog");

/** `p`, unless a dialog opens in the tab first; then DIALOG, and `p` is left to settle whenever the dialog is answered. */
async function orDialog<T>(tabId: string, p: Promise<T>): Promise<T | typeof DIALOG> {
  let done = false;
  p.then(
    () => {
      done = true;
    },
    () => {
      done = true;
    },
  );
  const watch = (async (): Promise<typeof DIALOG> => {
    while (!done && !dialogs.has(tabId)) await sleep(25);
    return DIALOG;
  })();
  return Promise.race([p, watch]);
}

/**
 * Installs (once per document) a MutationObserver in the page and reports the
 * load state and how long the DOM has been still. Runs in the page's world, so
 * the page can see `__zynlexQuiet`. ponytail: an isolated world would hide it.
 * The agent's own action marks (MARK) coming and going don't count.
 */
export const QUIET_PROBE = `(() => {
  const k = "__zynlexQuiet";
  const ours = (m) => m.type === "childList" &&
    [...m.addedNodes, ...m.removedNodes].every((n) => n.__zynlexMark);
  if (!window[k]) {
    window[k] = { t: performance.now() };
    new MutationObserver((recs) => { if (!recs.every(ours)) window[k].t = performance.now(); })
      .observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  }
  return { ready: document.readyState, quietMs: performance.now() - window[k].t };
})()`;

const SETTLE_TIMEOUT = 10_000;

/**
 * Waits until the page has loaded, has no requests in flight and its DOM has
 * been still for 500ms. Resolves to null once settled, or to why it didn't.
 * The 300ms floor gives an action's own requests time to start.
 */
async function settle(tabId: string): Promise<string | null> {
  const start = Date.now();
  let state = { ready: "", quietMs: 0 };
  let pending: string[] = [];
  while (Date.now() - start < SETTLE_TIMEOUT) {
    await sleep(100);
    if (dialogs.has(tabId)) return dialogNote(tabId);
    try {
      const r = await orDialog(
        tabId,
        tabCdp<{ result: { value?: typeof state } }>(tabId, "Runtime.evaluate", {
          expression: QUIET_PROBE,
          returnByValue: true,
        }),
      );
      if (r === DIALOG) return dialogNote(tabId);
      state = r.result.value ?? state;
      pending = await pendingRequests(tabId);
    } catch {
      // Mid-navigation, or the webview isn't up yet.
      continue;
    }
    const loading = useTabsStore.getState().tabs[tabId]?.isLoading;
    if (
      Date.now() - start >= 300 &&
      !loading &&
      state.ready === "complete" &&
      state.quietMs >= 500 &&
      !pending.length
    ) {
      return null;
    }
  }
  if (pending.length) {
    const shown = pending.slice(0, 3).join(", ");
    return `Not settled after 10s: ${pending.length} requests pending (${shown}).`;
  }
  return state.ready !== "complete"
    ? "Not settled after 10s: still loading."
    : "Not settled after 10s: the DOM keeps changing (animation or polling?).";
}

/** Brings the tab to the front, so the user sees what the agent does, and waits for its webview. */
async function showTab(tab: Tab): Promise<void> {
  // A minimized window has no content area, so the tab could never lay out.
  await revealWindow().catch(() => {});
  const ws = useWorkspacesStore.getState();
  if (ws.activeWorkspaceId !== tab.workspaceId) ws.setActiveWorkspace(tab.workspaceId);
  ws.setActiveTab(tab.workspaceId, tab.id);
  for (let i = 0; i < 50; i++) {
    try {
      await tabCdp(tab.id, "Runtime.evaluate", { expression: "1" });
      return;
    } catch {
      await sleep(100);
    }
  }
  throw new Error("The tab's page didn't come up within 5s.");
}

/**
 * The page as last reported, per tab: `compact` is what an agent is shown,
 * `full` (every piece of text) is what action diffs are taken against, so a
 * total or message that changes shows up as a changed line, not only the
 * buttons around it.
 */
interface Seen {
  compact: string;
  full: string;
}
const snapshots = new Map<string, Seen>();

async function frameAX(tabId: string, frameId?: string): Promise<AXNode[]> {
  const params = frameId ? { frameId } : {};
  return (await tabCdp<{ nodes: AXNode[] }>(tabId, "Accessibility.getFullAXTree", params)).nodes;
}

interface FrameTree {
  frame: { id: string; securityOrigin?: string };
  childFrames?: FrameTree[];
}

/** Most iframes walked per snapshot; ad-heavy pages can have dozens. */
const MAX_FRAMES = 20;

/**
 * The page's tree with its same-origin iframes' trees nested in (CDP gives one
 * tree per frame). Costs nothing extra on a page without iframes. Cross-origin
 * frames, and any frame whose tree can't be read (an out-of-process frame
 * isn't this target's), are marked rather than walked.
 */
async function axTree(tabId: string): Promise<AXNode[]> {
  const main = await frameAX(tabId);
  if (!main.some(isIframe)) return main;
  const { frameTree } = await tabCdp<{ frameTree: FrameTree }>(tabId, "Page.getFrameTree");
  const origins = new Map<string, string>();
  const index = (t: FrameTree) => {
    origins.set(t.frame.id, t.frame.securityOrigin ?? "");
    for (const c of t.childFrames ?? []) index(c);
  };
  index(frameTree);
  const home = frameTree.frame.securityOrigin;
  const frames: FrameTrees = new Map();
  const queue = [main];
  for (let nodes = queue.shift(); nodes && frames.size < MAX_FRAMES; nodes = queue.shift()) {
    for (const n of nodes.filter(isIframe)) {
      const key = n.backendDOMNodeId;
      if (key == null || frames.has(key) || frames.size >= MAX_FRAMES) continue;
      const frameId = await tabCdp<{ node: { frameId?: string } }>(tabId, "DOM.describeNode", {
        backendNodeId: key,
      }).then(
        (r) => r.node.frameId,
        () => undefined,
      );
      // No frame yet: the iframe hasn't loaded anything.
      if (!frameId) continue;
      if (!home || home === "null" || origins.get(frameId) !== home) {
        frames.set(key, "cross-origin");
        continue;
      }
      try {
        const sub = await frameAX(tabId, frameId);
        frames.set(key, sub);
        queue.push(sub);
      } catch {
        frames.set(key, "cross-origin");
      }
    }
  }
  return mergeFrames(main, frames);
}

/** Both views from one tree fetch. */
async function takePage(tabId: string): Promise<Seen> {
  const nodes = await axTree(tabId);
  return { compact: formatSnapshot(nodes), full: formatSnapshot(nodes, { full: true }) };
}

function parseRef(ref: unknown): number {
  const m = typeof ref === "string" ? /^e?(\d+)$/.exec(ref.trim()) : null;
  if (!m) throw new Error(`Expected a ref like "e12" from snapshot, got ${JSON.stringify(ref)}.`);
  return Number(m[1]);
}

/**
 * Tabs the page opened since `mark` (target=_blank, window.open). They open in
 * front, so one in scope becomes the default tab; any other can't be used,
 * only closed.
 */
function popupLines(tab: Tab, mark: number | undefined): string[] {
  if (mark == null) return [];
  return takePopups(tab.id, mark).map((p) => {
    const t = useTabsStore.getState().tabs[p.tabId];
    if (!t) return `Opened a new tab, already closed: ${p.url}`;
    const id = shortId(t);
    return agentCanUse(t.url, t.workspaceId)
      ? `Opened new tab [${id}] ${t.url}, now the default tab; pass tab="${shortId(tab)}" to stay on this one.`
      : `Opened new tab [${id}] ${t.url}: out of scope, so you can't use it (tabs close="${id}" closes it).`;
  });
}

/** Taken before an action, so its reply can name the tabs and downloads it started. */
interface ActionMark {
  popups: number;
  at: number;
}

const actionMark = (): ActionMark => ({ popups: popupMark(), at: Date.now() });

/**
 * Downloads `tabId` started since `since`, oldest first. A click on an export
 * button changes nothing in the page; this line is its whole result.
 */
export function downloadLines(items: DownloadItem[], tabId: string, since: number): string[] {
  return items
    .filter((d) => d.tabId === tabId && d.startedAt >= since)
    .reverse()
    .map((d) =>
      d.status === "done"
        ? `Downloaded ${d.filename} to ${d.path}`
        : d.status === "failed"
          ? `Download failed: ${d.filename} (${d.url})`
          : `Downloading ${d.filename} to ${d.path} (not finished when this reply was sent)`,
    );
}

/**
 * What happened after an action: settle note, URL change, tabs and downloads
 * it started (when given the mark from before it), page diff, new problems.
 */
async function consequences(
  tab: AgentTab,
  urlBefore: string,
  mark?: ActionMark,
): Promise<string[]> {
  const unsettled = await settle(tab.id);
  // The tab as it is now (URL, title), still as this agent sees it.
  const now: AgentTab = { ...(useTabsStore.getState().tabs[tab.id] ?? tab), client: tab.client };
  if (dialogs.has(tab.id)) {
    // The page is paused: its tree can't be read until the dialog is answered.
    const problems = newProblems(now);
    return [dialogNote(tab.id) as string, ...started(tab, mark), ...problems];
  }
  const before = snapshots.get(view(tab));
  const after = await takePage(tab.id);
  snapshots.set(view(tab), after);
  const diff = before == null ? [] : diffSnapshot(before.full, after.full);
  // A diff longer than the page itself is worse than just the page.
  const page =
    before == null || diff.length > after.compact.split("\n").length
      ? ["Page:", await showPage(now, after.compact)]
      : diff.length
        ? ["Page changes:", await showPage(now, diff.join("\n"))]
        : ["Page unchanged."];
  const problems = newProblems(now);
  return [
    ...(unsettled ? [unsettled] : []),
    ...(now.url !== urlBefore ? [`Navigated to ${now.url}`] : []),
    ...started(tab, mark),
    ...page,
    ...(problems.length ? problems : ["No new errors or failed requests."]),
  ];
}

/** Tabs and downloads an action started. */
function started(tab: Tab, mark: ActionMark | undefined): string[] {
  if (!mark) return [];
  const downloads = useDownloadsStore.getState().items;
  return [...popupLines(tab, mark.popups), ...downloadLines(downloads, tab.id, mark.at)];
}

async function checkTool(args: Args): Promise<string> {
  const tab = tabOf(args);
  const since = cursors.get(view(tab));
  let unsettled: string | null;
  if (args.reload) {
    await showTab(tab);
    // "After reload" must mean after: drop what the old page left, including
    // a network row that landed just after the console line already reported.
    newProblems(tab);
    await webviewReload(tab.id);
    unsettled = await settle(tab.id);
  } else {
    // A read doesn't bring the tab forward, and a tab that isn't loaded
    // (never shown, or discarded) has nothing to wait for.
    const loaded = await tabCdp(tab.id, "Runtime.evaluate", { expression: "1" }).then(
      () => true,
      () => false,
    );
    unsettled = loaded ? await settle(tab.id) : null;
  }
  const body = newProblems(tab);
  const when = args.reload
    ? "After reload:"
    : since
      ? `Since last check ${Math.round((Date.now() - since.at) / 1000)}s ago:`
      : "First check, everything recorded so far:";
  // A reload makes a new document, so every ref the agent had is stale:
  // hand over the new page instead of making it ask.
  let page: string[] = [];
  if (args.reload) {
    const now = await takePage(tab.id);
    snapshots.set(view(tab), now);
    page = ["Page:", await showPage(tab, now.compact)];
  }
  const vitals = args.vitals ? [await readVitals(tab.id)] : [];
  return [
    header(useTabsStore.getState().tabs[tab.id] ?? tab),
    ...(unsettled ? [unsettled] : []),
    when,
    ...(body.length ? body : ["No new errors or failed requests."]),
    ...vitals,
    ...page,
  ].join("\n");
}

/** What VITALS reports, all times in ms. */
export interface Vitals {
  lcp: number | null;
  lcpEl: string;
  cls: number;
  /** Longest interaction among those the browser buffered (over 104 ms), or null. */
  inp: number | null;
  slowInteractions: number;
  longTasks: number;
  longest: number;
  ttfb: number | null;
  load: number | null;
}

/**
 * In-page: the current document's web vitals, from buffered
 * PerformanceObserver entries, so nothing has to be installed beforehand.
 * Chromium buffers interactions only when slower than 104 ms, so INP here is
 * the worst of those (none: every interaction was faster). ponytail: CLS is
 * the sum of every unexpected shift, not the worst 5 s session window, so it
 * reads high on a long-lived page.
 */
const VITALS = `new Promise((resolve) => {
  const v = { lcp: null, lcpEl: "", cls: 0, inp: null, slowInteractions: 0, longTasks: 0, longest: 0, ttfb: null, load: null };
  const ids = new Set();
  const on = {
    "largest-contentful-paint": (e) => {
      v.lcp = e.startTime;
      const el = e.element;
      v.lcpEl = el ? el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") : "";
    },
    "layout-shift": (e) => { if (!e.hadRecentInput) v.cls += e.value; },
    "event": (e) => {
      if (!e.interactionId) return;
      ids.add(e.interactionId);
      v.inp = Math.max(v.inp || 0, e.duration);
    },
    "longtask": (e) => { v.longTasks++; v.longest = Math.max(v.longest, e.duration); },
  };
  const supported = PerformanceObserver.supportedEntryTypes || [];
  const obs = Object.keys(on).filter((t) => supported.includes(t)).map((t) => {
    const o = new PerformanceObserver((l) => l.getEntries().forEach(on[t]));
    o.observe({ type: t, buffered: true });
    return [o, on[t]];
  });
  const nav = performance.getEntriesByType("navigation")[0];
  if (nav) { v.ttfb = nav.responseStart; v.load = nav.loadEventEnd || null; }
  setTimeout(() => {
    for (const [o, f] of obs) { o.takeRecords().forEach(f); o.disconnect(); }
    v.slowInteractions = ids.size;
    resolve(v);
  }, 100);
})`;

const ms = (n: number) => (n < 1000 ? `${Math.round(n)} ms` : `${(n / 1000).toFixed(1)} s`);

/** "good" / "needs improvement" / "poor", by web.dev's thresholds. */
const rate = (n: number, good: number, poor: number) =>
  n <= good ? "good" : n <= poor ? "needs improvement" : "poor";

/** One line: LCP, CLS, INP, long tasks, TTFB and load. */
export function vitalsText(v: Vitals): string {
  const lcp =
    v.lcp == null
      ? "LCP not recorded (the tab was hidden while loading, or nothing painted)"
      : `LCP ${ms(v.lcp)} (${rate(v.lcp, 2500, 4000)}${v.lcpEl ? `, ${v.lcpEl}` : ""})`;
  const cls = `CLS ${v.cls.toFixed(2)} (${rate(v.cls, 0.1, 0.25)})`;
  const inp =
    v.inp == null
      ? "INP: no interaction over 104 ms"
      : `INP ${ms(v.inp)} (${rate(v.inp, 200, 500)}, worst of ${v.slowInteractions} slow interaction${v.slowInteractions === 1 ? "" : "s"})`;
  const long = v.longTasks
    ? `${v.longTasks} long task${v.longTasks === 1 ? "" : "s"}, longest ${ms(v.longest)}`
    : "no long tasks";
  const nav = [
    v.ttfb == null ? "" : `TTFB ${ms(v.ttfb)}`,
    v.load == null ? "" : `load ${ms(v.load)}`,
  ].filter(Boolean);
  return `Vitals: ${[lcp, cls, inp, long, nav.join(", ")].filter(Boolean).join(" · ")}`;
}

async function readVitals(tabId: string): Promise<string> {
  try {
    const r = await tabCdp<{ result: { value?: Vitals } }>(tabId, "Runtime.evaluate", {
      expression: VITALS,
      awaitPromise: true,
      returnByValue: true,
    });
    return r.result.value ? vitalsText(r.result.value) : "Vitals: couldn't read them.";
  } catch {
    return "Vitals: couldn't read them (page not loaded?).";
  }
}

async function snapshotTool(args: Args): Promise<string> {
  const tab = tabOf(args);
  const within = args.within == null ? undefined : parseRef(args.within);
  const full = !!args.full;
  if (full || within != null) {
    const text = formatSnapshot(await axTree(tab.id), { full, within });
    return `${header(tab)}\n${await showPage(tab, text)}`;
  }
  // "Unchanged" goes by the full text: a total that changed is a change.
  const now = await takePage(tab.id);
  const unchanged = snapshots.get(view(tab))?.full === now.full;
  snapshots.set(view(tab), now);
  const body = unchanged ? "Unchanged since your last snapshot." : await showPage(tab, now.compact);
  return `${header(tab)}\n${body}`;
}

/** CDP key events for the keys an agent needs. */
const KEYS: Record<string, { code: number; text?: string }> = {
  Enter: { code: 13, text: "\r" },
  Tab: { code: 9 },
  Escape: { code: 27 },
  Backspace: { code: 8 },
  Delete: { code: 46 },
  Space: { code: 32, text: " " },
  ArrowUp: { code: 38 },
  ArrowDown: { code: 40 },
  ArrowLeft: { code: 37 },
  ArrowRight: { code: 39 },
  Home: { code: 36 },
  End: { code: 35 },
  PageUp: { code: 33 },
  PageDown: { code: 34 },
};

/**
 * Sends input events in order. A handler that opens a dialog pauses the page
 * before its event's CDP call returns, so stop as soon as a dialog is open:
 * the rest of the sequence (a key-up, a mouse release) goes nowhere until the
 * dialog is answered.
 */
async function sendInput(tabId: string, method: string, events: object[]): Promise<void> {
  for (const params of events) {
    if ((await orDialog(tabId, tabCdp(tabId, method, params))) === DIALOG) return;
  }
}

async function pressKey(tabId: string, key: string): Promise<void> {
  const k = KEYS[key];
  if (!k) throw new Error(`Unknown key "${key}". Known: ${Object.keys(KEYS).join(", ")}.`);
  const base = { key: key === "Space" ? " " : key, windowsVirtualKeyCode: k.code };
  await sendInput(tabId, "Input.dispatchKeyEvent", [
    { type: "keyDown", ...base, text: k.text },
    { type: "keyUp", ...base },
  ]);
}

/** Runs `fn` in the page with the element as `this`; resolves to its return value. */
async function callOn(tabId: string, backendNodeId: number, fn: string, arg?: unknown) {
  const { object } = await tabCdp<{ object: { objectId: string } }>(tabId, "DOM.resolveNode", {
    backendNodeId,
  });
  const r = await tabCdp<{ result: { value?: unknown } }>(tabId, "Runtime.callFunctionOn", {
    objectId: object.objectId,
    functionDeclaration: fn,
    arguments: arg === undefined ? [] : [{ value: arg }],
    returnByValue: true,
  });
  return r.result.value;
}

/** The element's centre in viewport CSS pixels, as it lies now. */
async function centre(tabId: string, backendNodeId: number): Promise<{ x: number; y: number }> {
  const { quads } = await tabCdp<{ quads: number[][] }>(tabId, "DOM.getContentQuads", {
    backendNodeId,
  });
  const q = quads[0];
  if (!q) throw new Error(`e${backendNodeId} has no box on screen (hidden or zero-size).`);
  return { x: (q[0] + q[2] + q[4] + q[6]) / 4, y: (q[1] + q[3] + q[5] + q[7]) / 4 };
}

/**
 * "" when a click at the point lands on the element (or inside it), else what
 * is on top of it there. Asks the element's own root, so an element inside a
 * shadow tree isn't mistaken for being covered by its host. The point is in
 * the top page's viewport (content quads of same-process frames are); inside
 * an iframe, elementFromPoint wants the frame's own, so each enclosing
 * frame's content-box offset is taken off.
 */
/** In-page JS: takes each enclosing frame's content-box offset off `x`, `y`. */
const INTO_FRAME = `for (let w = this.ownerDocument.defaultView; w && w.frameElement; w = w.parent) {
    const f = w.frameElement, r = f.getBoundingClientRect(), s = getComputedStyle(f);
    x -= r.left + f.clientLeft + parseFloat(s.paddingLeft);
    y -= r.top + f.clientTop + parseFloat(s.paddingTop);
  }`;

const HIT_TEST = `function (p) {
  let x = p.x, y = p.y;
  ${INTO_FRAME}
  const root = this.getRootNode();
  const t = (root.elementFromPoint ? root : document).elementFromPoint(x, y);
  if (!t) return "nothing (it is off screen)";
  if (this === t || this.contains(t)) return "";
  const name = (t.getAttribute("aria-label") || t.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 40);
  return t.tagName.toLowerCase() + (t.id ? "#" + t.id : "") + (name ? ' "' + name + '"' : "");
}`;

/** How long a mark shows, and how long an action waits after drawing it so the developer sees it first. */
const MARK_MS = 1200;
const MARK_LEAD_MS = 250;

/**
 * Draws what the agent is about to do on the element (`this`): an outline, a
 * label ("agent: click") and, given the input point (top-page viewport), a
 * dot where the pointer goes. Shown in the element's own document, so the
 * point gets the frame offsets taken off. Fixed-position in a closed shadow
 * root on <html>: no layout shift, outside body.innerText, aria-hidden so the
 * snapshot doesn't see it, pointer-events none so input and elementFromPoint
 * go through it. Styles are set from script and the fade is element.animate,
 * so a page CSP that blocks <style> doesn't break it. Fading changes no DOM
 * and it removes itself; the settle
 * probe ignores the host coming and going. False when the element has no box.
 */
export const MARK = `function (o) {
  if (!this.getBoundingClientRect) return false;
  const r = this.getBoundingClientRect();
  if (!r.width && !r.height) return false;
  const doc = this.ownerDocument, C = "rgb(111,168,220)";
  const part = (css) => {
    const e = doc.createElement("div");
    e.style.cssText = "position:fixed;pointer-events:none;box-sizing:border-box;" + css;
    return e;
  };
  const host = doc.createElement("zynlex-agent-mark");
  host.__zynlexMark = true;
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = "all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647";
  const root = host.attachShadow({ mode: "closed" });
  root.append(
    part("left:" + r.left + "px;top:" + r.top + "px;width:" + r.width + "px;height:" + r.height + "px;" +
      "outline:2px solid " + C + ";outline-offset:2px;background:rgba(111,168,220,.15);border-radius:3px"));
  const tag = part("left:" + Math.max(0, r.left) + "px;top:" + (r.top < 24 ? r.bottom + 6 : r.top - 22) + "px;" +
    "font:600 11px/16px system-ui,sans-serif;color:#0b1a29;background:" + C + ";" +
    "padding:0 6px;border-radius:3px;white-space:nowrap");
  tag.textContent = o.label;
  root.append(tag);
  if (o.x != null) {
    let x = o.x, y = o.y;
    ${INTO_FRAME}
    root.append(part("left:" + (x - 8) + "px;top:" + (y - 8) + "px;width:16px;height:16px;" +
      "border-radius:50%;background:" + C + ";border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.5)"));
  }
  doc.documentElement.append(host);
  // Fades with the Web Animations API rather than a <style> rule: a page's
  // CSP can block <style> elements (it can't block styles set from script).
  if (host.animate) {
    host.animate([{ opacity: 1 }, { opacity: 1, offset: 0.75 }, { opacity: 0 }],
      { duration: o.ms, fill: "forwards" });
  }
  doc.defaultView.setTimeout(() => host.remove(), o.ms);
  return true;
}`;

/** Draws the mark; never fails the action (a stale ref fails in the action itself). */
async function drawMark(
  tabId: string,
  backendNodeId: number,
  label: string,
  p?: { x: number; y: number },
): Promise<boolean> {
  return callOn(tabId, backendNodeId, MARK, { label, ms: MARK_MS, ...p }).then(
    (drawn) => drawn === true,
    () => false,
  );
}

/** Shows the mark on an element that takes keyboard or value input, then gives the developer a moment to see it. */
async function showMark(tabId: string, backendNodeId: number, label: string): Promise<void> {
  await tabCdp(tabId, "DOM.scrollIntoViewIfNeeded", { backendNodeId }).catch(() => {});
  if (await drawMark(tabId, backendNodeId, label)) await sleep(MARK_LEAD_MS);
}

/**
 * The point to send mouse input to: the element's centre, once the element is
 * what's actually there. Scrolled only just into view, it can sit under a
 * fixed header or footer, and input would silently land on that instead.
 * `verb` names the action for the error ("a click would land…").
 */
async function aim(
  tabId: string,
  backendNodeId: number,
  verb: string,
): Promise<{ x: number; y: number }> {
  await tabCdp(tabId, "DOM.scrollIntoViewIfNeeded", { backendNodeId });
  let p = await centre(tabId, backendNodeId);
  let cover = await callOn(tabId, backendNodeId, HIT_TEST, p);
  if (cover) {
    await callOn(
      tabId,
      backendNodeId,
      `function () { this.scrollIntoView({ block: "center", inline: "center", behavior: "instant" }); }`,
    );
    p = await centre(tabId, backendNodeId);
    cover = await callOn(tabId, backendNodeId, HIT_TEST, p);
  }
  if (cover) {
    // visibility:hidden lets clicks through to what's behind: not a cover.
    const why = await hiddenWhy(tabId, backendNodeId);
    if (why && why !== "gone") throw hiddenError(backendNodeId, why);
    throw new Error(
      `e${backendNodeId} is covered by ${cover} at its centre, so a ${verb} would land on that instead. Nothing was done.`,
    );
  }
  return p;
}

/**
 * `aim`, with the mark shown first. Aims again after the pause: something
 * still moving (a CSS transition doesn't count against settle) may be
 * elsewhere by then, and input goes where the element is now.
 */
async function aimShown(
  tabId: string,
  backendNodeId: number,
  verb: string,
): Promise<{ x: number; y: number }> {
  const p = await aim(tabId, backendNodeId, verb);
  if (!(await drawMark(tabId, backendNodeId, `agent: ${verb}`, p))) return p;
  await sleep(MARK_LEAD_MS);
  return aim(tabId, backendNodeId, verb);
}

/** A real mouse click at the element's centre. */
async function click(tabId: string, backendNodeId: number): Promise<void> {
  const { x, y } = await aimShown(tabId, backendNodeId, "click");
  const at = { x, y, button: "left", clickCount: 1 };
  await sendInput(tabId, "Input.dispatchMouseEvent", [
    { type: "mouseMoved", x, y },
    { type: "mousePressed", ...at },
    { type: "mouseReleased", ...at },
  ]);
}

/** Moves the mouse onto the element's centre (hover menus, tooltips). */
async function hover(tabId: string, backendNodeId: number): Promise<void> {
  const { x, y } = await aimShown(tabId, backendNodeId, "hover");
  await sendInput(tabId, "Input.dispatchMouseEvent", [{ type: "mouseMoved", x, y }]);
}

/** Mouse moves between two points, so drag libraries that wait for a movement threshold see one. */
export function dragPath(
  from: { x: number; y: number },
  to: { x: number; y: number },
  steps = 5,
): { x: number; y: number }[] {
  return Array.from({ length: steps }, (_, i) => ({
    x: from.x + ((to.x - from.x) * (i + 1)) / steps,
    y: from.y + ((to.y - from.y) * (i + 1)) / steps,
  }));
}

/**
 * Press on `from`, move in steps, release on `to`. The drop target is checked
 * before anything is pressed (no scrolling once the button is down: that would
 * move the source out from under the pointer).
 */
async function drag(tabId: string, from: number, to: number): Promise<void> {
  await tabCdp(tabId, "DOM.scrollIntoViewIfNeeded", { backendNodeId: to });
  const p = await aimShown(tabId, from, "drag");
  const q = await centre(tabId, to);
  const cover = await callOn(tabId, to, HIT_TEST, q);
  if (cover) {
    const why = await hiddenWhy(tabId, to);
    if (why && why !== "gone") throw hiddenError(to, why);
    throw new Error(
      `Drop target e${to} is covered by ${cover} at its centre (or off screen with the source in view). Nothing was dragged.`,
    );
  }
  await drawMark(tabId, to, "agent: drop", q);
  const held = { button: "left", buttons: 1 };
  await sendInput(tabId, "Input.dispatchMouseEvent", [
    { type: "mouseMoved", ...p },
    { type: "mousePressed", ...p, ...held, clickCount: 1 },
    ...dragPath(p, q).map((m) => ({ type: "mouseMoved", ...m, ...held })),
    { type: "mouseReleased", ...q, ...held, clickCount: 1 },
  ]);
}

interface NavigationHistory {
  currentIndex: number;
  entries: { id: number; url: string; title?: string }[];
}

/**
 * The history entry back/forward goes to. Refuses one out of scope: the tab
 * would leave what the agent may use.
 */
export function historyTarget(
  h: NavigationHistory,
  dir: "back" | "forward",
  inScope: (url: string) => boolean,
): { id: number; url: string } {
  const entry = h.entries[h.currentIndex + (dir === "back" ? -1 : 1)];
  if (!entry) throw new Error(`Nothing to go ${dir} to in this tab's history.`);
  if (!inScope(entry.url)) {
    throw new Error(`Going ${dir} would leave your scope (${entry.url}). Nothing was done.`);
  }
  return entry;
}

async function goHistory(tabId: string, dir: "back" | "forward"): Promise<void> {
  const h = await tabCdp<NavigationHistory>(tabId, "Page.getNavigationHistory");
  const ws = useTabsStore.getState().tabs[tabId]?.workspaceId ?? "";
  const entry = historyTarget(h, dir, (url) => agentCanUse(url, ws));
  await tabCdp(tabId, "Page.navigateToHistoryEntry", { entryId: entry.id });
}

const SELECT_ALL = `function () {
  if (typeof this.select === "function") return this.select();
  const r = document.createRange();
  r.selectNodeContents(this);
  const s = getSelection();
  s.removeAllRanges();
  s.addRange(r);
}`;

/**
 * In-page: "" when `type` can put text in the element (a text-like input, a
 * textarea, contenteditable), else what it is ("a button", "an input of
 * type checkbox", "a <select>", "disabled", "read-only"). By tag name, not
 * instanceof, so it holds inside iframes too.
 */
export const TAKES_TEXT = `function () {
  if (this.isContentEditable) return "";
  const tag = (this.localName || "").toLowerCase();
  const field = () => this.disabled ? "disabled" : this.readOnly ? "read-only" : "";
  if (tag === "textarea") return field();
  if (tag === "input") {
    const t = (this.type || "text").toLowerCase();
    const none = ["button", "submit", "reset", "checkbox", "radio", "file", "image", "range", "color", "hidden"];
    return none.includes(t) ? "an input of type " + t : field();
  }
  if (tag === "select") return "a <select>";
  if (!tag) return "not an element";
  const role = this.getAttribute("role");
  if (tag === "button" || role === "button") return "a button";
  return "a <" + tag + ">" + (role ? " (role " + role + ")" : "") + " that isn't editable";
}`;

/** Picks a <select> option by value or label, firing the events frameworks listen for. */
const CHOOSE_OPTION = `function (v) {
  const opts = [...(this.options || [])];
  const o = opts.find((o) => o.value === v || o.label.trim() === v);
  if (!o) return "No option " + JSON.stringify(v) + ". Options: " + opts.map((o) => o.label.trim()).join(", ");
  this.value = o.value;
  this.dispatchEvent(new Event("input", { bubbles: true }));
  this.dispatchEvent(new Event("change", { bubbles: true }));
  return "";
}`;

/**
 * In-page: why input can't reach the element though it's still in the page,
 * "" when nothing stops it, "gone" when it was removed. checkVisibility sees
 * display:none on any ancestor, shadow hosts included.
 */
export const HIDDEN = `function () {
  if (!this.isConnected) return "gone";
  const el = this.nodeType === 1 ? this : this.parentElement;
  if (!el || !el.checkVisibility) return "";
  if (!el.checkVisibility()) return "display: none, on it or an ancestor";
  if (!el.checkVisibility({ visibilityProperty: true })) return "visibility: hidden";
  const r = el.getBoundingClientRect();
  return r.width && r.height ? "" : "zero size";
}`;

/** HIDDEN for a ref; "gone" when it can't even be resolved. */
async function hiddenWhy(tabId: string, backendNodeId: number): Promise<string> {
  return callOn(tabId, backendNodeId, HIDDEN).then(
    (v) => (typeof v === "string" ? v : ""),
    () => "gone",
  );
}

const hiddenError = (backendNodeId: number, why: string) =>
  new Error(
    `e${backendNodeId} is hidden (${why}): it's in the page, but input can't reach it. Nothing was done. Do what shows it first, or wait_for its text.`,
  );

/**
 * WebView2 reports every CDP error as E_INVALIDARG, dropping CDP's own
 * message. For an element-scoped call that means the node is gone
 * (re-render, navigation, reload), hidden (display:none has no box to aim
 * at), or refused the action (focus on something that takes none), so ask
 * the page which. Gone: the agent gets the current page instead. Any other
 * error is passed on.
 */
async function rethrowStale(
  tab: AgentTab,
  ref: number | null,
  err: unknown,
  to: number | null = null,
  action = "",
): Promise<never> {
  const msg = err instanceof Error ? err.message : String(err);
  if (ref != null && /0x80070057|no node|could not find node/i.test(msg)) {
    const ids = to == null ? [ref] : [ref, to];
    const whys = await Promise.all(ids.map((id) => hiddenWhy(tab.id, id)));
    const hidden = whys.findIndex((w) => w && w !== "gone");
    if (hidden >= 0) throw hiddenError(ids[hidden], whys[hidden]);
    if (!whys.includes("gone")) {
      const focus =
        action === "type" || action === "press" ? " Does it take focus (a text field)?" : "";
      throw new Error(
        `The browser refused ${action || "that"} on e${ref}, which is in the page and visible.${focus} Nothing was done.`,
      );
    }
    const fresh = await takePage(tab.id);
    snapshots.set(view(tab), fresh);
    const which = to == null ? `e${ref}` : `e${ref} or e${to}`;
    throw new Error(
      `Stale ref ${which}: that element is gone. Current page:\n${await showPage(tab, fresh.compact)}`,
    );
  }
  throw err;
}

/**
 * The file input a ref stands for: the element itself, the input a <label>
 * is for, or the one inside it (a styled drop zone); the input itself is often
 * hidden, so it has no ref of its own. Otherwise what the element is instead.
 */
const FILE_INPUT = `function () {
  const isFile = (e) => e instanceof HTMLInputElement && e.type === "file";
  if (isFile(this)) return this;
  if (isFile(this.control)) return this.control;
  const inner = this.querySelector ? this.querySelector('input[type="file"]') : null;
  if (inner) return inner;
  const tag = this.tagName ? this.tagName.toLowerCase() : "not an element";
  return tag + (typeof this.type === "string" && this.type ? "[type=" + this.type + "]" : "");
}`;

/** Sets an <input type=file>'s files, as a picked file would; the page gets its input and change events. */
async function upload(tabId: string, backendNodeId: number, files: string[]): Promise<void> {
  const { object } = await tabCdp<{ object: { objectId: string } }>(tabId, "DOM.resolveNode", {
    backendNodeId,
  });
  const { result } = await tabCdp<{
    result: { type: string; value?: unknown; objectId?: string };
  }>(tabId, "Runtime.callFunctionOn", {
    objectId: object.objectId,
    functionDeclaration: FILE_INPUT,
  });
  if (result.type === "string" || !result.objectId) {
    throw new Error(
      `e${backendNodeId} is ${String(result.value)}: not a file input (<input type=file>), and it holds none. Nothing was uploaded.`,
    );
  }
  const input = result.objectId;
  if (files.length > 1) {
    const multiple = await tabCdp<{ result: { value?: unknown } }>(
      tabId,
      "Runtime.callFunctionOn",
      {
        objectId: input,
        functionDeclaration: "function () { return this.multiple; }",
        returnByValue: true,
      },
    );
    if (!multiple.result.value) {
      throw new Error(
        `e${backendNodeId} takes one file (no multiple attribute), not ${files.length}. Nothing was uploaded.`,
      );
    }
  }
  try {
    await tabCdp(tabId, "DOM.setFileInputFiles", { files, objectId: input });
  } catch {
    throw new Error("The browser refused the files. Check that each path is a file that exists.");
  }
}

const baseName = (path: string) => path.split(/[\\/]/).pop() ?? path;

/** accept/dismiss: answers the open dialog, then reports what the page did next. */
async function answerDialog(tab: Tab, accept: boolean, text: string): Promise<string> {
  const d = dialogs.get(tab.id);
  if (!d) throw new Error("No dialog is open in this tab.");
  const urlBefore = (useTabsStore.getState().tabs[tab.id] ?? tab).url;
  const mark = actionMark();
  await tabCdp(tab.id, "Page.handleJavaScriptDialog", {
    accept,
    ...(d.type === "prompt" && accept ? { promptText: text } : {}),
  });
  dialogs.delete(tab.id);
  const did = `${accept ? "Accepted" : "Dismissed"} the ${d.type} dialog "${d.message}"`;
  return [did, ...(await consequences(tab, urlBefore, mark))].join("\n");
}

/** One `act` action, checked before anything touches the page. */
interface Step {
  action: string;
  text: string;
  ref: number | null;
  to: number | null;
  files: string[];
}

const ACTIONS = [
  "click",
  "hover",
  "drag",
  "type",
  "select",
  "press",
  "upload",
  "back",
  "forward",
  "accept",
  "dismiss",
];
const MAX_STEPS = 10;
const isAnswer = (s: Step) => s.action === "accept" || s.action === "dismiss";

function parseStep(a: Args): Step {
  const action = String(a.action ?? "");
  if (!ACTIONS.includes(action)) {
    throw new Error(`Unknown action "${action}". Use ${ACTIONS.join(", ")}.`);
  }
  const noRef =
    action === "back" ||
    action === "forward" ||
    action === "accept" ||
    action === "dismiss" ||
    (action === "press" && a.ref == null);
  return {
    action,
    text: typeof a.text === "string" ? a.text : "",
    ref: noRef ? null : parseRef(a.ref),
    to: action === "drag" ? parseRef(a.to) : null,
    files: action === "upload" ? uploadPaths(a.files) : [],
  };
}

/** Does one step and says what it did; the caller reports what it caused. */
async function doStep(tab: Tab, st: Step, labelOf: (r: number | null) => string): Promise<string> {
  const { action, text, ref, to, files } = st;
  if (isAnswer(st)) {
    const d = dialogs.get(tab.id);
    if (!d) throw new Error("No dialog is open in this tab.");
    const accept = action === "accept";
    await tabCdp(tab.id, "Page.handleJavaScriptDialog", {
      accept,
      ...(d.type === "prompt" && accept ? { promptText: text } : {}),
    });
    dialogs.delete(tab.id);
    return `${accept ? "Accepted" : "Dismissed"} the ${d.type} dialog "${d.message}"`;
  }
  const label = labelOf(ref);
  try {
    if (action === "type") {
      // insertText into something that takes no text does nothing, and the
      // reply would still say "Typed".
      const not = await callOn(tab.id, ref as number, TAKES_TEXT);
      if (not) {
        const hint = String(not).includes("select") ? " Use action=select." : "";
        throw new Error(
          `e${ref} is ${not}, so type can't put text in it. Nothing was done.${hint}`,
        );
      }
    }
    // Mouse actions mark their element as they aim (aimShown).
    if (ref != null && ["type", "select", "press", "upload"].includes(action)) {
      await showMark(tab.id, ref, `agent: ${action === "press" ? `press ${text}` : action}`);
    }
    if (action === "click") {
      await click(tab.id, ref as number);
    } else if (action === "hover") {
      await hover(tab.id, ref as number);
    } else if (action === "drag") {
      await drag(tab.id, ref as number, to as number);
    } else if (action === "back" || action === "forward") {
      await goHistory(tab.id, action);
    } else if (action === "type") {
      await tabCdp(tab.id, "DOM.focus", { backendNodeId: ref });
      await callOn(tab.id, ref as number, SELECT_ALL);
      // insertText replaces the selection; with nothing to insert, delete it.
      if (text) await tabCdp(tab.id, "Input.insertText", { text });
      else await pressKey(tab.id, "Backspace");
    } else if (action === "select") {
      const err = await callOn(tab.id, ref as number, CHOOSE_OPTION, text);
      if (err) throw new Error(String(err));
    } else if (action === "press") {
      if (ref != null) await tabCdp(tab.id, "DOM.focus", { backendNodeId: ref });
      await pressKey(tab.id, text);
    } else if (action === "upload") {
      await upload(tab.id, ref as number, files);
    }
  } catch (err) {
    await rethrowStale(tab, ref, err, to, action);
  }
  return action === "type"
    ? `Typed ${JSON.stringify(text)} into ${label}`
    : action === "select"
      ? `Selected ${JSON.stringify(text)} in ${label}`
      : action === "press"
        ? `Pressed ${text}${label ? ` in ${label}` : ""}`
        : action === "hover"
          ? `Hovered ${label}`
          : action === "drag"
            ? `Dragged ${label} onto ${labelOf(to)}`
            : action === "upload"
              ? `Attached ${files.map(baseName).join(", ")} to ${label}`
              : action === "back" || action === "forward"
                ? `Went ${action}`
                : `Clicked ${label}`;
}

/** Per tab, refs the developer flagged: they can be elements the outline leaves out (a clickable div). */
const flaggedRefs = new Map<string, Set<number>>();

const inPage = (seen: Seen | undefined, r: number) => !!seen?.full.includes(`[e${r}]`);

/**
 * The tab's page, once every ref a call names is in it (or was flagged by
 * the developer). A ref missing from the last snapshot gets one fresh look,
 * then a reason, before anything is touched: hidden, gone, or not in the
 * outline at all. Without this, a ref from an older page could name an
 * unrelated node (ids restart with the renderer) and the click would land
 * on it.
 */
async function knownRefs(tab: AgentTab, refs: number[]): Promise<Seen | undefined> {
  const flagged = flaggedRefs.get(tab.id);
  const ok = (seen: Seen | undefined, r: number) => inPage(seen, r) || !!flagged?.has(r);
  let seen = snapshots.get(view(tab));
  if (refs.every((r) => ok(seen, r))) return seen;
  seen = await takePage(tab.id);
  snapshots.set(view(tab), seen);
  const missing = refs.find((r) => !ok(seen, r));
  if (missing == null) return seen;
  const why = await hiddenWhy(tab.id, missing);
  if (why && why !== "gone") throw hiddenError(missing, why);
  const page = await showPage(tab, seen.compact);
  throw new Error(
    why === "gone"
      ? `Stale ref e${missing}: that element is gone. Current page:\n${page}`
      : `e${missing} isn't in the page's outline: it's from an older page, or not something to act on. Nothing was done. Use a ref from this page:\n${page}`,
  );
}

/**
 * One action, or `steps`: several in order in one call (click, type, press
 * Enter; click then accept the confirm), so a known sequence costs one model
 * turn instead of one per action. Settles between steps; a dialog a step opens
 * is answered only if the next step is accept/dismiss, else the batch stops
 * there. The reply is every step's line, then what they caused together; a
 * failing step ends the batch with what the page looks like at that point.
 */
async function actTool(args: Args): Promise<string> {
  const tab = tabOf(args);
  const batch = Array.isArray(args.steps);
  // With steps, a stray top-level action (agents sometimes send both) is
  // ignored rather than refused: the steps say what to do.
  const raw = batch ? (args.steps as unknown[]) : [args];
  if (!raw.length || raw.length > MAX_STEPS) {
    throw new Error(`steps takes 1 to ${MAX_STEPS} actions.`);
  }
  const steps = raw.map((r, i) => {
    try {
      return parseStep((r ?? {}) as Args);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(batch ? `Step ${i + 1}: ${msg} Nothing was done.` : msg);
    }
  });
  // Answering a dialog: the page is paused, so no snapshot (it can't be read).
  if (steps.length === 1 && isAnswer(steps[0])) {
    return answerDialog(tab, steps[0].action === "accept", steps[0].text);
  }
  await showTab(tab);
  if (!snapshots.has(view(tab)) && !dialogs.has(tab.id)) {
    snapshots.set(view(tab), await takePage(tab.id));
  }
  // A paused page (dialog) can't be read; its steps are answers anyway.
  const before = dialogs.has(tab.id)
    ? snapshots.get(view(tab))
    : await knownRefs(
        tab,
        steps.flatMap((s) => [s.ref, s.to]).filter((r): r is number => r != null),
      );
  const labelOf = (r: number | null) =>
    r == null
      ? ""
      : (before?.full
          .split("\n")
          .find((l) => l.includes(`[e${r}]`))
          ?.trim() ?? `e${r}`);
  const urlBefore = (useTabsStore.getState().tabs[tab.id] ?? tab).url;
  const mark = actionMark();
  const did: string[] = [];
  for (const [i, st] of steps.entries()) {
    if (i > 0) {
      if (dialogs.has(tab.id) && !isAnswer(st)) {
        did.push(`Stopped before step ${i + 1}: a dialog is open.`);
        break;
      }
      if (!dialogs.has(tab.id)) await settle(tab.id);
    }
    try {
      did.push(await doStep(tab, st, labelOf));
    } catch (err) {
      if (!batch) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      const page = await consequences(tab, urlBefore, mark).catch(() => []);
      throw new Error([...did, `Step ${i + 1} (${st.action}) failed: ${msg}`, ...page].join("\n"));
    }
  }
  return [...did, ...(await consequences(tab, urlBefore, mark))].join("\n");
}

/** The URL `open` was asked for, scheme added; empty if none was given. */
function openUrl(args: Args): string {
  const raw = typeof args.url === "string" ? args.url.trim() : "";
  if (!raw) return "";
  return /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
}

async function openTool(args: Args): Promise<string> {
  const url = openUrl(args);
  if (!url || !agentCanUse(url, useWorkspacesStore.getState().activeWorkspaceId)) {
    throw new Error(`open only takes URLs in your scope: ${SCOPE}.`);
  }
  const existing = scopedTabs().find((t) => t.url === url);
  const id = existing?.id ?? openTab({ url });
  if (!existing) markAgentOpened(id);
  const tab: AgentTab = { ...useTabsStore.getState().tabs[id], client: clientOf(args) };
  await showTab(tab);
  // Agents call `open` again to look at a fix, expecting a fresh load (as a
  // navigate would give). A tab the agent opened is reloaded; the developer's
  // own tab isn't, since that would lose what they typed, so the reply says so.
  // Without either, agents tested the old script and chased a fixed bug for
  // several turns (benchmark, 2026-11-09).
  const reload = !!existing && isAgentOpened(id);
  if (reload) {
    newProblems(tab);
    await webviewReload(id);
  }
  // A fresh page: report it whole, not as a diff against an old visit.
  snapshots.delete(view(tab));
  const lines = await consequences(tab, url);
  // The header already says where the page is; "Navigated to" would only
  // echo a redirect or a trailing slash.
  return [
    header(useTabsStore.getState().tabs[id] ?? tab),
    ...(reload ? ["Reloaded: it was already open."] : []),
    ...(existing && !reload
      ? [
          "Switched to the developer's open tab without reloading it. After a code change, use check reload=true.",
        ]
      : []),
    ...lines.filter((l) => !l.startsWith("Navigated to ")),
  ].join("\n");
}

/** Severity order for `errors level=…`: each level includes the ones before it. */
const LEVELS = ["error", "warning", "info", "log"] as const;

function errorsTool(args: Args): string {
  const tab = tabOf(args);
  const level = args.level ?? (args.warnings ? "warning" : "error");
  const rank = LEVELS.indexOf(level as (typeof LEVELS)[number]);
  if (rank < 0) throw new Error(`level must be one of ${LEVELS.join(", ")}.`);
  const { entriesByTab, logsByTab } = useConsoleStore.getState();
  const entries = entriesByTab[tab.id] ?? [];
  const warnings = entries.filter((e) => e.level === "warning");
  const logs = (logsByTab[tab.id] ?? []).filter((e) => rank >= LEVELS.indexOf(e.level));
  const older = logs.length - MAX_ROWS;
  const logLines = logs
    .slice(-MAX_ROWS)
    .map((e) =>
      e.level === "info" ? consoleLine(e).replace(/^ {2}/, "  info: ") : consoleLine(e),
    );
  const body = [
    ...problemReport(tab, false),
    ...(rank >= 1 ? section("warnings", warnings.map(consoleLine)) : []),
    ...(rank >= 2 ? section(rank === 3 ? "log/info messages" : "info messages", logLines) : []),
    older > 0 ? `(${older} older messages not shown)` : "",
  ].filter(Boolean);
  return [
    header(tab),
    ...(body.length ? body : ["No errors or failed requests recorded."]),
    rank === 0 && warnings.length
      ? `(${warnings.length} warnings hidden; pass level="warning")`
      : "",
    rank >= 2 && !logs.length
      ? "(No log/info messages. They are recorded only while an agent is connected, so reload to see the page's startup output.)"
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

async function requestDetail(tab: Tab, entry: NetworkLogEntry): Promise<string> {
  const n = await withBody(entry);
  const body = n.bodyEvicted
    ? "(body dropped to save memory; only the 50 newest requests keep theirs)"
    : n.body
      ? await inlineOrFile(n.body, `body-${shortId(tab)}-${n.id}`, { chars: MAX_BODY })
      : "(empty)";
  return [
    `${n.method} ${n.statusCode} ${n.reasonPhrase} ${n.url}`.trim(),
    `${n.resourceType}, ${n.durationMs}ms${n.mocked ? ", served by a ZYNLEX mock" : ""}${n.bodyTruncated ? ", body capped at 64 KB" : ""}`,
    "Response headers:",
    ...n.headers.map(([k, v]) => `  ${k}: ${v}`),
    "Body:",
    body,
  ].join("\n");
}

/** Whitespace collapsed, cut at `max` with the full length noted. */
const oneLine = (text: string, max: number) => {
  const t = text.replace(/\s+/g, " ");
  return t.length > max ? `${t.slice(0, max)}… (${t.length} chars)` : t;
};

/** `  ws-3 open ws://localhost:5173/live ↑2 ↓14`, plus its last error. */
function socketLine(s: SocketLog): string {
  const err = s.state === "error" && s.error ? `: ${oneLine(s.error, 120)}` : "";
  return `  ${s.id} ${s.state}${err} ${s.url || "(url not seen)"} ↑${s.sent} ↓${s.received}`;
}

/** Frames shown for one socket, newest last; `all` gives every frame kept. */
const FRAMES_SHOWN = 20;
const MAX_FRAME_CHARS = 300;

/** One socket's latest frames, oldest first, each with how long ago. */
function socketDetail(s: SocketLog, now: number, all = false): string {
  const frames = all ? s.frames : s.frames.slice(-FRAMES_SHOWN);
  const total = s.sent + s.received;
  const more =
    total > frames.length
      ? `Last ${frames.length} of ${total} frames${all ? "" : `; all=true shows the last ${MAX_WS_FRAMES}`}.`
      : "";
  return [
    socketLine(s).trim(),
    ...frames.map(
      (f) =>
        `  ${f.dir === "sent" ? "↑" : "↓"} ${Math.round((now - f.at) / 1000)}s ago ${oneLine(f.data, MAX_FRAME_CHARS)}`,
    ),
    frames.length ? "" : "  No frames yet.",
    more,
  ]
    .filter(Boolean)
    .join("\n");
}

async function networkTool(args: Args): Promise<string> {
  const tab = tabOf(args);
  const { entriesByTab, socketsByTab } = useNetworkStore.getState();
  const rows = entriesByTab[tab.id] ?? [];
  const sockets = socketsByTab[tab.id] ?? [];
  if (typeof args.id === "string" && args.id) {
    const ws = sockets.find((s) => s.id === args.id);
    if (ws) return `${header(tab)}\n${socketDetail(ws, Date.now(), !!args.all)}`;
    const hit = rows.find((n) => n.id === args.id);
    if (!hit) throw new Error(`No request ${args.id} in this tab.`);
    return requestDetail(tab, hit);
  }
  if (!rows.length && !sockets.length) {
    return `${header(tab)}\nNo requests recorded. Capture starts when an agent connects; requests the page made before that aren't here (failed ones are, in errors).`;
  }
  const match = typeof args.match === "string" ? args.match.toLowerCase() : "";
  const shown = rows.filter(
    (n) =>
      (args.all || !ASSET_TYPES.has(n.resourceType)) &&
      (!args.failed || isFailedRow(n)) &&
      (!match || n.url.toLowerCase().includes(match)),
  );
  const ws = sockets.filter(
    (s) => (!args.failed || s.state === "error") && (!match || s.url.toLowerCase().includes(match)),
  );
  const rest = shown.length - MAX_ROWS;
  return [
    header(tab),
    ...(shown.length ? shown.slice(-MAX_ROWS).map(netLine) : ["No matching requests."]),
    rest > 0 ? `(${rest} older not shown; narrow with match)` : "",
    "id method status time type url. Pass id for headers and body.",
    ...(ws.length
      ? ["WebSockets (↑ sent, ↓ received; pass id for the frames):", ...ws.map(socketLine)]
      : []),
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Emulates a device (or a plain width×height) in a tab through CDP, the same
 * overrides the Viewport panel uses: size and pixel ratio, mobile, touch, and
 * the device's user agent. The page lays out at that size inside the tab, so
 * the developer sees it too. `reset` clears all of it.
 */
async function viewportTool(args: Args): Promise<string> {
  const tab = tabOf(args);
  await showTab(tab);
  const urlBefore = (useTabsStore.getState().tabs[tab.id] ?? tab).url;
  const device = typeof args.device === "string" ? args.device.trim() : "";
  const current = emulated.get(tab.id);

  if (device.toLowerCase() === "reset") {
    if (!current) return `${header(tab)}\nNot emulating a device; nothing to reset.`;
    // Same order as applying: the size change comes last.
    await tabCdp(tab.id, "Emulation.setUserAgentOverride", { userAgent: current.originalUa });
    await tabCdp(tab.id, "Emulation.setTouchEmulationEnabled", { enabled: false });
    await tabCdp(tab.id, "Emulation.clearDeviceMetricsOverride");
    emulated.delete(tab.id);
    return [`Back to the normal window size.`, ...(await consequences(tab, urlBefore))].join("\n");
  }

  let preset: DevicePreset | undefined;
  if (device) {
    preset = findDevice(device);
    if (!preset) {
      const names = ALL_DEVICES.map((d) => d.label).join(", ");
      throw new Error(`No device "${device}". Devices: ${names}. Or pass width and height.`);
    }
  } else if (typeof args.width === "number" && typeof args.height === "number") {
    const narrow = args.width < 768;
    preset = {
      label: "custom",
      width: Math.round(args.width),
      height: Math.round(args.height),
      deviceScaleFactor: 1,
      category: narrow ? "mobile" : "laptop",
      mobile: narrow,
      touch: narrow,
    };
  } else {
    throw new Error('Pass a device (e.g. "iPhone 16"), or width and height, or device "reset".');
  }

  const originalUa =
    current?.originalUa ??
    String(
      (
        await tabCdp<{ result: { value?: unknown } }>(tab.id, "Runtime.evaluate", {
          expression: "navigator.userAgent",
          returnByValue: true,
        })
      ).result.value ?? "",
    );
  // User agent and touch before the size: the size change fires the page's
  // resize handlers, and they should already see the device they're on.
  await tabCdp(tab.id, "Emulation.setUserAgentOverride", {
    userAgent: preset.userAgent ?? originalUa,
  });
  await tabCdp(tab.id, "Emulation.setTouchEmulationEnabled", {
    enabled: preset.touch,
    ...(preset.touch ? { maxTouchPoints: 5 } : {}),
  });
  await tabCdp(tab.id, "Emulation.setDeviceMetricsOverride", {
    width: preset.width,
    height: preset.height,
    deviceScaleFactor: preset.deviceScaleFactor,
    mobile: preset.mobile,
  });
  // Without this, Chromium's mobile shrink-to-fit zooms out a page that
  // overflows (see docs/architecture.md, Viewport emulation).
  await tabCdp(tab.id, "Emulation.setPageScaleFactor", { pageScaleFactor: 1 });
  emulated.set(tab.id, { ...preset, originalUa });
  const ua = preset.userAgent
    ? " Its user agent applies to requests from now on; reload (check reload=true) if the server sniffs it."
    : "";
  return [
    `Emulating ${preset.label}: ${preset.width}×${preset.height}${preset.mobile ? ", mobile" : ""}${preset.touch ? ", touch" : ""}.${ua}`,
    ...(await consequences(tab, urlBefore)),
  ].join("\n");
}

/** The parts of CDP's Page.getLayoutMetrics read here. */
interface LayoutMetrics {
  cssLayoutViewport?: { pageX: number; pageY: number };
  layoutViewport?: { pageX: number; pageY: number };
}

/** The visible area, the whole page (`full`), or one element (`ref`), as a PNG in %TEMP%\zynlex-agent. */
async function screenshotTool(args: Args): Promise<string> {
  const tab = tabOf(args);
  // The agent wants the page, not its own action marks. ponytail: top document only.
  await tabCdp(tab.id, "Runtime.evaluate", {
    expression: `document.querySelectorAll("zynlex-agent-mark").forEach((m) => m.remove())`,
  }).catch(() => {});
  if (args.ref == null) {
    const path = await captureScreenshot(tab.id, args.full ? "agent-full" : "agent");
    return `${header(tab)}\nSaved ${path}${args.full ? " (whole page)" : ""}`;
  }
  if (args.full) throw new Error("Pass ref or full, not both.");
  const ref = parseRef(args.ref);
  let clip: ReturnType<typeof clipRect> = null;
  try {
    // Scrolled into view first, so lazy content in it has loaded and it's
    // laid out where the user would see it.
    await tabCdp(tab.id, "DOM.scrollIntoViewIfNeeded", { backendNodeId: ref });
    const { quads } = await tabCdp<{ quads: number[][] }>(tab.id, "DOM.getContentQuads", {
      backendNodeId: ref,
    });
    const m = await tabCdp<LayoutMetrics>(tab.id, "Page.getLayoutMetrics");
    const vp = m.cssLayoutViewport ?? m.layoutViewport;
    clip = clipRect(quads, { x: vp?.pageX ?? 0, y: vp?.pageY ?? 0 });
  } catch (err) {
    await rethrowStale(tab, ref, err);
  }
  if (!clip) throw new Error(`e${ref} has no box on screen (hidden or zero-size).`);
  const path = await captureScreenshot(tab.id, "agent", clip);
  return `${header(tab)}\nSaved ${path} (e${ref}, ${clip.width}×${clip.height})`;
}

/** Longest `eval` result returned. */
const MAX_EVAL = 4000;
/** How long `eval` waits for its value (a promise that never settles would hang the agent). */
const EVAL_TIMEOUT = 10_000;
const EVAL_GROUP = "zynlex-agent-eval";

/** `text` cut to `max` chars, saying how much was dropped. */
export function cut(text: string, max: number): string {
  return text.length > max
    ? `${text.slice(0, max)}\n… (${text.length - max} more chars cut; return a smaller part)`
    : text;
}

/**
 * What `eval` hands Runtime.evaluate. Code with a `return` is an async
 * function body; anything else is an expression (replMode allows top-level
 * `await` in it).
 */
export function evalSource(code: string): string {
  return /\breturn\b/.test(code) ? `(async () => {\n${code}\n})()` : code;
}

interface RemoteObject {
  type: string;
  subtype?: string;
  value?: unknown;
  unserializableValue?: string;
  description?: string;
}

/** A returned value as compact JSON; values JSON can't carry by their description. */
export function formatEvalValue(r: RemoteObject): string {
  if (r.type === "undefined") return "undefined";
  if (r.unserializableValue) return r.unserializableValue;
  if ("value" in r) return JSON.stringify(r.value) ?? String(r.value);
  return r.description ?? r.type;
}

async function evalTool(args: Args): Promise<string> {
  const tab = tabOf(args);
  const code = typeof args.code === "string" ? args.code.trim() : "";
  if (!code)
    throw new Error("Pass code: a JS expression, or a function body that returns a value.");
  await showTab(tab);
  type Evaluated = {
    result: RemoteObject & { objectId?: string };
    exceptionDetails?: { text: string; exception?: { description?: string } };
  };
  // replMode ignores awaitPromise, so a promise (an async body, fetch().then…)
  // came back as `{}`. Take a handle instead, await it if it's a promise, then
  // read the value.
  const call = async (): Promise<Evaluated> => {
    const r = await tabCdp<Evaluated>(tab.id, "Runtime.evaluate", {
      expression: evalSource(code),
      objectGroup: EVAL_GROUP,
      replMode: true,
      userGesture: true,
    });
    const id = r.result.objectId;
    if (r.exceptionDetails || !id) return r;
    return r.result.subtype === "promise"
      ? tabCdp<Evaluated>(tab.id, "Runtime.awaitPromise", {
          promiseObjectId: id,
          returnByValue: true,
        })
      : tabCdp<Evaluated>(tab.id, "Runtime.callFunctionOn", {
          objectId: id,
          functionDeclaration: "function () { return this; }",
          returnByValue: true,
        });
  };
  const r = await Promise.race([
    orDialog(tab.id, call()),
    sleep(EVAL_TIMEOUT).then(() => null),
  ]).finally(() => {
    tabCdp(tab.id, "Runtime.releaseObjectGroup", { objectGroup: EVAL_GROUP }).catch(() => {});
  });
  if (r === DIALOG) return `${header(tab)}\n${dialogNote(tab.id)}`;
  if (r === null) {
    throw new Error(`No value after ${EVAL_TIMEOUT / 1000}s (a promise that never settles?).`);
  }
  if (r.exceptionDetails) {
    const ex = r.exceptionDetails;
    throw new Error(`Threw: ${cut(ex.exception?.description ?? ex.text, MAX_EVAL)}`);
  }
  return cut(formatEvalValue(r.result), MAX_EVAL);
}

const WAIT_DEFAULT = 10;
const WAIT_MAX = 30;

interface WaitSpec {
  text?: string;
  gone?: string;
  url?: string;
  timeoutMs: number;
}

/** Validates wait_for's arguments: at least one condition; timeout in seconds, capped at 30. */
export function parseWaitFor(args: Args): WaitSpec {
  const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
  const spec = { text: str(args.text), gone: str(args.gone), url: str(args.url) };
  if (!spec.text && !spec.gone && !spec.url) {
    throw new Error("Pass text (to appear), gone (to disappear) or url (to contain), or several.");
  }
  const t = args.timeout == null ? WAIT_DEFAULT : Number(args.timeout);
  if (!Number.isFinite(t) || t <= 0) throw new Error("timeout is in seconds, e.g. 10.");
  return { ...spec, timeoutMs: Math.min(t, WAIT_MAX) * 1000 };
}

/** The conditions not met yet, as phrases; empty once all hold. */
export function waitPending(spec: WaitSpec, pageText: string, url: string): string[] {
  return [
    spec.text != null && !pageText.includes(spec.text) ? `text "${spec.text}" to appear` : "",
    spec.gone != null && pageText.includes(spec.gone) ? `text "${spec.gone}" to disappear` : "",
    spec.url != null && !url.includes(spec.url) ? `URL to contain "${spec.url}"` : "",
  ].filter(Boolean);
}

/**
 * The text wait_for matches against: the full snapshot (accessible names,
 * aria-labels) plus the body's rendered text, which the snapshot caps at 300
 * lines and 80 chars a name.
 */
async function pageText(tabId: string): Promise<string> {
  const nodes = await axTree(tabId);
  const r = await tabCdp<{ result: { value?: unknown } }>(tabId, "Runtime.evaluate", {
    expression: "document.body ? document.body.innerText : ''",
    returnByValue: true,
  });
  return `${formatSnapshot(nodes, { full: true })}\n${String(r.result.value ?? "")}`;
}

/** Polls until every condition holds or the timeout, then reports what the wait led to. */
async function waitForTool(args: Args): Promise<string> {
  const tab = tabOf(args);
  const spec = parseWaitFor(args);
  await showTab(tab);
  const urlBefore = (useTabsStore.getState().tabs[tab.id] ?? tab).url;
  const start = Date.now();
  let pending = waitPending(spec, "", urlBefore);
  let checked = false;
  while (Date.now() - start < spec.timeoutMs) {
    if (dialogs.has(tab.id)) break;
    const url = (useTabsStore.getState().tabs[tab.id] ?? tab).url;
    try {
      const text = spec.text || spec.gone ? await orDialog(tab.id, pageText(tab.id)) : "";
      if (text === DIALOG) break;
      pending = waitPending(spec, text, url);
      checked = true;
    } catch {
      // Mid-navigation: the next poll reads the new document.
    }
    if (checked && !pending.length) break;
    await sleep(250);
  }
  const secs = ((Date.now() - start) / 1000).toFixed(1);
  const met = [
    spec.text && `text "${spec.text}" appeared`,
    spec.gone && `text "${spec.gone}" is gone`,
    spec.url && `URL contains "${spec.url}"`,
  ].filter(Boolean);
  const verdict = dialogs.has(tab.id)
    ? `A dialog opened after ${secs}s${pending.length ? `; still waiting for ${pending.join(", ")}` : ""}.`
    : checked && !pending.length
      ? `Matched after ${secs}s: ${met.join(", ")}.`
      : `Timed out after ${secs}s; still waiting for ${pending.join(", ")}.`;
  return [verdict, ...(await consequences(tab, urlBefore))].join("\n");
}

/** Tools that need the page itself to answer; a dialog pauses it. */
const PAGE_TOOLS = new Set([
  "check",
  "snapshot",
  "act",
  "screenshot",
  "viewport",
  "eval",
  "wait_for",
]);

/**
 * Runs a tool and starts its reply with the developer's flags on the tab(s)
 * it touched (src/lib/agentFlags.ts). A call that fails leaves them queued for
 * the next one, so each flag reaches the agent exactly once, in a reply it
 * reads. `tabs` covers every localhost tab; `open` the tab it lands on.
 */
export async function runAgentTool(tool: string, args: Args, client = 0): Promise<string> {
  // Every tool below finds the agent through its args (tabOf).
  args = Object.assign({ ...args }, { [CLIENT]: client });
  connectedAt ??= Date.now();
  let target: string | undefined;
  if (tool !== "tabs" && tool !== "open") {
    try {
      target = resolveTab(args.tab).id;
    } catch {
      // The tool reports it.
    }
  }
  const text = await runPaused(tool, args);
  if (tool === "open") target = scopedTabs().find((t) => t.url === openUrl(args))?.id;
  const ids = tool === "tabs" ? scopedTabs().map((t) => t.id) : target ? [target] : [];
  const flags = useAgentFlagsStore.getState().take(ids);
  for (const f of flags) {
    const set = flaggedRefs.get(f.tabId) ?? new Set<number>();
    set.add(parseRef(f.ref));
    flaggedRefs.set(f.tabId, set);
  }
  return withFlags(text, flags, tool === "tabs");
}

/**
 * After a takeover: how the page differs from the agent's last snapshot of
 * it, so the agent knows what the developer changed before its own call runs.
 * Nothing for `open` and `tabs close` (no page of the agent's to compare), a
 * tab never snapshotted, a tab paused by a dialog, or a page that can't be read.
 */
async function takeoverDiff(tool: string, args: Args): Promise<string[]> {
  if (tool === "open" || tool === "tabs") return [];
  try {
    const tab = tabOf(args);
    const before = snapshots.get(view(tab));
    if (!before || dialogs.has(tab.id)) return [];
    const after = await takePage(tab.id);
    snapshots.set(view(tab), after);
    const diff = diffSnapshot(before.full, after.full);
    if (!diff.length) return ["Page unchanged since your last look."];
    return diff.length > after.compact.split("\n").length
      ? ["Page now:", await showPage(tab, after.compact)]
      : ["Page changes since your last look:", await showPage(tab, diff.join("\n"))];
  } catch {
    return [];
  }
}

/**
 * Runs one tool call. While the developer has paused the agent, calls that
 * act on a page wait (see agentPause.ts); once resumed they run, and their
 * reply leads with the takeover note and what changed meanwhile.
 */
async function runPaused(tool: string, args: Args): Promise<string> {
  if (!actsOnPage(tool, args)) return runNow(tool, args);
  const held = await holdWhilePaused();
  if (!held) return runNow(tool, args);
  if (held.kind === "timeout") return PAUSED_REPLY;
  if (held.kind === "stopped")
    throw new Error("The developer stopped the agent while it was paused.");
  const lead = [tookOverLine(held.pausedMs), ...(await takeoverDiff(tool, args))].join("\n");
  try {
    return `${lead}\n${await runNow(tool, args)}`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // `own`: the error without the lead, for the activity list.
    throw Object.assign(new Error(`${lead}\n${msg}`), { own: msg });
  }
}

async function runNow(tool: string, args: Args): Promise<string> {
  const answering = tool === "act" && (args.action === "accept" || args.action === "dismiss");
  if (PAGE_TOOLS.has(tool) && !answering) {
    const tab = resolveTab(args.tab);
    const note = dialogNote(tab.id);
    if (note)
      return `${header(tab)}
${note}`;
  }
  switch (tool) {
    case "tabs":
      return tabsTool(args);
    case "check":
      return checkTool(args);
    case "snapshot":
      return snapshotTool(args);
    case "act":
      return actTool(args);
    case "open":
      return openTool(args);
    case "errors":
      return errorsTool(args);
    case "network":
      return networkTool(args);
    case "screenshot":
      return screenshotTool(args);
    case "viewport":
      return viewportTool(args);
    case "eval":
      return evalTool(args);
    case "wait_for":
      return waitForTool(args);
    case "mock":
      return mockTool(resolveTab(args.tab), args);
    case "recording":
      return recordingTool(args.playwright === true);
    default:
      throw new Error(`Unknown tool "${tool}".`);
  }
}

/**
 * Mirrors the status, and drops the agents' mocks and header rules once the
 * last one disconnects: a mock left behind would keep answering the
 * developer's app with canned data nobody remembers adding.
 */
function setStatus(s: AgentStatus): void {
  const wasConnected = useAgentStore.getState().clients.length > 0;
  useAgentStore.setState(s);
  if (!wasConnected && s.clients.length) connectedAt = Date.now();
  if (wasConnected && !s.clients.length) {
    dropAgentRules();
    // The next agent gets the whole story, "before you connected" included.
    connectedAt = null;
    cursors.clear();
    // Ids aren't reused, so the views of agents that left are dead weight.
    snapshots.clear();
    forgetReported();
  }
  // A pause nobody can see (the indicator hides with no agent) or that Stop
  // overrides would only surprise the next agent.
  if (!s.enabled || !s.clients.length) cancelPause();
}

/** The tab a call is about, for the activity list; null when it names none that resolves. */
function callTab(tool: string, args: Args): { id: string | null; label: string } {
  if (tool === "tabs") {
    const close = typeof args.close === "string" ? args.close : "";
    return { id: null, label: close ? `[${close.slice(0, 8)}]` : "" };
  }
  try {
    const t = resolveTab(args.tab);
    return { id: t.id, label: `[${shortId(t)}] ${t.url}` };
  } catch {
    return { id: null, label: "" };
  }
}

/** Tools whose reply ends with what the call caused (consequences, or new problems for `check`). */
const TELLS_OUTCOME = new Set(["act", "check", "open", "wait_for", "viewport"]);

/**
 * The line of a failed reply that says what went wrong: a failed `steps`
 * batch lists the steps that worked before its `Step N (…) failed:` line.
 */
export function errorLine(text: string): string {
  return firstLine(text.split("\n").find((l) => /^Step \d+ \(\w+\) failed: /.test(l)) ?? text);
}

/** Runs a call and records it in the activity list (roadmap S6). */
export async function handleAgentCall(
  tool: string,
  args: Args,
  client = 0,
): Promise<{ ok: boolean; text: string }> {
  const at = Date.now();
  // `open` has no tab until it runs; it brings the one it opened forward, so
  // afterwards that's the default tab.
  let tab = tool === "open" ? { id: null, label: "" } : callTab(tool, args);
  let ok = true;
  let text: string;
  // The error itself, without a takeover lead (runPaused).
  let own = "";
  try {
    text = await runAgentTool(tool, args, client);
  } catch (err) {
    ok = false;
    text = err instanceof Error ? err.message : String(err);
    own = (err as { own?: string }).own ?? text;
  }
  if (tool === "open" && ok) tab = callTab(tool, {});
  // Flags may lead the reply (withFlags), so look past them.
  const tookOver = /^The developer took over/m.test(text);
  const paused = ok && text.endsWith(PAUSED_REPLY);
  useAgentActivityStore.getState().record(
    {
      at,
      tool,
      tabId: tab.id,
      tabLabel: tab.label,
      summary: summarizeCall(args),
      // A failed batch still did its earlier steps.
      what: tool === "act" ? actDid(text) : "",
      outcome: ok && TELLS_OUTCOME.has(tool) && !paused ? outcomeOf(text) : "",
      why: typeof args.why === "string" ? firstLine(args.why) : "",
      error: ok ? null : errorLine(own),
      ms: Date.now() - at,
      note: paused ? "paused, not run" : tookOver ? "ran after takeover" : null,
    },
    actsOnPage(tool, args) && !paused,
  );
  return { ok, text };
}

/** Subscribes the dispatcher and the status mirror. */
/**
 * Request ids already taken. In dev, React StrictMode mounts the bridge twice
 * and for a while two `agent://request` listeners exist, so every call ran
 * twice: text typed twice, a dialog answered by one run and then missing for
 * the other. Module-level, so every listener shares it.
 */
const taken = new Set<number>();

export function listenForAgents(): Promise<UnlistenFn>[] {
  getAgentStatus()
    .then(setStatus)
    .catch(() => {});
  return [
    onAgentStatus(setStatus),
    onDialog(({ tabId, open, type, message }) => {
      if (open) dialogs.set(tabId, { type: type ?? "alert", message: message ?? "" });
      else dialogs.delete(tabId);
    }),
    onAgentRequest(async ({ id, client, tool, args }) => {
      if (taken.has(id)) return;
      taken.add(id);
      // ponytail: ids only grow, so a bounded window is enough.
      if (taken.size > 1000) taken.delete(taken.values().next().value as number);
      const { ok, text } = await handleAgentCall(tool, args ?? {}, client ?? 0);
      agentReply(id, ok, text).catch(() => {});
    }).then((unlisten) => {
      agentReady().catch(() => {});
      return unlisten;
    }),
  ];
}
