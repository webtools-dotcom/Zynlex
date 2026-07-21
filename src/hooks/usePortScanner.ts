import { useEffect, useCallback, useRef } from "react";
import { useServersStore } from "@/stores/servers";
import { useSettingsStore } from "@/stores/settings";
import { scanPorts } from "@/services/browser";

const IS_TAURI =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// The standard list of dev server ports to scan
const DEFAULT_SCAN_PORTS: number[] = [
  1313,  // Hugo
  3000, 3001, 3002, 3333,
  4000, 4200, 4321, 4444,  // Angular:4200, Astro:4321
  5000, 5001, 5173, 5174,  // Vite:5173
  6006,  // Storybook
  7000, 7001,
  8000, 8080, 8081, 8787, 8888,  // Jupyter:8888, CF Workers:8787
  9000, 9229,  // Node debug:9229
];

// usePortScanner is mounted in two places (RootLayout's PortScannerMount for the
// background scan loop, and LiveServersPanel just to grab the `scan` callback for
// its rescan button). Only the first-mounted instance should own the mount/interval
// scan loop — otherwise both fire on mount and on every interval tick, doubling
// every port scan.
let primaryMounted = false;

export function usePortScanner() {
  const { updateFromScan, setIsScanning, setLastScanAt } = useServersStore();
  const { settings } = useSettingsStore();
  const isScanningRef = useRef(false);
  const isPrimaryRef = useRef(false);

  const scan = useCallback(async () => {
    if (!IS_TAURI) return;
    if (isScanningRef.current) return; // Skip if already scanning
    isScanningRef.current = true;
    setIsScanning(true);

    try {
      // Merge default ports with any user-added custom ports
      const allPorts = [
        ...new Set([...DEFAULT_SCAN_PORTS, ...settings.customPorts]),
      ];
      const results = await scanPorts(allPorts);

      // Skip store update if nothing actually changed — prevents
      // the immer middleware from producing a new servers array
      // reference every tick, which would cascade into re-renders
      // for every consumer of useServersStore.
      const current = useServersStore.getState().servers;
      const currentByPort = new Map(current.map((s) => [s.port, s]));
      const hasChanged =
        results.length !== current.length ||
        results.some((r) => {
          const prev = currentByPort.get(r.port);
          const normalizedProtocol = r.protocol === "https" ? "https" : "http";
          return (
            !prev ||
            prev.isAlive !== r.alive ||
            prev.protocol !== normalizedProtocol ||
            (prev.title ?? null) !== (r.title ?? null) ||
            (prev.status ?? null) !== (r.status ?? null)
          );
        });

      if (hasChanged) {
        updateFromScan(results);
      }
      setLastScanAt(Date.now());
    } catch (e) {
      if (import.meta.env.DEV) {
        console.error("[xevo] scan_ports failed:", e);
      }
    } finally {
      isScanningRef.current = false;
      setIsScanning(false);
    }
  }, [updateFromScan, setIsScanning, settings.customPorts]);

  // Initial scan on mount — only the first-mounted instance claims primary status.
  useEffect(() => {
    if (primaryMounted) return;
    primaryMounted = true;
    isPrimaryRef.current = true;
    scan();
    return () => {
      if (isPrimaryRef.current) primaryMounted = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only on mount

  // Periodic scan on interval — only the primary instance runs this.
  useEffect(() => {
    if (!isPrimaryRef.current) return;
    const intervalSec = settings.portScanInterval ?? 10;
    const intervalMs = Math.max(5, Math.min(60, intervalSec)) * 1000;
    const id = setInterval(scan, intervalMs);
    return () => clearInterval(id);
  }, [scan, settings.portScanInterval]);

  return { scan };
}
