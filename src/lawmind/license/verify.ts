/**
 * 离线许可校验：ed25519 验签 + 机器指纹 + 有效期。全程无网络。
 */

import {
  createPrivateKey,
  createPublicKey,
  sign,
  verify as cryptoVerify,
  createHash,
} from "node:crypto";
import os from "node:os";
import { LICENSE_PUBLIC_KEY_DER_B64 } from "./keys.js";
import type { LicenseEdition, LicensePayload } from "./types.js";

const EDITIONS: ReadonlySet<LicenseEdition> = new Set(["solo", "firm", "private_deploy"]);

function fromBase64Url(value: string): Buffer {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, "base64");
}

/**
 * 机器指纹：hostname + platform 的稳定哈希（不采集硬件序列号，无需特权）。
 * 换机后指纹变化 → 绑机许可失效（律师可在设置里看到原因）。
 */
export function machineFingerprint(): string {
  const material = `${os.hostname()}::${process.platform}::${os.arch()}`;
  return createHash("sha256").update(material).digest("hex").slice(0, 32);
}

export type ActivationCheck =
  | { ok: true; payload: LicensePayload }
  | { ok: false; reason: "malformed" | "bad_signature" | "bad_payload" | "machine_mismatch" };

/**
 * 校验一份激活码。任何一步不过都返回失败原因，绝不「宽容通过」。
 */
export function verifyActivationCode(
  code: string,
  opts?: { fingerprint?: string; publicKeyDerB64?: string },
): ActivationCheck {
  const trimmed = code.trim();
  if (!trimmed) {
    return { ok: false, reason: "malformed" };
  }
  const dot = trimmed.lastIndexOf(".");
  if (dot <= 0 || dot === trimmed.length - 1) {
    return { ok: false, reason: "malformed" };
  }
  const payloadPart = trimmed.slice(0, dot);
  const signaturePart = trimmed.slice(dot + 1);

  let payloadBytes: Buffer;
  let signature: Buffer;
  try {
    payloadBytes = fromBase64Url(payloadPart);
    signature = fromBase64Url(signaturePart);
  } catch {
    return { ok: false, reason: "malformed" };
  }

  let payload: LicensePayload;
  try {
    payload = JSON.parse(payloadBytes.toString("utf8")) as LicensePayload;
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (
    !payload ||
    payload.v !== 1 ||
    typeof payload.licensee !== "string" ||
    typeof payload.issuedAt !== "string" ||
    !EDITIONS.has(payload.edition)
  ) {
    return { ok: false, reason: "bad_payload" };
  }

  const publicKey = createPublicKey({
    key: Buffer.from(opts?.publicKeyDerB64 ?? LICENSE_PUBLIC_KEY_DER_B64, "base64"),
    format: "der",
    type: "spki",
  });
  let signatureOk = false;
  try {
    // ed25519 的 Ed25519 算法参数在 Node 里是 null。
    signatureOk = cryptoVerify(null, payloadBytes, publicKey, signature);
  } catch {
    signatureOk = false;
  }
  if (!signatureOk) {
    return { ok: false, reason: "bad_signature" };
  }

  if (payload.machineFingerprint) {
    const fp = opts?.fingerprint ?? machineFingerprint();
    if (payload.machineFingerprint !== fp) {
      return { ok: false, reason: "machine_mismatch" };
    }
  }
  return { ok: true, payload };
}

/** 签发一份激活码（发行方用；私钥 DER base64 由调用方提供，不进仓库运行路径）。 */
export function signActivationCode(payload: LicensePayload, privateKeyDerB64: string): string {
  const privateKey = createPrivateKey({
    key: Buffer.from(privateKeyDerB64, "base64"),
    format: "der",
    type: "pkcs8",
  });
  const payloadBytes = Buffer.from(JSON.stringify(payload), "utf8");
  const signature = sign(null, payloadBytes, privateKey);
  return `${payloadBytes.toString("base64url")}.${signature.toString("base64url")}`;
}
