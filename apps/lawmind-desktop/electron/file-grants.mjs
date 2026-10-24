/**
 * 工作区之外的文件：按次授权成「同级根」。
 *
 * 产品规则（与 Cursor 一致）：
 * - 律师让助手找一个工作区外的文件，那个文件必须能在中栏打开，并且**权限与工作区文件相同**（可读可写）；
 * - 但对话**产出**的文件只能落在会话所属的工作区 / 案件目录 —— 那由交付路径决定，
 *   不靠这层授权（见 `src/lawmind/artifacts/default-output-location.ts`）。
 *
 * 所以这里是「律师显式碰过的文件」这条路径：
 * - 授权范围是该文件**所在目录**（等同于临时把一个文件夹当工作区），
 *   只到文件一层会让「同目录里挨着的附件」打不开，与 Cursor 手感不符；
 * - 按次、仅本次运行有效：启动时清空，磁盘上那份 json 只是给本地服务进程的交接单，
 *   否则一次点击会变成永久全盘可写；
 * - 密钥 / 钥匙串 / LawMind 自己的凭据目录一律拒绝，授权覆盖不了它们。
 *
 * 规范实现（TS，服务端用）：`src/lawmind/host-access/deny-list.ts`。
 * 本文件是主进程侧的纯 JS 镜像 —— 主进程不能用 TS，改动时两边保持同步。
 */

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const FILE_ROOT_PREFIX = "file:";
/**
 * 同时可用的外部文件上限。
 *
 * 不设成「到顶就挤掉最早的」：那会让**已经打开的标签**在下次保存时突然 404，
 * 而这种失败在律师看来就是「文件坏了」。到顶时明确拒绝（见 grant），
 * 正常使用不会碰到 —— 关标签会释放授权（见 release）。
 */
export const MAX_FILE_GRANTS = 128;
export const FILE_GRANTS_FILENAME = "file-grants.json";

// ── 拒绝名单（与 src/lawmind/host-access/deny-list.ts 同口径） ──
const DENY_BASENAMES = new Set([
  ".env",
  ".env.lawmind",
  "id_rsa",
  "id_ed25519",
  "id_ecdsa",
  "id_dsa",
  "mail-secrets.json",
  "lawmind.policy.json",
  "ethics-wall.json",
]);
const DENY_EXTENSIONS = new Set([".pem", ".p12", ".pfx", ".key"]);
const DENY_DIR_NAMES = new Set([".ssh", ".gnupg", "Keychains", "Cookies"]);

function realpathOrResolve(abs) {
  try {
    return fs.realpathSync(abs);
  } catch {
    return path.resolve(abs);
  }
}

function isUnderRoot(rootPath, candidatePath) {
  const root = path.resolve(rootPath);
  const candidate = path.resolve(candidatePath);
  return candidate === root || candidate.startsWith(root + path.sep);
}

export function isDeniedFileGrantPath(absPath, opts = {}) {
  if (!absPath || !String(absPath).trim()) {
    return true;
  }
  const real = realpathOrResolve(absPath);
  const posix = real.replace(/\\/g, "/");
  const base = path.basename(real);
  const ext = path.extname(real).toLowerCase();
  if (base.startsWith(".env")) {
    return true;
  }
  if (DENY_BASENAMES.has(base) || DENY_BASENAMES.has(base.toLowerCase())) {
    return true;
  }
  if (DENY_EXTENSIONS.has(ext)) {
    return true;
  }
  const parts = posix.split("/").filter(Boolean);
  if (parts.some((seg) => DENY_DIR_NAMES.has(seg))) {
    return true;
  }
  const home = path.resolve(opts.homeDir || os.homedir());
  for (const dir of [
    path.join(home, ".ssh"),
    path.join(home, ".gnupg"),
    path.join(home, "Library", "Keychains"),
    path.join(home, "Library", "Cookies"),
  ]) {
    if (isUnderRoot(dir, real)) {
      return true;
    }
  }
  // LawMind 自己的数据目录（凭据、代次、吊销名单、模型 key）也在 home 下，
  // 名字就叫 LawMind，所以必须按绝对路径挡掉，不能只靠 basename。
  for (const dir of opts.secretDirs ?? []) {
    if (dir && String(dir).trim() && isUnderRoot(realpathOrResolve(dir), real)) {
      return true;
    }
  }
  return false;
}

export function fileRootKeyFor(absPath) {
  const digest = crypto.createHash("sha1").update(realpathOrResolve(absPath)).digest("hex");
  return `${FILE_ROOT_PREFIX}${digest.slice(0, 12)}`;
}

export function isFileRootKey(rootKey) {
  return typeof rootKey === "string" && rootKey.startsWith(FILE_ROOT_PREFIX);
}

/**
 * @param {{ filePath: string, homeDir?: string, secretDirs?: string[] }} opts
 */
