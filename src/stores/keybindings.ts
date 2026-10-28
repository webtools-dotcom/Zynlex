import { create } from "zustand";
import { persist } from "zustand/middleware";
import { bindChord, COMMANDS_BY_ID, type KeyOverrides } from "@/lib/commands";

/**
 * Toolbar buttons out of the box: the commands that work on any page with no setup, chosen by
 * what developers install extensions for (screenshots, colour pickers) plus the bug report.
 */
const DEFAULT_PINS = ["screenshot.full", "bugReport.copy", "color.pick"];

/** v1 → v2 added the default pins; anyone who had pins keeps theirs, after the defaults. */
export function migratePins(state: unknown, version: number): unknown {
  const s = (state ?? {}) as { pinned?: string[] };
  if (version < 2) {
    const pinned = s.pinned ?? [];
    return { ...s, pinned: [...DEFAULT_PINS.filter((id) => !pinned.includes(id)), ...pinned] };
  }
  return s;
}

/** The user's shortcut overrides and toolbar pins. Defaults live in COMMANDS. */
interface KeybindingsStore {
  overrides: KeyOverrides;
  /** Command ids shown as toolbar buttons, in order. */
  pinned: string[];
  bind: (id: string, chord: string) => void;
  unbind: (id: string, chord: string, current: string[]) => void;
  reset: (id: string) => void;
  togglePin: (id: string) => void;
}

export const useKeybindingsStore = create<KeybindingsStore>()(
  persist(
    (set) => ({
      overrides: {},
      pinned: DEFAULT_PINS,
      bind: (id, chord) => set((s) => ({ overrides: bindChord(s.overrides, id, chord) })),
      unbind: (id, chord, current) =>
        set((s) => ({ overrides: { ...s.overrides, [id]: current.filter((k) => k !== chord) } })),
      // Re-binding each default (rather than just dropping the override) takes
      // it back from any command the user had moved it to.
      reset: (id) =>
        set((s) => {
          const { [id]: _, ...rest } = s.overrides;
          let overrides = rest;
          for (const chord of COMMANDS_BY_ID.get(id)?.keys ?? []) {
            overrides = bindChord(overrides, id, chord);
          }
          return { overrides };
        }),
      togglePin: (id) =>
        set((s) => ({
          pinned: s.pinned.includes(id) ? s.pinned.filter((p) => p !== id) : [...s.pinned, id],
        })),
    }),
    {
      name: "zynlex-keybindings",
      version: 2,
      migrate: (s, v) => migratePins(s, v) as KeybindingsStore,
    },
  ),
);
