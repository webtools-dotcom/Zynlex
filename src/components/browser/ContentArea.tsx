import { useRef, useEffect } from "react";
import { useWorkspacesStore } from "@/stores/workspaces";
import { useTabsStore } from "@/stores/tabs";
import { useWebviewBridge } from "@/hooks/useWebviewBridge";
import { useSettingsStore } from "@/stores/settings";
import { HomePage } from "@/components/panels/HomePage";
import { getLiveWorkspaceActiveTab } from "@/lib/workspaceTabs";

interface ContentAreaProps {
  onBridgeReady: (bridge: ReturnType<typeof useWebviewBridge>) => void;
}

export function ContentArea({ onBridgeReady }: ContentAreaProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bridge = useWebviewBridge(containerRef);

  const workspaces = useWorkspacesStore((s) => s.workspaces);
  const activeWorkspaceId = useWorkspacesStore((s) => s.activeWorkspaceId);
  const tabs = useTabsStore((s) => s.tabs);

  const ws = workspaces[activeWorkspaceId];
  const activeTab = getLiveWorkspaceActiveTab(ws, tabs);
  const hasUrl = !!activeTab?.url;

  useEffect(() => {
    onBridgeReady(bridge);
  }, [bridge]);

  // Honour settings.homePage: an empty tab shows the built-in start page only
  // while homePage is the zynlex://home sentinel; any real URL is navigated to
  // instead. Keyed on the tab id so it fires once per newly-opened empty tab.
  const homePage = useSettingsStore((s) => s.settings.homePage);
  const isCustomHome = !!homePage && homePage !== "zynlex://home";
  useEffect(() => {
    if (!activeTab || activeTab.url || !isCustomHome) return;
    void bridge.navigate(homePage);
  }, [activeTab?.id, isCustomHome]);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 overflow-hidden flex flex-col"
      style={{
        background: "var(--color-base)",
      }}
    >
      {/* ZYNLEX Home page fills the content area when no tab is open */}
      {!hasUrl && <HomePage onNavigate={bridge?.navigate ?? null} />}
    </div>
  );
}
