import { describe, expect, it } from "vitest";
import { type HiddenTab, memoryLevel, planHiddenTabs } from "./memoryPolicy";

const MIN = 60_000;
const tab = (id: string, minutes: number, loopback = false): HiddenTab => ({
  id,
  hiddenMs: minutes * MIN,
  loopback,
});
const timers = { suspendMinutes: 5, discardMinutes: 10 };

describe("memoryLevel", () => {
  it("is normal without a reading", () => {
    expect(memoryLevel(null)).toBe("normal");
    expect(memoryLevel({ availableMb: 0, totalMb: 0 })).toBe("normal");
  });
  it("is low under 10% of RAM, and under 1 GB on small machines", () => {
    expect(memoryLevel({ availableMb: 1500, totalMb: 16000 })).toBe("low");
    expect(memoryLevel({ availableMb: 1700, totalMb: 16000 })).toBe("normal");
    expect(memoryLevel({ availableMb: 900, totalMb: 8000 })).toBe("low");
    expect(memoryLevel({ availableMb: 1100, totalMb: 8000 })).toBe("normal");
  });
  it("is ample over 30% of RAM, and never under 4 GB free", () => {
    expect(memoryLevel({ availableMb: 5000, totalMb: 16000 })).toBe("ample");
    expect(memoryLevel({ availableMb: 4700, totalMb: 16000 })).toBe("normal");
    expect(memoryLevel({ availableMb: 3500, totalMb: 8000 })).toBe("normal");
  });
});

describe("planHiddenTabs", () => {
  it("normal: the timers from Settings, exactly as before", () => {
    const plan = planHiddenTabs(
      [
        tab("young", 2),
        tab("idle", 6),
        tab("old", 11),
        tab("local", 6, true),
        tab("oldLocal", 11, true),
      ],
      timers,
      "normal",
    );
    expect(plan.suspend).toEqual(["idle"]);
    // Localhost tabs are never suspended, but the discard timer has always applied to them.
    expect(plan.discard).toEqual(["old", "oldLocal"]);
  });

  it("low: suspends after a minute and discards the longest-hidden tab", () => {
    const plan = planHiddenTabs(
      [tab("fresh", 0.5), tab("a", 2), tab("b", 4), tab("local", 8, true)],
      timers,
      "low",
    );
    expect(plan.discard).toEqual(["b"]);
    expect(plan.suspend).toEqual(["a"]);
  });

  it("low: one early discard per tick, on top of any the timer already chose", () => {
    const plan = planHiddenTabs([tab("a", 2), tab("b", 3), tab("old", 11)], timers, "low");
    expect(plan.discard.sort()).toEqual(["b", "old"]);
    expect(plan.suspend).toEqual(["a"]);
  });

  it("low: never discards a localhost tab early", () => {
    const plan = planHiddenTabs([tab("local", 8, true)], timers, "low");
    expect(plan).toEqual({ suspend: [], discard: [] });
  });

  it("low: never discards a tab that is playing audio early, and takes the next one", () => {
    const music = { ...tab("music", 9), audible: true };
    const plan = planHiddenTabs([music, tab("a", 2), tab("b", 4)], timers, "low");
    expect(plan.discard).toEqual(["b"]);
    // Suspending is left to Rust, which skips a tab that is playing audio.
    expect(plan.suspend).toEqual(["music", "a"]);
    expect(planHiddenTabs([music], timers, "low").discard).toEqual([]);
  });

  it("a tab playing audio is not discarded by the plain timer either", () => {
    const music = { ...tab("music", 45), audible: true };
    for (const level of ["normal", "ample", "low"] as const) {
      expect(planHiddenTabs([music, tab("old", 45)], timers, level).discard).toEqual(["old"]);
    }
  });

  it("low: the tab you left last is never discarded early", () => {
    // Two tabs you go back and forth between: only the older one can go.
    expect(planHiddenTabs([tab("justLeft", 2), tab("older", 5)], timers, "low").discard).toEqual([
      "older",
    ]);
    // Next tick it is the only hidden tab left: it stays until the normal timer.
    expect(planHiddenTabs([tab("justLeft", 3)], timers, "low").discard).toEqual([]);
    expect(planHiddenTabs([tab("justLeft", 11)], timers, "low").discard).toEqual(["justLeft"]);
  });

  it("low: a timer set to never stays never", () => {
    const plan = planHiddenTabs([tab("a", 30)], { suspendMinutes: 0, discardMinutes: 0 }, "low");
    expect(plan).toEqual({ suspend: [], discard: [] });
  });

  it("ample: keeps tabs three times as long, still suspends on time", () => {
    const tabs = [tab("idle", 6), tab("old", 11), tab("ancient", 31)];
    const plan = planHiddenTabs(tabs, timers, "ample");
    expect(plan.suspend).toEqual(["idle", "old"]);
    expect(plan.discard).toEqual(["ancient"]);
  });
});
