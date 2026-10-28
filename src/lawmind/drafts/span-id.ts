/**
 * Stable span ids for rule-level branch review.
 *
 * Prefers Word's `w14:paraId` when the parser captured it (stable across
 * edits). Falls back to `ordinal + content hash` of the base paragraph text,
 * which is stable *within one review* (all workers share the same base
 * snapshot) but not across a rewrite — callers must keep baseVersion.
 */

import { createHash } from "node:crypto";

export type SpanIdInput = {
  /** `w14:paraId` when available. */
  paraId?: string;
  /** 0-based paragraph ordinal in the story part. */
  paragraphIndex: number;
  /** Base paragraph plain text (used only for the fallback). */
  text: string;
};

export function contentHashOf(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex").slice(0, 12);
}

export function deriveSpanId(input: SpanIdInput): string {
  const paraId = input.paraId?.trim();
  if (paraId) {
    return `pid:${paraId}`;
  }
  return `ord:${input.paragraphIndex}:${contentHashOf(input.text)}`;
}

export function deriveSpanIds(paragraphs: readonly SpanIdInput[]): string[] {
  const seen = new Set<string>();
  return paragraphs.map((p) => {
    let id = deriveSpanId(p);
    if (seen.has(id)) {
      // Duplicate w14:paraId is malformed input; disambiguate deterministically.
      id = `${id}#${p.paragraphIndex}`;
    }
    seen.add(id);
    return id;
  });
}
