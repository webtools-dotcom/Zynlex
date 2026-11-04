/**
 * Take over (roadmap M5): the developer pauses the agent, uses the page
 * themselves, then resumes. While paused, every call that acts on a page is
 * held here instead of running; read-only calls still answer.
 *
 * A held call can't wait for ever: MCP clients give up on a tool call after
 * a while (Codex's default is reported as 60 s), and a call the client has given up on
 * must not run later behind the agent's back. So a hold lasts at most
 * PAUSE_HOLD_MS, then the call is answered with PAUSED_REPLY and never runs;
 * the agent calls again. The "took over for N s" figure counts from Pause,
 * so it's right across such retries.
 */
import { useAgentStore } from "@/stores/agent";

/** Longest a call is held; under the 60 s clients commonly allow per call. Keep below REPLY_TIMEOUT in agent.rs. */
export const PAUSE_HOLD_MS = 45_000;

export const PAUSED_REPLY = "Paused by the developer; call again later.";

export type HoldResult =
  | { kind: "resumed"; pausedMs: number }
  | { kind: "timeout" }
  | { kind: "stopped" };

type Release = (r: HoldResult) => void;
const waiters = new Set<Release>();

/** Calls that change a page or what it gets served. Everything else is a read and answers while paused. */
export function actsOnPage(tool: string, args: Record<string, unknown>): boolean {
  switch (tool) {
    case "act":
    case "open":
    case "eval":
    case "wait_for":
    case "viewport":
      return true;
    case "check":
      return !!args.reload;
    case "mock":
      return args.action !== "list";
    case "tabs":
      return typeof args.close === "string" && args.close !== "";
    default:
      return false;
  }
}

const isAgentPaused = () => useAgentStore.getState().pausedAt != null;

function syncWaiting() {
  useAgentStore.setState({ waiting: waiters.size });
}

export function pauseAgent(now = Date.now()): void {
  if (isAgentPaused()) return;
  useAgentStore.setState({ pausedAt: now });
}

function release(r: (pausedAt: number) => HoldResult): void {
  const at = useAgentStore.getState().pausedAt;
  if (at == null) return;
  useAgentStore.setState({ pausedAt: null });
  for (const w of [...waiters]) w(r(at));
  syncWaiting();
}

/** Lets every held call run; each reports how long the developer had the page. */
export function resumeAgent(now = Date.now()): void {
  release((at) => ({ kind: "resumed", pausedMs: now - at }));
}

/** Ends a pause without running the held calls (Stop, or the last agent left). */
export function cancelPause(): void {
  release(() => ({ kind: "stopped" }));
}

/** For the status bar and the palette. Pausing needs a connected agent: the indicator showing the pause hides without one. */
export function toggleAgentPause(): void {
  const { enabled, clients } = useAgentStore.getState();
  if (isAgentPaused()) resumeAgent();
  else if (enabled && clients.length) pauseAgent();
}

/** Resolves at once with null when not paused; otherwise on Resume, Stop or after `maxMs`. */
export function holdWhilePaused(maxMs = PAUSE_HOLD_MS): Promise<HoldResult | null> {
  if (!isAgentPaused()) return Promise.resolve(null);
  return new Promise((resolve) => {
    const done: Release = (r) => {
      clearTimeout(timer);
      waiters.delete(done);
      syncWaiting();
      resolve(r);
    };
    const timer = setTimeout(() => done({ kind: "timeout" }), maxMs);
    waiters.add(done);
    syncWaiting();
  });
}

export function tookOverLine(pausedMs: number): string {
  const s = Math.max(1, Math.round(pausedMs / 1000));
  return `The developer took over for ${s} s and resumed; the page may have changed.`;
}
