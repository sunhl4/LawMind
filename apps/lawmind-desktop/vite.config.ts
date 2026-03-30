import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  root: path.resolve(__dirname, "src/renderer"),
  /** Load `.env*` from package root (not `root`), so `apps/lawmind-desktop/.env.e2e` works for Playwright. */
  envDir: path.resolve(__dirname),
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
    // Renderer imports `src/lawmind/*` from the monorepo root; allow Vite to read those paths.
    fs: {
      allow: [path.resolve(__dirname, "../.."), path.resolve(__dirname, "src/renderer")],
    },
  },
});
