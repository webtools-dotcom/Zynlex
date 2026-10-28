/**
 * CommandPalette — VS Code-style Ctrl+K overlay.
 *
 * Centered modal with a search input that fuzzy-filters across tabs,
 * bookmarks, history, workspaces, servers, saved API requests, and built-in
 * commands — see PaletteType below for the full set. Keyboard: ArrowUp/Down
 * to move, Enter to run, Escape to close.
 */
import { useState, useEffect, useRef, useMemo } from "react";
import {
  Search,
  Globe,
  Code2,
  Bookmark,
  Clock,
  Server,
  Layers,
  TerminalSquare,
} from "lucide-react";
import { useTabsStore } from "@/stores/tabs";
import { useWorkspacesStore } from "@/stores/workspaces";
import { useUIStore } from "@/stores/ui";
import { useBookmarksStore } from "@/stores/bookmarks";
import { useHistoryStore } from "@/stores/history";
import { useServersStore } from "@/stores/servers";
import { useApiCollectionsStore } from "@/stores/apiCollections";
import { LOAD_REQUEST_EVENT } from "@/components/panels/ApiTester";
import { getLiveWorkspaceTabIds } from "@/lib/workspaceTabs";
import { openTab } from "@/lib/tabActions";
import { COMMANDS, chordLabel, keysFor } from "@/lib/commands";
import { useKeybindingsStore } from "@/stores/keybindings";
import { useEnvironmentsStore } from "@/stores/environments";
import { displayOrigin, matchEnv } from "@/lib/envSwitch";
import { switchEnv } from "@/lib/envActions";

type PaletteType =
  | "tab"
  | "environment"
  | "command"
  | "bookmark"
  | "history"
  | "workspace"
  | "server"
  | "request";

type PaletteItem = {
  id: string;
  type: PaletteType;
  label: string;
  sublabel?: string;
  icon?: React.ReactNode;
  action: () => void;
};

const GROUP_LABELS: Record<PaletteType, string> = {
  tab: "Tabs",
  environment: "Environments",
  command: "Commands",
  bookmark: "Bookmarks",
  history: "History",
  workspace: "Workspaces",
  server: "Live Servers",
  request: "Saved Requests",
};

/** Fixed group order, so results never reshuffle between keystrokes. */
const GROUP_ORDER: PaletteType[] = [
  "tab",
  "environment",
  "command",
  "bookmark",
  "request",
  "server",
  "workspace",
  "history",
];

