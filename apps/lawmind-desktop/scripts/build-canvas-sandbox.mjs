import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(here, "..");
const require = createRequire(path.resolve(packageDir, "../../package.json"));
const esbuild = require("esbuild");

const outfile = path.resolve(packageDir, "src/renderer/canvas/sandbox-runtime.js");
await esbuild.build({
  absWorkingDir: path.resolve(packageDir, "src/renderer"),
  entryPoints: [path.resolve(packageDir, "src/renderer/canvas/sandbox-entry.ts")],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  jsx: "automatic",
  outfile,
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "warning",
});
