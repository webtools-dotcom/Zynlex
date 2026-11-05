/**
 * "Flag for agent" (docs/agent-interface.md#flag-for-agent): the developer
 * clicks an element in a localhost tab and types a note; the next agent call
 * that touches that tab gets it as the first line of its reply, with the
 * element's ref, so the agent sees what the person is pointing at.
 *
 * Picking runs a small script in the tab through `Runtime.evaluate` that
 * highlights what's under the mouse and resolves with the clicked element; the
 * CDP call simply waits for it (Rust-initiated, never page-originated IPC).
 * Not Overlay inspect mode: in WebView2 it leaves the tab ignoring the agent's
 * `Input.dispatchMouseEvent` clicks after it's turned off.
 */
import { getActiveTabId } from "@/hooks/useActiveScope";
import { type AXNode, INTERACTIVE } from "@/lib/agentSnapshot";
import { isLoopbackUrl } from "@/lib/url";
import { tabCdp } from "@/services/browser";
import { type AgentFlag, type FlagTarget, useAgentFlagsStore } from "@/stores/agentFlags";
import { useTabsStore } from "@/stores/tabs";
import { useUIStore } from "@/stores/ui";

const MAX_NAME = 80;
const MAX_NOTE = 300;

const oneLine = (s: string, max: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
};

/** `Developer flagged e15 button "Apply": does nothing on mobile`. */
export function flagLine(f: AgentFlag, withTab = false): string {
  const name = f.name ? ` "${oneLine(f.name, MAX_NAME)}"` : "";
  const where = withTab ? ` in [${f.tabId.slice(0, 8)}]` : "";
  const note = oneLine(f.note, MAX_NOTE);
  return `Developer flagged ${f.ref} ${f.role}${name}${where}${note ? `: ${note}` : ""}`;
}

/**
 * Prepends the flags to a reply. `withTab` names each flag's tab, for replies
 * that cover several tabs (`tabs`).
 */
export function withFlags(text: string, flags: AgentFlag[], withTab = false): string {
  if (!flags.length) return text;
  return [...flags.map((f) => flagLine(f, withTab)), text].join("\n");
}

/** Roles that say nothing about what an element is; the tag name says more. */
const VAGUE = new Set(["", "generic", "none", "presentation", "StaticText", "InlineTextBox"]);

/** The parts of an AX node this reads; `parentId` is newer CDP, childIds cover older. */
type PickedNode = AXNode & { parentId?: string };

const text = (v: unknown) => (typeof v === "string" ? v : "");

/**
 * What the developer clicked, as the agent should see it. A click usually
 * lands on something inside a control (the icon in a button, the span in a
 * link), so the nearest interactive ancestor wins, ref and all: that's the
 * ref the agent can `act` on. Otherwise the clicked element itself, named by
 * its role, or its tag when the role is just "generic".
 */
export function describePicked(nodes: PickedNode[], backendNodeId: number, tag = ""): FlagTarget {
  const byId = new Map(nodes.map((n) => [n.nodeId, n]));
  const parent = new Map<string, string>();
  for (const n of nodes) {
    for (const c of n.childIds ?? []) parent.set(c, n.nodeId);
    if (n.parentId) parent.set(n.nodeId, n.parentId);
  }
  const start = nodes.find((n) => n.backendDOMNodeId === backendNodeId);
  const path: PickedNode[] = [];
  for (let n = start; n && path.length < 50; n = byId.get(parent.get(n.nodeId) ?? "")) {
    path.push(n);
  }
  const control = path.find(
    (n) => !n.ignored && INTERACTIVE.has(text(n.role?.value)) && n.backendDOMNodeId != null,
  );
  if (control) {
    return {
      ref: `e${control.backendDOMNodeId}`,
      role: text(control.role?.value),
      name: text(control.name?.value),
    };
  }
  const own = start && !start.ignored ? start : undefined;
  const role = text(own?.role?.value);
  return {
    ref: `e${backendNodeId}`,
    role: VAGUE.has(role) ? tag || role || "element" : role,
    name: text(own?.name?.value),
  };
}

/**
 * Highlights the element under the mouse and resolves with the one clicked
 * (null on Escape or cancel). The click and its press/release never reach the
 * page. `__zynlexFlagCancel` lets `cancelFlag` end it from the app.
 */
