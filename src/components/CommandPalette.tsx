/**
 * CommandPalette — VS Code-style Ctrl+K overlay.
 *
 * Centered modal with a search input that fuzzy-filters across
 * (1) open tabs in the active workspace and
 * (2) built-in commands (New Tab, Open Settings, Close Current Tab).
 *
 * Keyboard: ArrowUp/Down to move, Enter to run, Escape to close.
 * Mouse: click on a row to run it, click on backdrop to close.
 */
import { useState, useEffect, useRef, useMemo } from "react";
import { Search, Globe, Plus, Settings, X, Code2, Bookmark } from "lucide-react";
import { useTabsStore } from "@/stores/tabs";
import { useWorkspacesStore } from "@/stores/workspaces";
import { useUIStore } from "@/stores/ui";
import {
  getLiveWorkspaceActiveTabId,
  getLiveWorkspaceTabIds,
} from "@/lib/workspaceTabs";

type PaletteItem = {
  id: string;
  type: "tab" | "command";
  label: string;
  sublabel?: string;
  icon?: React.ReactNode;
  action: () => void;
};

export function CommandPalette() {
  const tabs = useTabsStore((s) => s.tabs);
  const workspaces = useWorkspacesStore((s) => s.workspaces);
  const activeWorkspaceId = useWorkspacesStore((s) => s.activeWorkspaceId);

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
          useWorkspacesStore
            .getState()
            .setActiveTab(activeWorkspaceId, tabId);
          useUIStore.getState().closeCommandPalette();
        },
      };
    });

    const commandItems: PaletteItem[] = [
      {
        id: "cmd-new-tab",
        type: "command",
        label: "New Tab",
        sublabel: "Open a new empty tab",
        icon: <Plus size={14} className="text-[var(--xevo-text-muted)]" />,
        action: () => {
          const wsId = activeWorkspaceId;
          const newTabId = useTabsStore.getState().addTab(wsId, {});
          useWorkspacesStore.getState().addTabToWorkspace(wsId, newTabId);
          useWorkspacesStore.getState().setActiveTab(wsId, newTabId);
          useUIStore.getState().closeCommandPalette();
        },
      },
      {
        id: "cmd-settings",
        type: "command",
        label: "Open Settings",
        sublabel: "Theme, search engine, scan interval",
        icon: <Settings size={14} className="text-[var(--xevo-text-muted)]" />,
        action: () => {
          useUIStore.getState().toggleSettingsPanel();
          useUIStore.getState().closeCommandPalette();
        },
      },
      {
        id: "cmd-close-tab",
        type: "command",
        label: "Close Current Tab",
        sublabel: "Close the active tab",
        icon: <X size={14} className="text-[var(--xevo-text-muted)]" />,
        action: () => {
          const wsState = useWorkspacesStore.getState();
          const ws = wsState.workspaces[activeWorkspaceId];
          const activeTabId = getLiveWorkspaceActiveTabId(ws, useTabsStore.getState().tabs);
          if (activeTabId) {
            useTabsStore.getState().closeTab(activeTabId);
            wsState.removeTabFromWorkspace(activeWorkspaceId, activeTabId);
          }
          useUIStore.getState().closeCommandPalette();
        },
      },
      {
        id: "cmd-bookmarks",
        type: "command",
        label: "Open Bookmarks Panel",
        sublabel: "Show saved bookmarks in the sidebar",
        icon: <Bookmark size={14} className="text-[var(--xevo-text-muted)]" />,
        action: () => {
          useUIStore.getState().setActivePanel("bookmarks");
          useUIStore.getState().closeCommandPalette();
        },
      },
      {
        id: "cmd-api-tester",
        type: "command",
        label: "Open API Tester",
        sublabel: "Test HTTP endpoints in a split panel",
        icon: <Code2 size={14} className="text-[var(--xevo-text-muted)]" />,
        action: () => {
          useUIStore.getState().openOverlay("api-tester");
          useUIStore.getState().closeCommandPalette();
        },
      },
      {
        id: "cmd-find",
        type: "command",
        label: "Find in Page",
        sublabel: "Open the in-page search bar (Ctrl+F)",
        icon: <Search size={14} className="text-[var(--xevo-text-muted)]" />,
        action: () => {
          useUIStore.getState().openFind();
          useUIStore.getState().closeCommandPalette();
        },
      },
    ];

    const allItems = [...tabItems, ...commandItems];
    if (query.trim() === "") return allItems.slice(0, 8);
    const q = query.toLowerCase();
    return allItems
      .filter(
        (item) =>
          item.label.toLowerCase().includes(q) ||
          (item.sublabel?.toLowerCase().includes(q) ?? false)
      )
      .slice(0, 10);
  }, [query, tabs, workspaces, activeWorkspaceId]);

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
        results[selectedIndex]?.action();
      } else if (e.key === "Escape") {
        useUIStore.getState().closeCommandPalette();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [results, selectedIndex]);

  // Reset selection when query changes
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
        className="w-[560px] max-h-[480px] flex flex-col overflow-hidden rounded-lg border"
        style={{
          background: "var(--xevo-modal-bg)",
          borderColor: "var(--xevo-modal-border)",
          boxShadow: "0 25px 50px rgba(0,0,0,0.8)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center h-12 px-4 border-b shrink-0"
          style={{ borderColor: "var(--xevo-modal-border)" }}
        >
          <Search size={15} className="text-[var(--xevo-text-faint)] shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tabs and commands..."
            className="flex-1 ml-3 bg-transparent outline-none text-sm text-[var(--xevo-text)] placeholder:text-[var(--xevo-text-faint)]"
          />
          {query === "" && (
            <kbd
              className="px-1.5 py-0.5 text-[10px] border rounded"
              style={{
                background: "var(--xevo-badge-bg)",
                borderColor: "var(--xevo-modal-border)",
                color: "var(--xevo-text-faint)",
              }}
            >
              ESC
            </kbd>
          )}
        </div>

        <div ref={listRef} className="overflow-y-auto">
          {results.length === 0 ? (
            <div className="py-8 text-center text-sm text-[var(--xevo-text-faint)]">
              {query ? `No results for "${query}"` : "Start typing to search..."}
            </div>
          ) : (
            results.map((item, index) => (
              <div
                key={item.id}
                onClick={item.action}
                className={`flex items-center h-11 px-3 gap-2.5 cursor-pointer transition-colors ${
                  index === selectedIndex
                    ? "bg-[var(--xevo-hover)]"
                    : "hover:bg-[var(--xevo-hover)]"
                }`}
              >
                <div className="w-5 h-5 flex items-center justify-center shrink-0">
                  {item.type === "tab" ? (
                    <Globe size={13} className="text-[var(--xevo-text-faint)]" />
                  ) : (
                    item.icon
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="text-sm text-[var(--xevo-text)] truncate">{item.label}</div>
                  {item.sublabel && (
                    <div className="text-[11px] text-[var(--xevo-text-faint)] truncate">
                      {item.sublabel}
                    </div>
                  )}
                </div>

                {item.type === "tab" && (
                  <span
                    className="text-[9px] px-1 py-0.5 border rounded shrink-0"
                    style={{
                      background: "var(--xevo-badge-bg)",
                      borderColor: "var(--xevo-modal-border)",
                      color: "var(--xevo-text-faint)",
                    }}
                  >
                    TAB
                  </span>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export default CommandPalette;
