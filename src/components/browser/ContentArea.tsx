import { useRef, useEffect } from "react";
import { useWorkspacesStore } from "@/stores/workspaces";
import { useTabsStore } from "@/stores/tabs";
import { useWebviewBridge } from "@/hooks/useWebviewBridge";
import { HomePage } from "@/components/panels/HomePage";
import { getLiveWorkspaceActiveTab } from "@/lib/workspaceTabs";

interface ContentAreaProps {
  onBridgeReady: (bridge: ReturnType<typeof useWebviewBridge>) => void;
}

export function ContentArea({ onBridgeReady }: ContentAreaProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bridge = useWebviewBridge(containerRef);

  const { workspaces, activeWorkspaceId } = useWorkspacesStore();
  const tabs = useTabsStore((s) => s.tabs);

  const ws = workspaces[activeWorkspaceId];
  const activeTab = getLiveWorkspaceActiveTab(ws, tabs);
  const hasUrl = !!activeTab?.url;

  useEffect(() => {
    onBridgeReady(bridge);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge]);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 overflow-hidden"
      style={{
        background: "var(--xevo-content-bg)",
      }}
    >
      {/* XEVO Home page fills the content area when no tab is open */}
      {!hasUrl && <HomePage onNavigate={bridge?.navigate ?? null} />}
    </div>
  );
}
