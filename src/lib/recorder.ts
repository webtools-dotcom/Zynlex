/**
 * Records the developer's own steps in a localhost tab for an agent to read
 * (`recording` tool; agent-roadmap M2). The page never calls out: the
 * listener in RECORDER_SCRIPT buffers events and this module drains them with
 * its own `Runtime.evaluate` every POLL_MS, then resolves each element to a
 * ref with `DOM.describeNode` and to a role and name with the accessibility
 * tree, the same words a snapshot uses. Errors, failed requests and URL
 * changes are copied from the console, network and tabs stores as they
 * arrive (a navigation clears the first two).
 */
import {
  addStep,
  errorText,
  fallbackTarget,
  formatRecording,
  type Happening,
  type RawEvent,
  RECORDER_SCRIPT,
  type Recording,
  shortUrl,
  type Target,
  toStep,
} from "@/lib/agentRecord";
import { agentCanUse } from "@/lib/agentScope";
import type { AXNode } from "@/lib/agentSnapshot";
import { toPlaywrightTest } from "@/lib/playwrightExport";
import { setNetworkCapture, tabCdp } from "@/services/browser";
import { isFailedRequest, useConsoleStore } from "@/stores/console";
import { useHeadersStore } from "@/stores/headers";
import { useMocksStore } from "@/stores/mocks";
import { useNetworkStore } from "@/stores/network";
import { useRecordingStore } from "@/stores/recording";
import { useTabsStore } from "@/stores/tabs";
import { useUIStore } from "@/stores/ui";

const POLL_MS = 300;
const DRAIN_WAIT = 2000;
const HANDLE = `window[Symbol.for("zynlex.recorder")]`;

interface Session {
  rec: Recording;
  origin: string;
  scriptId: string | null;
  timer: ReturnType<typeof setInterval>;
  unsubs: (() => void)[];
  draining: Promise<void> | null;
}

let session: Session | null = null;

const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));

/** Publishes the working copy so the status bar re-renders. */
function publish(s: Session): void {
  useRecordingStore.setState({ rec: { ...s.rec, steps: [...s.rec.steps] }, active: true });
}

/** The element behind a buffered event: its ref, role and name, and its attributes. */
async function resolveTarget(
  tabId: string,
  raw: RawEvent,
): Promise<{ target: Target | null; attributes?: string[] }> {
  if (!raw.tag) return { target: null };
  const fallback = { target: fallbackTarget(raw) };
  const r = await tabCdp<{ result: { objectId?: string } }>(tabId, "Runtime.evaluate", {
    expression: `${HANDLE}?.el(${raw.seq})`,
  }).catch(() => null);
  const objectId = r?.result.objectId;
  if (!objectId) return fallback;
  try {
    const { node } = await tabCdp<{ node: { backendNodeId: number; attributes?: string[] } }>(
      tabId,
      "DOM.describeNode",
      { objectId },
    );
    const ref = node.backendNodeId;
    let role = "";
    let name = "";
    try {
      const { nodes } = await tabCdp<{ nodes: AXNode[] }>(tabId, "Accessibility.getPartialAXTree", {
        backendNodeId: ref,
        fetchRelatives: false,
      });
      const n = nodes.find((x) => x.backendDOMNodeId === ref) ?? nodes[0];
      if (n && !n.ignored) {
        role = str(n.role?.value);
        name = str(n.name?.value);
      }
    } catch {
      // A detached element has no accessibility node; the page's own words stand in.
    }
    const fb = fallback.target;
    if (!role || role === "none" || role === "StaticText") role = fb?.role ?? "element";
    return { target: { role, name: name || fb?.name || "", ref }, attributes: node.attributes };
  } catch {
    return fallback;
  } finally {
    tabCdp(tabId, "Runtime.releaseObject", { objectId }).catch(() => {});
  }
}

