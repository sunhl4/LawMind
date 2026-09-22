/**
 * Packaged / extraResources layout for officecli (no Electron import).
 * Keep in sync with `src/lawmind/artifacts/officecli-bin.ts` and vendor script.
 */
import fs from "node:fs";
import path from "node:path";

export function officecliRuntimeKey(platform = process.platform, arch = process.arch) {
  return `${platform}-${arch}`;
}

export function bundledOfficeCliFileName(platform = process.platform) {
  return platform === "win32" ? "officecli.exe" : "officecli";
}

/**
 * Prefer LAWMIND_OFFICECLI, then extraResources (packaged), then repo vendor dir, else "".
 */
export function resolveOfficeCliExecutable({
  env = process.env,
  platform = process.platform,
  arch = process.arch,
  packaged = false,
  resourcesPath = "",
  repoRoot = "",
  exists = (p) => fs.existsSync(p) && !fs.statSync(p).isDirectory(),
} = {}) {
  const name = bundledOfficeCliFileName(platform);
  const key = officecliRuntimeKey(platform, arch);
  const override = typeof env.LAWMIND_OFFICECLI === "string" ? env.LAWMIND_OFFICECLI.trim() : "";
  if (override && exists(override)) {
    return override;
  }
  if (packaged && resourcesPath) {
    const bundled = path.join(resourcesPath, "officecli", key, name);
    if (exists(bundled)) {
      return bundled;
    }
  }
  if (repoRoot) {
    const vendored = path.join(repoRoot, "apps", "lawmind-desktop", "resources", "officecli", key, name);
    if (exists(vendored)) {
      return vendored;
    }
  }
  return "";
}

/** Prepend the binary's directory to PATH and set LAWMIND_OFFICECLI. */
export function applyOfficeCliEnv(source, binPath) {
  const out = { ...source };
  const trimmed = typeof binPath === "string" ? binPath.trim() : "";
  if (!trimmed) {
    return out;
  }
  out.LAWMIND_OFFICECLI = trimmed;
  const dir = path.dirname(trimmed);
  const pathKey = Object.keys(out).find((k) => k.toLowerCase() === "path") ?? "PATH";
  const current = typeof out[pathKey] === "string" ? out[pathKey] : "";
  const parts = current.split(path.delimiter).filter(Boolean);
  if (!parts.includes(dir)) {
    out[pathKey] = parts.length > 0 ? `${dir}${path.delimiter}${current}` : dir;
  }
  return out;
}
