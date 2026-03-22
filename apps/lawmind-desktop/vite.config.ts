import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  root: path.resolve(__dirname, "src/renderer"),
  base: "./",
  build: {
    outDir: path.resolve(__dirname, "dist"),
    emptyOutDir: true,
  },
  server: {
    port: 5174,
    strictPort: true,
    // Must match Electron main `loadURL` (127.0.0.1). Default `localhost` can bind IPv6-only on macOS → ERR_CONNECTION_REFUSED.
    host: "127.0.0.1",
  },
});
