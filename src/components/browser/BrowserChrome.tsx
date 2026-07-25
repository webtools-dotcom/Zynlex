import { ContentArea } from "./ContentArea";
import { FindBar } from "./FindBar";
import { OverlayPanel } from "@/components/overlay/OverlayPanel";
import { ApiTester } from "@/components/panels/ApiTester";
import { useUIStore } from "@/stores/ui";
import { useMemo } from "react";
import type { useWebviewBridge } from "@/hooks/useWebviewBridge";

type BridgeType = ReturnType<typeof useWebviewBridge>;

interface BrowserChromeProps {
  onBridgeReady: (bridge: BridgeType) => void;
}

export function BrowserChrome({ onBridgeReady }: BrowserChromeProps) {
  const closeOverlay = useUIStore((s) => s.closeOverlay);

  const apiTesterContent = useMemo(
    () => <ApiTester embedded onClose={closeOverlay} />,
    [closeOverlay],
  );
  return (
    <div className="relative flex-1 overflow-hidden">
      <ContentArea onBridgeReady={onBridgeReady} />
      <OverlayPanel apiTesterContent={apiTesterContent} />
      <FindBar />
    </div>
  );
}
