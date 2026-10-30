import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// text-micro and text-md are our own font sizes (index.css). Unregistered,
// tailwind-merge reads them as text colours and drops them next to a real one.
const twMerge = extendTailwindMerge({ extend: { theme: { text: ["micro", "md"] } } });

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Keeps a `width`×`height` context menu opened at (x, y) on screen, 4px from the edges. */
export function fitMenuOnScreen(x: number, y: number, width: number, height: number) {
  let nx = x;
  let ny = y;
  if (nx + width > window.innerWidth) nx = window.innerWidth - width - 4;
  if (ny + height > window.innerHeight) ny = window.innerHeight - height - 4;
  return { x: Math.max(4, nx), y: Math.max(4, ny) };
}
