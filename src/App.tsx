import { useEffect } from "react";
import { RootLayout } from "@/components/layout/RootLayout";
import { useSettingsStore } from "@/stores/settings";
import { setUserAgent } from "@/services/browser";
import type { ThemeMode } from "@/types";

function App() {
  const compactMode = useSettingsStore((s) => s.settings.compactMode);
  const theme = useSettingsStore((s) => s.settings.theme);
  const userAgent = useSettingsStore((s) => s.settings.userAgent);

  useEffect(() => {
    if (compactMode) {
      document.documentElement.classList.add("zynlex-compact");
    } else {
      document.documentElement.classList.remove("zynlex-compact");
    }
  }, [compactMode]);

  useEffect(() => {
    function apply(t: ThemeMode) {
      if (t === "dark") {
        document.documentElement.setAttribute("data-theme", "dark");
        return undefined;
      }
      if (t === "light") {
        document.documentElement.setAttribute("data-theme", "light");
        return undefined;
      }
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const onChange = () => {
        document.documentElement.setAttribute("data-theme", mq.matches ? "dark" : "light");
      };
      onChange();
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    }

    return apply(theme);
  }, [theme]);

  useEffect(() => {
    setUserAgent(userAgent ?? "").catch(() => {});
  }, []);

  return <RootLayout />;
}

export default App;
