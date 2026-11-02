import { create } from "zustand";
import type { AgentStatus } from "@/services/browser";

/** Agent bridge state, mirrored from Rust for the status bar. */
export const useAgentStore = create<AgentStatus>()(() => ({ enabled: true, clients: [] }));