export function CommandPalette() {
  const tabs = useTabsStore((s) => s.tabs);
  const workspaces = useWorkspacesStore((s) => s.workspaces);
  const workspaceOrder = useWorkspacesStore((s) => s.workspaceOrder);
  const activeWorkspaceId = useWorkspacesStore((s) => s.activeWorkspaceId);
  const bookmarks = useBookmarksStore((s) => s.bookmarks);
  const historyEntries = useHistoryStore((s) => s.entries);
  const servers = useServersStore((s) => s.servers);
  const collections = useApiCollectionsStore((s) => s.byWs[activeWorkspaceId]);
  const recentPaletteIds = useUIStore((s) => s.recentPaletteIds);
  const overrides = useKeybindingsStore((s) => s.overrides);
  const envsByWs = useEnvironmentsStore((s) => s.rulesByWs);

  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo<PaletteItem[]>(() => {
    const ws = workspaces[activeWorkspaceId];
    const tabIds = getLiveWorkspaceTabIds(ws, tabs);
    const tabItems: PaletteItem[] = tabIds.map((tabId) => {
      const tab = tabs[tabId];
      return {
        id: tabId,
        type: "tab" as const,
        label: tab?.title || tab?.url || "New Tab",
        sublabel: tab?.url || "",
        action: () => {
          useWorkspacesStore.getState().setActiveTab(activeWorkspaceId, tabId);
          useUIStore.getState().closeCommandPalette();
        },
      };
    });

    const commandItems: PaletteItem[] = COMMANDS.filter((c) => !c.hidden).map((c) => {
      const Icon = c.icon ?? TerminalSquare;
      const keys = keysFor(c, overrides);
      return {
        id: c.id,
        type: "command" as const,
        label: c.title,
        sublabel: keys.length ? chordLabel(keys[0]).join("+") : undefined,
        icon: <Icon size={14} className="text-[var(--color-text-muted)]" />,
        action: () => {
          useUIStore.getState().closeCommandPalette();
          c.run();
        },
      };
    });

    // The active page on the workspace's other environments.
    const wsEnvs = envsByWs[activeWorkspaceId] ?? [];
    const activeUrl = tabs[ws?.activeTabId ?? ""]?.url ?? "";
    const currentEnv = activeUrl ? matchEnv(activeUrl, wsEnvs) : null;
    const envItems: PaletteItem[] = currentEnv
      ? wsEnvs
          .filter((e) => e.id !== currentEnv.id)
          .map((e) => ({
            id: `env-${e.id}`,
            type: "environment" as const,
            label: `Open on ${e.name}${e.isProd ? " (production)" : ""}`,
            sublabel: displayOrigin(e.origin),
            icon: <Layers size={14} className="text-[var(--color-text-muted)]" />,
            action: () => {
              useUIStore.getState().closeCommandPalette();
              switchEnv(e);
            },
          }))
      : [];

    /** Every non-command item ends up opening a URL in a new tab. */
    const openInNewTab = (url: string, title: string) => () => {
      openTab({ url, title });
      useUIStore.getState().closeCommandPalette();
    };

    const bookmarkItems: PaletteItem[] = bookmarks
      .filter((b) => b.workspaceId === activeWorkspaceId)
      .map((b) => ({
        id: `bm-${b.id}`,
        type: "bookmark" as const,
        label: b.title,
        sublabel: b.url,
        icon: <Bookmark size={14} className="text-[var(--color-text-muted)]" />,
        action: openInNewTab(b.url, b.title),
      }));

    const historyItems: PaletteItem[] = historyEntries.slice(0, 60).map((h) => ({
      id: `hist-${h.id}`,
      type: "history" as const,
      label: h.title || h.url,
      sublabel: h.url,
      icon: <Clock size={14} className="text-[var(--color-text-muted)]" />,
      action: openInNewTab(h.url, h.title || h.url),
    }));

    const serverItems: PaletteItem[] = servers
      .filter((s) => s.isAlive)
      .map((s) => {
        const url = `${s.protocol}://localhost:${s.port}`;
        return {
          id: `srv-${s.port}`,
          type: "server" as const,
          label: `localhost:${s.port}`,
          sublabel: s.label ?? s.title ?? url,
          icon: <Server size={14} className="text-[var(--color-text-muted)]" />,
          action: openInNewTab(url, s.label ?? s.title ?? `localhost:${s.port}`),
        };
      });

    const workspaceItems: PaletteItem[] = workspaceOrder
      .filter((id) => id !== activeWorkspaceId && workspaces[id])
      .map((id) => ({
        id: `ws-${id}`,
        type: "workspace" as const,
        label: workspaces[id].name,
        sublabel: "Switch workspace",
        icon: <Layers size={14} className="text-[var(--color-text-muted)]" />,
        action: () => {
          useWorkspacesStore.getState().setActiveWorkspace(id);
          useUIStore.getState().closeCommandPalette();
        },
      }));

    const requestItems: PaletteItem[] = (collections?.requests ?? []).map((r) => ({
      id: `req-${r.id}`,
      type: "request" as const,
      label: r.name,
      sublabel: `${r.method} ${r.url}`,
      icon: <Code2 size={14} className="text-[var(--color-text-muted)]" />,
      action: () => {
        useUIStore.getState().openApiTester();
        useUIStore.getState().closeCommandPalette();
        setTimeout(
          () => window.dispatchEvent(new CustomEvent(LOAD_REQUEST_EVENT, { detail: r })),
          0,
        );
      },
    }));

    const allItems = [
      ...tabItems,
      ...envItems,
      ...commandItems,
      ...bookmarkItems,
      ...requestItems,
      ...serverItems,
      ...workspaceItems,
      ...historyItems,
    ];

    const q = query.trim().toLowerCase();
    const matched = q
      ? allItems.filter(
          (item) =>
            item.label.toLowerCase().includes(q) ||
            (item.sublabel?.toLowerCase().includes(q) ?? false),
        )
      : allItems;

    // Group in a fixed order, and float recently-used entries to the very top.
    const byGroup = GROUP_ORDER.flatMap((type) => matched.filter((i) => i.type === type));
    const recent = recentPaletteIds
      .map((id) => byGroup.find((i) => i.id === id))
      .filter((i): i is PaletteItem => !!i);
    const rest = byGroup.filter((i) => !recent.includes(i));

    return [...recent, ...rest].slice(0, q ? 30 : 12);
  }, [
    query,
    tabs,
    workspaces,
    workspaceOrder,
    activeWorkspaceId,
    bookmarks,
    historyEntries,
    servers,
    collections,
    recentPaletteIds,
    overrides,
    envsByWs,
  ]);

  function run(item: PaletteItem) {
    useUIStore.getState().pushRecentPaletteId(item.id);
    item.action();
  }

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const item = results[selectedIndex];
        if (item) run(item);
      } else if (e.key === "Escape") {
        useUIStore.getState().closeCommandPalette();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [results, selectedIndex]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Auto-focus input on open
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-start justify-center pt-[15vh]"
      style={{ background: "rgba(0,0,0,0.6)" }}
      onClick={() => useUIStore.getState().closeCommandPalette()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="w-[560px] flex flex-col overflow-hidden rounded-[6px] border"
        style={{
          background: "var(--color-elevated)",
          borderColor: "var(--color-border)",
          boxShadow: "0 25px 50px rgba(0,0,0,0.8)",
          animation: "paletteIn var(--duration-fast) var(--ease-out)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center h-[44px] px-4 border-b shrink-0"
          style={{ borderColor: "var(--color-border)" }}
        >
          <Search size={15} className="text-[var(--color-text-disabled)] shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tabs, bookmarks, history, servers, requests…"
            className="flex-1 ml-3 bg-transparent outline-none text-md text-[var(--color-text-primary)] placeholder:text-[var(--color-text-disabled)]"
            style={{ fontFamily: "var(--font-ui)" }}
          />
          {query === "" && (
            <kbd
              className="px-1.5 py-0.5 text-micro border rounded-[2px]"
              style={{
                background: "var(--color-elevated)",
                borderColor: "var(--color-border)",
                color: "var(--color-text-disabled)",
              }}
            >
              ESC
            </kbd>
          )}
        </div>

        <div ref={listRef} role="listbox" className="max-h-[320px] overflow-y-auto">
          {results.length === 0 ? (
            <div className="py-8 text-center text-sm text-[var(--color-text-disabled)]">
              {query ? `No results for "${query}"` : "Start typing to search..."}
            </div>
          ) : (
            results.map((item, index) => {
              // Results are grouped in a fixed order, so a header is simply a
              // type change from the previous row.
              const showHeader = index === 0 || results[index - 1].type !== item.type;
              return (
                <div key={item.id}>
                  {showHeader && (
                    <div className="px-3 pt-2 pb-0.5 text-micro font-semibold tracking-widest uppercase text-[var(--color-text-disabled)]">
                      {GROUP_LABELS[item.type]}
                    </div>
                  )}
                  <div
                    role="option"
                    aria-selected={index === selectedIndex}
                    onClick={() => run(item)}
                    className={`flex items-center h-8 px-3 gap-3 cursor-pointer transition-colors duration-0 ${
                      index === selectedIndex
                        ? "bg-[var(--color-accent-dim)]"
                        : "hover:bg-[var(--color-hover)]"
                    }`}
                  >
                    <div className="w-5 h-5 flex items-center justify-center shrink-0">
                      {item.type === "tab" ? (
                        <Globe size={14} className="text-[var(--color-text-muted)]" />
                      ) : (
                        item.icon
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-[var(--color-text-primary)] truncate">
                        {item.label}
                      </div>
                    </div>

                    <span className="text-micro text-[var(--color-text-disabled)] shrink-0 max-w-[45%] truncate">
                      {item.sublabel}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
