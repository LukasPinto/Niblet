import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @tauri-apps/cli arranca vite y luego envuelve la webview.
const host = process.env.TAURI_DEV_HOST;

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  // Evita que vite oculte errores de Rust
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // No vigiles src-tauri durante dev
      ignored: ["**/src-tauri/**"],
    },
  },
}));
