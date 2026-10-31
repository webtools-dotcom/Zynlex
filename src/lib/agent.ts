/**
 * Answers AI-agent tool calls (see docs/agent-interface.md). Rust forwards each
 * call from zynlex-mcp as an `agent://request`; the reply goes back through
 * `agent_reply`. Everything is read from the stores the panels already use.
 *
 * Output is terse plain text: it lands in a model's context, so every line
 * costs tokens. Only localhost tabs are visible to an agent. Every call that
 * acts on a page returns what the action caused, so the agent never needs a
 * second call to find out.
 */
import type { UnlistenFn } from "@tauri-apps/api/event";
import { getActiveTabId } from "@/hooks/useActiveScope";
import { type AXNode, diffSnapshot, formatSnapshot } from "@/lib/agentSnapshot";
import { openTab } from "@/lib/tabActions";
import { isLoopbackUrl } from "@/lib/url";
import { useAgentStore } from "@/stores/agent";
import { type ConsoleEntry, isFailedRequest, useConsoleStore } from "@/stores/console";
import { type NetworkLogEntry, useNetworkStore } from "@/stores/network";
import { useServersStore } from "@/stores/servers";
import { useTabsStore } from "@/stores/tabs";
import { useWorkspacesStore } from "@/stores/workspaces";
import {
  agentReply,
  captureScreenshot,
  getAgentStatus,
  onAgentRequest,
  onAgentStatus,
  pendingRequests,
  revealWindow,
  tabCdp,
  webviewReload,
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
/** The browser's own favicon probe isn't the app's failure (console.rs drops it too). */
const isFailedRow = (n: NetworkLogEntry) =>
  n.statusCode >= 400 && !/\/favicon\.ico$/.test(n.url.split(/[?#]/)[0]);
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
 * Per tab, what's already been reported: each console entry's repeat count
 * (an entry seen again with a higher count is news) and the newest network
 * row number. Ids, not timestamps: two messages in one millisecond are common.
 */
const cursors = new Map<string, { seen: Map<string, number>; net: number; at: number }>();

/** Errors and failed requests since the last report, as lines (none: empty). Advances the cursor. */
function newProblems(tab: Tab): string[] {
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
  return [...section("errors", errors), ...section("failed requests", failed)];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
    try {
      const r = await tabCdp<{ result: { value?: typeof state } }>(tabId, "Runtime.evaluate", {
        expression: QUIET_PROBE,
        returnByValue: true,
      });
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

async function axTree(tabId: string): Promise<AXNode[]> {
  return (await tabCdp<{ nodes: AXNode[] }>(tabId, "Accessibility.getFullAXTree")).nodes;
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

/** What happened after an action: settle note, URL change, page diff, new problems. */
async function consequences(tab: Tab, urlBefore: string): Promise<string[]> {
  const unsettled = await settle(tab.id);
  const now = useTabsStore.getState().tabs[tab.id] ?? tab;
  const before = snapshots.get(tab.id);
  const after = await takePage(tab.id);
  snapshots.set(tab.id, after);
  const diff = before == null ? [] : diffSnapshot(before.full, after.full);
  // A diff longer than the page itself is worse than just the page.
  const page =
    before == null || diff.length > after.compact.split("\n").length
      ? ["Page:", after.compact]
      : diff.length
        ? ["Page changes:", ...diff]
        : ["Page unchanged."];
  const problems = newProblems(now);
  return [
    ...(unsettled ? [unsettled] : []),
    ...(now.url !== urlBefore ? [`Navigated to ${now.url}`] : []),
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
    page = ["Page:", now.compact];
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
    return `${header(tab)}\n${formatSnapshot(await axTree(tab.id), { full, within })}`;
  }
  // "Unchanged" goes by the full text: a total that changed is a change.
  const now = await takePage(tab.id);
  const unchanged = snapshots.get(tab.id)?.full === now.full;
  snapshots.set(tab.id, now);
  return `${header(tab)}\n${unchanged ? "Unchanged since your last snapshot." : now.compact}`;
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

async function pressKey(tabId: string, key: string): Promise<void> {
  const k = KEYS[key];
  if (!k) throw new Error(`Unknown key "${key}". Known: ${Object.keys(KEYS).join(", ")}.`);
  const base = { key: key === "Space" ? " " : key, windowsVirtualKeyCode: k.code };
  await tabCdp(tabId, "Input.dispatchKeyEvent", { type: "keyDown", ...base, text: k.text });
  await tabCdp(tabId, "Input.dispatchKeyEvent", { type: "keyUp", ...base });
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
 * shadow tree isn't mistaken for being covered by its host.
 */
const HIT_TEST = `function (p) {
  const root = this.getRootNode();
  const t = (root.elementFromPoint ? root : document).elementFromPoint(p.x, p.y);
  if (!t) return "nothing (it is off screen)";
  if (this === t || this.contains(t)) return "";
  const name = (t.getAttribute("aria-label") || t.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 40);
  return t.tagName.toLowerCase() + (t.id ? "#" + t.id : "") + (name ? ' "' + name + '"' : "");
}`;

/**
 * A real mouse click at the element's centre. Checks first that the element
 * is what's actually there: scrolled only just into view, it can sit under a
 * fixed header or footer, and a click would silently land on that instead.
 */
async function click(tabId: string, backendNodeId: number): Promise<void> {
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
      `e${backendNodeId} is covered by ${cover} at its centre, so a click would land on that instead. Nothing was clicked.`,
    );
  }
  const { x, y } = p;
  const at = { x, y, button: "left", clickCount: 1 };
  await tabCdp(tabId, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await tabCdp(tabId, "Input.dispatchMouseEvent", { type: "mousePressed", ...at });
  await tabCdp(tabId, "Input.dispatchMouseEvent", { type: "mouseReleased", ...at });
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

async function actTool(args: Args): Promise<string> {
  const tab = resolveTab(args.tab);
  const action = String(args.action ?? "");
  const text = typeof args.text === "string" ? args.text : "";
  const ref = action === "press" && args.ref == null ? null : parseRef(args.ref);
  await showTab(tab);
  if (!snapshots.has(tab.id)) snapshots.set(tab.id, await takePage(tab.id));
  const label =
    ref == null
      ? ""
      : (snapshots
          .get(tab.id)
          ?.compact.split("\n")
          .find((l) => l.includes(`[e${ref}]`))
          ?.trim() ?? `e${ref}`);
  const urlBefore = (useTabsStore.getState().tabs[tab.id] ?? tab).url;

  try {
    if (action === "click") {
      await click(tab.id, ref as number);
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
    } else {
      throw new Error(`Unknown action "${action}". Use click, type, select or press.`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // WebView2 reports every CDP error as E_INVALIDARG, dropping CDP's own
    // message; for an element-scoped call that almost always means the node
    // is gone (re-render, navigation, reload).
    if (ref != null && /0x80070057|no node|could not find node/i.test(msg)) {
      const fresh = await takePage(tab.id);
      snapshots.set(tab.id, fresh);
      throw new Error(`Stale ref e${ref}: that element is gone. Current page:\n${fresh.compact}`);
    }
    throw err;
  }

  const did =
    action === "type"
      ? `Typed ${JSON.stringify(text)} into ${label}`
      : action === "select"
        ? `Selected ${JSON.stringify(text)} in ${label}`
        : action === "press"
          ? `Pressed ${text}${label ? ` in ${label}` : ""}`
          : `Clicked ${label}`;
  return [did, ...(await consequences(tab, urlBefore))].join("\n");
}

async function openTool(args: Args): Promise<string> {
  const raw = typeof args.url === "string" ? args.url.trim() : "";
  const url = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  if (!raw || !isLoopbackUrl(url)) {
    throw new Error("open only takes localhost URLs (localhost, 127.0.0.1, *.localhost).");
  }
  const existing = scopedTabs().find((t) => t.url === url);
  const id = existing?.id ?? openTab({ url });
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
