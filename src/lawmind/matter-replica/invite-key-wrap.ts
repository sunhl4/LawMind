/**
 * Derive a wrapping key from an invite token (HKDF-SHA256).
 * Matter key never travels in plaintext inside the invite pack.
 */

import { createHash, hkdfSync } from "node:crypto";
import { openBytes, sealBytes } from "./crypto-envelope.js";
import type { MatterReplicaKey } from "./matter-key.js";
import { matterKeyBytes } from "./matter-key.js";

export type WrappedMatterKey = {
  version: 2;
  keyId: string;
  /** base64 of LMRENv1 envelope around the 32-byte matter key */
  sealedKeyB64: string;
  /** Invite token fingerprint (not the token) for diagnostics */
  tokenFp: string;
};

export function inviteTokenFingerprint(token: string): string {
  return createHash("sha256").update(token.trim().toUpperCase()).digest("hex").slice(0, 16);
}

export function deriveInviteWrapKey(token: string, matterId: string): Buffer {
  const ikm = Buffer.from(token.trim().toUpperCase(), "utf8");
  const salt = Buffer.from("lawmind-matter-replica-invite-v1", "utf8");
  const info = Buffer.from(`matter:${matterId}`, "utf8");
  return Buffer.from(hkdfSync("sha256", ikm, salt, info, 32));
}

export function wrapMatterKeyForInvite(
  matterKey: MatterReplicaKey,
  token: string,
  matterId: string,
): WrappedMatterKey {
  const wrapKey = deriveInviteWrapKey(token, matterId);
  const sealed = sealBytes(matterKeyBytes(matterKey), wrapKey);
  return {
    version: 2,
    keyId: matterKey.keyId,
    sealedKeyB64: sealed.toString("base64"),
    tokenFp: inviteTokenFingerprint(token),
  };
}

export function unwrapMatterKeyFromInvite(
  wrapped: WrappedMatterKey,
  token: string,
  matterId: string,
): MatterReplicaKey {
  if (wrapped.version !== 2 || typeof wrapped.sealedKeyB64 !== "string") {
    throw new Error("invalid wrapped matter key");
  }
  const wrapKey = deriveInviteWrapKey(token, matterId);
  const raw = openBytes(Buffer.from(wrapped.sealedKeyB64, "base64"), wrapKey);
  if (raw.length !== 32) {
    throw new Error("unwrapped matter key length invalid");
  }
  return {
    version: 1,
    keyId: wrapped.keyId || `mk_${inviteTokenFingerprint(token)}`,
    keyB64: raw.toString("base64"),
    createdAt: new Date().toISOString(),
  };
}
