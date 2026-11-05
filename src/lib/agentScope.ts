/**
 * What an AI agent may see and drive (docs/agent-interface.md#permissions-and-safety):
 * localhost, plus the environments of the tab's workspace the developer ticked
 * "agent" on in Settings → Environments. Production environments never count,
 * even if ticked before they were marked prod.
 */
import { type Environment, matchEnv } from "@/lib/envSwitch";
import { isLoopbackUrl } from "@/lib/url";
import { useEnvironmentsStore } from "@/stores/environments";

/** The granted environment a URL belongs to, if any. */
export function grantedEnv(url: string, envs: Environment[]): Environment | null {
  const env = matchEnv(url, envs);
  return env?.agent && !env.isProd ? env : null;
}

export function agentCanUse(url: string, workspaceId: string): boolean {
  return (
    isLoopbackUrl(url) ||
    grantedEnv(url, useEnvironmentsStore.getState().rulesByWs[workspaceId] ?? []) != null
  );
}

/** For replies: what "a tab you can use" means. */
export const SCOPE = "localhost, or an environment the developer let agents use";
