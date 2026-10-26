import { create } from "zustand";
import { persist } from "zustand/middleware";
import { bindChord, COMMANDS_BY_ID, type KeyOverrides } from "@/lib/commands";

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
      pinned: [],
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
    { name: "zynlex-keybindings", version: 1 },
  ),
);
