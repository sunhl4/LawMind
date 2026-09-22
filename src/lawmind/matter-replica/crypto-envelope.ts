/**
 * Client-side encryption envelope for replica blobs (Keyhive-lite).
 * Relay stores ciphertext only; matter key never leaves the workspace.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALG = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;
const MAGIC = Buffer.from("LMRENv1");

export function sealBytes(plaintext: Buffer, key32: Buffer): Buffer {
  if (key32.length !== 32) {
    throw new Error("matter key must be 32 bytes");
  }
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALG, key32, iv);
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([MAGIC, iv, tag, enc]);
}

export function openBytes(envelope: Buffer, key32: Buffer): Buffer {
  if (key32.length !== 32) {
    throw new Error("matter key must be 32 bytes");
  }
  // Fail closed on non-envelope input. A silent plaintext passthrough made
  // "replace the ciphertext with plaintext" undetectable, which is a downgrade
  // attack on every sealed blob (see 案件副本差距评审 X6).
  if (!isSealedEnvelope(envelope)) {
    throw new Error("not a sealed envelope (refusing plaintext passthrough)");
  }
  if (envelope.length < MAGIC.length + IV_LEN + TAG_LEN + 1) {
    throw new Error("ciphertext too short");
  }
  const iv = envelope.subarray(MAGIC.length, MAGIC.length + IV_LEN);
  const tag = envelope.subarray(MAGIC.length + IV_LEN, MAGIC.length + IV_LEN + TAG_LEN);
  const data = envelope.subarray(MAGIC.length + IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALG, key32, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

export function isSealedEnvelope(buf: Buffer): boolean {
  return buf.length >= MAGIC.length && buf.subarray(0, MAGIC.length).equals(MAGIC);
}
