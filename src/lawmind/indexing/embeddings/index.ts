/**
 * Local embedding index seam (C2-3 / G7).
 *
 * Default: disabled. When LAWMIND_EMBEDDING_ENABLED=1, uses a deterministic
 * local hash-embedding stub suitable for tests / offline smoke — NOT a
 * production semantic model. USER may later swap in bge-m3 / onnx runtime.
 */

export type EmbeddingIndexConfig = {
  enabled: boolean;
  /** Model id label for Doctor */
  modelId: string;
  dimensions: number;
};

export function getEmbeddingIndexConfig(opts?: {
  enabled?: string;
  modelId?: string;
}): EmbeddingIndexConfig {
  const raw = (opts?.enabled ?? process.env.LAWMIND_EMBEDDING_ENABLED ?? "").trim().toLowerCase();
  const enabled = raw === "1" || raw === "true" || raw === "yes";
  const modelId =
    opts?.modelId?.trim() || process.env.LAWMIND_EMBEDDING_MODEL?.trim() || "local-hash-stub-v1";
  const dimensions = Number(process.env.LAWMIND_EMBEDDING_DIMS ?? "64");
  return {
    enabled,
    modelId,
    dimensions: Number.isFinite(dimensions) && dimensions > 0 ? Math.min(dimensions, 1024) : 64,
  };
}

/** Deterministic bag-of-chars hash embedding (stub). */
export function embedTextsLocalStub(texts: string[], dimensions = 64): number[][] {
  return texts.map((text) => {
    const vec = Array.from({ length: dimensions }, () => 0);
    const s = text.normalize("NFKC");
    for (let i = 0; i < s.length; i++) {
      const code = s.charCodeAt(i);
      vec[code % dimensions] += 1;
      vec[(code * 31) % dimensions] += 0.5;
    }
    const norm = Math.sqrt(vec.reduce((a, b) => a + b * b, 0)) || 1;
    return vec.map((v) => v / norm);
  });
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d === 0 ? 0 : dot / d;
}

export type HybridHit = { id: string; text: string; score: number };

/**
 * Hybrid-ish rank: stub embedding cosine + simple term overlap.
 * When embeddings disabled, term overlap only.
 */
export function rankHybrid(opts: {
  query: string;
  docs: Array<{ id: string; text: string }>;
  limit?: number;
}): HybridHit[] {
  const cfg = getEmbeddingIndexConfig();
  const limit = opts.limit ?? 8;
  const qTerms = opts.query
    .toLowerCase()
    .split(/[\s\p{P}]+/u)
    .filter((t) => t.length >= 2);
  let qVec: number[] | null = null;
  if (cfg.enabled) {
    qVec = embedTextsLocalStub([opts.query], cfg.dimensions)[0] ?? null;
  }
  const scored = opts.docs.map((doc) => {
    const lower = doc.text.toLowerCase();
    let term = 0;
    for (const t of qTerms) {
      if (lower.includes(t)) {
        term += 1;
      }
    }
    const termScore = qTerms.length === 0 ? 0 : term / qTerms.length;
    let emb = 0;
    if (qVec) {
      const dVec = embedTextsLocalStub([doc.text], cfg.dimensions)[0];
      emb = cosineSimilarity(qVec, dVec);
    }
    const score = cfg.enabled ? 0.55 * emb + 0.45 * termScore : termScore;
    return { id: doc.id, text: doc.text, score };
  });
  return scored.toSorted((a, b) => b.score - a.score).slice(0, limit);
}
