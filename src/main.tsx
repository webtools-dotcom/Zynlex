import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
// Self-hosted (not loaded from fonts.bunny.net) — the app's CSP only allows
// 'self' for style-src/font-src, so a cross-origin stylesheet is blocked.
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/600.css";
import "@fontsource/space-grotesk/700.css";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
