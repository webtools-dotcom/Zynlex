/**
 * Command registry — every app action a keyboard shortcut, the Ctrl+K palette,
 * the shortcut help or a toolbar pin can trigger. One list, so a new feature
 * adds an entry here and is searchable, rebindable and pinnable with no other
 * wiring.
 *
 * Chords are normalized strings: modifiers in ctrl, alt, shift order, then the
 * key ("ctrl+shift+t", "alt+left", "f12"). Rust builds the same strings from
 * virtual-key codes (`chord` in events.rs) for keys pressed while a page has
 * focus — keep chordFromEvent and that table in step.
 */
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  Bug,
  Clock,
  Code2,
  Eraser,
  FileWarning,
  Keyboard,
  type LucideIcon,
  Plus,
  RotateCw,
  Search,
  Settings,
  Star,
  TerminalSquare,
  X,
} from "lucide-react";
import { useUIStore, isFindOpen } from "@/stores/ui";
import { useTabsStore } from "@/stores/tabs";
import { useConsoleStore } from "@/stores/console";
import { useWorkspacesStore } from "@/stores/workspaces";
import { getLiveWorkspaceActiveTabId, getLiveWorkspaceTabIds } from "@/lib/workspaceTabs";
import { toggleBookmarkForActiveTab } from "@/lib/bookmarkAction";
import { openTab, closeTab, reopenLastClosedTab } from "@/lib/tabActions";
import { getActiveTabId } from "@/hooks/useActiveScope";
import { activeEnv, switchEnv, workspaceEnvs } from "@/lib/envActions";
import { originOf } from "@/lib/url";
import { copyBugReport } from "@/lib/bugReport";
import {
  clearSiteData,
  hardReload,
  openDevtools,
  setTabZoom,
  stopLoading,
  webviewGoBack,
  webviewGoForward,
  webviewReload,
} from "@/services/browser";

export interface Command {
  id: string;
  title: string;
  /** Default chords; the user's overrides live in the keybindings store. */
  keys: string[];
  /** Return false when the command didn't apply, so the key isn't swallowed. */
  run: () => boolean | void;
  icon?: LucideIcon;
  /** Skip while typing in an input or textarea. */
  notInInputs?: boolean;
  /** Left out of the palette; still bindable and listed in the help. */
  hidden?: boolean;
}

// ─── Actions ────────────────────────────────────────────────────────

/** Runs a per-tab IPC call on the active tab; false if there is none. */
function onActiveTab(fn: (tabId: string) => Promise<unknown>): boolean {
  const tabId = getActiveTabId();
  if (!tabId) return false;
  fn(tabId).catch(() => {});
  return true;
}

/** Chrome's zoom ladder. Clamped by browser_set_zoom to 0.25..5 as well. */
const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];

/** dir: -1 zoom out, +1 zoom in, 0 reset to 100%. */
function applyZoom(dir: -1 | 0 | 1): boolean {
  const tabId = getActiveTabId();
  if (!tabId) return false;

  let next = 1;
  if (dir !== 0) {
    const current = useTabsStore.getState().tabs[tabId]?.zoom ?? 1;
    let i = ZOOM_STEPS.findIndex((z) => Math.abs(z - current) < 0.001);
    if (i === -1) i = ZOOM_STEPS.indexOf(1);
    next = ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, i + dir))];
  }

  useTabsStore.getState().updateTab(tabId, { zoom: next });
  setTabZoom(tabId, next).catch(() => {});
  return true;
}

/** Select a tab of the active workspace by index (negative = relative step). */
function selectTab(pick: (ids: string[], current: number) => number): boolean {
  const wsState = useWorkspacesStore.getState();
  const wsId = wsState.activeWorkspaceId;
  const workspace = wsState.workspaces[wsId];
  if (!workspace) return false;
  const tabs = useTabsStore.getState().tabs;
  const tabIds = getLiveWorkspaceTabIds(workspace, tabs);
  if (tabIds.length === 0) return false;
  const current = tabIds.indexOf(getLiveWorkspaceActiveTabId(workspace, tabs) ?? "");
  const target = tabIds[pick(tabIds, current)];
  if (target) wsState.setActiveTab(wsId, target);
  return true;
}

