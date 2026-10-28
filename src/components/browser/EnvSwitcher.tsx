/**
 * EnvSwitcher — the workspace's environments as a segmented control in the
 * toolbar, shown only while the active tab is on one of them. Click: same page
 * on that environment. Ctrl/middle-click: in a new tab. Production confirms
 * in place first.
 *
 * Inline rather than a dropdown: a menu opening below the toolbar would sit
 * under the tab's native webview and be unreachable.
 */
import { cn } from "@/lib/utils";
import { type Environment, displayOrigin, matchEnv } from "@/lib/envSwitch";
import { switchEnv } from "@/lib/envActions";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { useEnvironmentsStore } from "@/stores/environments";

const EMPTY: Environment[] = [];

const segment =
  "h-[22px] px-2 text-micro font-medium whitespace-nowrap border-l first:border-l-0 border-[var(--color-border)] transition-colors";

export function EnvSwitcher({ wsId, url }: { wsId: string; url: string }) {
  const envs = useEnvironmentsStore((s) => s.rulesByWs[wsId]) ?? EMPTY;
  const current = url ? matchEnv(url, envs) : null;
  if (!current || envs.length < 2) return null;

  return (
    <div
      role="group"
      aria-label="Environment"
      className="flex items-center shrink-0 rounded-[4px] border border-[var(--color-border)] overflow-hidden"
    >
      {envs.map((env) => {
        const isCurrent = env.id === current.id;
        const title = `${env.name}: ${displayOrigin(env.origin)}`;
        const style = env.isProd ? { color: "var(--color-env-prod)" } : undefined;
        if (isCurrent) {
          return (
            <span
              key={env.id}
              title={`On ${title}`}
              aria-current="true"
              className={cn(segment, "flex items-center bg-[var(--color-active)]")}
              style={{ color: env.isProd ? "var(--color-env-prod)" : "var(--color-text-primary)" }}
            >
              {env.name}
            </span>
          );
        }
        if (env.isProd) {
          return (
            <ConfirmButton
              key={env.id}
              onConfirm={() => switchEnv(env)}
              confirmLabel={`Open ${env.name}?`}
              title={`Open this page on ${title}`}
              className={cn(segment, "hover:bg-[var(--color-hover)]")}
            >
              <span style={style}>{env.name}</span>
            </ConfirmButton>
          );
        }
        return (
          <button
            key={env.id}
            type="button"
            title={`Open this page on ${title} (Ctrl+click: new tab)`}
            onClick={(e) => switchEnv(env, { newTab: e.ctrlKey })}
            onAuxClick={(e) => e.button === 1 && switchEnv(env, { newTab: true })}
            className={cn(
              segment,
              "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-hover)]",
            )}
          >
            {env.name}
          </button>
        );
      })}
    </div>
  );
}
