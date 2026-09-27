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
const EXACT_PROTECTED_RELS = new Set(["lawmind.policy.json"]);
const PROTECTED_REL_PREFIXES = [
  "lawmind/",
  "audit/",
  "sessions/",
  "tasks/",
  "matters/",
  "drafts/",
  ".git/",
];
const PROTECTED_BASENAMES = new Set([
  ".lawmind-dms.json",
  "RULES.md",
  "ethics-wall.json",
  ".signing-secret",
]);

/**
 * `.env` 家族（`.env`、`.env.lawmind`、`.env.local` …）一律是密钥文件，任意深度拒写。
 * 与 `src/lawmind/runtime/protected-workspace-rels.ts` 的 `isEnvSecretBasename` 同口径。
 */
function isEnvSecretBasename(baseFold) {
  return baseFold === ".env" || baseFold.startsWith(".env.");
}

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
  if (isEnvSecretBasename(baseFold)) {
    return true;
  }
  for (const name of PROTECTED_BASENAMES) {
    if (base === name || baseFold === name.toLowerCase()) {
      return true;
    }
  }
  return false;
}

/**
 * 保护路径的**祖先目录**（`audit`、`sessions`、`matters` …）。
 *
 * 为什么需要单独一条：`isProtectedWorkspaceRel` 按 `audit/` 这种**带斜杠前缀**匹配，
 * 所以目录名本身（`audit`）不命中——而 `fs:delete` 是 `rm -r`，删 `audit` 等于删掉整条
 * 审计链，删 `sessions` 等于删掉全部会话真相源。所以「删/改名一个目录」必须连祖先一起拒。
 *
 * `cases` 不在 `PROTECTED_REL_PREFIXES` 里（它不是治理面），但它是**案件卷**
 * （`cases/<id>/CASE.md`、`RULES.md` 等结构文件），所以同样不许整卷删除/改名。
 * 结构文件清单的规范实现在 `src/lawmind/agent/tools/legal/workspace-file-ops.ts`
 * 的 `CASE_STRUCTURAL_ENTRIES`。
 */
const PROTECTED_TREE_ROOTS = new Set([
  ...PROTECTED_REL_PREFIXES.map((prefix) => prefix.replace(/\/$/, "")),
  "cases",
]);

/** 目录内容扫描的节点上限；超限按「可能有保护文件」处理（fail-closed）。 */
export const PROTECTED_SCAN_MAX_NODES = 20_000;

/**
 * `relPath` 是不是某个保护路径的祖先目录（即删/改名它会连带整棵受保护子树）。
 * 只判目录身份，不看文件系统。
 */
export function isProtectedWorkspaceAncestor(relPath) {
  const norm = String(relPath || "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
  return PROTECTED_TREE_ROOTS.has(norm.toLowerCase());
}

/**
 * 目录里有没有受保护路径（用于删/改名这类会连带整棵子树的操作）。
 * 返回命中的工作区相对路径；没有则返回 null。**扫描超限时返回当前节点（fail-closed）**。
 *
 * 为什么需要走目录：`RULES.md` / `ethics-wall.json` / `.lawmind-dms.json` 是
 * **任意深度**保护（见 `PROTECTED_BASENAMES`），无法用前缀枚举，所以删
 * `cases/<id>` 时必须看它里面有没有这些文件。
 */
export function findProtectedEntryUnder(absPath, relPath) {
  const stack = [{ abs: absPath, rel: toPosix(relPath) }];
  let visited = 0;
  while (stack.length > 0) {
    const node = stack.pop();
    let dirents;
    try {
      dirents = fs.readdirSync(node.abs, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of dirents) {
      visited += 1;
      const childRel = toPosix(path.join(node.rel, entry.name));
      if (visited > PROTECTED_SCAN_MAX_NODES) {
        return childRel;
      }
      if (isProtectedWorkspaceRel(childRel) || isProtectedWorkspaceAncestor(childRel)) {
        return childRel;
      }
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        stack.push({ abs: path.join(node.abs, entry.name), rel: childRel });
      }
    }
  }
  return null;
}

export const PROTECTED_WORKSPACE_WRITE_REFUSAL =
  "该路径属于 LawMind 治理/审计数据（策略、MCP 配置、审计、会话、任务、案件真相源），不能通过写文书或文件接口修改；请使用对应的设置入口。";

export const PROTECTED_WORKSPACE_WRITE_CODE = "protected_workspace_path";

/**
 * 路径**身份**层面的写保护判定（纯函数，不看文件系统）。
 *
 * 两层，缺任何一层都有绕过路径：
 * 1. 目标本身是保护路径 —— `matters/<id>/matter.json`、`audit/x.jsonl`、`lawmind/mcp.json`。
 * 2. 目标是保护路径的祖先目录 —— `audit`、`sessions`、`cases`。删/改名是递归的，
 *    只查第 1 层会放走「删掉整个 audit 目录」。
 *
 * 第三层（目录里有没有任意深度的 `RULES.md`）需要读文件系统，由调用点用
 * `findProtectedEntryUnder` 在 symlink 校验之后单独做。
 *
 * 导出供「另存为」这类不经过 `resolveFsPath` 的写入口复用（见 ipc-handlers 的保存对话框）。
 */
export function isProtectedWorkspaceWritePath(relPath) {
  return isProtectedWorkspaceRel(relPath) || isProtectedWorkspaceAncestor(relPath);
}

function protectedWriteError() {
  const err = new Error(PROTECTED_WORKSPACE_WRITE_REFUSAL);
  err.code = PROTECTED_WORKSPACE_WRITE_CODE;
  return err;
}

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
   *
   * `destructive: true` 表示「这个写会连带整棵子树」（删除、改名 from）——
   * 除保护路径本身外，还要扫目标目录里有没有保护文件。
   */
  function resolveFsPath(rootKey, relPath = "", opts = {}) {
    const { access, mustExist = false, allowRoot = true, destructive = false } = opts;
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
    // 写保护分两处判：
    // ① 路径身份（不看文件系统）**先于 mustExist**——否则「该路径不存在」会盖掉
    //    「这是保护路径」，既泄漏存在性又让错误契约随文件状态漂移。
    // 受保护清单是工作区相对的，所以只对 workspace 根生效（与 /api/fs/write 同口径）。
    const protectsWorkspace = access === "write" && rootKey === "workspace";
    if (protectsWorkspace && isProtectedWorkspaceWritePath(rel)) {
      throw protectedWriteError();
    }
    if (mustExist && !fs.existsSync(absPath)) {
      throw new Error("path does not exist");
    }
    const real = realpathSafe(absPath);
    if (real && !isUnderRoot(rootPath, real)) {
      throw new Error("symlink escapes root");
    }
    // ② 目录内容扫描放在 symlink 校验**之后**：`RULES.md` 等是任意深度保护，无法用前缀
    //    枚举；但扫描必须确认目标没顺着软链逃出根，否则会去 readdir 根外目录。
    if (protectsWorkspace && destructive && findProtectedEntryUnder(absPath, rel)) {
      throw protectedWriteError();
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
