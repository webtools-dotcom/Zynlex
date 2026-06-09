import { useCallback, useState, useMemo } from "react";
import { TabBar } from "./TabBar";
import { AddressBar } from "./AddressBar";
import { ContentArea } from "./ContentArea";
import { LoadingBar } from "./LoadingBar";
import { FindBar } from "./FindBar";
import { OverlayPanel } from "@/components/overlay/OverlayPanel";
import { ApiTester } from "@/components/panels/ApiTester";
import { NotesNotepad } from "@/components/panels/NotesNotepad";
import { useUIStore } from "@/stores/ui";
import type { useWebviewBridge } from "@/hooks/useWebviewBridge";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useWorkspacesStore } from "@/stores/workspaces";
import { useTabsStore } from "@/stores/tabs";
import { getLiveWorkspaceActiveTab } from "@/lib/workspaceTabs";

type BridgeType = ReturnType<typeof useWebviewBridge>;

export function BrowserChrome() {
  const [bridge, setBridge] = useState<BridgeType | null>(null);
  const closeOverlay = useUIStore((s) => s.closeOverlay);

  const handleBridgeReady = useCallback((b: BridgeType) => {
    setBridge(b);
  }, []);

  useKeyboardShortcuts(bridge);

  const workspaces = useWorkspacesStore((s) => s.workspaces);
  const activeWorkspaceId = useWorkspacesStore((s) => s.activeWorkspaceId);
  const tabs = useTabsStore((s) => s.tabs);
  const ws = workspaces[activeWorkspaceId];
  const activeTab = getLiveWorkspaceActiveTab(ws, tabs);
  const isLoading = activeTab?.isLoading ?? false;

  const apiTesterContent = useMemo(
    () => <ApiTester embedded onClose={closeOverlay} />,
    [closeOverlay]
  );

  const notesContent = useMemo(() => <NotesNotepad />, []);

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <TabBar bridge={bridge} />
      <AddressBar
        onNavigate={bridge?.navigate ?? null}
        onBack={bridge?.goBack ?? null}
        onForward={bridge?.goForward ?? null}
        onReload={bridge?.reload ?? null}
      />
      <LoadingBar isLoading={isLoading} />
      <div className="relative flex-1 overflow-hidden">
        <ContentArea onBridgeReady={handleBridgeReady} />
        <OverlayPanel
          apiTesterContent={apiTesterContent}
          notesContent={notesContent}
        />
        <FindBar />
      </div>
    </div>
  );
}
