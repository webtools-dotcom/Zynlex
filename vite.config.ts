import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // Without this, the dep scanner's default **/*.html glob from the project
  // root picks up the 20k+ files in src-tauri/target/doc (rustdoc output) —
  // EMFILE on Windows and a much slower cold start. index.html is the only
  // real entry point.
  optimizeDeps: {
    entries: ["index.html"],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          "react-vendor": ["react", "react-dom"],
          "zustand-vendor": ["zustand"],
          icons: ["lucide-react"],
          "ui-lib": ["clsx", "tailwind-merge"],
        },
      },
    },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? { protocol: "ws", host, port: 1421 }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
