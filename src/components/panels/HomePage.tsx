/**
 * HomePage — the "XEVO Home" landing page that fills the content area
 * when no tab has a URL. Replaces the previous bare "Type a URL or
 * search" placeholder.
 *
 * Sections (top-to-bottom):
 *   1. Hero: "XEVO Home" heading + a centered search input that submits
 *      to the active tab (or opens a new one if no active tab).
 *   2. Live Servers: cards for each running localhost dev server, click
 *      to open in a new tab.
 *   3. Pinned Bookmarks: workspace-scoped bookmarks (most recent first),
 *      click to open in a new tab. Shows the active workspace name.
 *
 * Live servers come from useServersStore (populated by the port
 * scanner hook). Pinned bookmarks come from useBookmarksStore.
 */
import { useMemo } from "react";
import { useState, useRef, useEffect } from "react";
import { Search, Server, Bookmark, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useServersStore } from "@/stores/servers";
import { useBookmarksStore } from "@/stores/bookmarks";
import { useWorkspacesStore } from "@/stores/workspaces";
import { useTabsStore } from "@/stores/tabs";
import { useSettingsStore } from "@/stores/settings";
import { useUIStore } from "@/stores/ui";
import { getLiveWorkspaceActiveTab } from "@/lib/workspaceTabs";
import type { useWebviewBridge } from "@/hooks/useWebviewBridge";

interface HomePageProps {
  onNavigate?: ReturnType<typeof useWebviewBridge>["navigate"] | null;
}

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

