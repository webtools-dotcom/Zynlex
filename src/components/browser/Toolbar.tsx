import { useState, useEffect, useRef, useCallback } from "react";
import {
  ArrowLeft,
  ArrowRight,
  RotateCw,
  X,
  MoreHorizontal,
  Star,
  Columns3,
  Lock,
  ShieldAlert,
  Wrench,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useWorkspacesStore } from "@/stores/workspaces";
import { useTabsStore } from "@/stores/tabs";
import { useSettingsStore } from "@/stores/settings";
import { useUIStore } from "@/stores/ui";
import { useBookmarksStore } from "@/stores/bookmarks";
import { getLiveWorkspaceActiveTab } from "@/lib/workspaceTabs";
import { toggleBookmarkForActiveTab } from "@/lib/bookmarkAction";
import { resolveInput } from "@/lib/url";

/**
 * Address-bar security indicator, derived purely from the URL scheme.
 * No certificate inspection — that's a V2 item. Local dev servers are http by
 * nature, so they get a neutral wrench rather than a "Not secure" scolding.
 */
function SecurityIndicator({ url, hidden }: { url: string; hidden: boolean }) {
  if (hidden || !url) return null;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const isLocal =
    parsed.hostname === "localhost" ||
    parsed.hostname === "127.0.0.1" ||
    parsed.hostname === "[::1]" ||
    parsed.hostname.endsWith(".localhost");

  let icon: React.ReactNode;
  let label: string;
  if (parsed.protocol === "https:") {
    icon = <Lock size={12} />;
    label = "Secure (HTTPS)";
  } else if (isLocal) {
    icon = <Wrench size={12} />;
    label = "Local dev server";
  } else if (parsed.protocol === "http:") {
    icon = <ShieldAlert size={12} />;
    label = "Not secure";
  } else {
    return null;
  }

  return (
    <span
      title={label}
      aria-label={label}
      className="absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none"
      style={{
        color:
          parsed.protocol === "https:"
            ? "var(--color-live)"
            : isLocal
              ? "var(--color-text-disabled)"
              : "var(--color-warn)",
      }}
    >
      {icon}
    </span>
  );
}

interface ToolbarProps {
  onNavigate: ((url: string) => Promise<void>) | null;
  onBack: (() => Promise<void>) | null;
  onForward: (() => Promise<void>) | null;
  onReload: (() => Promise<void>) | null;
}

