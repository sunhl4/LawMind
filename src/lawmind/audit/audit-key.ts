/**
 * 审计链 HMAC 密钥解析。
 *
 * 分层保管：
 * - Electron：主进程 keyVault（safeStorage）生成/保管，经 `LAWMIND_AUDIT_CHAIN_KEY`
 *   注入本地服务器与 lawmindd 子进程环境；
 * - headless（CLI / 测试 / 无 keychain 降级）：工作区外 0600 key 文件
 *   （见 `platform/local-key-store.ts`），首次自动生成。
 *
 * 同一台机器上两条路径可能并存（桌面用 keychain 密钥、CLI 用 key 文件），
 * 因此 verify 侧接受「任一本机密钥」匹配；emit 侧固定用首选密钥（env 优先）。
 */

import { parseHexKey, resolveKeyFileKey } from "../platform/local-key-store.js";

export const AUDIT_CHAIN_KEY_ENV = "LAWMIND_AUDIT_CHAIN_KEY";
export const AUDIT_CHAIN_KEY_NAME = "audit-chain";

/** 全部可用的本机审计链密钥（env 优先，去重）。 */
export function resolveAuditChainKeys(opts?: { keyDir?: string; create?: boolean }): Buffer[] {
  const out: Buffer[] = [];
  const envKey = parseHexKey(process.env[AUDIT_CHAIN_KEY_ENV]);
  if (envKey) {
    out.push(envKey);
  }
  const fileKey = resolveKeyFileKey({
    name: AUDIT_CHAIN_KEY_NAME,
    keyDir: opts?.keyDir,
    create: opts?.create,
  });
  if (fileKey && !out.some((k) => k.equals(fileKey))) {
    out.push(fileKey);
  }
  return out;
}

/** emit 侧首选密钥（env 优先；缺省允许首次自动生成 key 文件）。 */
export function resolveAuditChainKey(opts?: { keyDir?: string; create?: boolean }): Buffer | null {
  return resolveAuditChainKeys({ keyDir: opts?.keyDir, create: opts?.create ?? true })[0] ?? null;
}
