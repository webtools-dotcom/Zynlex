/**
 * Settings → Shortcuts: rebind, unbind and reset any command's chords, and pin
 * commands to the toolbar. Every row is a command from allCommands() (src/lib/commands.ts).
 */
import { useEffect, useState } from "react";
import { Pin, PinOff, Plus, RotateCcw } from "lucide-react";
import {
  allCommands,
  bindingMap,
  chordFromEvent,
  chordLabel,
  isBindable,
  keysFor,
} from "@/lib/commands";
import { useKeybindingsStore } from "@/stores/keybindings";
import { useSnippetsStore } from "@/stores/snippets";
import { useUIStore } from "@/stores/ui";
import { setRecordingShortcut } from "@/hooks/useKeyboardShortcuts";

const iconButton =
  "w-5 h-5 flex items-center justify-center rounded text-[var(--color-text-disabled)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-hover)] shrink-0";

const chip =
  "px-1 py-px text-micro rounded border whitespace-nowrap text-[var(--color-text-primary)] shrink-0";

export function ShortcutsSettings() {
  const { overrides, pinned, bind, unbind, reset, togglePin } = useKeybindingsStore();
  const snippets = useSnippetsStore((s) => s.snippets);
  const [filter, setFilter] = useState("");
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [hint, setHint] = useState("");

  useEffect(() => {
    if (!recordingId) return;
    setRecordingShortcut(true);
    // Capture phase, so the chord neither runs its current command nor
    // reaches the settings panel's own Escape handler.
    function onKey(e: KeyboardEvent) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.code === "Escape" && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        setRecordingId(null);
        return;
      }
      const chord = chordFromEvent(e);
      if (!chord) return; // a modifier on its own: keep listening
      if (!isBindable(chord)) {
        setHint("Use Ctrl or Alt, or a function key.");
        return;
      }
      const owner = bindingMap(useKeybindingsStore.getState().overrides).get(chord);
      if (recordingId && owner && owner.id !== recordingId) {
        useUIStore
          .getState()
          .pushToast(`${chordLabel(chord).join("+")} removed from "${owner.title}"`, "info");
      }
      if (recordingId) bind(recordingId, chord);
      setRecordingId(null);
    }
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      setRecordingShortcut(false);
      setHint("");
    };
  }, [recordingId, bind]);

  const q = filter.trim().toLowerCase();
  const commands = allCommands(snippets);
  const rows = q ? commands.filter((c) => c.title.toLowerCase().includes(q)) : commands;

  return (
    <div>
      <input
        type="text"
        placeholder="Filter commands"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="w-full px-2 py-1 mb-2 text-xs border rounded text-[var(--color-text-primary)] placeholder:text-[var(--color-text-disabled)] outline-none focus:border-[var(--color-accent)]"
        style={{ background: "var(--color-elevated)", borderColor: "var(--color-border)" }}
      />
      {hint && <div className="text-xs text-[var(--color-warn)] mb-1">{hint}</div>}
      <div className="space-y-0.5">
        {rows.map((c) => {
          const keys = keysFor(c, overrides);
          const isPinned = pinned.includes(c.id);
          return (
            <div key={c.id} className="flex items-center gap-1 min-h-6">
              <span
                className="flex-1 min-w-0 truncate text-xs text-[var(--color-text-muted)]"
                title={c.title}
              >
                {c.title}
              </span>
              {recordingId === c.id ? (
                <span className={chip} style={{ borderColor: "var(--color-accent)" }}>
                  Press keys…
                </span>
              ) : (
                keys.map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => unbind(c.id, k, keys)}
                    title="Remove this shortcut"
                    className={`${chip} hover:line-through`}
                    style={{
                      background: "var(--color-surface)",
                      borderColor: "var(--color-border)",
                    }}
                  >
                    {chordLabel(k).join("+")}
                  </button>
                ))
              )}
              <button
                type="button"
                onClick={() => setRecordingId(recordingId === c.id ? null : c.id)}
                title="Add a shortcut"
                aria-label={`Add a shortcut for ${c.title}`}
                className={iconButton}
              >
                <Plus size={12} />
              </button>
              {c.id in overrides && (
                <button
                  type="button"
                  onClick={() => reset(c.id)}
                  title="Reset to default"
                  aria-label={`Reset ${c.title} to its default shortcut`}
                  className={iconButton}
                >
                  <RotateCcw size={12} />
                </button>
              )}
              {!c.hidden && (
                <button
                  type="button"
                  onClick={() => togglePin(c.id)}
                  title={isPinned ? "Unpin from toolbar" : "Pin to toolbar"}
                  aria-label={isPinned ? `Unpin ${c.title}` : `Pin ${c.title} to the toolbar`}
                  aria-pressed={isPinned}
                  className={iconButton}
                  style={isPinned ? { color: "var(--color-accent)" } : undefined}
                >
                  {isPinned ? <PinOff size={12} /> : <Pin size={12} />}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
