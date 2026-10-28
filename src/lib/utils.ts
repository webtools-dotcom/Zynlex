import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// text-micro and text-md are our own font sizes (index.css). Unregistered,
// tailwind-merge reads them as text colours and drops them next to a real one.
const twMerge = extendTailwindMerge({ extend: { theme: { text: ["micro", "md"] } } });

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
