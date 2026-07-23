/**
 * SettingsPanel — right-side slide-in settings panel.
 *
 * Mounted by RootLayout when useUIStore.settingsPanelOpen is true.
 * All edits persist via the Zustand settings store.
 */
import { useEffect } from "react";
import { X } from "lucide-react";
import { useSettingsStore } from "@/stores/settings";
import { useUIStore } from "@/stores/ui";

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-xs uppercase tracking-wider text-[var(--color-text-disabled)] mt-5 mb-2 pt-4 border-t border-[var(--color-border-subtle)] first:mt-0 first:pt-0 first:border-t-0">
      {children}
    </div>
  );
}

function ThemeButton({
  label,
  value,
  current,
  onSelect,
}: {
  label: string;
  value: "dark" | "light" | "system";
  current: "dark" | "light" | "system";
  onSelect: (v: "dark" | "light" | "system") => void;
}) {
  const active = current === value;
  return (
    <button
      onClick={() => onSelect(value)}
      className={
        "px-3 py-1 text-xs rounded border " +
        (active
          ? "text-[var(--color-text-primary)] border-[var(--color-text-muted)]"
          : "text-[var(--color-text-disabled)] hover:text-[var(--color-text-primary)] border-transparent")
      }
      style={active ? { background: "var(--color-elevated)" } : undefined}
    >
      {label}
    </button>
  );
}

function SearchEngineButton({
  label,
  value,
  current,
  onSelect,
}: {
  label: string;
  value: "google" | "duckduckgo" | "bing" | "custom";
  current: "google" | "duckduckgo" | "bing" | "custom";
  onSelect: (v: "google" | "duckduckgo" | "bing" | "custom") => void;
}) {
  const active = current === value;
  return (
    <button
      onClick={() => onSelect(value)}
      className={
        active
          ? "border border-[color:var(--color-accent)]/50 bg-[color:var(--color-accent)]/10 text-[var(--color-text-primary)] rounded px-2 py-1.5 text-xs text-center"
          : "border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] rounded px-2 py-1.5 text-xs text-center"
      }
    >
      {label}
    </button>
  );
}

function CompactToggle({
  value,
  onToggle,
}: {
  value: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      role="switch"
      aria-checked={value}
      className={
        "w-9 h-5 rounded-full relative transition-colors " +
        (value ? "bg-[var(--color-accent)]" : "bg-[var(--color-border)]")
      }
    >
      <span
        className="absolute top-0.5 w-4 h-4 rounded-full bg-[var(--color-text-primary)] transition-transform"
        style={{ transform: value ? "translateX(18px)" : "translateX(2px)" }}
      />
    </button>
  );
}

export function SettingsPanel() {
  const settings = useSettingsStore((s) => s.settings);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const setSearchEngine = useSettingsStore((s) => s.setSearchEngine);
  const setCustomSearchUrl = useSettingsStore((s) => s.setCustomSearchUrl);
  const setPortScanInterval = useSettingsStore((s) => s.setPortScanInterval);
  const setCompactMode = useSettingsStore((s) => s.setCompactMode);
  const toggleSettingsPanel = useUIStore((s) => s.toggleSettingsPanel);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      toggleSettingsPanel();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggleSettingsPanel]);

  return (
    <div
      className="absolute top-0 right-0 w-[300px] h-full border-l z-50 overflow-y-auto p-4 xevo-settings-panel"
      style={{
        background: "var(--color-elevated)",
        borderColor: "var(--color-border)",
      }}
    >
      {/* Header */}
      <div className="flex justify-between items-center mb-4">
        <span className="text-sm font-semibold text-[var(--color-text-primary)]">Settings</span>
        <button
          onClick={toggleSettingsPanel}
          className="text-[var(--color-text-disabled)] hover:text-[var(--color-text-primary)]"
          title="Close (Esc)"
          aria-label="Close settings"
        >
          <X size={16} />
        </button>
      </div>

      {/* ── Appearance ──────────────────────────────────────────────── */}
      <SectionHeader>Appearance</SectionHeader>

      <div className="flex gap-1" role="radiogroup" aria-label="Theme">
        <ThemeButton
          label="Dark"
          value="dark"
          current={settings.theme}
          onSelect={setTheme}
        />
        <ThemeButton
          label="Light"
          value="light"
          current={settings.theme}
          onSelect={setTheme}
        />
        <ThemeButton
          label="System"
          value="system"
          current={settings.theme}
          onSelect={setTheme}
        />
      </div>

      <div className="flex justify-between items-center mt-3">
        <div>
          <span className="text-sm text-[var(--color-text-muted)] block">Compact Mode</span>
          <span className="text-xs text-[var(--color-text-disabled)] block">Reduce UI chrome size</span>
        </div>
        <CompactToggle
          value={settings.compactMode}
          onToggle={() => setCompactMode(!settings.compactMode)}
        />
      </div>

      {/* ── Search Engine ───────────────────────────────────────────── */}
      <SectionHeader>Search Engine</SectionHeader>

      <div className="grid grid-cols-2 gap-1">
        <SearchEngineButton
          label="Google"
          value="google"
          current={settings.searchEngine}
          onSelect={setSearchEngine}
        />
        <SearchEngineButton
          label="DuckDuckGo"
          value="duckduckgo"
          current={settings.searchEngine}
          onSelect={setSearchEngine}
        />
        <SearchEngineButton
          label="Bing"
          value="bing"
          current={settings.searchEngine}
          onSelect={setSearchEngine}
        />
        <SearchEngineButton
          label="Custom"
          value="custom"
          current={settings.searchEngine}
          onSelect={setSearchEngine}
        />
      </div>

      {settings.searchEngine === "custom" && (
        <input
          type="text"
          placeholder="https://search.example.com?q=%s"
          value={settings.customSearchUrl}
          onChange={(e) => setCustomSearchUrl(e.target.value)}
          className="w-full mt-1 px-2 py-1 text-xs border rounded text-[var(--color-text-primary)] placeholder:text-[var(--color-text-disabled)] outline-none focus:border-[var(--color-accent)]"
          style={{
            background: "var(--color-elevated)",
        borderColor: "var(--color-border)",
          }}
        />
      )}

      {/* ── Port Scanner ────────────────────────────────────────────── */}
      <SectionHeader>Port Scanner</SectionHeader>

      <div className="flex justify-between items-center mb-1">
        <span className="text-sm text-[var(--color-text-muted)]">Scan Interval</span>
        <span className="text-xs text-[var(--color-text-disabled)]">
          {settings.portScanInterval}s
        </span>
      </div>

      <input
        type="range"
        min={5}
        max={60}
        step={5}
        value={settings.portScanInterval}
        onChange={(e) => setPortScanInterval(Number(e.target.value))}
        className="w-full accent-blue-500"
      />

      <span className="text-xs text-[var(--color-text-disabled)] block mt-1">
        How often to scan for running dev servers
      </span>

      {/* ── About ───────────────────────────────────────────────────── */}
      <div className="text-xs text-[var(--color-text-disabled)] mt-6 space-y-1">
        <div>XEVO Browser v1.18.0</div>
        <div>Open source · Zero telemetry · Zero accounts</div>
      </div>
    </div>
  );
}

export default SettingsPanel;
