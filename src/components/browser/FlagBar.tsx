/**
 * FlagBar — the "Flag for agent" row (src/lib/agentFlags.ts): a hint while
 * the developer picks an element in the page, then the note input.
 *
 * Docks above the content area like the FindBar, for the same reason: the tab
 * is a native child webview composited above this document, so nothing can
 * float over it. Taking layout height shrinks the content area instead.
 */
import { Flag, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useActiveTabId } from "@/hooks/useActiveScope";
import { cancelFlag, saveFlag } from "@/lib/agentFlags";
import { focusAppWebview } from "@/services/browser";
import { useAgentFlagsStore } from "@/stores/agentFlags";

export function FlagBar() {
  const pick = useAgentFlagsStore((s) => s.pick);
  const activeTabId = useActiveTabId();
  const [note, setNote] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const picked = pick?.target != null;

  // Switching tabs abandons the flow: the element belongs to the old tab.
  useEffect(() => {
    if (pick && pick.tabId !== activeTabId) cancelFlag();
  }, [pick, activeTabId]);

  // Once an element is picked the page still has OS focus (the click landed
  // there); ask for it back before focusing the input, as the FindBar does.
  useEffect(() => {
    if (!picked) return;
    setNote("");
    setTimeout(() => {
      void focusAppWebview().then(() => inputRef.current?.focus());
    }, 0);
  }, [picked]);

  if (!pick || pick.tabId !== activeTabId) return null;
  const t = pick.target;

  return (
    <div
      className="flex-shrink-0 flex items-center gap-2 h-9 px-2.5 border-b text-sm font-mono"
      style={{ background: "var(--color-elevated)", borderColor: "var(--color-border)" }}
      onKeyDown={(e) => {
        if (e.key === "Escape") e.stopPropagation();
      }}
    >
      <Flag size={14} className="text-[var(--color-accent)] flex-shrink-0" />
      {t ? (
        <>
          <span className="flex-shrink-0 text-[var(--color-text-muted)] max-w-[40%] truncate">
            {t.ref} {t.role}
            {t.name ? ` "${t.name}"` : ""}
          </span>
          <input
            ref={inputRef}
            type="text"
            value={note}
            maxLength={300}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                saveFlag(note);
              } else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                cancelFlag();
              }
            }}
            placeholder="What's wrong with it? Enter to flag, Esc to cancel"
            spellCheck={false}
            className="flex-1 min-w-0 bg-transparent outline-none text-[var(--color-text-primary)] placeholder:text-[var(--color-text-disabled)]"
          />
        </>
      ) : (
        <span className="flex-1 text-[var(--color-text-muted)]">
          Click an element in the page to flag it for the agent · Esc to cancel
        </span>
      )}
      <button
        onClick={() => cancelFlag()}
        title="Cancel (Esc)"
        aria-label="Cancel flag"
        className="w-6 h-6 flex items-center justify-center rounded text-[var(--color-text-disabled)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-hover)] transition-colors"
      >
        <X size={13} />
      </button>
    </div>
  );
}
