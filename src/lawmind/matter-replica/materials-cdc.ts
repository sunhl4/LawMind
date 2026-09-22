/**
 * Fixed-size CDC-lite for large materials (content-defined later).
 * Chunks are content-addressed; compound file = ordered chunk hashes.
 */

import { createHash } from "node:crypto";

/** Start chunking above this size (whole-file under threshold). */
export const MATERIAL_CHUNK_THRESHOLD = 4 * 1024 * 1024;
export const MATERIAL_CHUNK_SIZE = 2 * 1024 * 1024;

export type MaterialChunkPlan = {
  sha256: string;
  size: number;
  chunks: Array<{ sha256: string; size: number; offset: number }>;
};

export function hashBuffer(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

export function planMaterialChunks(bytes: Buffer): MaterialChunkPlan {
  const sha256 = hashBuffer(bytes);
  if (bytes.length <= MATERIAL_CHUNK_THRESHOLD) {
    return {
      sha256,
      size: bytes.length,
      chunks: [{ sha256, size: bytes.length, offset: 0 }],
    };
  }
  const chunks: MaterialChunkPlan["chunks"] = [];
  for (let offset = 0; offset < bytes.length; offset += MATERIAL_CHUNK_SIZE) {
    const slice = bytes.subarray(offset, Math.min(offset + MATERIAL_CHUNK_SIZE, bytes.length));
    chunks.push({ sha256: hashBuffer(slice), size: slice.length, offset });
  }
  return { sha256, size: bytes.length, chunks };
}

export function reassembleChunks(parts: Buffer[], expectedSha256: string): Buffer {
  const out = Buffer.concat(parts);
  const got = hashBuffer(out);
  if (got !== expectedSha256) {
    throw new Error("chunk reassembly hash mismatch");
  }
  return out;
}
