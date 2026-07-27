import { useMemo } from "react";
import { useState, useRef, useEffect } from "react";
import { Bookmark, ArrowRight } from "lucide-react";
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
  const bookmarks = useBookmarksStore((s) => s.bookmarks);
  const activeWorkspaceId = useWorkspacesStore((s) => s.activeWorkspaceId);
  const addTabToWorkspace = useWorkspacesStore((s) => s.addTabToWorkspace);
  const setActiveTab = useWorkspacesStore((s) => s.setActiveTab);
  const addTab = useTabsStore((s) => s.addTab);
  const settings = useSettingsStore((s) => s.settings);
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
    <div className="w-full h-full overflow-y-auto pointer-events-auto">
      <div className="min-h-full flex flex-col items-center px-10 pt-24 pb-10">
        {/* ── Eyebrow ────────────────────────────────────────────── */}
        <div className="font-mono text-[.75rem] tracking-[0.25em] text-[var(--color-text-muted)] mb-5">
          <span className="text-[var(--color-accent)]">▚</span> XEVO / LOCALHOST
        </div>

        {/* ── Heading ────────────────────────────────────────────── */}
        <h1
          className="text-[2.875rem] leading-none font-semibold text-center text-[var(--color-text-primary)] mb-1"
          style={{ fontFamily: "var(--font-display)", letterSpacing: "-1.2px" }}
        >
          Your stack, at a glance.
        </h1>

        {/* ── Subtitle ───────────────────────────────────────────── */}
        <p className="font-mono text-[.8125rem] text-[var(--color-text-disabled)] mb-10">
          {"// everything running on this machine, one keystroke away"}
        </p>

        {/* ── Command bar ────────────────────────────────────────── */}
        <form
          onSubmit={submitSearch}
          className="w-full max-w-[620px] h-[58px] flex items-center gap-3.5 pl-5 pr-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-elevated)] transition-colors duration-[120ms] focus-within:border-[var(--color-accent)]"
        >
          <span className="font-mono text-[1rem] font-semibold text-[var(--color-accent)] flex-shrink-0">
            ›
          </span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search the web or enter URL"
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            className="flex-1 bg-transparent outline-none font-mono text-[.9375rem] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-disabled)]"
          />
          <kbd className="font-mono text-[.6875rem] text-[var(--color-text-muted)] bg-[var(--color-hover)] border border-[var(--color-border)] px-2.5 py-2 rounded-md">
            Ctrl+L
          </kbd>
        </form>

        {/* ── Live Servers ──────────────────────────────────────── */}
        <section className="w-full max-w-[720px] mt-14">
          <div className="flex items-center gap-2.5 mb-3.5">
            <span className="font-mono text-[.6875rem] font-semibold tracking-[0.15em] text-[var(--color-text-muted)]">
              LIVE SERVERS
            </span>
            <span className="h-px flex-1 bg-[var(--color-border-subtle)]" />
            <span className="font-mono text-[.6875rem] text-[var(--color-text-disabled)]">
              {liveServers.length > 0
                ? `${liveServers.length} running`
                : "watching :3000 :5173 :8080 :4200"}
            </span>
          </div>

          {liveServers.length === 0 ? (
            <div className="relative text-center rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-accent-dim)]" style={{ padding: "42px 32px" }}>
              <span className="absolute top-2.5 left-3 font-mono text-xs text-[var(--color-border)]">┌</span>
              <span className="absolute top-2.5 right-3 font-mono text-xs text-[var(--color-border)]">┐</span>
              <span className="absolute bottom-2.5 left-3 font-mono text-xs text-[var(--color-border)]">└</span>
              <span className="absolute bottom-2.5 right-3 font-mono text-xs text-[var(--color-border)]">┘</span>
              <div className="text-[1rem] text-[var(--color-text-secondary)] mb-1.5" style={{ fontFamily: "var(--font-display)" }}>
                No dev servers detected on localhost.
              </div>
              <div className="font-mono text-[.8125rem] text-[var(--color-text-disabled)]">
                Start one and it appears here — <span className="text-[var(--color-accent)]">npm run dev</span> ⏎
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {liveServers.map((server) => (
                <button
                  key={server.port}
                  onClick={() => openServer(server.port, server.protocol)}
                  className="text-left rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3.5 cursor-pointer transition-colors duration-75 hover:border-[var(--color-text-disabled)]"
                >
                  <div className="flex items-center justify-end">
                    <span
                      className="w-1.5 h-1.5 rounded-full"
                      style={{
                        background: server.isAlive
                          ? "var(--color-live)"
                          : "var(--color-dead)",
                      }}
                    />
                  </div>
                  <div className="mt-2.5 text-[.9rem] font-semibold text-[var(--color-text-primary)]">
                    {server.label ?? server.title ?? `localhost:${server.port}`}
                  </div>
                  <div className="font-mono text-[.78rem] text-[var(--color-text-muted)]">
                    localhost:{server.port}
                  </div>
                  <div className="mt-2.5 flex justify-end font-mono text-[.72rem] text-[var(--color-text-muted)]">
                    Open ↗
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* ── Bookmarks ─────────────────────────────────────────── */}
        {wsBookmarks.length > 0 && (
          <section className="w-full max-w-[720px] mt-8">
            <div className="flex items-center gap-2.5 mb-3.5">
              <span className="flex items-center gap-1.5 font-mono text-[.6875rem] font-semibold tracking-[0.15em] text-[var(--color-text-muted)]">
                <Bookmark size={11} className="text-[var(--color-text-disabled)]" />
                BOOKMARKS
              </span>
              <span className="h-px flex-1 bg-[var(--color-border-subtle)]" />
              <button
                onClick={() => setActivePanel("bookmarks")}
                className="font-mono text-[.6875rem] text-[var(--color-text-disabled)] hover:text-[var(--color-text-primary)] transition-colors"
              >
                view all
              </button>
            </div>

            <div className="space-y-0.5">
              {wsBookmarks.map((bookmark) => (
                <button
                  key={bookmark.id}
                  onClick={() => openBookmark(bookmark.url)}
                  className={cn(
                    "w-full flex items-center gap-2 px-3 h-8 rounded-md text-left",
                    "hover:bg-[var(--color-hover)] transition-colors duration-0"
                  )}
                >
                  <ArrowRight
                    size={11}
                    className="text-[var(--color-text-disabled)] flex-shrink-0"
                  />
                  <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                    <span className="text-xs text-[var(--color-text-primary)] truncate">
                      {bookmark.title}
                    </span>
                    <span className="text-xs text-[var(--color-text-muted)] truncate font-mono">
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