function openPanel(panel: "history" | "bookmarks" | "console") {
  useUIStore.getState().setActivePanel(panel);
  useUIStore.getState().setSidebarOpen(true);
}

function stopOrCloseFind(): boolean {
  if (isFindOpen()) {
    useUIStore.getState().closeFind();
    return true;
  }
  const tabId = getActiveTabId();
  if (tabId && useTabsStore.getState().tabs[tabId]?.isLoading) {
    stopLoading(tabId).catch(() => {});
    return true;
  }
  return false;
}

/** Production needs a second press within this window, like the pill's confirm click. */
const PROD_CONFIRM_MS = 3000;
let prodArmedAt: { id: string; at: number } | null = null;

function gotoEnv(n: number): boolean {
  const target = workspaceEnvs()[n - 1];
  const current = activeEnv();
  if (!target || !current || current.id === target.id) return false;
  if (target.isProd) {
    const armed = prodArmedAt?.id === target.id && Date.now() - prodArmedAt.at < PROD_CONFIRM_MS;
    if (!armed) {
      prodArmedAt = { id: target.id, at: Date.now() };
      useUIStore.getState().pushToast(`Press again to open ${target.name}`, "danger");
      return true;
    }
    prodArmedAt = null;
  }
  return switchEnv(target);
}

function clearSite(): boolean {
  const tabId = getActiveTabId();
  const url = tabId && useTabsStore.getState().tabs[tabId]?.url;
  const origin = url && originOf(url);
  if (!tabId || !origin) return false;
  clearSiteData(tabId, origin).catch(() => {});
  useUIStore.getState().pushToast(`Cleared cookies and storage for ${origin}`, "info");
  return true;
}

// ─── Registry ───────────────────────────────────────────────────────

const DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