/** Takes what the page buffered and turns it into steps. One drain at a time. */
function drain(s: Session): Promise<void> {
  if (s.draining) return s.draining;
  const tabId = s.rec.tabId;
  s.draining = (async () => {
    const r = await tabCdp<{ result: { value?: RawEvent[] | null } }>(tabId, "Runtime.evaluate", {
      expression: `${HANDLE}?.drain() ?? null`,
      returnByValue: true,
    });
    const raws = r.result.value;
    if (raws == null) {
      // A new document the on-new-document script didn't reach: listen again.
      await tabCdp(tabId, "Runtime.evaluate", { expression: RECORDER_SCRIPT });
      return;
    }
    if (!raws.length) return;
    for (const raw of raws) {
      const { target, attributes } = await resolveTarget(tabId, raw);
      if (session !== s) return;
      addStep(s.rec.steps, toStep(raw, target, attributes));
    }
    publish(s);
  })()
    .catch(() => {
      // Mid-navigation the page answers nothing; the next poll picks up.
    })
    .finally(() => {
      s.draining = null;
    });
  return s.draining;
}

/**
 * A drain that gives up after DRAIN_WAIT: a page paused by an alert() answers
 * no `Runtime.evaluate`, and Stop must still stop.
 */
const drainBriefly = (s: Session) =>
  Promise.race([drain(s), new Promise<void>((r) => setTimeout(r, DRAIN_WAIT))]);

function note(s: Session, h: Happening): void {
  s.rec.happenings.push(h);
  if (s.rec.happenings.length > 1000) s.rec.happenings.shift();
}

