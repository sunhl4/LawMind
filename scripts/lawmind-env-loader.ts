import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

export type LoadedEnvFile = {
  path: string;
  loaded: boolean;
};

/**
 * Load .env.lawmind automatically (non-destructive).
 *
 * Precedence:
 * 1) existing process.env values (already exported)
 * 2) .env.lawmind values (only fill missing keys)
 */
export function loadLawMindEnv(cwd = process.cwd()): LoadedEnvFile {
  const envPath = path.resolve(cwd, ".env.lawmind");
  if (!fs.existsSync(envPath)) {
    return { path: envPath, loaded: false };
  }

  dotenv.config({
    path: envPath,
    override: false,
  });
  return { path: envPath, loaded: true };
}
