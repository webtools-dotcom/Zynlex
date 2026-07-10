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
import { resolveInput } from "@/lib/url";
import type { useWebviewBridge } from "@/hooks/useWebviewBridge";

interface HomePageProps {
  onNavigate?: ReturnType<typeof useWebviewBridge>["navigate"] | null;
}

export function HomePage({ onNavigate = null }: HomePageProps) {
  const { servers } = useServersStore();
  const { bookmarks } = useBookmarksStore();
  const { activeWorkspaceId, addTabToWorkspace, setActiveTab } = useWorkspacesStore();
  const { addTab } = useTabsStore();
  const { settings } = useSettingsStore();
  const setActivePanel = useUIStore((s) => s.setActivePanel);

  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

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

  const wsBookmarks = useMemo(
    () =>
      bookmarks
        .filter((b) => b.workspaceId === activeWorkspaceId)
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 8),
    [bookmarks, activeWorkspaceId]
  );

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
    // FIX: true flex centering instead of paddingTop:40vh + translateY(-50%).
    // The old approach left a large dead zone above sparse content. This
    // centers the whole block in whatever height is actually available,
    // and still scrolls correctly once content grows past viewport height.
    <div className="w-full h-full overflow-y-auto pointer-events-auto flex flex-col items-center justify-center">
      <div className="w-full max-w-[720px] mx-auto px-6 py-16">
        {/* ── Hero ──────────────────────────────────────────────── */}
        <div className="text-center mb-14">
          <h1
            className="text-[24px] font-semibold tracking-tight text-[var(--color-text-primary)] mb-6"
            style={{ fontFamily: "var(--font-ui)" }}
          >
            Your stack, at a glance.
          </h1>

          {/*
            FIX: removed "max-w-xl mx-auto" (576px, centered) and use
            "w-full" instead. The search bar now shares the exact same
            left/right edges as the Live Servers / Bookmarks sections
            below it (both live inside the same max-w-[720px] column).
            That mismatch was the root cause of the "not symmetrical"
            look — the search bar was narrower and offset from the
            section content beneath it.
          */}
          <form
            onSubmit={submitSearch}
            className={cn(
              "flex items-center gap-2 h-11 px-3 w-full",
              "rounded-[4px] border transition-all duration-[120ms]",
              "border-[var(--color-border)] bg-[var(--color-elevated)]",
              "focus-within:border-[rgba(59,130,246,0.25)]"
            )}
          >
            <Search size={14} className="text-[var(--color-text-disabled)] flex-shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search the web or enter URL"
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              className="flex-1 bg-transparent outline-none text-[13px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-disabled)]"
            />
            {query && (
              <button
                type="submit"
                className="text-[var(--color-text-disabled)] hover:text-[var(--color-text-primary)]"
                title="Go"
                aria-label="Go"
              >
                <ArrowRight size={14} />
              </button>
            )}
          </form>
          <p className="text-[12px] text-[var(--color-text-disabled)] mt-2">
            <kbd className="px-1 py-0.5 bg-[var(--color-elevated)] text-[var(--color-text-muted)] rounded text-[11px] font-mono">Ctrl+L</kbd>{" "}
            focuses the address bar
          </p>
        </div>

        {/* ── Live Servers ──────────────────────────────────────── */}
        <section className="mb-12 relative">
          {/*
            FIX: removed "-z-10". A negative z-index with no stacking
            context established between this element and the page root
            was rendering the gradient behind the app's own background
            layer — invisible no matter the opacity. Plain DOM order
            (gradient div first, content after) already paints this
            behind the header/cards without needing z-index at all.
          */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background: "radial-gradient(ellipse at center, var(--color-live-glow) 0%, transparent 70%)",
              opacity: 0.15,
              animation: "ambientPulse 3s ease-in-out infinite",
            }}
          />

          <div className="flex items-center justify-between mb-3 relative">
            <div className="flex items-center gap-1.5">
              <Server size={12} className="text-[var(--color-text-disabled)]" />
              <h2 className="text-[12px] font-medium tracking-[0.08em] text-[var(--color-text-muted)] uppercase">
                Live Servers
              </h2>
            </div>
            {liveServers.length > 0 && (
              <button
                onClick={() => setActivePanel("servers")}
                className="text-[12px] text-[var(--color-accent)] opacity-60 hover:opacity-100 hover:underline transition-opacity"
              >
                View all
              </button>
            )}
          </div>

          {liveServers.length === 0 ? (
            <div className="py-4 text-center relative">
              <p className="text-[13px] text-[var(--color-text-muted)] italic">
                No servers detected. Start your dev server and XEVO will find it.
              </p>
            </div>
          ) : (
            <div className="space-y-1 relative">
              {liveServers.map((server) => (
                <button
                  key={server.port}
                  onClick={() => openServer(server.port, server.protocol)}
                  className={cn(
                    // FIX: added "group" — the "Open →" label below uses
                    // group-hover:opacity-100, which silently does nothing
                    // without an ancestor literally classed "group".
                    "group w-full flex items-center gap-3 h-16 px-4 text-left",
                    "rounded-[4px] border border-[var(--color-border)] bg-[var(--color-elevated)]",
                    "hover:bg-[var(--color-hover)] transition-colors duration-0"
                  )}
                >
                  {/* Left: liveness dot + port */}
                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{
                        backgroundColor: server.isAlive
                          ? "var(--color-live)"
                          : "var(--color-text-disabled)",
                        boxShadow: server.isAlive
                          ? "0 0 6px var(--color-live-glow)"
                          : "none",
                      }}
                    />
                    <span className="text-[12px] font-mono text-[var(--color-text-primary)] tabular-nums">
                      :{server.port}
                    </span>
                  </div>

                  {/* Right: name + Open link */}
                  <div className="flex-1 min-w-0 flex items-center justify-between">
                    <span className="text-[12px] text-[var(--color-text-muted)] truncate">
                      {server.label ?? server.title ?? `${server.protocol}://localhost:${server.port}`}
                    </span>
                    <span className="text-[11px] text-[var(--color-accent)] opacity-0 group-hover:opacity-100 transition-opacity shrink-0 ml-2">
                      Open →
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* ── Bookmarks ─────────────────────────────────────────── */}
        {wsBookmarks.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-1.5">
                <Bookmark size={12} className="text-[var(--color-text-disabled)]" />
                <h2 className="text-[12px] font-medium tracking-[0.08em] text-[var(--color-text-muted)] uppercase">
                  Bookmarks
                </h2>
              </div>
              <button
                onClick={() => setActivePanel("bookmarks")}
                className="text-[12px] text-[var(--color-accent)] opacity-60 hover:opacity-100 hover:underline transition-opacity"
              >
                View all
              </button>
            </div>

            <div className="space-y-0.5">
              {wsBookmarks.map((bookmark) => (
                <button
                  key={bookmark.id}
                  onClick={() => openBookmark(bookmark.url)}
                  className={cn(
                    "w-full flex items-center gap-2 px-3 h-8 rounded-[4px] text-left",
                    "hover:bg-[var(--color-hover)] transition-colors duration-0"
                  )}
                >
                  <ArrowRight
                    size={11}
                    className="text-[var(--color-text-disabled)] flex-shrink-0"
                  />
                  <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                    <span className="text-[12px] text-[var(--color-text-primary)] truncate">
                      {bookmark.title}
                    </span>
                    <span className="text-[12px] text-[var(--color-text-muted)] truncate font-mono">
                      {bookmark.url}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

export default HomePage;