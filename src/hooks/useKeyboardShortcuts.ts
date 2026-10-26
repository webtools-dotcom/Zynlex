/**
 * useKeyboardShortcuts — dispatches key chords to the command registry.
 *
 * Two complementary paths feed the same lookup: a main-window keydown listener
 * for when focus is on the React UI, and a bridge for when focus is inside a
 * tab's webview — Rust's accelerator handler forwards the chords it was told
 * are bound (browser_set_shortcuts) and re-emits them here. Both paths are
 * idempotent, so double-handling when they overlap is harmless.
 *
 * Commands and their default chords: src/lib/commands.ts. User overrides:
 * src/stores/keybindings.ts.
 */
import { useEffect } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { bindingMap, chordFromEvent, type Command } from "@/lib/commands";
import { useKeybindingsStore } from "@/stores/keybindings";
import { setShortcuts } from "@/services/browser";

const IS_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Set while the Settings shortcut recorder is listening for a new chord. */
let recording = false;
export function setRecordingShortcut(v: boolean) {
  recording = v;
}

function lookup(chord: string): Command | undefined {
  return bindingMap(useKeybindingsStore.getState().overrides).get(chord);
}

export function useKeyboardShortcuts() {
  // ── Path 1: main-window keydown ──────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (recording) return;
      const chord = chordFromEvent(e);
      const cmd = chord && lookup(chord);
      if (!cmd) return;
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      if (cmd.notInInputs && (tag === "input" || tag === "textarea")) return;
      if (cmd.run() !== false) e.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ── Path 2: chords forwarded from a focused tab webview ──────────────
  useEffect(() => {
    if (!IS_TAURI) return;

    let cancelled = false;
    let unlisten: UnlistenFn | null = null;

    void listen<string>("zynlex://shortcut", (e) => {
      lookup(e.payload)?.run();
    }).then((fn) => {
      if (cancelled) {
        fn();
        return;
      }
      unlisten = fn;
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  // ── Tell Rust which chords to take from pages ────────────────────────
  useEffect(() => {
    if (!IS_TAURI) return;
    const push = (overrides: Parameters<typeof bindingMap>[0]) =>
      setShortcuts([...bindingMap(overrides).keys()]).catch(() => {});
    push(useKeybindingsStore.getState().overrides);
    return useKeybindingsStore.subscribe((s, prev) => {
      if (s.overrides !== prev.overrides) push(s.overrides);
    });
  }, []);
}
