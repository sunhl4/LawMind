import fs from "node:fs";
import path from "node:path";
import type { Connect, Plugin } from "vite";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const pdfjsPkg = path.resolve(__dirname, "node_modules/pdfjs-dist");

function serveDir(rootDir: string): Connect.NextHandleFunction {
  return (req, res, next) => {
    const name = decodeURIComponent((req.url ?? "/").split("?")[0] ?? "/").replace(/^\/+/, "");
    const file = path.resolve(rootDir, name);
    if (!file.startsWith(rootDir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      next();
      return;
    }
    res.setHeader("Content-Type", "application/octet-stream");
    fs.createReadStream(file).pipe(res);
  };
}

/** Dev middleware + production copy so pdf.js can load CMaps and standard fonts. */
function pdfjsAssets(): Plugin {
  const cmaps = path.join(pdfjsPkg, "cmaps");
  const fonts = path.join(pdfjsPkg, "standard_fonts");
  return {
    name: "lawmind-pdfjs-assets",
    configureServer(server) {
      server.middlewares.use("/pdfjs/cmaps", serveDir(cmaps));
      server.middlewares.use("/pdfjs/standard_fonts", serveDir(fonts));
    },
    closeBundle() {
      const out = path.resolve(__dirname, "dist/pdfjs");
      fs.cpSync(cmaps, path.join(out, "cmaps"), { recursive: true });
      fs.cpSync(fonts, path.join(out, "standard_fonts"), { recursive: true });
    },
  };
}

export default defineConfig({
  plugins: [react(), pdfjsAssets()],
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
