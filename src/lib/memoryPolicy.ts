/**
 * Which hidden tabs to suspend and discard on one tick of the bridge's timer.
 *
 * The timers in Settings are the baseline. With "Adapt to available memory" on,
 * the system's free RAM moves them: when it runs short, hidden tabs are suspended
 * after a minute and the longest-hidden one is discarded each tick until memory
 * recovers; when there is plenty, tabs are kept three times as long before they
 * are discarded, so they don't reload for nothing.
 *
 * Why discard and not something gentler: suspending frees resident memory but
 * not committed memory, and a forced GC or a memory-pressure signal on a hidden
 * tab measured no saving at all. Only discarding returns a tab's ~100 MB.
 */

export interface SystemMemory {
  availableMb: number;
  totalMb: number;
}

type MemoryLevel = "low" | "normal" | "ample";

/** A hidden tab the timer may act on: not active, pinned, loading or discarded. */
export interface HiddenTab {
  id: string;
  /** Time since the tab was last visible. */
  hiddenMs: number;
  /** localhost: never suspended (HMR would stall), never discarded early. */
  loopback: boolean;
}

const MINUTE = 60_000;
/** Under pressure, a tab must have been hidden this long before it is touched. */
const PRESSURE_MIN_HIDDEN_MS = MINUTE;
/** With plenty of RAM, the discard timer is stretched by this factor. */
const AMPLE_DISCARD_FACTOR = 3;

/** `null` (the reading failed, or adapting is off) is "normal": the plain timers. */
export function memoryLevel(m: SystemMemory | null): MemoryLevel {
  if (!m || m.totalMb <= 0) return "normal";
  if (m.availableMb < Math.max(1024, m.totalMb * 0.1)) return "low";
  if (m.availableMb > Math.max(4096, m.totalMb * 0.3)) return "ample";
  return "normal";
}

export function planHiddenTabs(
  tabs: HiddenTab[],
  timers: { suspendMinutes: number; discardMinutes: number },
  level: MemoryLevel,
): { suspend: string[]; discard: string[] } {
  // 0 means "never" for both, and memory pressure does not override a "never".
  let suspendMs = timers.suspendMinutes * MINUTE;
  let discardMs = timers.discardMinutes * MINUTE;
  if (level === "low" && suspendMs > 0) suspendMs = Math.min(suspendMs, PRESSURE_MIN_HIDDEN_MS);
  if (level === "ample") discardMs *= AMPLE_DISCARD_FACTOR;

  const discard = new Set(
    discardMs > 0 ? tabs.filter((t) => t.hiddenMs > discardMs).map((t) => t.id) : [],
  );
  if (level === "low" && discardMs > 0) {
    // One per tick, longest hidden first: each discard returns about 100 MB, and
    // the next tick re-reads memory before taking another.
    const oldest = tabs
      .filter((t) => !t.loopback && !discard.has(t.id) && t.hiddenMs > PRESSURE_MIN_HIDDEN_MS)
      .sort((a, b) => b.hiddenMs - a.hiddenMs)[0];
    if (oldest) discard.add(oldest.id);
  }
  const suspend =
    suspendMs > 0
      ? tabs.filter((t) => !t.loopback && !discard.has(t.id) && t.hiddenMs > suspendMs)
      : [];
  return { suspend: suspend.map((t) => t.id), discard: [...discard] };
}
