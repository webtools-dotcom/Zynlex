import { create } from "zustand";
import type { AgentStatus } from "@/services/browser";

export interface AgentState extends AgentStatus {
  /** When the developer pressed Pause (ms), or null while the agent may act. */
  pausedAt: number | null;
  /** Agent calls held until Resume (see src/lib/agentPause.ts). */
  waiting: number;
}

/** Agent bridge state, mirrored from Rust for the status bar, plus the pause, which is the frontend's own. */
export const useAgentStore = create<AgentState>()(() => ({
  enabled: true,
  clients: [],
  pausedAt: null,
  waiting: 0,
}));
