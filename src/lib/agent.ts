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
  pendingRequests,
  revealWindow,
  tabCdp,
  webviewReload,
} from "@/services/browser";
import { useAgentStore } from "@/stores/agent";
import { firstLine, summarizeCall, useAgentActivityStore } from "@/stores/agentActivity";
import { useAgentFlagsStore } from "@/stores/agentFlags";
import { type ConsoleEntry, useConsoleStore } from "@/stores/console";
import { type NetworkLogEntry, useNetworkStore } from "@/stores/network";
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

function tabsTool(args: Args = {}): string {
  if (typeof args.close === "string" && args.close) return closeAgentTab(args.close);
  const tabs = scopedTabs();
  const counts = useConsoleStore.getState().countsByTab;
  const activeId = getActiveTabId();
  const lines = tabs.map((t) => {
    const c = counts[t.id];
    const problems = c && c.errors + c.failed ? ` — ${c.errors} errors, ${c.failed} failed` : "";
    const yours = isAgentOpened(t.id) ? " (opened by you)" : "";
    return `${t.id === activeId ? "*" : " "} ${header(t)}${yours}${problems}`;
  });
  const open = new Set(tabs.map((t) => new URL(t.url).port));
  const idle = useServersStore
    .getState()
    .servers.filter((s) => s.isAlive && !open.has(String(s.port)))
    .map((s) => `  ${s.protocol}://localhost:${s.port}${s.title ? ` "${s.title}"` : ""}`);
  const hidden = Object.keys(useTabsStore.getState().tabs).length - tabs.length;
  return [
    tabs.length ? "Tabs you can use (* = active):" : `No tabs you can use (${SCOPE}).`,
    ...lines,
    ...section("dev servers without a tab", idle),
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
function closeAgentTab(arg: string): string {
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
  for (const m of [snapshots, cursors, emulated, dialogs]) m.delete(t.id);
  return `Closed [${shortId(t)}] ${t.url}\n${tabsTool()}`;
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
function problemReport(tab: Tab, delta: boolean): string[] {
  const rows = useNetworkStore.getState().entriesByTab[tab.id] ?? [];
  if (delta) cursors.set(tab.id, { at: Date.now() });
  return report(tabProblems(tab.id, rows, origin(tab)), delta, connectedAt);
}

/** Errors and failed requests since the last report, as lines (none: empty). */
const newProblems = (tab: Tab) => problemReport(tab, true);

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
 */
const QUIET_PROBE = `(() => {
  const k = "__zynlexQuiet";
  if (!window[k]) {
    window[k] = { t: performance.now() };
    new MutationObserver(() => { window[k].t = performance.now(); })
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

/**
 * What happened after an action: settle note, URL change, tabs it opened (when
 * given the `popupMark` from before it), page diff, new problems.
 */
async function consequences(tab: Tab, urlBefore: string, mark?: number): Promise<string[]> {
  const unsettled = await settle(tab.id);
  const now = useTabsStore.getState().tabs[tab.id] ?? tab;
  if (dialogs.has(tab.id)) {
    // The page is paused: its tree can't be read until the dialog is answered.
    const problems = newProblems(now);
    return [dialogNote(tab.id) as string, ...popupLines(tab, mark), ...problems];
  }
  const before = snapshots.get(tab.id);
  const after = await takePage(tab.id);
  snapshots.set(tab.id, after);
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
    ...popupLines(tab, mark),
    ...page,
    ...(problems.length ? problems : ["No new errors or failed requests."]),
  ];
}

async function checkTool(args: Args): Promise<string> {
  const tab = resolveTab(args.tab);
  const since = cursors.get(tab.id);
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
    snapshots.set(tab.id, now);
    page = ["Page:", await showPage(tab, now.compact)];
  }
  return [
    header(useTabsStore.getState().tabs[tab.id] ?? tab),
    ...(unsettled ? [unsettled] : []),
    when,
    ...(body.length ? body : ["No new errors or failed requests."]),
    ...page,
  ].join("\n");
}

async function snapshotTool(args: Args): Promise<string> {
  const tab = resolveTab(args.tab);
  const within = args.within == null ? undefined : parseRef(args.within);
  const full = !!args.full;
  if (full || within != null) {
    const text = formatSnapshot(await axTree(tab.id), { full, within });
    return `${header(tab)}\n${await showPage(tab, text)}`;
  }
  // "Unchanged" goes by the full text: a total that changed is a change.
  const now = await takePage(tab.id);
  const unchanged = snapshots.get(tab.id)?.full === now.full;
  snapshots.set(tab.id, now);
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
const HIT_TEST = `function (p) {
  let x = p.x, y = p.y;
  for (let w = this.ownerDocument.defaultView; w && w.frameElement; w = w.parent) {
    const f = w.frameElement, r = f.getBoundingClientRect(), s = getComputedStyle(f);
    x -= r.left + f.clientLeft + parseFloat(s.paddingLeft);
    y -= r.top + f.clientTop + parseFloat(s.paddingTop);
  }
  const root = this.getRootNode();
  const t = (root.elementFromPoint ? root : document).elementFromPoint(x, y);
  if (!t) return "nothing (it is off screen)";
  if (this === t || this.contains(t)) return "";
  const name = (t.getAttribute("aria-label") || t.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 40);
  return t.tagName.toLowerCase() + (t.id ? "#" + t.id : "") + (name ? ' "' + name + '"' : "");
}`;

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
    throw new Error(
      `e${backendNodeId} is covered by ${cover} at its centre, so a ${verb} would land on that instead. Nothing was done.`,
    );
  }
  return p;
}

/** A real mouse click at the element's centre. */
async function click(tabId: string, backendNodeId: number): Promise<void> {
  const { x, y } = await aim(tabId, backendNodeId, "click");
  const at = { x, y, button: "left", clickCount: 1 };
  await sendInput(tabId, "Input.dispatchMouseEvent", [
    { type: "mouseMoved", x, y },
    { type: "mousePressed", ...at },
    { type: "mouseReleased", ...at },
  ]);
}

/** Moves the mouse onto the element's centre (hover menus, tooltips). */
async function hover(tabId: string, backendNodeId: number): Promise<void> {
  const { x, y } = await aim(tabId, backendNodeId, "hover");
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
  const p = await aim(tabId, from, "drag");
  const q = await centre(tabId, to);
  const cover = await callOn(tabId, to, HIT_TEST, q);
  if (cover) {
    throw new Error(
      `Drop target e${to} is covered by ${cover} at its centre (or off screen with the source in view). Nothing was dragged.`,
    );
  }
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
 * WebView2 reports every CDP error as E_INVALIDARG, dropping CDP's own
 * message; for an element-scoped call that almost always means the node is
 * gone (re-render, navigation, reload). Then the agent gets the current page
 * instead; any other error is passed on.
 */
async function rethrowStale(
  tab: Tab,
  ref: number | null,
  err: unknown,
  to: number | null = null,
): Promise<never> {
  const msg = err instanceof Error ? err.message : String(err);
  if (ref != null && /0x80070057|no node|could not find node/i.test(msg)) {
    const fresh = await takePage(tab.id);
    snapshots.set(tab.id, fresh);
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
  const mark = popupMark();
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
    await rethrowStale(tab, ref, err, to);
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

/**
 * One action, or `steps`: several in order in one call (click, type, press
 * Enter; click then accept the confirm), so a known sequence costs one model
 * turn instead of one per action. Settles between steps; a dialog a step opens
 * is answered only if the next step is accept/dismiss, else the batch stops
 * there. The reply is every step's line, then what they caused together; a
 * failing step ends the batch with what the page looks like at that point.
 */
async function actTool(args: Args): Promise<string> {
  const tab = resolveTab(args.tab);
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
  if (!snapshots.has(tab.id) && !dialogs.has(tab.id)) {
    snapshots.set(tab.id, await takePage(tab.id));
  }
  const before = snapshots.get(tab.id);
  const labelOf = (r: number | null) =>
    r == null
      ? ""
      : (before?.compact
          .split("\n")
          .find((l) => l.includes(`[e${r}]`))
          ?.trim() ?? `e${r}`);
  const urlBefore = (useTabsStore.getState().tabs[tab.id] ?? tab).url;
  const mark = popupMark();
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
  const tab = useTabsStore.getState().tabs[id];
  await showTab(tab);
  // A fresh page: report it whole, not as a diff against an old visit.
  snapshots.delete(id);
  const lines = await consequences(tab, url);
  // The header already says where the page is; "Navigated to" would only
  // echo a redirect or a trailing slash.
  return [
    header(useTabsStore.getState().tabs[id] ?? tab),
    ...lines.filter((l) => !l.startsWith("Navigated to ")),
  ].join("\n");
}

/** Severity order for `errors level=…`: each level includes the ones before it. */
const LEVELS = ["error", "warning", "info", "log"] as const;

function errorsTool(args: Args): string {
  const tab = resolveTab(args.tab);
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

async function requestDetail(tab: Tab, n: NetworkLogEntry): Promise<string> {
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

async function networkTool(args: Args): Promise<string> {
  const tab = resolveTab(args.tab);
  const rows = useNetworkStore.getState().entriesByTab[tab.id] ?? [];
  if (typeof args.id === "string" && args.id) {
    const hit = rows.find((n) => n.id === args.id);
    if (!hit) throw new Error(`No request ${args.id} in this tab.`);
    return requestDetail(tab, hit);
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

/**
 * Emulates a device (or a plain width×height) in a tab through CDP, the same
 * overrides the Viewport panel uses: size and pixel ratio, mobile, touch, and
 * the device's user agent. The page lays out at that size inside the tab, so
 * the developer sees it too. `reset` clears all of it.
 */
async function viewportTool(args: Args): Promise<string> {
  const tab = resolveTab(args.tab);
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
  const tab = resolveTab(args.tab);
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
  const tab = resolveTab(args.tab);
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
  const tab = resolveTab(args.tab);
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
export async function runAgentTool(tool: string, args: Args): Promise<string> {
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
  return withFlags(text, useAgentFlagsStore.getState().take(ids), tool === "tabs");
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
    const tab = resolveTab(args.tab);
    const before = snapshots.get(tab.id);
    if (!before || dialogs.has(tab.id)) return [];
    const after = await takePage(tab.id);
    snapshots.set(tab.id, after);
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
    throw new Error(`${lead}\n${err instanceof Error ? err.message : String(err)}`);
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

/** Runs a call and records it in the activity list (roadmap S6). */
export async function handleAgentCall(
  tool: string,
  args: Args,
): Promise<{ ok: boolean; text: string }> {
  const at = Date.now();
  // `open` has no tab until it runs; it brings the one it opened forward, so
  // afterwards that's the default tab.
  let tab = tool === "open" ? { id: null, label: "" } : callTab(tool, args);
  let ok = true;
  let text: string;
  try {
    text = await runAgentTool(tool, args);
  } catch (err) {
    ok = false;
    text = err instanceof Error ? err.message : String(err);
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
      // A takeover note leads the reply; the error is the line after it.
      error: ok ? null : firstLine(tookOver ? text.split("\n").slice(1).join("\n") : text),
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
    onAgentRequest(async ({ id, tool, args }) => {
      if (taken.has(id)) return;
      taken.add(id);
      // ponytail: ids only grow, so a bounded window is enough.
      if (taken.size > 1000) taken.delete(taken.values().next().value as number);
      const { ok, text } = await handleAgentCall(tool, args ?? {});
      agentReply(id, ok, text).catch(() => {});
    }).then((unlisten) => {
      agentReady().catch(() => {});
      return unlisten;
    }),
  ];
}