const PICKER = `new Promise((resolve) => {
  window.__zynlexFlagCancel?.();
  const box = document.createElement("div");
  box.style.cssText = "position:fixed;z-index:2147483647;pointer-events:none;display:none;" +
    "background:rgba(111,168,220,.35);outline:2px solid rgb(111,168,220)";
  document.documentElement.append(box);
  const block = (e) => { e.preventDefault(); e.stopImmediatePropagation(); };
  const on = [
    ["mousemove", (e) => {
      const r = e.target.getBoundingClientRect();
      Object.assign(box.style, { display: "block", left: r.left + "px", top: r.top + "px",
        width: r.width + "px", height: r.height + "px" });
    }],
    ["pointerdown", block], ["mousedown", block], ["pointerup", block], ["mouseup", block],
    ["click", (e) => { block(e); done(e.target); }],
    ["keydown", (e) => { if (e.key === "Escape") { block(e); done(null); } }],
  ];
  const done = (el) => {
    for (const [t, f] of on) removeEventListener(t, f, true);
    box.remove();
    delete window.__zynlexFlagCancel;
    resolve(el);
  };
  for (const [t, f] of on) addEventListener(t, f, true);
  window.__zynlexFlagCancel = () => done(null);
})`;

const PICK_GROUP = "zynlex-agent-flag";

/** The clicked element's backendNodeId, or null when picking was cancelled. */
async function pickElement(tabId: string): Promise<number | null> {
  const r = await tabCdp<{ result: { objectId?: string } }>(tabId, "Runtime.evaluate", {
    expression: PICKER,
    awaitPromise: true,
    objectGroup: PICK_GROUP,
  });
  try {
    if (!r.result.objectId) return null;
    const d = await tabCdp<{ node: { backendNodeId: number } }>(tabId, "DOM.describeNode", {
      objectId: r.result.objectId,
    });
    return d.node.backendNodeId;
  } finally {
    tabCdp(tabId, "Runtime.releaseObjectGroup", { objectGroup: PICK_GROUP }).catch(() => {});
  }
}

async function describe(tabId: string, backendNodeId: number): Promise<FlagTarget> {
  const [ax, dom] = await Promise.all([
    tabCdp<{ nodes: PickedNode[] }>(tabId, "Accessibility.getPartialAXTree", {
      backendNodeId,
      fetchRelatives: true,
    }).catch(() => ({ nodes: [] })),
    tabCdp<{ node: { localName?: string } }>(tabId, "DOM.describeNode", { backendNodeId }).catch(
      () => ({ node: {} as { localName?: string } }),
    ),
  ]);
  return describePicked(ax.nodes, backendNodeId, dom.node.localName ?? "");
}

/** The `agent.flag` command: inspect mode on in the active tab. */
export function startFlag(): boolean {
  const tabId = getActiveTabId();
  const tab = tabId ? useTabsStore.getState().tabs[tabId] : undefined;
  if (!tab) return false;
  const { pushToast } = useUIStore.getState();
  if (!isLoopbackUrl(tab.url)) {
    pushToast("Flag for agent works in localhost tabs, the ones an agent can see", "info");
    return true;
  }
  cancelFlag();
  const { setPick } = useAgentFlagsStore.getState();
  setPick({ tabId: tab.id });
  pickElement(tab.id)
    .then((id) => onPicked(tab.id, id))
    .catch(() => {
      // A reload or navigation mid-pick lands here too.
      if (useAgentFlagsStore.getState().pick?.tabId !== tab.id) return;
      setPick(null);
      pushToast("Couldn't pick an element in this tab", "danger");
    });
  return true;
}

/** Ends a flag flow without saving. False if none was running (Escape falls through). */
export function cancelFlag(): boolean {
  const { pick, setPick } = useAgentFlagsStore.getState();
  if (!pick) return false;
  if (!pick.target) {
    tabCdp(pick.tabId, "Runtime.evaluate", {
      expression: "window.__zynlexFlagCancel?.()",
    }).catch(() => {});
  }
  setPick(null);
  return true;
}

/** Queues the picked element with the note and ends the flow. */
export function saveFlag(note: string): void {
  const { pick, setPick, add } = useAgentFlagsStore.getState();
  if (!pick?.target) return;
  add({ tabId: pick.tabId, ...pick.target, note: note.trim() });
  setPick(null);
  useUIStore
    .getState()
    .pushToast("Flagged: the agent's next reply on this tab starts with it", "success");
}

async function onPicked(tabId: string, id: number | null): Promise<void> {
  const { pick, setPick } = useAgentFlagsStore.getState();
  if (!pick || pick.tabId !== tabId || pick.target) return;
  if (id == null) {
    cancelFlag();
    return;
  }
  // A target at once, so the note input shows while the description loads.
  setPick({ tabId, target: { ref: `e${id}`, role: "element", name: "" } });
  const target = await describe(tabId, id);
  const now = useAgentFlagsStore.getState().pick;
  if (now?.tabId === tabId && now.target?.ref === `e${id}`) setPick({ tabId, target });
}