export function Toolbar({ onNavigate, onBack, onForward, onReload }: ToolbarProps) {
  const workspaces = useWorkspacesStore((s) => s.workspaces);
  const activeWorkspaceId = useWorkspacesStore((s) => s.activeWorkspaceId);
  const tabs = useTabsStore((s) => s.tabs);
  const { searchEngine, customSearchUrl } = useSettingsStore((s) => s.settings);
  const toggleSettingsPanel = useUIStore((s) => s.toggleSettingsPanel);
  const viewportMode = useUIStore((s) => s.viewportMode);

  const ws = workspaces[activeWorkspaceId];
  const activeTab = getLiveWorkspaceActiveTab(ws, tabs);

  const bookmarks = useBookmarksStore((s) => s.bookmarks);
  const isCurrentBookmarked =
    activeTab?.url != null &&
    activeTab.url !== "" &&
    bookmarks.some((b) => b.workspaceId === activeWorkspaceId && b.url === activeTab.url);

  const [draft, setDraft] = useState(activeTab?.url ?? "");
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!focused) setDraft(activeTab?.url ?? "");
  }, [activeTab?.id, activeTab?.url, focused]);

  const handleNavigate = useCallback(
    async (raw: string) => {
      const url = resolveInput(raw, searchEngine, customSearchUrl);
      if (!url) return;
      setDraft(url);
      if (onNavigate) await onNavigate(url);
    },
    [onNavigate, searchEngine, customSearchUrl],
  );

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") handleNavigate(draft).catch(() => {});
    if (e.key === "Escape") {
      setDraft(activeTab?.url ?? "");
      inputRef.current?.blur();
    }
  }

  useEffect(() => {
    function focusInput() {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
    function handler(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "l") {
        e.preventDefault();
        focusInput();
      }
    }
    function onForwarded() {
      focusInput();
    }
    window.addEventListener("keydown", handler);
    window.addEventListener("xevo:focus-address-bar", onForwarded);
    return () => {
      window.removeEventListener("keydown", handler);
      window.removeEventListener("xevo:focus-address-bar", onForwarded);
    };
  }, []);

  const canGoBack = (activeTab?.historyBack?.length ?? 0) > 0;
  const canGoForward = (activeTab?.historyForward?.length ?? 0) > 0;

  return (
    <div
      className="h-[44px] flex items-center gap-2 px-3 flex-shrink-0"
      style={{
        background: "var(--color-surface)",
        borderBottom: "1px solid var(--color-border)",
      }}
    >
      {/* Nav buttons */}
      <button
        disabled={!canGoBack}
        onClick={() => onBack?.()}
        title="Back (Alt+←)"
        aria-label="Go back"
        className={cn(
          "w-8 h-8 flex items-center justify-center rounded-[4px] transition-colors",
          canGoBack
            ? "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-hover)] cursor-pointer"
            : "text-[var(--color-text-disabled)] cursor-not-allowed opacity-40",
        )}
      >
        <ArrowLeft size={15} />
      </button>
      <button
        disabled={!canGoForward}
        onClick={() => onForward?.()}
        title="Forward (Alt+→)"
        aria-label="Go forward"
        className={cn(
          "w-8 h-8 flex items-center justify-center rounded-[4px] transition-colors",
          canGoForward
            ? "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-hover)] cursor-pointer"
            : "text-[var(--color-text-disabled)] cursor-not-allowed opacity-40",
        )}
      >
        <ArrowRight size={15} />
      </button>
      <button
        disabled={!onReload}
        onClick={() => onReload?.()}
        title="Reload (Ctrl+R)"
        aria-label="Reload page"
        className={cn(
          "w-8 h-8 flex items-center justify-center rounded-[4px] transition-colors",
          onReload
            ? "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-hover)] cursor-pointer"
            : "text-[var(--color-text-disabled)] cursor-not-allowed opacity-40",
        )}
      >
        <RotateCw size={15} />
      </button>

      {/* Address bar — centered, max-width constrained */}
      <div className="flex-1 flex justify-center">
        <div className="relative w-full max-w-[680px]">
          <SecurityIndicator url={activeTab?.url ?? ""} hidden={focused} />
          <input
            ref={inputRef}
            type="text"
            value={focused ? draft : (activeTab?.url ?? "")}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            onFocus={() => {
              setFocused(true);
              setDraft(activeTab?.url ?? "");
              setTimeout(() => inputRef.current?.select(), 0);
            }}
            onBlur={() => setFocused(false)}
            placeholder="Search or enter address (Ctrl+L)"
            className={cn(
              "w-full h-[30px] bg-[var(--color-elevated)] rounded-[4px] border border-[var(--color-border)]",
              "pr-3 text-[var(--color-text-primary)] placeholder:text-[var(--color-text-disabled)]",
              !focused && activeTab?.url ? "pl-7" : "pl-3",
              "focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)] focus:border-[var(--color-accent)]",
              focused ? "font-[var(--font-ui)] text-sm" : "font-[var(--font-mono)] text-sm",
            )}
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
          />

          {focused && draft && (
            <button
              onMouseDown={(e) => {
                e.preventDefault();
                setDraft("");
              }}
              aria-label="Clear address bar"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-text-disabled)] hover:text-[var(--color-text-muted)] transition-colors"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Bookmark button */}
      <button
        onClick={() => toggleBookmarkForActiveTab()}
        title={isCurrentBookmarked ? "Remove bookmark (Ctrl+D)" : "Bookmark (Ctrl+D)"}
        aria-label={isCurrentBookmarked ? "Remove bookmark" : "Bookmark page"}
        disabled={!activeTab?.url}
        className={cn(
          "w-8 h-8 flex items-center justify-center rounded-[4px] transition-colors",
          activeTab?.url
            ? isCurrentBookmarked
              ? "text-[var(--color-accent)] hover:text-[var(--color-accent)] hover:bg-[var(--color-hover)] cursor-pointer"
              : "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-hover)] cursor-pointer"
            : "text-[var(--color-text-disabled)] cursor-not-allowed opacity-40",
        )}
      >
        <Star size={15} fill={isCurrentBookmarked ? "currentColor" : "none"} />
      </button>

      {/* Viewport mode toggle */}
      <button
        onClick={() => {
          const { enterViewportMode, exitViewportMode } = useUIStore.getState();
          if (viewportMode) exitViewportMode();
          else enterViewportMode();
        }}
        title="Viewport mode"
        aria-label="Toggle viewport mode"
        className={cn(
          "w-8 h-8 flex items-center justify-center rounded-[4px] transition-colors",
          viewportMode
            ? "bg-[var(--color-accent-dim)] text-[var(--color-accent)]"
            : "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-hover)]",
        )}
      >
        <Columns3 size={15} />
      </button>

      {/* Right-side actions */}
      <button
        onClick={toggleSettingsPanel}
        title="Settings"
        aria-label="Settings"
        className="w-8 h-8 flex items-center justify-center rounded-[4px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-hover)] transition-colors"
      >
        <MoreHorizontal size={15} />
      </button>
    </div>
  );
}
