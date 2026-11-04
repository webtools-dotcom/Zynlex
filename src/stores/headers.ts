import { createWorkspaceRulesStore } from "@/stores/workspaceRules";

export interface HeaderRule {
  id: string;
  pattern: string;
  name: string;
  value: string;
  enabled: boolean;
  /** Added by an AI agent; not persisted (see workspaceRules). Rust ignores it. */
  agent?: boolean;
}

export const useHeadersStore = createWorkspaceRulesStore<HeaderRule>("zynlex-header-rules");
