import { useCallback, useState } from "react";
import { copyText } from "@/services/browser";

/** Copies `text` and reports back which `label` was last copied for
 * `resetMs`, so a UI can show a per-button "Copied!" state. Pass no label
 * (or the same one everywhere) to use it as a plain boolean. */
export function useCopy(resetMs = 1500) {
  const [copiedLabel, setCopiedLabel] = useState<string | null>(null);

  const copy = useCallback(
    (text: string, label = "copied") => {
      copyText(text)
        .then(() => {
          setCopiedLabel(label);
          setTimeout(() => setCopiedLabel((c) => (c === label ? null : c)), resetMs);
        })
        .catch(() => {}); // Clipboard busy — not critical, the copy just no-ops.
    },
    [resetMs],
  );

  return { copiedLabel, copy };
}