export function HomePage({ onNavigate = null }: HomePageProps) {
  const { servers } = useServersStore();
  const { bookmarks } = useBookmarksStore();
  const { workspaces, activeWorkspaceId, addTabToWorkspace, setActiveTab } = useWorkspacesStore();
  const { tabs, addTab } = useTabsStore();
  const { settings } = useSettingsStore();
  const setActivePanel = useUIStore((s) => s.setActivePanel);

  const ws = workspaces[activeWorkspaceId];
  const activeTab = getLiveWorkspaceActiveTab(ws, tabs);
  const activeTabId = activeTab?.id ?? null;

  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Live servers — sorted: pinned first, then alive, then by port
  const liveServers = useMemo(
    () =>
      [...servers]
        .filter((s) => s.isPinned || s.isAlive)
        .sort((a, b) => {
          if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
          if (a.isAlive !== b.isAlive) return a.isAlive ? -1 : 1;
          return a.port - b.port;
        })
        .slice(0, 12),
    [servers]
  );

  // Pinned bookmarks for the active workspace
  const wsBookmarks = useMemo(
    () =>
      bookmarks
        .filter((b) => b.workspaceId === activeWorkspaceId)
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 8),
    [bookmarks, activeWorkspaceId]
  );

  const wsName = ws?.name ?? "Workspace";
  const wsColor = ws?.color ?? "#3b82f6";

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    const url = resolveInput(
      query,
      settings.searchEngine,
      settings.customSearchUrl
    );
    if (!url) return;
    if (onNavigate) {
      onNavigate(url);
    } else if (activeTabId) {
      // No bridge — open a new tab via the store
      addTab(activeWorkspaceId, { url });
    } else {
      const id = addTab(activeWorkspaceId, { url });
      addTabToWorkspace(activeWorkspaceId, id);
      setActiveTab(activeWorkspaceId, id);
    }
    setQuery("");
  }

  function openServer(port: number, protocol: "http" | "https") {
    const url = `${protocol}://localhost:${port}`;
    const id = addTab(activeWorkspaceId, { url });
    addTabToWorkspace(activeWorkspaceId, id);
    setActiveTab(activeWorkspaceId, id);
  }

  function openBookmark(url: string) {
    const id = addTab(activeWorkspaceId, { url });
    addTabToWorkspace(activeWorkspaceId, id);
    setActiveTab(activeWorkspaceId, id);
  }

  return (
    <div className="w-full h-full overflow-y-auto pointer-events-auto">
      <div className="max-w-3xl mx-auto px-6 py-10">
        {/* ── Hero ──────────────────────────────────────────────── */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 mb-4">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center text-base font-bold"
              style={{ background: wsColor, color: "#fff" }}
            >
              {ws?.icon || "🌐"}
            </div>
            <h1 className="text-2xl font-semibold text-[var(--xevo-text)]">
              XEVO Home
            </h1>
          </div>
          <p className="text-[13px] text-[var(--xevo-text-muted)] mb-6" style={{ letterSpacing: "0.04em" }}>
            <span style={{ color: wsColor }}>{wsName}</span> workspace
            {" · "}
            Search the web, jump to a dev server, or open a bookmark
          </p>

          <form
            onSubmit={submitSearch}
            className={cn(
              "flex items-center gap-2 h-11 px-3 mx-auto max-w-xl",
              "rounded-[10px] border transition-all duration-150",
              "border-[var(--xevo-border)] bg-[var(--xevo-modal-bg)]",
              "focus-within:border-[var(--xevo-accent-border)] focus-within:shadow-[0_0_0_2px_rgba(255,255,255,0.04)]"
            )}
          >
            <Search size={14} className="text-[var(--xevo-text-faint)] flex-shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search the web or enter URL"
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              className="flex-1 bg-transparent outline-none text-[13px] text-[var(--xevo-text)] placeholder:text-[var(--xevo-text-faint)]"
            />
            {query && (
              <button
                type="submit"
                className="text-[var(--xevo-text-faint)] hover:text-[var(--xevo-text)]"
                title="Go"
              >
                <ArrowRight size={14} />
              </button>
            )}
          </form>
          <p className="text-[10px] text-[var(--xevo-text-faint)] mt-2">
            <kbd className="px-1 py-0.5 bg-[var(--xevo-badge-bg)] text-[var(--xevo-text-muted)] rounded text-[9px] font-mono">Ctrl+L</kbd>{" "}
            focuses the address bar from anywhere
          </p>
        </div>

        {/* ── Live Servers ──────────────────────────────────────── */}
        <section className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-1.5">
              <Server size={12} className="text-[var(--xevo-text-faint)]" />
              <h2 className="text-[11px] font-semibold tracking-[0.08em] text-[var(--xevo-accent)] uppercase">
                Live Servers
              </h2>
            </div>
            <button
              onClick={() => setActivePanel("servers")}
              className="text-[10px] text-[var(--xevo-accent)] opacity-60 hover:opacity-100 hover:underline transition-opacity"
            >
              View all
            </button>
          </div>

          {liveServers.length === 0 ? (
            <div className="p-4 text-center">
              <p className="text-[12px] text-[var(--xevo-text-muted)]">
                No dev servers running · Start one and it'll appear here
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
              {liveServers.map((server) => (
                <button
                  key={server.port}
                  onClick={() => openServer(server.port, server.protocol)}
                  className={cn(
                    "flex items-center gap-2 p-3 rounded-[8px] text-left",
                    "border border-[var(--xevo-border)] bg-[var(--xevo-modal-bg)]",
                    "hover:border-[var(--xevo-accent-border)] hover:bg-[var(--xevo-hover)]",
                    "transition-all duration-150"
                  )}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                    style={{ background: "var(--xevo-success)" }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] font-mono text-[var(--xevo-text)] truncate">
                      :{server.port}
                    </div>
                    <div className="text-[10px] text-[var(--xevo-text-faint)] truncate">
                      {server.label ?? server.title ?? `${server.protocol}://localhost:${server.port}`}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* ── Bookmarks ─────────────────────────────────────────── */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-1.5">
              <Bookmark size={12} className="text-[var(--xevo-text-faint)]" />
              <h2 className="text-[11px] font-semibold tracking-[0.08em] text-[var(--xevo-accent)] uppercase">
                Bookmarks
              </h2>
            </div>
            <button
              onClick={() => setActivePanel("bookmarks")}
              className="text-[10px] text-[var(--xevo-accent)] opacity-60 hover:opacity-100 hover:underline transition-opacity"
            >
              View all
            </button>
          </div>

          {wsBookmarks.length === 0 ? (
            <div className="p-4 text-center">
              <p className="text-[12px] text-[var(--xevo-text-muted)]">
                No bookmarks yet · Press <kbd className="px-1 py-0.5 bg-[var(--xevo-badge-bg)] text-[var(--xevo-text-muted)] rounded text-[9px] font-mono">Ctrl+D</kbd> to save one
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              {wsBookmarks.map((bookmark) => (
                <button
                  key={bookmark.id}
                  onClick={() => openBookmark(bookmark.url)}
                  className={cn(
                    "w-full flex items-center gap-2 p-2 rounded-md text-left",
                    "hover:bg-[var(--xevo-hover)] transition-colors"
                  )}
                >
                  <ArrowRight
                    size={11}
                    className="text-[var(--xevo-text-faint)] flex-shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] text-[var(--xevo-text)] truncate">
                      {bookmark.title}
                    </div>
                    <div className="text-[10px] text-[var(--xevo-text-faint)] truncate font-mono">
                      {bookmark.url}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export default HomePage;
