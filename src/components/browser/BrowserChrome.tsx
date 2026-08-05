import { ContentArea } from "./ContentArea";
import { FindBar } from "./FindBar";
import { OverlayPanel } from "@/components/overlay/OverlayPanel";
import type { useWebviewBridge } from "@/hooks/useWebviewBridge";

type BridgeType = ReturnType<typeof useWebviewBridge>;

interface BrowserChromeProps {
  onBridgeReady: (bridge: BridgeType) => void;
}

export function BrowserChrome({ onBridgeReady }: BrowserChromeProps) {
  return (
    <div className="relative flex-1 overflow-hidden">
      <ContentArea onBridgeReady={onBridgeReady} />
      <OverlayPanel />
      <FindBar />
    </div>
  );
}
