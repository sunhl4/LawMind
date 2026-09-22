/**
 * Load desktop model/API env: user `.env.lawmind` wins; repo `.env.lawmind` fills gaps only.
 *
 * Trust phases (Claude Code–style):
 * - Phase A (pre–first-run trust): user env only; no repo fill until workspace trust confirmed.
 * - Phase B (post–first-run): optional repo `.env.lawmind` gap-fill via `bootstrapLawMindDesktopEnv`.
 */
import fs from "node:fs";
import path from "node:path";
import { loadLawMindEnv } from "../../../scripts/lawmind/lawmind-env-loader.js";

export type BootstrapLawMindDesktopEnvArgs = {
  workspaceDir: string;
  /** Absolute or relative path to user env file (Electron passes LAWMIND_ENV_FILE). */
  envFile?: string;
  /** Monorepo or bundle parent; optional repo `.env.lawmind` used only for missing keys. */
  repoRoot?: string;
};

export type BootstrapLawMindDesktopEnvResult = {
  userEnvPath: string;
  userEnvLoaded: boolean;
  repoEnvLoaded: boolean;
};

export function resolveDesktopUserEnvPath(workspaceDir: string, envFile?: string): string {
  if (envFile?.trim()) {
    return path.resolve(envFile.trim());
  }
  return path.resolve(path.dirname(path.resolve(workspaceDir)), ".env.lawmind");
}

export function bootstrapLawMindDesktopEnv(
  args: BootstrapLawMindDesktopEnvArgs,
): BootstrapLawMindDesktopEnvResult {
  const workspaceDir = path.resolve(args.workspaceDir);
  const userEnvPath = resolveDesktopUserEnvPath(workspaceDir, args.envFile);
  const envDir = path.dirname(userEnvPath);

  let userEnvLoaded = false;
  if (fs.existsSync(userEnvPath)) {
    userEnvLoaded = loadLawMindEnv(envDir, userEnvPath, { override: true }).loaded;
  }

  let repoEnvLoaded = false;
  const repoRootRaw = args.repoRoot?.trim();
  if (repoRootRaw) {
    const repoRootAbs = path.resolve(repoRootRaw);
    const repoEnvPath = path.join(repoRootAbs, ".env.lawmind");
    if (fs.existsSync(repoEnvPath)) {
      repoEnvLoaded = loadLawMindEnv(repoRootAbs, undefined, { override: false }).loaded;
    }
  }

  return { userEnvPath, userEnvLoaded, repoEnvLoaded };
}
