/**
 * Locate the officecli binary LawMind uses for Word tracked-change export.
 *
 * Packaged desktop apps and `pnpm install` vendor a platform build under
 * `apps/lawmind-desktop/resources/officecli/<platform-arch>/`. Electron injects
 * `LAWMIND_OFFICECLI`; this resolver is the engine-side fallback for CLI /
 * unpackaged runs.
 */
import fs from "node:fs";
import path from "node:path";

export const OFFICECLI_VENDOR_REL = path.join("apps", "lawmind-desktop", "resources", "officecli");

export function officecliRuntimeKey(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string {
  return `${platform}-${arch}`;
}

export function bundledOfficeCliFileName(platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" ? "officecli.exe" : "officecli";
}

export type ResolveOfficeCliBinOpts = {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  /** Explicit path (call-site override). */
  explicit?: string;
  platform?: NodeJS.Platform;
  arch?: string;
  exists?: (filePath: string) => boolean;
};

function defaultExists(filePath: string): boolean {
  try {
    return fs.existsSync(filePath) && !fs.statSync(filePath).isDirectory();
  } catch {
    return false;
  }
}

function firstExisting(
  candidates: Array<string | undefined>,
  exists: (p: string) => boolean,
): string | undefined {
  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (trimmed && exists(trimmed)) {
      return trimmed;
    }
  }
  return undefined;
}

function vendorLayoutBin(root: string, platform: NodeJS.Platform, arch: string): string {
  return path.join(
    root,
    OFFICECLI_VENDOR_REL,
    officecliRuntimeKey(platform, arch),
    bundledOfficeCliFileName(platform),
  );
}

function resourcesLayoutBin(
  resourcesPath: string,
  platform: NodeJS.Platform,
  arch: string,
): string {
  return path.join(
    resourcesPath,
    "officecli",
    officecliRuntimeKey(platform, arch),
    bundledOfficeCliFileName(platform),
  );
}

/**
 * Absolute path to officecli, or undefined if only PATH lookup remains.
 * Callers that spawn may fall back to the bare name `"officecli"`.
 */
export function resolveOfficeCliBin(opts: ResolveOfficeCliBinOpts = {}): string | undefined {
  const env = opts.env ?? process.env;
  const platform = opts.platform ?? process.platform;
  const arch = opts.arch ?? process.arch;
  const exists = opts.exists ?? defaultExists;

  const found = firstExisting(
    [
      opts.explicit,
      env.LAWMIND_OFFICECLI,
      env.LAWMIND_RESOURCES_PATH
        ? resourcesLayoutBin(env.LAWMIND_RESOURCES_PATH, platform, arch)
        : undefined,
      env.LAWMIND_REPO_ROOT ? vendorLayoutBin(env.LAWMIND_REPO_ROOT, platform, arch) : undefined,
      opts.cwd ? vendorLayoutBin(path.resolve(opts.cwd), platform, arch) : undefined,
      vendorLayoutBin(process.cwd(), platform, arch),
    ],
    exists,
  );
  return found;
}
