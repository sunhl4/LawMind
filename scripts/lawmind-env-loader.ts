import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

export type LoadedEnvFile = {
  path: string;
  loaded: boolean;
};

/**
 * Load .env.lawmind so LawMind commands use this file as source of truth.
 *
 * Precedence: .env.lawmind overrides process.env when present, so that
 * running from the install dir (e.g. ~/.lawmind/openclaw) always uses
 * the configured keys/URLs instead of stale shell exports (e.g. 127.0.0.1).
 */
export type LoadLawMindEnvOptions = {
  /** When false, do not overwrite variables already set in `process.env`. Default true. */
  override?: boolean;
};

export function loadLawMindEnv(
  cwd = process.cwd(),
  envFilePath?: string,
  options?: LoadLawMindEnvOptions,
): LoadedEnvFile {
  const envPath = envFilePath ? path.resolve(envFilePath) : path.resolve(cwd, ".env.lawmind");
  if (!fs.existsSync(envPath)) {
    return { path: envPath, loaded: false };
  }

  dotenv.config({
    path: envPath,
    override: options?.override ?? true,
  });
  return { path: envPath, loaded: true };
}