export const COMMANDS: Command[] = [
  {
    id: "palette.open",
    title: "Command Palette",
    keys: ["ctrl+k"],
    hidden: true,
    run: () => void useUIStore.getState().openCommandPalette(),
  },
  { id: "tab.new", title: "New Tab", keys: ["ctrl+t"], icon: Plus, run: () => void openTab() },
  {
    id: "tab.close",
    title: "Close Tab",
    keys: ["ctrl+w"],
    icon: X,
    run: () => {
      const tabId = getActiveTabId();
      if (tabId) closeTab(tabId);
    },
  },
  {
    id: "tab.reopen",
    title: "Reopen Last Closed Tab",
    keys: ["ctrl+shift+t"],
    notInInputs: true,
    run: () => {
      if (!useTabsStore.getState().lastClosedTab) return false;
      reopenLastClosedTab();
    },
  },
  {
    id: "tab.next",
    title: "Next Tab",
    keys: ["ctrl+tab"],
    run: () => selectTab((ids, i) => (i + 1) % ids.length),
  },
  {
    id: "tab.prev",
    title: "Previous Tab",
    keys: ["ctrl+shift+tab"],
    run: () => selectTab((ids, i) => (i - 1 + ids.length) % ids.length),
  },
  {
    id: "nav.reload",
    title: "Reload",
    keys: ["ctrl+r"],
    icon: RotateCw,
    run: () => onActiveTab(webviewReload),
  },
  {
    id: "nav.hardReload",
    title: "Hard Reload (bypass cache)",
    keys: ["ctrl+shift+r"],
    icon: RotateCw,
    run: () => onActiveTab(hardReload),
  },
  {
    id: "nav.back",
    title: "Go Back",
    keys: ["alt+left"],
    icon: ArrowLeft,
    run: () => onActiveTab(webviewGoBack),
  },
  {
    id: "nav.forward",
    title: "Go Forward",
    keys: ["alt+right"],
    icon: ArrowRight,
    run: () => onActiveTab(webviewGoForward),
  },
  {
    id: "nav.escape",
    title: "Stop Loading / Close Find",
    keys: ["escape"],
    hidden: true,
    run: stopOrCloseFind,
  },
  {
    id: "addressBar.focus",
    title: "Focus Address Bar",
    keys: ["ctrl+l"],
    run: () => void window.dispatchEvent(new CustomEvent("zynlex:focus-address-bar")),
  },
  {
    id: "find.open",
    title: "Find in Page",
    keys: ["ctrl+f"],
    icon: Search,
    run: () => {
      const ui = useUIStore.getState();
      // Re-opening an open find bar re-focuses and re-selects its input.
      if (isFindOpen()) {
        ui.closeFind();
        requestAnimationFrame(() => ui.openFind());
      } else {
        ui.openFind();
      }
    },
  },
  {
    id: "bookmark.toggle",
    title: "Bookmark Current Tab",
    keys: ["ctrl+d"],
    icon: Star,
    notInInputs: true,
    run: () => void toggleBookmarkForActiveTab(),
  },
  {
    id: "devtools.open",
    title: "Open DevTools",
    keys: ["f12", "ctrl+shift+i"],
    icon: Bug,
    run: () => onActiveTab(openDevtools),
  },
  {
    id: "site.clear",
    title: "Clear Site Data and Reload",
    keys: [],
    icon: Eraser,
    run: clearSite,
  },
  {
    id: "bugReport.copy",
    title: "Copy Bug Report",
    keys: [],
    icon: FileWarning,
    run: copyBugReport,
  },
  { id: "zoom.in", title: "Zoom In", keys: ["ctrl+=", "ctrl+shift+="], run: () => applyZoom(1) },
  { id: "zoom.out", title: "Zoom Out", keys: ["ctrl+-"], run: () => applyZoom(-1) },
  { id: "zoom.reset", title: "Reset Zoom", keys: ["ctrl+0"], run: () => applyZoom(0) },
  {
    id: "sidebar.toggle",
    title: "Toggle Sidebar",
    keys: ["ctrl+b"],
    run: () => void useUIStore.getState().toggleSidebar(),
  },
  {
    id: "panel.history",
    title: "History Panel",
    keys: ["ctrl+h"],
    icon: Clock,
    notInInputs: true,
    run: () => openPanel("history"),
  },
  {
    id: "panel.console",
    title: "Console Panel",
    keys: ["ctrl+shift+j"],
    icon: TerminalSquare,
    run: () => openPanel("console"),
  },
  {
    id: "console.clear",
    title: "Clear Console",
    keys: [],
    run: () => {
      const tabId = getActiveTabId();
      if (!tabId) return false;
      useConsoleStore.getState().clearTab(tabId);
    },
  },
  {
    id: "panel.bookmarks",
    title: "Bookmarks Panel",
    keys: [],
    icon: Bookmark,
    run: () => openPanel("bookmarks"),
  },
  {
    id: "panel.api",
    title: "API Tester",
    keys: [],
    icon: Code2,
    run: () => void useUIStore.getState().openApiTester(),
  },
  {
    id: "settings.toggle",
    title: "Settings",
    keys: ["ctrl+,"],
    icon: Settings,
    run: () => void useUIStore.getState().toggleSettingsPanel(),
  },
  {
    id: "help.shortcuts",
    title: "Keyboard Shortcuts",
    keys: ["ctrl+shift+/"],
    icon: Keyboard,
    notInInputs: true,
    run: () => void useUIStore.getState().openShortcutHelp(),
  },
  ...DIGITS.map(
    (n): Command => ({
      id: `tab.goto.${n}`,
      title: `Switch to Tab ${n}`,
      keys: [`ctrl+${n}`],
      hidden: true,
      run: () => selectTab(() => n - 1),
    }),
  ),
  ...[1, 2, 3, 4].map(
    (n): Command => ({
      id: `env.goto.${n}`,
      title: `Switch to Environment ${n}`,
      keys: [`alt+shift+${n}`],
      hidden: true,
      run: () => gotoEnv(n),
    }),
  ),
  ...DIGITS.map(
    (n): Command => ({
      id: `workspace.goto.${n}`,
      title: `Switch to Workspace ${n}`,
      keys: [`ctrl+shift+${n}`],
      hidden: true,
      run: () => {
        const { workspaceOrder, setActiveWorkspace } = useWorkspacesStore.getState();
        const target = workspaceOrder[n - 1];
        if (!target) return false;
        setActiveWorkspace(target);
      },
    }),
  ),
];

export const COMMANDS_BY_ID = new Map(COMMANDS.map((c) => [c.id, c]));

