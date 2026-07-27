/**
 * FindBar — Ctrl+F floating search bar for the active webview.
 *
 * Sits at the top-right of the content area, overlaying the webview
 * (positioned via fixed, doesn't disturb webview bounds). Search
 * updates flow through the Rust `browser_find` command, which
 * injects a JS-based find (since Tauri 2.11.2 stable does not
 * expose a native WebviewWindow::find API). Match counts arrive
 * via the `browser://find-result` event.
 */
import { useEffect, useRef, useCallback } from "react";
import { Search, X, ChevronUp, ChevronDown } from "lucide-react";
import { webviewFind, webviewFindNext, webviewStopFind, onFindResult } from "@/services/browser";
import { useUIStore } from "@/stores/ui";
import { useWorkspacesStore } from "@/stores/workspaces";
import { useTabsStore } from "@/stores/tabs";
import { getLiveWorkspaceActiveTabId } from "@/lib/workspaceTabs";

const IS_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

function getActiveTabId(): string | null {
  const wsState = useWorkspacesStore.getState();
  const ws = wsState.workspaces[wsState.activeWorkspaceId];
  return getLiveWorkspaceActiveTabId(ws, useTabsStore.getState().tabs);
}

export function FindBar() {
  const findOpen = useUIStore((s) => s.findOpen);
  const findQuery = useUIStore((s) => s.findQuery);
  const findActiveMatch = useUIStore((s) => s.findActiveMatch);
  const findTotalMatches = useUIStore((s) => s.findTotalMatches);
  const setFindQuery = useUIStore((s) => s.setFindQuery);
  const closeFind = useUIStore((s) => s.closeFind);
  const setFindResult = useUIStore((s) => s.setFindResult);

  const inputRef = useRef<HTMLInputElement>(null);
  const lastQueriedRef = useRef<string>("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runFind = useCallback(async (q: string) => {
    if (!IS_TAURI) return;
    if (q === lastQueriedRef.current) return;
    const tabId = getActiveTabId();
    if (!tabId) return;
    lastQueriedRef.current = q;
    try {
      await webviewFind(tabId, q);
    } catch (e) {
      if (import.meta.env.DEV) {
        console.error("[xevo] webviewFind failed:", e);
      }
    }
  }, []);

  // Subscribe to find-result events (active/total match counts).
  useEffect(() => {
    if (!IS_TAURI) return;
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    onFindResult((result) => {
      setFindResult(result.active_match, result.total_matches);
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
  }, [setFindResult]);

  // Focus the input whenever the bar opens.
  useEffect(() => {
    if (findOpen) {
      // Defer one tick so the input is mounted.
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 0);
    } else {
      lastQueriedRef.current = "";
      if (IS_TAURI) {
        const tabId = getActiveTabId();
        if (tabId) webviewStopFind(tabId).catch(() => {});
      }
    }
  }, [findOpen]);

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

  // Local keydown handler: Enter cycles matches, Shift+Enter goes back,
  // Escape closes the bar. The global Ctrl+F is handled in
  // useKeyboardShortcuts.
  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (IS_TAURI) {
        const tabId = getActiveTabId();
        if (tabId) webviewFindNext(tabId, !e.shiftKey).catch(() => {});
      }
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
      className="absolute top-2 right-2 z-50 flex items-center gap-1 h-9 px-2.5 rounded-[4px] border"
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
        onClick={() => {
          if (!IS_TAURI) return;
          const tabId = getActiveTabId();
          if (tabId) webviewFindNext(tabId, false).catch(() => {});
        }}
        disabled={!hasQuery || findTotalMatches === 0}
        title="Previous match (Shift+Enter)"
        aria-label="Previous match"
        className="w-6 h-6 flex items-center justify-center rounded text-[var(--color-text-disabled)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-hover)] disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed transition-colors"
      >
        <ChevronUp size={13} />
      </button>
      <button
        onClick={() => {
          if (!IS_TAURI) return;
          const tabId = getActiveTabId();
          if (tabId) webviewFindNext(tabId, true).catch(() => {});
        }}
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
