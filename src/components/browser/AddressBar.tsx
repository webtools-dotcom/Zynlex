import {
  useState, useEffect, useRef, useCallback,
} from "react";
import {
  ArrowLeft, ArrowRight, RotateCw, Lock, Globe, X, Search,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useWorkspacesStore } from "@/stores/workspaces";
import { useTabsStore } from "@/stores/tabs";
import { useSettingsStore } from "@/stores/settings";
import { getLiveWorkspaceActiveTab } from "@/lib/workspaceTabs";

function resolveInput(
  raw: string,
  searchEngine: string,
  customSearchUrl: string
): string {
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

interface AddressBarProps {
  onNavigate: ((url: string) => Promise<void>) | null;
  onBack: (() => Promise<void>) | null;
  onForward: (() => Promise<void>) | null;
  onReload: (() => Promise<void>) | null;
}

export function AddressBar({
  onNavigate,
  onBack,
  onForward,
  onReload,
}: AddressBarProps) {
  const { workspaces, activeWorkspaceId } = useWorkspacesStore();
  const { tabs } = useTabsStore();
  const { searchEngine, customSearchUrl } = useSettingsStore((s) => s.settings);

  const ws = workspaces[activeWorkspaceId];
  const activeTab = getLiveWorkspaceActiveTab(ws, tabs);
  const activeTabId = activeTab?.id ?? null;

  const [draft, setDraft] = useState(activeTab?.url ?? "");
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!focused) setDraft(activeTab?.url ?? "");
  }, [activeTabId, activeTab?.url, focused]);

  const handleNavigate = useCallback(
    async (raw: string) => {
      const url = resolveInput(raw, searchEngine, customSearchUrl);
      if (!url) return;
      setDraft(url);
      if (onNavigate) {
        await onNavigate(url);
      }
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

  const isHttps = activeTab?.url?.startsWith("https://") ?? false;
  const isLocalhost =
    activeTab?.url?.startsWith("http://localhost") ||
    activeTab?.url?.startsWith("http://127") ||
    false;
  const isSecure = isHttps || isLocalhost;

  const canGoBack = (activeTab?.historyBack?.length ?? 0) > 0;
  const canGoForward = (activeTab?.historyForward?.length ?? 0) > 0;

  return (
    <div
      className="h-11 flex items-center gap-1 px-2 flex-shrink-0"
      style={{
        background: "var(--xevo-address-bar)",
        borderBottom: "1px solid var(--xevo-border)",
      }}
    >
      <button
        disabled={!canGoBack}
        onClick={() => onBack?.()}
        title="Back (Alt+←)"
        className={cn(
          "w-[26px] h-[26px] flex items-center justify-center rounded-[5px] transition-colors",
          canGoBack
            ? "text-[var(--xevo-text-muted)] hover:text-[var(--xevo-text)] hover:bg-[rgba(255,255,255,0.06)] cursor-pointer"
            : "text-[var(--xevo-text-faint)] cursor-not-allowed opacity-25",
        )}
      >
        <ArrowLeft size={14} />
      </button>

      <button
        disabled={!canGoForward}
        onClick={() => onForward?.()}
        title="Forward (Alt+→)"
        className={cn(
          "w-[26px] h-[26px] flex items-center justify-center rounded-[5px] transition-colors",
          canGoForward
            ? "text-[var(--xevo-text-muted)] hover:text-[var(--xevo-text)] hover:bg-[rgba(255,255,255,0.06)] cursor-pointer"
            : "text-[var(--xevo-text-faint)] cursor-not-allowed opacity-25",
        )}
      >
        <ArrowRight size={14} />
      </button>

      <button
        disabled={!onReload}
        onClick={() => onReload?.()}
        title="Reload (Ctrl+R)"
        className={cn(
          "w-[26px] h-[26px] flex items-center justify-center rounded-[5px] transition-colors",
          onReload
            ? "text-[var(--xevo-text-muted)] hover:text-[var(--xevo-text)] hover:bg-[rgba(255,255,255,0.06)] cursor-pointer"
            : "text-[var(--xevo-text-faint)] cursor-not-allowed opacity-25",
        )}
      >
        <RotateCw size={13} />
      </button>

      <div
        className={cn(
          "flex-1 flex items-center gap-1.5 h-7 px-2 rounded-[7px] border transition-all duration-150",
          focused
            ? "border-[var(--xevo-accent-border)] bg-[var(--xevo-content-bg)] shadow-[0_0_0_2px_rgba(255,255,255,0.04)]"
            : "border-[var(--xevo-border)] bg-[var(--xevo-content-bg)] hover:border-[var(--xevo-text-faint)]",
        )}
      >
        <div className="flex-shrink-0 text-[var(--xevo-text-faint)] flex items-center">
          {focused ? (
            <Search size={11} />
          ) : activeTab?.url ? (
            isSecure ? (
              <Lock size={11} className="text-[color:var(--xevo-success)]/70" />
            ) : (
              <Globe size={11} className="text-[color:var(--xevo-warning)]/70" />
            )
          ) : (
            <Search size={11} />
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
          onBlur={() => {
            setFocused(false);
          }}
          placeholder="Search or enter address (Ctrl+L)"
          className="flex-1 bg-transparent outline-none text-[11px] font-mono text-[var(--xevo-text)] placeholder:text-[var(--xevo-text-faint)]"
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
            className="flex-shrink-0 text-[var(--xevo-text-faint)] hover:text-[var(--xevo-text-muted)] transition-colors"
          >
            <X size={11} />
          </button>
        )}
      </div>
    </div>
  );
}
