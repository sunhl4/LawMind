/**
 * 工作区所在卷的事实：文件系统类型与剩余字节。
 * 只查询，不判断文案。判断在渲染进程 `lawmind-workspace-location.ts`。
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * @param {{ bsize?: number; bavail?: number } | null | undefined} stat
 * @returns {number | null}
 */
export function freeBytesFromStatfs(stat) {
  const bsize = stat?.bsize;
  const bavail = stat?.bavail;
  if (typeof bsize !== "number" || typeof bavail !== "number") {
    return null;
  }
  if (!Number.isFinite(bsize) || !Number.isFinite(bavail) || bsize <= 0 || bavail < 0) {
    return null;
  }
  const free = BigInt(Math.trunc(bavail)) * BigInt(Math.trunc(bsize));
  if (free > BigInt(Number.MAX_SAFE_INTEGER)) {
    return Number.MAX_SAFE_INTEGER;
  }
  return Number(free);
}

/**
 * 从 Linux `/proc/mounts` 文本里取覆盖该路径的最长挂载点的文件系统名。
 * @param {string} mountsText
 * @param {string} absPath
 * @returns {string | null}
 */
export function fstypeFromMountTable(mountsText, absPath) {
  const target = path.resolve(absPath);
  let best = null;
  let bestLen = -1;
  for (const line of mountsText.split("\n")) {
    const parts = line.trim().split(" ");
    if (parts.length < 3) {
      continue;
    }
    const mountPoint = parts[1].replace(/\\040/g, " ").replace(/\\011/g, "\t");
    const fstype = parts[2];
    const covers =
      target === mountPoint ||
      target.startsWith(mountPoint === "/" ? "/" : `${mountPoint}/`);
    if (covers && mountPoint.length > bestLen) {
      bestLen = mountPoint.length;
      best = fstype;
    }
  }
  return best;
}

/**
 * @param {string} absPath
 * @returns {Promise<string | null>}
 */
function darwinFstype(absPath) {
  return new Promise((resolve) => {
    execFile("/usr/bin/stat", ["-f", "%T", absPath], { timeout: 3000, encoding: "utf8" }, (err, stdout) => {
      if (err) {
        resolve(null);
        return;
      }
      const name = (stdout ?? "").trim();
      resolve(name || null);
    });
  });
}

/**
 * @param {string} absPath
 * @returns {Promise<number | null>}
 */
function windowsDriveType(absPath) {
  const root = path.parse(path.resolve(absPath)).root;
  const match = /^([A-Za-z]):\\?$/.exec(root);
  if (!match) {
    return Promise.resolve(null);
  }
  const deviceId = `${match[1]}:`;
  const script = `(Get-CimInstance -ClassName Win32_LogicalDisk -Filter "DeviceID='${deviceId}'").DriveType`;
  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { timeout: 8000, windowsHide: true, encoding: "utf8" },
      (err, stdout) => {
        if (err) {
          resolve(null);
          return;
        }
        const n = Number((stdout ?? "").trim());
        resolve(Number.isFinite(n) ? n : null);
      },
    );
  });
}

/**
 * @param {string} absPath
 * @returns {Promise<{ ok: true; fstype: string | null; driveType: number | null; freeBytes: number | null } | { ok: false; error: string }>}
 */
export async function inspectWorkspaceVolume(absPath) {
  const raw = typeof absPath === "string" ? absPath.trim() : "";
  if (!raw) {
    return { ok: false, error: "empty_path" };
  }
  const resolved = path.resolve(raw);
  let freeBytes = null;
  try {
    freeBytes = freeBytesFromStatfs(fs.statfsSync(resolved));
  } catch {
    freeBytes = null;
  }
  let fstype = null;
  let driveType = null;
  if (process.platform === "darwin") {
    fstype = await darwinFstype(resolved);
  } else if (process.platform === "linux") {
    try {
      fstype = fstypeFromMountTable(fs.readFileSync("/proc/mounts", "utf8"), resolved);
    } catch {
      fstype = null;
    }
  } else if (process.platform === "win32") {
    driveType = await windowsDriveType(resolved);
  }
  return { ok: true, fstype, driveType, freeBytes };
}
