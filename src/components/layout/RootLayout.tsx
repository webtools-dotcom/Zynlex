import { useState, useCallback, useEffect } from "react";
import { usePortScanner } from "@/hooks/usePortScanner";
import { WorkspaceSwitcher } from "@/components/sidebar/WorkspaceSwitcher";
import { Sidebar } from "@/components/sidebar/Sidebar";
import { TabBar } from "@/components/browser/TabBar";
import { WindowControls } from "@/components/browser/WindowControls";
import { Toolbar } from "@/components/browser/Toolbar";
import { BrowserChrome } from "@/components/browser/BrowserChrome";
import { LoadingBar } from "@/components/browser/LoadingBar";
import { StatusBar } from "@/components/browser/StatusBar";
import { BookmarkBar } from "@/components/browser/BookmarkBar";
import { SettingsPanel } from "@/components/panels/SettingsPanel";
import { CommandPalette } from "@/components/CommandPalette";
import { ShortcutHelp } from "@/components/ShortcutHelp";
import { Toast } from "@/components/Toast";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ViewportSurface } from "@/components/panels/ViewportPanel";
import { useUIStore, useViewportMode } from "@/stores/ui";
import { useWorkspacesStore } from "@/stores/workspaces";
import { useTabsStore } from "@/stores/tabs";
import { useSettingsStore } from "@/stores/settings";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { getLiveWorkspaceActiveTab } from "@/lib/workspaceTabs";
import { onHoveredUrlChanged } from "@/services/browser";
import type { useWebviewBridge } from "@/hooks/useWebviewBridge";

function PortScannerMount() {
  usePortScanner();
  return null;
}

type BridgeType = ReturnType<typeof useWebviewBridge>;
const IS_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export function RootLayout() {
  const settingsPanelOpen = useUIStore((s) => s.settingsPanelOpen);
  const commandPaletteOpen = useUIStore((s) => s.commandPaletteOpen);
  const shortcutHelpOpen = useUIStore((s) => s.shortcutHelpOpen);

  const workspaces = useWorkspacesStore((s) => s.workspaces);
  const activeWorkspaceId = useWorkspacesStore((s) => s.activeWorkspaceId);
  const tabs = useTabsStore((s) => s.tabs);
  const ws = workspaces[activeWorkspaceId];
  const activeTab = getLiveWorkspaceActiveTab(ws, tabs);

  const isLoading = activeTab?.isLoading ?? false;
  const loadTime = activeTab?.loadTime ?? null;
  const url = activeTab?.url ?? "";
  const activeTabId = activeTab?.id ?? null;
  const [hoveredUrl, setHoveredUrl] = useState<string | null>(null);

  useEffect(() => {
    setHoveredUrl(null);
    if (!IS_TAURI || !activeTabId) return;

    let cancelled = false;
    const unlisten = onHoveredUrlChanged((tabId, hovered) => {
      if (!cancelled && tabId === activeTabId) setHoveredUrl(hovered);
    });
    return () => {
      cancelled = true;
      unlisten.then((fn) => fn());
    };
  }, [activeTabId]);

  const bookmarkBarVisible = useSettingsStore((s) => s.settings.bookmarkBarVisible);
  const verticalTabs = useSettingsStore((s) => s.settings.tabBarPosition) === "left";

  const [bridge, setBridge] = useState<BridgeType | null>(null);
  const handleBridgeReady = useCallback((b: BridgeType) => {
    setBridge(b);
  }, []);

  useKeyboardShortcuts(bridge);
  const viewportMode = useViewportMode();

  return (
    <ErrorBoundary>
      <div
        className="flex flex-col h-screen w-screen overflow-hidden"
        style={{
          fontFamily: "var(--font-ui)",
          background: "var(--color-base)",
          color: "var(--color-text-primary)",
        }}
      >
        <PortScannerMount />

        {/* Tab Bar — 36px, window drag region. In vertical mode the tabs move
            to a left column, so the top strip keeps only the drag region and
            the window controls. */}
        {verticalTabs ? (
          <div
            className="h-[40px] flex items-stretch flex-shrink-0"
            data-tauri-drag-region="deep"
            style={{
              background: "var(--color-surface)",
              borderBottom: "1px solid var(--color-border-subtle)",
            }}
          >
            <div className="flex-1" />
            <WindowControls />
          </div>
        ) : (
          <TabBar bridge={bridge} />
        )}

        {/* Toolbar — 40px, nav buttons + address bar */}
        {/* LoadingBar is absolutely positioned over the toolbar's bottom edge,
            not in flow: in flow it shifted the content top by 2px whenever
            loading toggled, and a stale bounds sync then left the child webview
            2px high, covering the bar everywhere but the sidebar strip. It must
            stay inside the toolbar band — the tab is a native child webview
            composited above this page, so anything drawn under it is invisible. */}
        <div className="relative flex-shrink-0">
          <Toolbar
            onNavigate={bridge?.navigate ?? null}
            onBack={bridge?.goBack ?? null}
            onForward={bridge?.goForward ?? null}
            onReload={bridge?.reload ?? null}
          />
          <LoadingBar isLoading={isLoading} />
        </div>
        {bookmarkBarVisible && <BookmarkBar />}

        {/* Sidebar + Content area */}
        <div className="flex flex-1 overflow-hidden min-h-0">
          <WorkspaceSwitcher />
          <Sidebar />
          {verticalTabs && <TabBar bridge={bridge} vertical />}
          <div className="relative flex flex-col flex-1 overflow-hidden min-w-0">
            <BrowserChrome onBridgeReady={handleBridgeReady} />
            {viewportMode && (
              <div className="absolute inset-0 z-10 bg-[var(--color-base)]">
                <ViewportSurface />
              </div>
            )}
            {!viewportMode && settingsPanelOpen && <SettingsPanel />}
          </div>
        </div>

        {/* Status Bar — 24px */}
        <StatusBar
          isLoading={isLoading}
          loadTime={loadTime}
          url={url}
          hoveredUrl={hoveredUrl}
          zoom={activeTab?.zoom ?? 1}
        />

        {/* Overlays */}
        {commandPaletteOpen && <CommandPalette />}
        {shortcutHelpOpen && <ShortcutHelp />}
        <Toast />
      </div>
    </ErrorBoundary>
  );
}
