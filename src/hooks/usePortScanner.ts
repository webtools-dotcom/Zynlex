import { useEffect } from "react";
import { useServersStore } from "@/stores/servers";
import { useSettingsStore } from "@/stores/settings";
import { scanPorts } from "@/services/browser";

const IS_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// The standard list of dev server ports to scan
const DEFAULT_SCAN_PORTS: number[] = [
  1313, // Hugo
  3000,
  3001,
  3002,
  3333,
  4000,
  4200,
  4321,
  4444, // Angular:4200, Astro:4321
  4173, // vite preview
  5000,
  5001,
  5173,
  5174, // Vite:5173
  5500, // VS Code Live Server
  5555, // Prisma Studio
  6006, // Storybook
  7000,
  7001,
  8000,
  8080,
  8100, // Ionic
  8081,
  8787,
  8888, // Jupyter:8888, CF Workers:8787
  9000,
  9229, // Node debug:9229
  19006, // Expo web
];

let isScanning = false;

/**
 * One scan of the default + custom ports. A plain function, not hook state, so
 * the sidebar's rescan button can call it without mounting a second scan loop.
 */
export async function scanPortsOnce(): Promise<void> {
  if (!IS_TAURI) return;
  if (isScanning) return;
  isScanning = true;
  const { updateFromScan, setIsScanning, setLastScanAt } = useServersStore.getState();
  setIsScanning(true);

  try {
    const customPorts = useSettingsStore.getState().settings.customPorts;
    const allPorts = [...new Set([...DEFAULT_SCAN_PORTS, ...customPorts])];
    const results = await scanPorts(allPorts);

    // Skip the store update when nothing changed, or every tick produces a new
    // servers array and re-renders every consumer. Results include every dead
    // port while the store only holds ports ever seen alive, so compare per
    // port — a length comparison made this "changed" on every single tick.
    const current = useServersStore.getState().servers;
    const resultByPort = new Map(results.map((r) => [r.port, r]));
    const hasChanged =
      results.some((r) => {
        const prev = current.find((s) => s.port === r.port);
        if (!prev) return r.alive;
        return (
          prev.isAlive !== r.alive ||
          prev.protocol !== (r.protocol === "https" ? "https" : "http") ||
          (prev.title ?? null) !== (r.title ?? null) ||
          (prev.status ?? null) !== (r.status ?? null)
        );
      }) || current.some((s) => s.isAlive && !resultByPort.has(s.port));

    if (hasChanged) updateFromScan(results);
    setLastScanAt(Date.now());
  } catch (e) {
    if (import.meta.env.DEV) {
      console.error("[zynlex] scan_ports failed:", e);
    }
  } finally {
    isScanning = false;
    setIsScanning(false);
  }
}

/** The background scan loop. Mount once (RootLayout). */
export function usePortScanner() {
  const intervalSec = useSettingsStore((s) => s.settings.portScanInterval) ?? 10;
  const customPorts = useSettingsStore((s) => s.settings.customPorts);

  // Rescan immediately when the port list changes, then on the interval.
  // biome-ignore lint/correctness/useExhaustiveDependencies: customPorts is the trigger; scanPortsOnce reads it fresh
  useEffect(() => {
    void scanPortsOnce();
  }, [customPorts]);

  useEffect(() => {
    const intervalMs = Math.max(5, Math.min(60, intervalSec)) * 1000;
    const id = setInterval(() => void scanPortsOnce(), intervalMs);
    return () => clearInterval(id);
  }, [intervalSec]);
}
