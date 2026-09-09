/**
 * FindBar — Ctrl+F search bar for the active webview.
 *
 * Docks as a row above the content area rather than floating over it. It cannot
 * float: the tab is a native child webview composited above this document, so
 * anything drawn under it is invisible. Taking layout height instead shrinks the
 * content area, and the bridge's ResizeObserver re-syncs the webview bounds to
 * match.
 *
 * Search runs through the Rust `browser_find` command, which injects a JS-based
 * find (Tauri 2.11.2 stable exposes no native WebviewWindow::find API). Match
 * counts come back as that command's return value, read out of the page with
 * ExecuteScript — a page cannot invoke IPC back into the app, so the old
 * `browser://find-result` event was never emitted and the counter never moved.
 */
import { useEffect, useRef, useCallback } from "react";
import { Search, X, ChevronUp, ChevronDown } from "lucide-react";
import {
  webviewFind,
  webviewFindNext,
  webviewStopFind,
  focusAppWebview,
} from "@/services/browser";
import { useUIStore, useFindOpen } from "@/stores/ui";
import { getActiveTabId } from "@/hooks/useActiveScope";

const IS_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export function FindBar() {
  const findOpen = useFindOpen();
  const findTabId = useUIStore((s) => s.findTabId);
  const findQuery = useUIStore((s) => s.findQuery);
  const findActiveMatch = useUIStore((s) => s.findActiveMatch);
  const findTotalMatches = useUIStore((s) => s.findTotalMatches);
  const setFindQuery = useUIStore((s) => s.setFindQuery);
  const closeFind = useUIStore((s) => s.closeFind);
  const setFindResult = useUIStore((s) => s.setFindResult);

  const inputRef = useRef<HTMLInputElement>(null);
  const lastQueriedRef = useRef<string>("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runFind = useCallback(
    async (q: string) => {
      if (!IS_TAURI) return;
      if (q === lastQueriedRef.current) return;
      const tabId = getActiveTabId();
      if (!tabId) return;
      lastQueriedRef.current = q;
      try {
        const r = await webviewFind(tabId, q);
        setFindResult(r.activeMatch, r.totalMatches);
      } catch (e) {
        setFindResult(0, 0);
        if (import.meta.env.DEV) {
          console.error("[zynlex] webviewFind failed:", e);
        }
      }
    },
    [setFindResult],
  );

  // Focus the input whenever the bar opens, and clear the highlights on the way
  // out. Stopping the find in a *cleanup* keyed on the searched tab is what
  // matters: the bar is scoped per tab now, so switching tabs unmounts it, and
  // an `else` branch would never run — leaving the old tab highlighted forever.
  useEffect(() => {
    if (!findTabId) return;
    // Defer one tick so the input is mounted. focusAppWebview() first: Ctrl+F
    // is usually pressed with the page focused, and the tab's child webview
    // keeps OS keyboard focus until this document asks for it — without it the
    // bar opens but every keystroke still goes to the page.
    setTimeout(() => {
      void focusAppWebview().then(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }, 0);
    return () => {
      lastQueriedRef.current = "";
      if (IS_TAURI) webviewStopFind(findTabId).catch(() => {});
    };
  }, [findTabId]);

  // Debounced find on query change.
  useEffect(() => {
    if (!findOpen) return;
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      runFind(findQuery);
    }, 150);
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, [findQuery, findOpen, runFind]);

  const step = useCallback(
    (forward: boolean) => {
      if (!IS_TAURI) return;
      const tabId = getActiveTabId();
      if (!tabId) return;
      webviewFindNext(tabId, forward)
        .then((r) => setFindResult(r.activeMatch, r.totalMatches))
        .catch(() => {});
    },
    [setFindResult],
  );

  // Local keydown handler: Enter cycles matches, Shift+Enter goes back,
  // Escape closes the bar. The global Ctrl+F is handled in
  // useKeyboardShortcuts.
  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      step(!e.shiftKey);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeFind();
    }
  }

  if (!findOpen) return null;

  const hasQuery = findQuery.length > 0;
  const matchText = !hasQuery
    ? ""
    : findTotalMatches === 0
      ? "No results"
      : `${findActiveMatch} of ${findTotalMatches}`;

  return (
    <div
      className="flex-shrink-0 flex items-center justify-end gap-1 h-9 px-2.5 border-b"
      style={{
        background: "var(--color-elevated)",
        borderColor: "var(--color-border)",
      }}
      onKeyDown={(e) => {
        // Stop the Escape from bubbling to global shortcuts
        if (e.key === "Escape") e.stopPropagation();
      }}
    >
      <Search size={14} className="text-[var(--color-text-disabled)] flex-shrink-0" />
      <input
        ref={inputRef}
        type="text"
        value={findQuery}
        onChange={(e) => setFindQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Find in page"
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        className="w-[200px] bg-transparent outline-none text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-disabled)] font-mono"
      />
      {matchText && (
        <span
          className="text-micro font-mono text-[var(--color-text-disabled)] min-w-[60px] text-right select-none tabular-nums"
          aria-live="polite"
        >
          {matchText}
        </span>
      )}
      <button
        onClick={() => step(false)}
        disabled={!hasQuery || findTotalMatches === 0}
        title="Previous match (Shift+Enter)"
        aria-label="Previous match"
        className="w-6 h-6 flex items-center justify-center rounded text-[var(--color-text-disabled)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-hover)] disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed transition-colors"
      >
        <ChevronUp size={13} />
      </button>
      <button
        onClick={() => step(true)}
        disabled={!hasQuery || findTotalMatches === 0}
        title="Next match (Enter)"
        aria-label="Next match"
        className="w-6 h-6 flex items-center justify-center rounded text-[var(--color-text-disabled)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-hover)] disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed transition-colors"
      >
        <ChevronDown size={13} />
      </button>
      <button
        onClick={closeFind}
        title="Close (Esc)"
        aria-label="Close find bar"
        className="w-6 h-6 flex items-center justify-center rounded text-[var(--color-text-disabled)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-hover)] transition-colors"
      >
        <X size={13} />
      </button>
    </div>
  );
}
