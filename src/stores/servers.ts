import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { persist } from "zustand/middleware";
import type { LocalServer } from "@/types";
import type { ScannedPort } from "@/services/browser";

interface ServersStore {
  servers: LocalServer[];
  isScanning: boolean;
  lastScanAt: number | null;
  updateFromScan: (scanned: ScannedPort[]) => void;
  setIsScanning: (v: boolean) => void;
  setLastScanAt: (value: number | null) => void;
  setLabel: (port: number, label: string | null) => void;
  togglePinned: (port: number) => void;
  removeServer: (port: number) => void;
}

export const useServersStore = create<ServersStore>()(
  persist(
    immer((set) => ({
      servers: [],
      isScanning: false,
      lastScanAt: null,

      updateFromScan: (scanned) => {
        set((s) => {
          const now = Date.now();
          const scannedMap = new Map(scanned.map((r) => [r.port, r]));

          s.servers.forEach((server: LocalServer) => {
            const found = scannedMap.get(server.port);
            if (!found) return;

            server.isAlive = found.alive;
            server.protocol = found.protocol === "https" ? "https" : "http";
            server.title = found.title ?? null;
            server.status = found.status ?? null;
            if (found.alive) {
              server.lastSeen = now;
            }
            scannedMap.delete(server.port);
          });

          scannedMap.forEach((result) => {
            if (!result.alive) return;

            s.servers.push({
              port: result.port,
              protocol: result.protocol === "https" ? "https" : "http",
              label: null,
              title: result.title ?? null,
              status: result.status ?? null,
              isAlive: true,
              lastSeen: now,
              isPinned: false,
            });
          });
        });
      },

      setIsScanning: (v) => {
        set((s) => {
          s.isScanning = v;
        });
      },

      setLastScanAt: (value) => {
        set((s) => {
          s.lastScanAt = value;
        });
      },

      setLabel: (port, label) => {
        set((s) => {
          const server = s.servers.find((sv: LocalServer) => sv.port === port);
          if (server) server.label = label;
        });
      },

      togglePinned: (port) => {
        set((s) => {
          const server = s.servers.find((sv: LocalServer) => sv.port === port);
          if (server) server.isPinned = !server.isPinned;
        });
      },

      removeServer: (port) => {
        set((s) => {
          s.servers = s.servers.filter((sv: LocalServer) => sv.port !== port);
        });
      },
    })),
    {
      name: "xevo-servers",
      partialize: (s) => ({
        servers: s.servers.map((sv) => ({
          ...sv,
          title: sv.title ?? null,
          status: sv.status ?? null,
          isAlive: false,
        })),
      }),
    }
  )
);