// ─── Bindings ───────────────────────────────────────────────────────

/** User overrides: command id → chords ([] = unbound). */
export type KeyOverrides = Record<string, string[]>;

export function keysFor(cmd: Command, overrides: KeyOverrides): string[] {
  return overrides[cmd.id] ?? cmd.keys;
}

/** chord → command, after overrides. */
export function bindingMap(overrides: KeyOverrides): Map<string, Command> {
  const map = new Map<string, Command>();
  for (const cmd of COMMANDS) {
    for (const chord of keysFor(cmd, overrides)) map.set(chord, cmd);
  }
  return map;
}

/**
 * Overrides after binding `chord` to `id`: the chord is taken off whichever
 * command had it, so one chord never maps to two commands.
 */
export function bindChord(overrides: KeyOverrides, id: string, chord: string): KeyOverrides {
  const next = { ...overrides };
  for (const cmd of COMMANDS) {
    const keys = keysFor(cmd, next);
    if (cmd.id !== id && keys.includes(chord)) next[cmd.id] = keys.filter((k) => k !== chord);
  }
  const target = COMMANDS_BY_ID.get(id);
  if (target) next[id] = [...keysFor(target, next).filter((k) => k !== chord), chord];
  return next;
}

// ─── Chords ─────────────────────────────────────────────────────────

const CODE_KEYS: Record<string, string> = {
  ArrowLeft: "left",
  ArrowUp: "up",
  ArrowRight: "right",
  ArrowDown: "down",
  Tab: "tab",
  Escape: "escape",
  Space: "space",
  Enter: "enter",
  NumpadEnter: "enter",
  Backspace: "backspace",
  Delete: "delete",
  Comma: ",",
  Period: ".",
  Slash: "/",
  NumpadDivide: "/",
  Backslash: "\\",
  Equal: "=",
  NumpadAdd: "=",
  Minus: "-",
  NumpadSubtract: "-",
  Backquote: "`",
  Semicolon: ";",
  Quote: "'",
  BracketLeft: "[",
  BracketRight: "]",
};

/**
 * Letters come from `key`, so they follow the keyboard layout the way Rust's
 * virtual-key codes do (on AZERTY the key labelled W reports code "KeyZ").
 * Everything else comes from `code`, the physical key: with Shift held `key` is
 * the shifted symbol ("!" for 1), which would make Ctrl+Shift+1 unmatchable.
 */
function keyName(key: string, code: string): string | null {
  if (/^[a-z]$/i.test(key)) return key.toLowerCase();
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
  if (/^(Digit|Numpad)\d$/.test(code)) return code.slice(-1);
  if (/^F([1-9]|1[0-2])$/.test(code)) return code.toLowerCase();
  return CODE_KEYS[code] ?? null;
}

type KeyLike = Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "altKey" | "shiftKey">;

export function chordFromEvent(e: KeyLike): string | null {
  const key = keyName(e.key, e.code);
  if (!key) return null;
  return [e.ctrlKey && "ctrl", e.altKey && "alt", e.shiftKey && "shift", key]
    .filter(Boolean)
    .join("+");
}

/**
 * Bindable = can't collide with typing: needs Ctrl or Alt, unless it's a
 * function key or Escape. Bound chords are taken from pages too (events.rs),
 * so a bare letter would stop the user typing it anywhere.
 */
export function isBindable(chord: string): boolean {
  return (
    /^(ctrl|alt)\+/.test(chord) || /^(shift\+)?f([1-9]|1[0-2])$/.test(chord) || chord === "escape"
  );
}

const KEY_LABELS: Record<string, string> = {
  ctrl: "Ctrl",
  alt: "Alt",
  shift: "Shift",
  left: "←",
  right: "→",
  up: "↑",
  down: "↓",
  escape: "Esc",
  tab: "Tab",
  space: "Space",
  enter: "Enter",
  backspace: "Backspace",
  delete: "Del",
};

/** "ctrl+shift+t" → ["Ctrl", "Shift", "T"]. */
export function chordLabel(chord: string): string[] {
  return chord.split("+").map((p) => KEY_LABELS[p] ?? p.toUpperCase());
}
