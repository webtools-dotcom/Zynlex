/**
 * "Flag for agent" (docs/agent-interface.md#flag-for-agent): the developer
 * clicks an element in a localhost tab and types a note; the next agent call
 * that touches that tab gets it as the first line of its reply, with the
 * element's ref, so the agent sees what the person is pointing at.
 *
 * Picking uses CDP's Overlay inspect mode (the DevTools element picker). Its
 * events come back through console.rs's per-tab CDP subscription, like dialog
 * events: Rust-initiated, never page-originated IPC.
 */
import type { UnlistenFn } from "@tauri-apps/api/event";
import { getActiveTabId } from "@/hooks/useActiveScope";
import { type AXNode, INTERACTIVE } from "@/lib/agentSnapshot";
import { isLoopbackUrl } from "@/lib/url";
import { type InspectEvent, onInspect, tabCdp } from "@/services/browser";
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

/** DevTools' own picker colours, so the overlay looks like the tool it is. */
const HIGHLIGHT = {
  showInfo: true,
  contentColor: { r: 111, g: 168, b: 220, a: 0.66 },
  paddingColor: { r: 147, g: 196, b: 125, a: 0.55 },
  borderColor: { r: 255, g: 229, b: 153, a: 0.66 },
  marginColor: { r: 246, g: 178, b: 107, a: 0.66 },
};

async function inspectMode(tabId: string, on: boolean): Promise<void> {
  if (on) {
    // Overlay needs the DOM domain on.
    await tabCdp(tabId, "DOM.enable");
    await tabCdp(tabId, "Overlay.enable");
    await tabCdp(tabId, "Overlay.setInspectMode", {
      mode: "searchForNode",
      highlightConfig: HIGHLIGHT,
    });
  } else {
    await tabCdp(tabId, "Overlay.setInspectMode", { mode: "none" });
    await tabCdp(tabId, "Overlay.disable");
    await tabCdp(tabId, "DOM.disable");
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
  inspectMode(tab.id, true).catch(() => {
    if (useAgentFlagsStore.getState().pick?.tabId === tab.id) setPick(null);
    pushToast("Couldn't start picking in this tab", "danger");
  });
  return true;
}

/** Ends a flag flow without saving. False if none was running (Escape falls through). */
export function cancelFlag(): boolean {
  const { pick, setPick } = useAgentFlagsStore.getState();
  if (!pick) return false;
  if (!pick.target) inspectMode(pick.tabId, false).catch(() => {});
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

async function onPicked(e: InspectEvent): Promise<void> {
  const { pick, setPick } = useAgentFlagsStore.getState();
  if (!pick || pick.tabId !== e.tabId || pick.target) return;
  if (e.canceled || e.backendNodeId == null) {
    cancelFlag();
    return;
  }
  const id = e.backendNodeId;
  // A target at once, so the inspectModeCanceled that turning the mode off
  // may fire can't end the flow while the description loads.
  setPick({ tabId: e.tabId, target: { ref: `e${id}`, role: "element", name: "" } });
  inspectMode(e.tabId, false).catch(() => {});
  const target = await describe(e.tabId, id);
  const now = useAgentFlagsStore.getState().pick;
  if (now?.tabId === e.tabId && now.target?.ref === `e${id}`) setPick({ tabId: e.tabId, target });
}

export function listenForFlags(): Promise<UnlistenFn> {
  return onInspect((e) => {
    onPicked(e).catch(() => {});
  });
}
