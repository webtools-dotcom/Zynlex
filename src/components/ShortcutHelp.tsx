/**
 * ShortcutHelp — centered modal listing all keyboard shortcuts.
 *
 * Triggered by Ctrl+? (Ctrl+Shift+/ on most keyboards). The key value
 * reported by the browser is "?" when Shift+/ is pressed with Ctrl held.
 * Esc or X button or backdrop click closes the overlay.
 */
import { useEffect } from "react";
import { X } from "lucide-react";
import { useUIStore } from "@/stores/ui";

interface Shortcut {
  keys: string[];
  description: string;
}

const SHORTCUTS: Shortcut[] = [
  { keys: ["Ctrl", "T"], description: "New Tab" },
  { keys: ["Ctrl", "W"], description: "Close Tab" },
  { keys: ["Ctrl", "Shift", "T"], description: "Reopen Last Tab" },
  { keys: ["Ctrl", "L"], description: "Focus Address Bar" },
  { keys: ["Ctrl", "R"], description: "Reload" },
  { keys: ["Ctrl", "F"], description: "Find in Page" },
  { keys: ["Ctrl", "D"], description: "Bookmark Current Tab" },
  { keys: ["Ctrl", "K"], description: "Command Palette" },
  { keys: ["Ctrl", ","], description: "Settings" },
  { keys: ["Ctrl", "?"], description: "This Help" },
  { keys: ["Alt", "←"], description: "Go Back" },
  { keys: ["Alt", "→"], description: "Go Forward" },
  { keys: ["Esc"], description: "Stop Loading / Close Find" },
  { keys: ["Ctrl", "1"], description: "Switch to Tab 1" },
  { keys: ["Ctrl", "2"], description: "Switch to Tab 2" },
  { keys: ["Ctrl", "3"], description: "Switch to Tab 3" },
  { keys: ["Ctrl", "4"], description: "Switch to Tab 4" },
  { keys: ["Ctrl", "5"], description: "Switch to Tab 5" },
  { keys: ["Ctrl", "6"], description: "Switch to Tab 6" },
  { keys: ["Ctrl", "7"], description: "Switch to Tab 7" },
  { keys: ["Ctrl", "8"], description: "Switch to Tab 8" },
  { keys: ["Ctrl", "9"], description: "Switch to Tab 9" },
  { keys: ["Ctrl", "Tab"], description: "Next Tab" },
  { keys: ["Ctrl", "Shift", "Tab"], description: "Previous Tab" },
  { keys: ["Ctrl", "Shift", "R"], description: "Hard Reload (bypass cache)" },
  { keys: ["Ctrl", "H"], description: "History Panel" },
  { keys: ["Ctrl", "Shift", "1-9"], description: "Switch Workspace" },
  { keys: ["Ctrl", "+"], description: "Zoom In" },
  { keys: ["Ctrl", "-"], description: "Zoom Out" },
  { keys: ["Ctrl", "0"], description: "Reset Zoom" },
];

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
          {SHORTCUTS.map((s) => (
            <div
              key={s.description}
              className="flex items-center justify-between px-4 py-1.5 hover:bg-[var(--color-hover)]"
            >
              <div className="flex items-center gap-1 shrink-0">
                {s.keys.map((k, j) => (
                  <span key={k} className="flex items-center gap-1">
                    <Kbd>{k}</Kbd>
                    {j < s.keys.length - 1 && (
                      <span className="text-[var(--color-text-disabled)] text-micro">+</span>
                    )}
                  </span>
                ))}
              </div>
              <span className="text-xs text-[var(--color-text-muted)] text-right ml-4 truncate">
                {s.description}
              </span>
            </div>
          ))}
        </div>

        <div
          className="flex justify-end px-4 py-2 border-t shrink-0"
          style={{ borderColor: "var(--color-border)" }}
        >
          <span className="text-micro text-[var(--color-text-disabled)]">
            Press <Kbd>Esc</Kbd> to close
          </span>
        </div>
      </div>
    </div>
  );
}
