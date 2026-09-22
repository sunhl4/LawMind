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

// ── 治理/证据面写保护（纯 JS 镜像） ──
// 规范实现：src/lawmind/runtime/protected-workspace-rels.ts（Electron 主进程为 .mjs，
// 无法直接 import TS）。修改该文件清单时必须同步修改此处。
const EXACT_PROTECTED_RELS = new Set(["lawmind.policy.json", ".env", ".env.lawmind"]);
const PROTECTED_REL_PREFIXES = ["lawmind/", "audit/", "sessions/", "tasks/", "matters/"];
const PROTECTED_BASENAMES = new Set([".lawmind-dms.json", "RULES.md", "ethics-wall.json"]);

export function isProtectedWorkspaceRel(relPath) {
  const norm = String(relPath || "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^\/+/, "");
  const folded = norm.toLowerCase();
  if (EXACT_PROTECTED_RELS.has(norm) || EXACT_PROTECTED_RELS.has(folded)) {
    return true;
  }
  if (
    PROTECTED_REL_PREFIXES.some(
      (prefix) => norm.startsWith(prefix) || folded.startsWith(prefix.toLowerCase()),
    )
  ) {
    return true;
  }
  const base = norm.split("/").pop() || norm;
  const baseFold = folded.split("/").pop() || folded;
  for (const name of PROTECTED_BASENAMES) {
    if (base === name || baseFold === name.toLowerCase()) {
      return true;
    }
  }
  return false;
}

export const PROTECTED_WORKSPACE_WRITE_REFUSAL =
  "该路径属于 LawMind 治理/审计数据（策略、MCP 配置、审计、会话、任务、案件真相源），不能通过写文书或文件接口修改；请使用对应的设置入口。";

export const PROTECTED_WORKSPACE_WRITE_CODE = "protected_workspace_path";

// ── 可写根白名单（fail-closed） ──
// 规范实现：apps/lawmind-desktop/server/lawmind-server-helpers.ts 的 WRITABLE_FS_ROOTS。
// 用白名单而非「root 以 mount: 开头」的否定式判断：新增根种类（如将来的 grant:）
// 默认只读，必须显式加入才能写，避免默默开出一个新写入口。
export const WRITABLE_ROOT_KEYS = new Set(["workspace", "project"]);

/** 机器可读的拒写原因，与 server 侧 FS_ROOT_NOT_WRITABLE_CODE 一致。 */
export const FS_ROOT_NOT_WRITABLE_CODE = "root_not_writable";


// 挂载点（mount:<id>）只读：规范实现在
// src/lawmind/host-access/access-broker.ts 的 MOUNT_WRITE_REFUSAL（本机能力网关对挂载点
// 一律 write_forbidden）。桌面文件接口必须同口径，否则 /api/fs/write 与
// lawmind:fs:write 会开出一个与网关矛盾的写入口。
// 文件面板的 RootKey 只有 workspace | project，拒绝 mount:* 不影响任何已发布 UI 路径。
export const MOUNT_WRITE_REFUSAL = "本机文件夹默认不能改写。请使用「收进本案」复制到案件目录。";

export function isMountRootKey(rootKey) {
  return typeof rootKey === "string" && rootKey.startsWith("mount:");
}

/** 所有写操作（write/mkdir/rename/delete/copy）在解析路径前必须先过这一关。 */
export function assertWritableRoot(rootKey) {
  if (typeof rootKey === "string" && WRITABLE_ROOT_KEYS.has(rootKey)) {
    return;
  }
  const err = new Error(
    isMountRootKey(rootKey) ? MOUNT_WRITE_REFUSAL : `不可写的根：${rootKey ?? "(未指定)"}`,
  );
  err.code = FS_ROOT_NOT_WRITABLE_CODE;
  throw err;
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
    const ok =
      rootKey === "workspace" ||
      rootKey === "project" ||
      (typeof rootKey === "string" && rootKey.startsWith("mount:"));
    if (!ok) {
      throw new Error("invalid root");
    }
    const roots = getAllowedRoots();
    const rootPath = roots[rootKey];
    if (!rootPath) {
      throw new Error(`root not available: ${rootKey}`);
    }
    return rootPath;
  }

  /**
   * `access` 必填：调用点必须显式声明读还是写。写操作先过可写根白名单，
   * 这样新增写入口不会因为「忘了加校验」而默认放行；漏传则当场报错。
   */
  function resolveFsPath(rootKey, relPath = "", opts = {}) {
    const { access, mustExist = false, allowRoot = true } = opts;
    if (access !== "read" && access !== "write") {
      throw new Error("internal: resolveFsPath requires access: read|write");
    }
    if (access === "write") {
      assertWritableRoot(rootKey);
    }
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
    const { absPath, rel } = resolveFsPath(rootKey, relPath, {
      access: "read",
      mustExist: true,
      allowRoot: true,
    });
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
