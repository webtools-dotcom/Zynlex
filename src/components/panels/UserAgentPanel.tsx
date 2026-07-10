import { useEffect, useState } from "react";
import { Monitor, Smartphone, Bot, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { setUserAgent } from "@/services/browser";
import { useSettingsStore } from "@/stores/settings";
import { UA_PRESETS, type UserAgentPreset } from "@/components/panels/UserAgentPresets";

const CATEGORIES: { key: UserAgentPreset["category"]; label: string; Icon: React.ElementType }[] = [
  { key: "desktop", label: "Desktop", Icon: Monitor },
  { key: "mobile", label: "Mobile", Icon: Smartphone },
  { key: "bot", label: "Bot", Icon: Bot },
];

export function UserAgentPanel() {
  const settingsUA = useSettingsStore((s) => s.settings.userAgent);
  const update = useSettingsStore((s) => s.update);
  const currentUA = settingsUA ?? "";
  const [customUA, setCustomUA] = useState(currentUA);

  useEffect(() => {
    setCustomUA(currentUA);
  }, [currentUA]);

  async function selectPreset(preset: UserAgentPreset) {
    setCustomUA(preset.ua);
    update({ userAgent: preset.ua });
    setUserAgent(preset.ua).catch(() => {});
  }

  async function applyCustom() {
    const ua = customUA.trim();
    update({ userAgent: ua });
    setUserAgent(ua).catch(() => {});
  }

  async function resetDefault() {
    setCustomUA("");
    update({ userAgent: null });
    setUserAgent("").catch(() => {});
  }

  return (
    <div className="p-2 flex flex-col h-full">
      <div className="flex items-center justify-between px-1 mb-2 flex-shrink-0">
        <p className="text-[12px] font-semibold tracking-widest text-[var(--color-text-disabled)] uppercase">
          User Agent
        </p>
        {currentUA && (
          <button
            onClick={resetDefault}
            title="Reset to default UA"
            className="text-[12px] text-[var(--color-text-disabled)] hover:text-[var(--color-accent)] transition-colors flex items-center gap-1"
          >
            <RotateCcw size={12} />
            Default
          </button>
        )}
      </div>

      {currentUA && (
        <div className="px-1 mb-2 flex-shrink-0">
          <p className="text-[11px] text-[var(--color-text-muted)] mb-0.5">Current:</p>
          <p className="text-[11px] text-[var(--color-text-disabled)] font-mono truncate bg-[var(--color-elevated)] rounded px-1.5 py-1">
            {currentUA}
          </p>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto space-y-2">
        {CATEGORIES.map(({ key, label, Icon }) => {
          const presets = UA_PRESETS.filter((p) => p.category === key);
          return (
            <div key={key}>
              <div className="flex items-center gap-1.5 px-1 mb-1">
                <Icon size={12} className="text-[var(--color-text-disabled)]" />
                <p className="text-[11px] font-semibold tracking-widest text-[var(--color-text-disabled)] uppercase">
                  {label}
                </p>
              </div>
              {presets.map((preset) => (
                <button
                  key={preset.ua}
                  onClick={() => selectPreset(preset)}
                  className={cn(
                    "w-full text-left px-2 py-1.5 rounded text-[13px] transition-colors mb-0.5",
                    currentUA === preset.ua
                      ? "bg-[var(--color-accent-dim)] text-[var(--color-accent)]"
                      : "text-[var(--color-text-muted)] hover:bg-[var(--color-hover)]"
                  )}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          );
        })}
      </div>

      {/* Custom UA input */}
      <div className="flex-shrink-0 pt-2 border-t mt-2" style={{ borderColor: "var(--color-border-subtle)" }}>
        <p className="text-[11px] font-semibold tracking-widest text-[var(--color-text-disabled)] uppercase mb-1 px-1">
          Custom UA
        </p>
        <div className="flex gap-1 px-1">
          <input
            value={customUA}
            onChange={(e) => setCustomUA(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && customUA.trim()) applyCustom();
            }}
            placeholder="Mozilla/5.0 (..."
            className="flex-1 min-w-0 bg-[var(--color-elevated)] text-[12px] text-[var(--color-text-primary)] font-mono rounded px-1.5 py-1 outline-none border border-[var(--color-border)] focus:border-[var(--color-accent)]"
          />
          <button
            onClick={applyCustom}
            disabled={!customUA.trim()}
            className={cn(
              "text-[12px] px-2 rounded transition-colors",
              customUA.trim()
                ? "bg-[var(--color-accent-dim)] text-[var(--color-accent)] hover:bg-[var(--color-accent)] hover:text-white"
                : "bg-[var(--color-elevated)] text-[var(--color-text-disabled)]"
            )}
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