/** Copies errors, failed requests and URL changes into the recording as they arrive. */
function watchStores(s: Session): (() => void)[] {
  const tabId = s.rec.tabId;
  const seenConsole = new Map(
    (useConsoleStore.getState().entriesByTab[tabId] ?? []).map((e) => [e.id, e.count]),
  );
  const seenRows = new Set((useNetworkStore.getState().entriesByTab[tabId] ?? []).map((n) => n.id));
  let url = useTabsStore.getState().tabs[tabId]?.url ?? s.rec.url;

  const onConsole = useConsoleStore.subscribe((st, prev) => {
    const list = st.entriesByTab[tabId];
    if (!list || list === prev.entriesByTab[tabId]) return;
    for (const e of list) {
      if (seenConsole.get(e.id) === e.count) continue;
      seenConsole.set(e.id, e.count);
      if (e.level !== "error") continue;
      if (isFailedRequest(e)) {
        const status = /status of (\d+)/.exec(e.text)?.[1];
        const where = shortUrl(e.url, s.origin);
        note(s, {
          t: e.ts,
          kind: "failed",
          text: `${where} ${status ?? "failed"}`,
          url: e.url,
          console: true,
        });
      } else {
        note(s, { t: e.ts, kind: "error", text: errorText(e.text) });
      }
    }
  });
  const onNetwork = useNetworkStore.subscribe((st, prev) => {
    const rows = st.entriesByTab[tabId];
    if (!rows || rows === prev.entriesByTab[tabId]) return;
    const now = Date.now();
    for (const n of rows) {
      if (seenRows.has(n.id)) continue;
      seenRows.add(n.id);
      if (n.statusCode < 400 || /\/favicon\.ico$/.test(n.url.split(/[?#]/)[0])) continue;
      note(s, {
        t: now,
        kind: "failed",
        text: `${n.method} ${shortUrl(n.url, s.origin)} ${n.statusCode}`,
        url: n.url,
      });
    }
  });
  const onTabs = useTabsStore.subscribe((st) => {
    const tab = st.tabs[tabId];
    // Closed, or gone somewhere an agent may not look.
    if (!tab || !agentCanUse(tab.url, tab.workspaceId)) {
      stopRecording().catch(() => {});
      return;
    }
    if (tab.url !== url) {
      url = tab.url;
      note(s, { t: Date.now(), kind: "nav", text: url });
      publish(s);
    }
    s.rec.title = tab.title;
  });
  return [onConsole, onNetwork, onTabs];
}

/** Starts recording a tab an agent can see, replacing the last recording. */
export async function startRecording(tabId: string): Promise<void> {
  if (session) await stopRecording();
  const tab = useTabsStore.getState().tabs[tabId];
  if (!tab || !agentCanUse(tab.url, tab.workspaceId)) {
    throw new Error(
      "Recording works on tabs an agent can see: localhost, or a granted environment.",
    );
  }
  // Inject first, so a tab that isn't loaded fails before anything is set up.
  await tabCdp(tabId, "Runtime.evaluate", { expression: RECORDER_SCRIPT });
  const added = await tabCdp<{ identifier?: string }>(
    tabId,
    "Page.addScriptToEvaluateOnNewDocument",
    { source: RECORDER_SCRIPT },
  ).catch(() => ({ identifier: undefined }));
  // Request rows (method, status) only exist while capture is on; hold a reference.
  setNetworkCapture(true).catch(() => {});
  const rec: Recording = {
    tabId,
    workspaceId: tab.workspaceId,
    url: tab.url,
    title: tab.title,
    startedAt: Date.now(),
    stoppedAt: null,
    steps: [],
    happenings: [],
  };
  let origin = "";
  try {
    origin = new URL(tab.url).origin;
  } catch {
    // agentCanUse parsed it already; unreachable in practice.
  }
  const s: Session = {
    rec,
    origin,
    scriptId: added.identifier ?? null,
    timer: setInterval(() => {
      if (session === s) drain(s);
    }, POLL_MS),
    unsubs: [],
    draining: null,
  };
  session = s;
  s.unsubs = watchStores(s);
  publish(s);
}

/** Stops recording and keeps the result for `recording`. */
export async function stopRecording(): Promise<Recording | null> {
  const s = session;
  if (!s) return useRecordingStore.getState().rec;
  clearInterval(s.timer);
  await drainBriefly(s);
  session = null;
  for (const u of s.unsubs) u();
  const tabId = s.rec.tabId;
  if (s.scriptId) {
    tabCdp(tabId, "Page.removeScriptToEvaluateOnNewDocument", { identifier: s.scriptId }).catch(
      () => {},
    );
  }
  tabCdp(tabId, "Runtime.evaluate", { expression: `${HANDLE}?.stop()` }).catch(() => {});
  setNetworkCapture(false).catch(() => {});
  const rec = { ...s.rec, steps: [...s.rec.steps], stoppedAt: Date.now() };
  useRecordingStore.setState({ rec, active: false });
  return rec;
}

/**
 * The `recording` agent tool: the latest recording, drained first if still
 * running; with `playwright`, as a Playwright test.
 */
export async function recordingTool(playwright = false): Promise<string> {
  if (session) await drainBriefly(session);
  const rec = session?.rec ?? useRecordingStore.getState().rec;
  if (!rec) {
    return 'No recording yet. Ask the developer to record their steps: "Record Steps for Agent" in the command palette (Ctrl+K), or Record in the status bar.';
  }
  if (!playwright) return formatRecording(rec);
  const ws = rec.workspaceId;
  const test = toPlaywrightTest(
    rec,
    useMocksStore.getState().rulesByWs[ws],
    useHeadersStore.getState().rulesByWs[ws],
  );
  return `A Playwright test of the recording. Save it with the project's tests (e.g. tests/recorded.spec.ts), replace the TODO with an expect for the fixed behaviour, and run it with npx playwright test (ZYNLEX doesn't run it). The app must be serving at ${rec.url}.

${test}`;
}

/** Palette command and status-bar button: start on `tabId`, or stop, with a toast either way. */
export async function toggleRecording(tabId: string): Promise<void> {
  const toast = useUIStore.getState().pushToast;
  if (session) {
    const rec = await stopRecording();
    const n = rec?.steps.length ?? 0;
    toast(
      `Recorded ${n} step${n === 1 ? "" : "s"}; an agent can read them with the recording tool`,
    );
    return;
  }
  try {
    await startRecording(tabId);
    toast("Recording your steps for an agent; Stop in the status bar");
  } catch (err) {
    toast(
      err instanceof Error && err.message.includes("localhost")
        ? err.message
        : "Couldn't record this tab (is it loaded?)",
      "danger",
    );
  }
}
