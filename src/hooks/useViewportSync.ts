import { useEffect } from "react";
import { useUIStore } from "@/stores/ui";
import {
  clickViewport,
  evalRaw,
  onViewportClick,
  onViewportInput,
  onViewportScroll,
  scrollViewport,
} from "@/services/browser";

function escapeJsStr(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r");
}

export function useViewportSync() {
  const viewports = useUIStore((s) => s.viewports);
  const syncScroll = useUIStore((s) => s.syncScroll);
  const syncClick = useUIStore((s) => s.syncClick);
  const syncInput = useUIStore((s) => s.syncInput);

  useEffect(() => {
    if (!syncScroll) return;
    const unsub = onViewportScroll(({ sourceLabel, percentX, percentY }) => {
      for (const vp of viewports) {
        const label = `viewport-${vp.id}`;
        if (label === sourceLabel) continue;
        scrollViewport(label, percentX, percentY).catch(() => {});
      }
    });
    return () => { unsub.then((fn) => fn()).catch(() => {}); };
  }, [viewports, syncScroll]);

  useEffect(() => {
    if (!syncClick) return;
    const unsub = onViewportClick(({ sourceLabel, x, y }) => {
      for (const vp of viewports) {
        const label = `viewport-${vp.id}`;
        if (label === sourceLabel) continue;
        clickViewport(label, x, y).catch(() => {});
      }
    });
    return () => { unsub.then((fn) => fn()).catch(() => {}); };
  }, [viewports, syncClick]);

  useEffect(() => {
    if (!syncInput) return;
    const unsub = onViewportInput(({ sourceLabel, selector, value, checked, inputType: _inputType }) => {
      for (const vp of viewports) {
        const label = `viewport-${vp.id}`;
        if (label === sourceLabel) continue;
        const lines = [
          "(function(){",
          '  var el = document.querySelector("' + escapeJsStr(selector) + '");',
          "  if (el) {",
          '    el.value = "' + escapeJsStr(value) + '";',
          checked != null ? "    el.checked = " + checked + ";" : "",
          '    el.dispatchEvent(new Event("input", { bubbles: true }));',
          '    el.dispatchEvent(new Event("change", { bubbles: true }));',
          "  }",
          "})()",
        ];
        evalRaw(label, lines.filter(Boolean).join("\n")).catch(() => {});
      }
    });
    return () => { unsub.then((fn) => fn()).catch(() => {}); };
  }, [viewports, syncInput]);
}
