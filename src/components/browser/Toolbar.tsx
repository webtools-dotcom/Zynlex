import { useState, useEffect, useRef, useCallback } from "react";
import { ArrowLeft, ArrowRight, RotateCw, Lock, Globe, Search, X, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { useWorkspacesStore } from "@/stores/workspaces";
import { useTabsStore } from "@/stores/tabs";
import { useSettingsStore } from "@/stores/settings";
import { useUIStore } from "@/stores/ui";
import { getLiveWorkspaceActiveTab } from "@/lib/workspaceTabs";

function resolveInput(raw: string, searchEngine: string, customSearchUrl: string): string {
  const s = raw.trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  if (/^localhost(:\d+)?(\/.*)?$/i.test(s) || /^127\.0\.0\.1/.test(s))
    return `http://${s}`;
  if (/^[\w-]+\.[\w.-]+(\/.*)?$/.test(s) && !s.includes(" "))
    return `https://${s}`;
  if (searchEngine === "custom" && customSearchUrl) {
    return customSearchUrl.replace("%s", encodeURIComponent(s));
  }
  const engine = searchEngine === "duckduckgo" ? "duckduckgo.com"
    : searchEngine === "bing" ? "bing.com"
    : "google.com";
  return `https://${engine}/search?q=${encodeURIComponent(s)}`;
}

interface ToolbarProps {
  onNavigate: ((url: string) => Promise<void>) | null;
  onBack: (() => Promise<void>) | null;
  onForward: (() => Promise<void>) | null;
  onReload: (() => Promise<void>) | null;
}

export function Toolbar({ onNavigate, onBack, onForward, onReload }: ToolbarProps) {
  const { workspaces, activeWorkspaceId } = useWorkspacesStore();
  const { tabs } = useTabsStore();
  const { searchEngine, customSearchUrl } = useSettingsStore((s) => s.settings);
  const toggleSettingsPanel = useUIStore((s) => s.toggleSettingsPanel);

  const ws = workspaces[activeWorkspaceId];
  const activeTab = getLiveWorkspaceActiveTab(ws, tabs);

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
    if (e.key === "Enter") handleNavigate(draft);
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
    function onForwarded() { focusInput(); }
    window.addEventListener("keydown", handler);
    window.addEventListener("xevo:focus-address-bar", onForwarded);
    return () => {
      window.removeEventListener("keydown", handler);
      window.removeEventListener("xevo:focus-address-bar", onForwarded);
    };
  }, []);

  const isHttps = activeTab?.url?.startsWith("https://") ?? false;
  const isLocalhost =
    activeTab?.url?.startsWith("http://localhost") ||
    activeTab?.url?.startsWith("http://127") || false;
  const isSecure = isHttps || isLocalhost;

  const canGoBack = (activeTab?.historyBack?.length ?? 0) > 0;
  const canGoForward = (activeTab?.historyForward?.length ?? 0) > 0;

  return (
    <div
      className="h-[40px] flex items-center gap-2 px-3 flex-shrink-0"
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
          "w-7 h-7 flex items-center justify-center rounded-[4px] transition-colors",
          canGoBack
            ? "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-hover)] cursor-pointer"
            : "text-[var(--color-text-disabled)] cursor-not-allowed opacity-40",
        )}
      >
        <ArrowLeft size={14} />
      </button>
      <button
        disabled={!canGoForward}
        onClick={() => onForward?.()}
        title="Forward (Alt+→)"
        aria-label="Go forward"
        className={cn(
          "w-7 h-7 flex items-center justify-center rounded-[4px] transition-colors",
          canGoForward
            ? "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-hover)] cursor-pointer"
            : "text-[var(--color-text-disabled)] cursor-not-allowed opacity-40",
        )}
      >
        <ArrowRight size={14} />
      </button>
      <button
        disabled={!onReload}
        onClick={() => onReload?.()}
        title="Reload (Ctrl+R)"
        aria-label="Reload page"
        className={cn(
          "w-7 h-7 flex items-center justify-center rounded-[4px] transition-colors",
          onReload
            ? "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-hover)] cursor-pointer"
            : "text-[var(--color-text-disabled)] cursor-not-allowed opacity-40",
        )}
      >
        <RotateCw size={14} />
      </button>

      {/* Address bar — centered, max-width constrained */}
      <div className="flex-1 flex justify-center">
        <div className="relative w-full max-w-[680px]">
          <div className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-disabled)] flex items-center pointer-events-none">
            {focused ? (
              <Search size={13} />
            ) : activeTab?.url ? (
              isSecure ? (
                <Lock size={13} className="text-[var(--color-live)] opacity-70" />
              ) : (
                <Globe size={13} className="text-[var(--color-warn)] opacity-70" />
              )
            ) : (
              <Search size={13} />
            )}
          </div>

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
              "w-full h-[28px] bg-[var(--color-elevated)] rounded-[4px] border border-[var(--color-border)]",
              "pl-8 pr-3 text-[var(--color-text-primary)] placeholder:text-[var(--color-text-disabled)]",
              "focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)] focus:border-[var(--color-accent)]",
              focused
                ? "font-[var(--font-ui)] text-[13px]"
                : "font-[var(--font-mono)] text-[12px]",
            )}
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
          />

          {focused && draft && (
            <button
              onMouseDown={(e) => { e.preventDefault(); setDraft(""); }}
              aria-label="Clear address bar"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-text-disabled)] hover:text-[var(--color-text-muted)] transition-colors"
            >
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Right-side actions */}
      <button
        onClick={toggleSettingsPanel}
        title="Settings"
        aria-label="Settings"
        className="w-7 h-7 flex items-center justify-center rounded-[4px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-hover)] transition-colors"
      >
        <MoreHorizontal size={14} />
      </button>
    </div>
  );
}
