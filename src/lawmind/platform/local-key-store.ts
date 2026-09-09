/**
 * 本地对称密钥保管（headless 降级层）。
 *
 * 分层保管：Electron 主进程用 safeStorage（electron/lawmind-key-vault.cjs）保管密钥，
 * 并经环境变量注入本地服务器子进程；纯 Node（CLI / 测试 / lawmindd）降级为
 * 工作区外 0600 key 文件（默认 `~/.lawmind/keys/`，可用 LAWMIND_KEY_DIR 覆盖），
 * 首次使用自动生成。密钥绝不可落在工作区内——工作区是模型可读写面，
 * 治理与数据已分离，密钥同理。
 */

import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const keyFileCache = new Map<string, Buffer>();

export function defaultLocalKeyDir(): string {
  const override = process.env.LAWMIND_KEY_DIR?.trim();
  if (override) {
    return path.resolve(override);
  }
  return path.join(os.homedir(), ".lawmind", "keys");
}

/** 64 位 hex（32 字节）→ Buffer；不合法返回 null。 */
export function parseHexKey(raw: string | undefined | null): Buffer | null {
  const t = (raw ?? "").trim();
  if (!/^[0-9a-fA-F]{64}$/.test(t)) {
    return null;
  }
  return Buffer.from(t, "hex");
}

/**
 * 读取（或首次生成）key 文件：`<keyDir>/<name>.key`，0600。
 * create=false 时不生成新密钥——verify 场景无密钥即不可用，
 * 而不是静默生成一把新钥匙让历史数据全部校验失败且难以诊断。
 */
export function resolveKeyFileKey(opts: {
  name: string;
  keyDir?: string;
  create?: boolean;
}): Buffer | null {
  const dir = opts.keyDir ?? defaultLocalKeyDir();
  const keyPath = path.join(dir, `${opts.name}.key`);
  const cached = keyFileCache.get(keyPath);
  if (cached) {
    return cached;
  }
  try {
    const key = parseHexKey(fs.readFileSync(keyPath, "utf8"));
    if (key) {
      keyFileCache.set(keyPath, key);
      return key;
    }
  } catch {
    /* 不存在或不可读 → 下方按需生成 */
  }
  if (opts.create === false) {
    return null;
  }
  try {
    const key = randomBytes(32);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(keyPath, `${key.toString("hex")}\n`, { encoding: "utf8", mode: 0o600 });
    try {
      fs.chmodSync(keyPath, 0o600);
    } catch {
      /* Windows 上 chmod 为 best-effort */
    }
    keyFileCache.set(keyPath, key);
    return key;
  } catch (err) {
    console.warn(
      `[LawMind] 无法生成本地密钥 ${opts.name}:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/** Test-only: 清空 key 文件缓存（切换 LAWMIND_KEY_DIR 后调用）。 */
export function resetLocalKeyStoreCacheForTests(): void {
  keyFileCache.clear();
}
