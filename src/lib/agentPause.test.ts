import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAgentStore } from "@/stores/agent";
import {
  actsOnPage,
  cancelPause,
  holdWhilePaused,
  PAUSE_HOLD_MS,
  pauseAgent,
  resumeAgent,
  toggleAgentPause,
  tookOverLine,
} from "./agentPause";

beforeEach(() => {
  vi.useFakeTimers();
  useAgentStore.setState({ enabled: true, clients: ["claude-code"], pausedAt: null, waiting: 0 });
});
afterEach(() => {
  cancelPause();
  vi.useRealTimers();
});

describe("actsOnPage", () => {
  it("holds page actions and lets reads through", () => {
    for (const tool of ["act", "open", "eval", "wait_for", "viewport"]) {
      expect(actsOnPage(tool, {})).toBe(true);
    }
    expect(actsOnPage("check", { reload: true })).toBe(true);
    expect(actsOnPage("check", {})).toBe(false);
    expect(actsOnPage("mock", { action: "add" })).toBe(true);
    expect(actsOnPage("mock", { action: "clear" })).toBe(true);
    expect(actsOnPage("mock", { action: "list" })).toBe(false);
    expect(actsOnPage("tabs", { close: "aaaa" })).toBe(true);
    expect(actsOnPage("tabs", {})).toBe(false);
    for (const tool of ["snapshot", "errors", "network", "screenshot"]) {
      expect(actsOnPage(tool, {})).toBe(false);
    }
  });
});

describe("pause and resume", () => {
  it("doesn't hold anything while not paused", async () => {
    expect(await holdWhilePaused()).toBeNull();
  });

  it("holds calls until Resume, then reports how long the developer had the page", async () => {
    pauseAgent(1_000);
    let done: unknown = "pending";
    const held = holdWhilePaused().then((r) => {
      done = r;
    });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(done).toBe("pending");
    expect(useAgentStore.getState().waiting).toBe(1);
    resumeAgent(43_000);
    await held;
    expect(done).toEqual({ kind: "resumed", pausedMs: 42_000 });
    expect(useAgentStore.getState()).toMatchObject({ pausedAt: null, waiting: 0 });
  });

  it("gives up after the ceiling instead of hanging past the client's patience", async () => {
    pauseAgent();
    const held = holdWhilePaused();
    await vi.advanceTimersByTimeAsync(PAUSE_HOLD_MS);
    expect(await held).toEqual({ kind: "timeout" });
    // Still paused: the next call is held too.
    expect(useAgentStore.getState().pausedAt).not.toBeNull();
    expect(useAgentStore.getState().waiting).toBe(0);
  });

  it("releases held calls as stopped when the pause is cancelled", async () => {
    pauseAgent();
    const a = holdWhilePaused();
    const b = holdWhilePaused();
    cancelPause();
    expect(await a).toEqual({ kind: "stopped" });
    expect(await b).toEqual({ kind: "stopped" });
  });

  it("keeps the first pause time when paused twice", () => {
    pauseAgent(5);
    pauseAgent(9);
    expect(useAgentStore.getState().pausedAt).toBe(5);
  });

  it("toggles, but won't pause with no agent connected", () => {
    toggleAgentPause();
    expect(useAgentStore.getState().pausedAt).not.toBeNull();
    toggleAgentPause();
    expect(useAgentStore.getState().pausedAt).toBeNull();
    useAgentStore.setState({ clients: [] });
    toggleAgentPause();
    expect(useAgentStore.getState().pausedAt).toBeNull();
  });

  it("words the takeover line", () => {
    expect(tookOverLine(42_400)).toBe(
      "The developer took over for 42 s and resumed; the page may have changed.",
    );
    expect(tookOverLine(100)).toMatch(/for 1 s/);
  });
});
