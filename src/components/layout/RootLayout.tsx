import { usePortScanner } from "@/hooks/usePortScanner";
import { WorkspaceSwitcher } from "@/components/sidebar/WorkspaceSwitcher";
import { Sidebar } from "@/components/sidebar/Sidebar";
import { BrowserChrome } from "@/components/browser/BrowserChrome";
import { StatusBar } from "@/components/browser/StatusBar";
import { SettingsPanel } from "@/components/panels/SettingsPanel";
import { CommandPalette } from "@/components/CommandPalette";
import { ShortcutHelp } from "@/components/ShortcutHelp";
import { Toast } from "@/components/Toast";
import { ApiTester } from "@/components/panels/ApiTester";
import { useUIStore } from "@/stores/ui";
import { useWorkspacesStore } from "@/stores/workspaces";
import { useTabsStore } from "@/stores/tabs";
import { getLiveWorkspaceActiveTab } from "@/lib/workspaceTabs";

// Mount the port scanner at the app root so it's always running
function PortScannerMount() {
  usePortScanner();
  return null;
}

export function RootLayout() {
  const settingsPanelOpen = useUIStore((s) => s.settingsPanelOpen);
  const commandPaletteOpen = useUIStore((s) => s.commandPaletteOpen);
  const shortcutHelpOpen = useUIStore((s) => s.shortcutHelpOpen);
  const apiTesterOpen = useUIStore((s) => s.apiTesterOpen);
  const closeApiTester = useUIStore((s) => s.closeApiTester);

  const workspaces = useWorkspacesStore((s) => s.workspaces);
  const activeWorkspaceId = useWorkspacesStore((s) => s.activeWorkspaceId);
  const tabs = useTabsStore((s) => s.tabs);
  const ws = workspaces[activeWorkspaceId];
  const activeTab = getLiveWorkspaceActiveTab(ws, tabs);

  const isLoading = activeTab?.isLoading ?? false;
  const loadTime = activeTab?.loadTime ?? null;
  const url = activeTab?.url ?? "";

  return (
    <div
      className="flex flex-col h-screen w-screen overflow-hidden"
      style={{ background: "var(--xevo-content-bg)" }}
    >
      <PortScannerMount />
      <div className="flex flex-1 overflow-hidden min-h-0">
        <WorkspaceSwitcher />
        <Sidebar />
        <div className="relative flex flex-col flex-1 overflow-hidden min-w-0">
          <BrowserChrome />
          {settingsPanelOpen && <SettingsPanel />}
        </div>
      </div>
      <StatusBar isLoading={isLoading} loadTime={loadTime} url={url} hoveredUrl={null} />
      {commandPaletteOpen && <CommandPalette />}
      {shortcutHelpOpen && <ShortcutHelp />}
      {apiTesterOpen && <ApiTester embedded={false} onClose={closeApiTester} />}
      <Toast />
    </div>
  );
}
