import { createWorkspaceRulesStore } from "@/stores/workspaceRules";

export interface HeaderRule {
  id: string;
  pattern: string;
  name: string;
  value: string;
  enabled: boolean;
}

export const useHeadersStore = createWorkspaceRulesStore<HeaderRule>("zynlex-header-rules");
