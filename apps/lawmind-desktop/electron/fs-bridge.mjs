import fs from "node:fs";
import path from "node:path";

export const MAX_TEXT_READ_BYTES = 1_000_000;
export const MAX_IMAGE_READ_BYTES = 12_000_000;

const IMAGE_EXT_MIME = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

export function mimeTypeForImagePath(relPath) {
  const low = String(relPath || "").toLowerCase();
  for (const [ext, mime] of Object.entries(IMAGE_EXT_MIME)) {
    if (low.endsWith(ext)) {
      return mime;
    }
  }
  return null;
}

export function toPosix(relPath) {
  return String(relPath || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
}

function realpathSafe(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return null;
  }
}

function isUnderRoot(rootPath, candidatePath) {
  const root = path.resolve(rootPath);
  const candidate = path.resolve(candidatePath);
  return candidate === root || candidate.startsWith(root + path.sep);
}

/**
 * @param {() => Record<string, string>} getAllowedRoots
 */
export function createFsBridge(getAllowedRoots) {
  function assertRoot(rootKey) {
    if (rootKey !== "workspace" && rootKey !== "project") {
      throw new Error("invalid root");
    }
    const roots = getAllowedRoots();
    const rootPath = roots[rootKey];
    if (!rootPath) {
      throw new Error(`root not available: ${rootKey}`);
    }
    return rootPath;
  }

  function resolveFsPath(rootKey, relPath = "", opts = {}) {
    const { mustExist = false, allowRoot = true } = opts;
    const rootPath = assertRoot(rootKey);
    const rel = toPosix(relPath);
    if (!allowRoot && !rel) {
      throw new Error("root path is not allowed for this operation");
    }
    if (rel.includes("..")) {
      throw new Error("path traversal is not allowed");
    }
    const absPath = path.resolve(rootPath, rel);
    if (!isUnderRoot(rootPath, absPath)) {
      throw new Error("path escapes root");
    }
    if (mustExist && !fs.existsSync(absPath)) {
      throw new Error("path does not exist");
    }
    const real = realpathSafe(absPath);
    if (real && !isUnderRoot(rootPath, real)) {
      throw new Error("symlink escapes root");
    }
    return { rootPath, absPath, rel };
  }

  function isLikelyBinary(buffer) {
    const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
    for (const byte of sample) {
      if (byte === 0) {
        return true;
      }
    }
    return false;
  }

  function listDirectoryEntries(rootKey, relPath = "") {
    const { absPath, rel } = resolveFsPath(rootKey, relPath, { mustExist: true, allowRoot: true });
    const stat = fs.statSync(absPath);
    if (!stat.isDirectory()) {
      throw new Error("path is not a directory");
    }
    const entries = fs.readdirSync(absPath, { withFileTypes: true });
    return entries
      .map((entry) => {
        const childRel = toPosix(path.join(rel, entry.name));
        const childAbs = path.join(absPath, entry.name);
        const childStat = fs.statSync(childAbs);
        return {
          name: entry.name,
          path: childRel,
          kind: entry.isDirectory() ? "directory" : "file",
          size: entry.isDirectory() ? undefined : childStat.size,
          mtimeMs: childStat.mtimeMs,
        };
      })
      .toSorted((a, b) => {
        if (a.kind !== b.kind) {
          return a.kind === "directory" ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });
  }

  return {
    resolveFsPath,
    listDirectoryEntries,
    isLikelyBinary,
  };
}
