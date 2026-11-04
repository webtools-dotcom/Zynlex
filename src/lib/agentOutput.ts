/**
 * Pure helpers for the agent tools that deal in files: what fits in a reply
 * (the rest goes to a file), the screenshot area of an element, and the paths
 * an upload takes. See docs/agent-interface.md.
 */
import type { ClipRect } from "@/services/browser";

/** Snapshot lines returned inline; past this the whole snapshot goes to a file. */
export const MAX_LINES = 300;
/** Response-body characters returned inline; past this the whole body goes to a file. */
export const MAX_BODY = 8000;
/** Chromium's tallest screenshot. */
const MAX_SHOT = 16384;

/** `text` cut to `limit`, and what was left out; null when it all fits. */
export function cutForInline(
  text: string,
  limit: { lines: number } | { chars: number },
): { head: string; more: string } | null {
  if ("lines" in limit) {
    const lines = text.split("\n");
    if (lines.length <= limit.lines) return null;
    return {
      head: lines.slice(0, limit.lines).join("\n"),
      more: `${lines.length - limit.lines} more lines`,
    };
  }
  if (text.length <= limit.chars) return null;
  return { head: text.slice(0, limit.chars), more: `${text.length - limit.chars} more chars` };
}

/**
 * The box around an element's quads (DOM.getContentQuads, viewport CSS
 * pixels), moved into page coordinates by the scroll offset, as whole pixels
 * that cover it; kept inside the page and Chromium's height limit. Null when
 * there's nothing to capture.
 */
export function clipRect(quads: number[][], scroll: { x: number; y: number }): ClipRect | null {
  const xs = quads.flatMap((q) => [q[0], q[2], q[4], q[6]]);
  const ys = quads.flatMap((q) => [q[1], q[3], q[5], q[7]]);
  if (!xs.length) return null;
  const x = Math.max(0, Math.floor(Math.min(...xs) + scroll.x));
  const y = Math.max(0, Math.floor(Math.min(...ys) + scroll.y));
  const right = Math.ceil(Math.max(...xs) + scroll.x);
  const bottom = Math.min(Math.ceil(Math.max(...ys) + scroll.y), y + MAX_SHOT);
  if (right <= x || bottom <= y) return null;
  return { x, y, width: right - x, height: bottom - y };
}

/** `C:\…`, `C:/…` or a `\\server\share\…` path. */
const ABSOLUTE = /^(?:[a-zA-Z]:[\\/]|\\\\[^\\])/;

/** The files an upload names, as absolute paths on this machine; throws saying what's wrong. */
export function uploadPaths(arg: unknown): string[] {
  const list = typeof arg === "string" ? [arg] : Array.isArray(arg) ? arg : [];
  const files = list.map((f) => (typeof f === "string" ? f.trim() : ""));
  if (!files.length || files.some((f) => !f)) {
    throw new Error(
      'upload needs files: absolute paths on this machine, e.g. ["C:\\\\Users\\\\me\\\\photo.png"].',
    );
  }
  const relative = files.find((f) => !ABSOLUTE.test(f));
  if (relative) {
    throw new Error(
      `${JSON.stringify(relative)} isn't an absolute path. upload needs full paths, e.g. C:\\Users\\me\\photo.png.`,
    );
  }
  return files;
}