export function createFileGrantStore(opts) {
  const filePath = opts.filePath;
  /** @type {Map<string, { key: string, absPath: string, dirPath: string, label: string, addedAt: string }>} */
  let grants = new Map();
  /**
   * 已知的 workspace / project 目录。
   *
   * 授权是用来「打开工作区外的文件」的，不是绕路。已经在工作区里的文件不需要
   * 也不能变成 `file:` 根 —— 否则同一份文件会有两个可写根，审计和写保护都会漏。
   */
  let knownRoots = [];

  function persist() {
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(
        filePath,
        `${JSON.stringify({ grants: [...grants.values()] }, null, 2)}\n`,
        "utf8",
      );
    } catch {
      /* 交接单写不出去时，主进程内的读取仍然有效；本地服务侧会退化成 not_found。 */
    }
  }

  function reset() {
    grants = new Map();
    persist();
  }

  /**
   * 记住 workspace / project 目录，用来拒绝「已经在工作区内」的文件。
   *
   * 必须 realpath：macOS 的 `/var` 是 `/private/var` 的软链，只做 path.resolve
   * 会让「工作区里的文件」被判定在工作区外，白拿一个外部授权。
   */
  function setKnownRoots(roots) {
    knownRoots = (roots ?? [])
      .filter((r) => typeof r === "string" && r.trim())
      .map((r) => realpathOrResolve(r));
  }

  /**
   * 为一份真实存在的文件登记可读写的同级根。返回 `{ ok: true, root, rel }`，
   * 或 `{ ok: false, error }`（文件不存在 / 是目录 / 命中拒绝名单 / 已在工作区内）。
   */
  function grant(absPath) {
    const raw = typeof absPath === "string" ? absPath.trim() : "";
    if (!raw || raw.includes("\0") || !path.isAbsolute(raw)) {
      return { ok: false, error: "路径无效。" };
    }
    let stat;
    try {
      stat = fs.statSync(raw);
    } catch {
      return { ok: false, error: "这份文件已经不在磁盘上了。" };
    }
    if (!stat.isFile()) {
      return { ok: false, error: "这个路径不是文件。" };
    }
    const real = realpathOrResolve(raw);
    for (const root of knownRoots) {
      if (isUnderRoot(root, real)) {
        return {
          ok: false,
          error: "这个文件已经在工作区或项目目录内，不需要额外授权。",
        };
      }
    }
    if (
      isDeniedFileGrantPath(real, {
        homeDir: opts.homeDir,
        secretDirs: opts.secretDirs,
      })
    ) {
      return {
        ok: false,
        error: "这个文件属于密钥、钥匙串或 LawMind 的治理数据，不能打开。",
      };
    }
    const key = fileRootKeyFor(real);
    const dirPath = path.dirname(real);
    if (!grants.has(key)) {
      if (grants.size >= MAX_FILE_GRANTS) {
        // 到顶了就说不，不挤掉别人：被挤掉的标签会在下次保存时 404。
        return {
          ok: false,
          error: `同时在用 ${MAX_FILE_GRANTS} 个工作区外文件，已到上限。请先关掉一些标签，或把它们收进本案。`,
        };
      }
      grants.set(key, {
        key,
        absPath: real,
        dirPath,
        label: path.basename(real),
        addedAt: new Date().toISOString(),
      });
      persist();
    }
    return { ok: true, root: key, rel: path.basename(real) };
  }

  /** 外部路径是否命中密钥/治理名单（读外部目录时用）。 */
  function isDenied(absPath) {
    return isDeniedFileGrantPath(absPath, {
      homeDir: opts.homeDir,
      secretDirs: opts.secretDirs,
    });
  }

  /** 该根授权的**那一份文件**的绝对路径；没授权返回 null。 */
  function grantedFileAbs(rootKey) {
    const row = grants.get(typeof rootKey === "string" ? rootKey : "");
    return row ? row.absPath : null;
  }

  /**
   * 关掉标签时释放授权：不让上限随会话变长而堆满。
   * 只删自己这一条，别人的不动。返回是否真的删掉了。
   */
  function release(rootKey) {
    const key = typeof rootKey === "string" ? rootKey : "";
    if (!key.startsWith(FILE_ROOT_PREFIX) || !grants.has(key)) {
      return false;
    }
    grants.delete(key);
    persist();
    return true;
  }

  /** 给 fs-bridge / 本地服务用的 `根 key → 目录` 映射。 */
  function roots() {
    const out = {};
    for (const [key, row] of grants) {
      out[key] = row.dirPath;
    }
    return out;
  }

  return {
    filePath,
    grant,
    roots,
    reset,
    setKnownRoots,
    grantedFileAbs,
    isDenied,
    release,
    size: () => grants.size,
  };
}

/** 本地服务进程读交接单。按次授权：这里只读，不写。 */
export function readFileGrantRoots(filePath) {
  const out = {};
  if (!filePath || !String(filePath).trim()) {
    return out;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const rows = Array.isArray(raw?.grants) ? raw.grants : [];
    for (const row of rows) {
      if (
        row &&
        typeof row.key === "string" &&
        row.key.startsWith(FILE_ROOT_PREFIX) &&
        typeof row.dirPath === "string" &&
        row.dirPath.trim() &&
        path.isAbsolute(row.dirPath)
      ) {
        out[row.key] = row.dirPath;
      }
    }
  } catch {
    /* 没有交接单 = 没有授权。 */
  }
  return out;
}
