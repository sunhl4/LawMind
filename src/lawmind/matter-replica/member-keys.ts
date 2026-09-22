/**
 * 成员密钥对 —— 让「撤销邀请」真的能收回访问权（差距评审 X8）。
 *
 * ## 为什么需要它
 *
 * 案件密钥原先把**邀请码**经 HKDF 包装后分发。邀请码一旦泄露（或成员被移出），
 * 那把钥匙就再也换不回来：没有成员公钥，就无法只对「剩下的人」重新分发新密钥。
 *
 * 所以每位律师持有一对 X25519 设备密钥：
 * - **公钥**随 `member.key` op 公布，任何成员都能看到；
 * - **私钥**只留本机（0600），从不出网。
 *
 * 密钥轮换时，新案件密钥用 ECDH 逐一封装给**仍在册的成员**；被移出的人拿不到任何一份，
 * 因此读不了轮换之后的内容。
 *
 * ## 诚信边界（诚实标注）
 *
 * 这是**本地工具与共享文件夹**威胁模型下的收口，不是抗恶意中继的完整方案：
 * 中继仍可丢包 / 重放 op（`op` 尚无签名），也能看到 `member.key` 公钥。
 * 完整方案见差距评审 G2/G3（op 签名、密钥图）。
 */

import {
  createHash,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
} from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "../adapters/matter-storage/io.js";
import { openBytes, sealBytes } from "./crypto-envelope.js";
import type { MatterRecordOp } from "./types.js";

export type MemberKeyPair = {
  version: 1;
  lawyerId: string;
  /** SPKI DER base64 —— 可公开 */
  publicKeyB64: string;
  /** PKCS8 DER base64 —— 只在本机，0600 */
  privateKeyB64: string;
  createdAt: string;
};

export type WrappedMatterKeyForMember = {
  version: 1;
  /** 收件人 lawyerId */
  forLawyerId: string;
  /** 一次性 ECDH 公钥（SPKI DER base64） */
  ephemeralPublicKeyB64: string;
  /** LMRENv1 封套（内容 = 32 字节案件密钥） */
  sealedKeyB64: string;
};

const HKDF_SALT = Buffer.from("lawmind-matter-replica-member-wrap-v1", "utf8");

export function memberKeysPath(workspaceDir: string): string {
  return path.join(path.resolve(workspaceDir), "lawmind", "lawyer-keys.json");
}

/** 本机密钥对指纹 —— 用于判断 op 里的公钥是不是已登记过的同一把。 */
export function memberKeyFingerprint(publicKeyB64: string): string {
  return createHash("sha256").update(publicKeyB64).digest("hex").slice(0, 16);
}

export function readMemberKeyPair(workspaceDir: string): MemberKeyPair | null {
  const p = memberKeysPath(workspaceDir);
  try {
    if (!fs.existsSync(p)) {
      return null;
    }
    const raw = JSON.parse(fs.readFileSync(p, "utf8")) as Partial<MemberKeyPair>;
    if (
      raw?.version !== 1 ||
      typeof raw.lawyerId !== "string" ||
      typeof raw.publicKeyB64 !== "string" ||
      typeof raw.privateKeyB64 !== "string"
    ) {
      return null;
    }
    return {
      version: 1,
      lawyerId: raw.lawyerId,
      publicKeyB64: raw.publicKeyB64,
      privateKeyB64: raw.privateKeyB64,
      createdAt: typeof raw.createdAt === "string" ? raw.createdAt : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

/** 取（必要时生成）本机密钥对。私钥文件 0600。 */
export function ensureMemberKeyPair(workspaceDir: string, lawyerId: string): MemberKeyPair {
  const existing = readMemberKeyPair(workspaceDir);
  if (existing && existing.lawyerId === lawyerId) {
    return existing;
  }
  const { publicKey, privateKey } = generateKeyPairSync("x25519");
  const pair: MemberKeyPair = {
    version: 1,
    lawyerId,
    publicKeyB64: publicKey.export({ type: "spki", format: "der" }).toString("base64"),
    privateKeyB64: privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"),
    createdAt: new Date().toISOString(),
  };
  const p = memberKeysPath(workspaceDir);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  writeJsonAtomic(p, pair);
  // writeJsonAtomic 的权限取决于 umask；私钥再显式收紧一次
  try {
    fs.chmodSync(p, 0o600);
  } catch {
    /* 平台不支持就跳过，不与产品功能耦合 */
  }
  return pair;
}

function deriveWrapKey(sharedSecret: Buffer, matterId: string): Buffer {
  return Buffer.from(
    hkdfSync("sha256", sharedSecret, HKDF_SALT, Buffer.from(`matter:${matterId}`, "utf8"), 32),
  );
}

/** 用收件人公钥封装案件密钥（发送方只需公钥）。 */
export function wrapMatterKeyForMember(input: {
  matterKeyBytes: Buffer;
  matterId: string;
  forLawyerId: string;
  recipientPublicKeyB64: string;
}): WrappedMatterKeyForMember {
  const recipient = createPublicKey({
    key: Buffer.from(input.recipientPublicKeyB64, "base64"),
    type: "spki",
    format: "der",
  });
  const ephemeral = generateKeyPairSync("x25519");
  const shared = diffieHellman({ privateKey: ephemeral.privateKey, publicKey: recipient });
  const wrapKey = deriveWrapKey(shared, input.matterId);
  return {
    version: 1,
    forLawyerId: input.forLawyerId,
    ephemeralPublicKeyB64: ephemeral.publicKey
      .export({ type: "spki", format: "der" })
      .toString("base64"),
    sealedKeyB64: sealBytes(input.matterKeyBytes, wrapKey).toString("base64"),
  };
}

/** 用本机私钥解出被封装给自己的案件密钥。 */
export function unwrapMatterKeyForMember(input: {
  wrapped: WrappedMatterKeyForMember;
  matterId: string;
  myPrivateKeyB64: string;
}): Buffer {
  const { wrapped } = input;
  if (wrapped.version !== 1 || typeof wrapped.sealedKeyB64 !== "string") {
    throw new Error("invalid member-wrapped matter key");
  }
  const ephemeral = createPublicKey({
    key: Buffer.from(wrapped.ephemeralPublicKeyB64, "base64"),
    type: "spki",
    format: "der",
  });
  const mine = createPrivateKey({
    key: Buffer.from(input.myPrivateKeyB64, "base64"),
    type: "pkcs8",
    format: "der",
  });
  const shared = diffieHellman({ privateKey: mine, publicKey: ephemeral });
  const wrapKey = deriveWrapKey(shared, input.matterId);
  const raw = openBytes(Buffer.from(wrapped.sealedKeyB64, "base64"), wrapKey);
  if (raw.length !== 32) {
    throw new Error("unwrapped matter key length invalid");
  }
  return raw;
}

/** 从 op 日志汇总已公布的公钥（lawyerId → 公钥）；后公布的胜出（换设备即重新登记）。 */
export function memberPublicKeysFromOps(ops: MatterRecordOp[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const op of ops) {
    if (op.kind !== "member.key") {
      continue;
    }
    const pub = op.payload.publicKeyB64;
    if (typeof pub !== "string" || !pub) {
      continue;
    }
    out.set(op.actorId, pub);
  }
  return out;
}
