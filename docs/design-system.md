# Design System

ZYNLEX is a developer tool, not a consumer app. Its UI is infrastructure: the
webview — the content the developer is building — should be the loudest thing on
screen, and everything else recedes.

All colors, spacing, radii, and motion timings live in `src/index.css`'s `@theme`
block as CSS custom properties. Components reference the tokens
(`var(--color-*)`, `text-[var(--text-*)]`) rather than hardcoded hex values or
Tailwind's default scale, so retheming is a one-file change.

## Color tokens

Current palette is "Warm Ivory": a warm off-black base with a pale ivory accent,
defined once in `src/index.css` and consumed everywhere via `@theme`.

- **Surfaces** — a strict three-layer stack: `base` → `surface` → `elevated`.
  Popovers and the command palette are always `elevated`. Never invert the
  stack.
- **Accent** (`--color-accent`) — interaction only: focus rings, the active tab
  underline, active sidebar item border, link/URL text. Never used as a
  background fill.
- **Liveness** (`--color-live` / `--color-dead` / `--color-warn`) — reserved for
  server-liveness state only, never reused for generic success/error, so the
  signal stays trustworthy at a glance.
- **HTTP method/status colors** — used only in the Network panel and API
  Tester, always as colored text against `--color-elevated`, never as a
  background.

## Typography

`--font-ui` is JetBrains Mono (the whole chrome, not just data values — this is
the "terminal instrument" identity), `--font-display` (Space Grotesk) is reserved
for the HomePage hero heading and its empty-state message only.

Type scale is rem-based (`--text-micro` through `--text-lg`), so root font-size
(16px, 14px in compact mode) drives density uniformly. There is deliberately no
`--text-base` step — `--color-base` already claims the `.text-base` Tailwind
utility name, so a `--text-base` custom property would collide with it silently
(Tailwind would emit `text-base` as the *color* utility, not a font-size one).
Use `text-[1rem]` where you need that size explicitly.

## Layout architecture

```
┌──────────────────────────────────────────────────────────────┐
│  TAB BAR                  data-tauri-drag-region              │
├──────────────────────────────────────────────────────────────│
│  TOOLBAR                                                      │
├────────────────────────┬─────────────────────────────────────│
│  SIDEBAR (collapsible) │   WEBVIEW (fills remaining space)   │
│                        ├─────────────────────────────────────│
│                        │   BOTTOM PANEL (resizable, optional) │
├────────────────────────┴─────────────────────────────────────│
│  STATUS BAR                                                   │
└──────────────────────────────────────────────────────────────┘
```

Zone boundaries use a single `1px solid var(--color-border)` line. No shadows or
gradients as zone separators.

## Tauri platform constraints

- **Drag region.** `data-tauri-drag-region` goes on the tab bar container only —
  it does not inherit to children, and applying it to tab items, buttons, or
  inputs breaks their click handlers.
- **No browser storage.** `localStorage`/`sessionStorage` are unavailable
  under Tauri's security model. All persistence goes through Zustand stores,
  which write to disk via Tauri IPC.
- **Native confirm/prompt are unreachable.** `window.confirm()` and
  `window.prompt()` render *behind* the child webview and can never be
  clicked. Every destructive action uses the in-panel `ConfirmButton`
  (Sure?/No, Escape or ~4s to disarm) instead.

## Motion

`--duration-instant/fast/normal/slow` (0/80/120/150ms) and `--ease-out`/
`--ease-snap` are the single source of truth for all chrome motion — hover/active
feedback uses `duration-fast`, mount/dismiss animations (panel switch, toasts,
command palette) use `duration-normal`. `prefers-reduced-motion` disables all of
it.

Never animate a property that changes content-area geometry (sidebar width,
panel resize): the child webview's native window handle can't animate in step
with a CSS transition, so the chrome visibly slides while the page snaps to its
new bounds in one frame.

## Hard rules

1. No `rounded-xl`/`rounded-2xl` in chrome UI — max `--radius-lg` (9px).
2. No `shadow-*` for elevation. Depth comes from the surface stepping
   (`base`→`surface`→`elevated`), not shadows.
3. No `backdrop-blur` — too GPU-heavy for the memory budget this app is
   measured against (see `scripts/measure.ps1`).
4. No `hover:scale-*` on chrome elements — hover state is a background-color
   change only.
5. No motion longer than 150ms on any chrome interaction.
6. No `localStorage`/`sessionStorage` anywhere.

## CSS gotcha

Never put a `*/`-shaped substring inside a CSS comment — it prematurely closes
the comment block and can silently break the build. Vite keeps serving the last
good CSS on a parse failure, so the breakage is easy to miss until a much later
diff.
