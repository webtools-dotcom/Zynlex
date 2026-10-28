import type { Environment } from "@/lib/envSwitch";
import { createWorkspaceRulesStore } from "@/stores/workspaceRules";

/** Each workspace's environments (local / staging / production…), in switcher order. */
export const useEnvironmentsStore = createWorkspaceRulesStore<Environment>("zynlex-environments");
