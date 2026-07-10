import { useState, useCallback } from "react";
import { usePortScanner } from "@/hooks/usePortScanner";
import { WorkspaceSwitcher } from "@/components/sidebar/WorkspaceSwitcher";
import { Sidebar } from "@/components/sidebar/Sidebar";
import { TabBar } from "@/components/browser/TabBar";
import { Toolbar } from "@/components/browser/Toolbar";
import { BrowserChrome } from "@/components/browser/BrowserChrome";
import { LoadingBar } from "@/components/browser/LoadingBar";
import { StatusBar } from "@/components/browser/StatusBar";
import { SettingsPanel } from "@/components/panels/SettingsPanel";
import { CommandPalette } from "@/components/CommandPalette";
import { ShortcutHelp } from "@/components/ShortcutHelp";
import { Toast } from "@/components/Toast";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ViewportSurface } from "@/components/panels/ViewportPanel";
import { useUIStore } from "@/stores/ui";
import { useWorkspacesStore } from "@/stores/workspaces";
import { useTabsStore } from "@/stores/tabs";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useViewportSync } from "@/hooks/useViewportSync";
import { getLiveWorkspaceActiveTab } from "@/lib/workspaceTabs";
import type { useWebviewBridge } from "@/hooks/useWebviewBridge";

function PortScannerMount() {
  usePortScanner();
  return null;
}

type BridgeType = ReturnType<typeof useWebviewBridge>;

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

  const [bridge, setBridge] = useState<BridgeType | null>(null);
  const handleBridgeReady = useCallback((b: BridgeType) => {
    setBridge(b);
  }, []);

  useKeyboardShortcuts(bridge);
  const viewportMode = useUIStore((s) => s.viewportMode);
  useViewportSync();

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

        {/* Tab Bar — 36px, window drag region */}
        <TabBar bridge={bridge} />

        {/* Toolbar — 40px, nav buttons + address bar */}
        <Toolbar
          onNavigate={bridge?.navigate ?? null}
          onBack={bridge?.goBack ?? null}
          onForward={bridge?.goForward ?? null}
          onReload={bridge?.reload ?? null}
        />
        <LoadingBar isLoading={isLoading} />

        {/* Sidebar + Content area */}
        <div className="flex flex-1 overflow-hidden min-h-0">
          <WorkspaceSwitcher />
          <Sidebar />
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
        <StatusBar isLoading={isLoading} loadTime={loadTime} url={url} hoveredUrl={null} />

        {/* Overlays */}
        {commandPaletteOpen && <CommandPalette />}
        {shortcutHelpOpen && <ShortcutHelp />}
        <Toast />
      </div>
    </ErrorBoundary>
  );
}
