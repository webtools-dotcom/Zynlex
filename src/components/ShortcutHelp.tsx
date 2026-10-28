/**
 * ShortcutHelp — centered modal listing all keyboard shortcuts.
 *
 * Triggered by Ctrl+? (Ctrl+Shift+/ on most keyboards). The key value
 * reported by the browser is "?" when Shift+/ is pressed with Ctrl held.
 * Esc or X button or backdrop click closes the overlay. Generated from the
 * command registry, so it always shows the user's current bindings.
 */
import { useEffect } from "react";
import { X } from "lucide-react";
import { useUIStore } from "@/stores/ui";
import { allCommands, chordLabel, keysFor } from "@/lib/commands";
import { useKeybindingsStore } from "@/stores/keybindings";

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd
      className="inline-block min-w-[20px] px-1.5 py-0.5 text-micro font-mono rounded text-center"
      style={{
        background: "var(--color-elevated)",
        border: "1px solid var(--color-border)",
        color: "var(--color-text-primary)",
      }}
    >
      {children}
    </kbd>
  );
}

export function ShortcutHelp() {
  const overrides = useKeybindingsStore((s) => s.overrides);
  const shortcuts = allCommands().flatMap((c) =>
    keysFor(c, overrides).map((chord) => ({ chord, title: c.title })),
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        useUIStore.getState().closeShortcutHelp();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.6)" }}
      onClick={() => useUIStore.getState().closeShortcutHelp()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        className="w-[480px] max-h-[80vh] flex flex-col overflow-hidden rounded-[6px] border"
        style={{
          background: "var(--color-elevated)",
          borderColor: "var(--color-border)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between h-12 px-4 border-b shrink-0"
          style={{ borderColor: "var(--color-border)" }}
        >
          <span className="text-sm font-semibold text-[var(--color-text-primary)]">
            Keyboard Shortcuts
          </span>
          <button
            onClick={() => useUIStore.getState().closeShortcutHelp()}
            className="text-[var(--color-text-disabled)] hover:text-[var(--color-text-primary)] transition-colors"
            title="Close (Esc)"
            aria-label="Close shortcuts help"
          >
            <X size={16} />
          </button>
        </div>

        <div className="overflow-y-auto py-2">
          {shortcuts.map((s) => (
            <div
              key={s.chord}
              className="flex items-center justify-between px-4 py-1.5 hover:bg-[var(--color-hover)]"
            >
              <div className="flex items-center gap-1 shrink-0">
                {chordLabel(s.chord).map((k, j, keys) => (
                  <span key={k} className="flex items-center gap-1">
                    <Kbd>{k}</Kbd>
                    {j < keys.length - 1 && (
                      <span className="text-[var(--color-text-disabled)] text-micro">+</span>
                    )}
                  </span>
                ))}
              </div>
              <span className="text-xs text-[var(--color-text-muted)] text-right ml-4 truncate">
                {s.title}
              </span>
            </div>
          ))}
        </div>

        <div
          className="flex justify-between px-4 py-2 border-t shrink-0"
          style={{ borderColor: "var(--color-border)" }}
        >
          <span className="text-micro text-[var(--color-text-disabled)]">
            Change these in Settings → Shortcuts
          </span>
          <span className="text-micro text-[var(--color-text-disabled)]">
            Press <Kbd>Esc</Kbd> to close
          </span>
        </div>
      </div>
    </div>
  );
}
