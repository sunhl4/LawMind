/**
 * Local open-law corpus search (keyword / tag scoring).
 * Loads embedded sample + optional LAWMIND_OPEN_LAW_CORPUS (json/jsonl).
 * External CORPUS wins on id collision (loaded last).
 */

import fs from "node:fs";
import path from "node:path";
import type { AuthorityHit } from "../../authority-hits.js";
import { OPEN_LAW_SAMPLE_STATUTES_JSONL } from "./sample-statutes.embedded.js";
import { OPEN_LAW_PROVIDER, type OpenLawRecord } from "./types.js";

function parseCorpusText(raw: string): OpenLawRecord[] {
  const trimmed = raw.trim();
  if (!trimmed) {
    return [];
  }
  if (trimmed.startsWith("[")) {
    const arr = JSON.parse(trimmed) as unknown;
    return Array.isArray(arr) ? (arr as OpenLawRecord[]) : [];
  }
  const out: OpenLawRecord[] = [];
  for (const line of trimmed.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("//") || t.startsWith("#")) {
      continue;
    }
    try {
      out.push(JSON.parse(t) as OpenLawRecord);
    } catch {
      /* skip bad line */
    }
  }
  return out;
}

/** Parse embedded sample only (no filesystem). Used by tests / packaged CJS. */
export function loadEmbeddedOpenLawSample(): OpenLawRecord[] {
  return parseCorpusText(OPEN_LAW_SAMPLE_STATUTES_JSONL).filter((r) => r?.id && r.title);
}

type LoadedOpenLawRecord = OpenLawRecord & { origin: "sample" | "external" };

function loadOpenLawCorpusWithOrigin(opts?: { corpusPath?: string }): LoadedOpenLawRecord[] {
  const byId = new Map<string, LoadedOpenLawRecord>();
  // Bundled sample first…
  for (const r of loadEmbeddedOpenLawSample()) {
    byId.set(r.id, { ...r, origin: "sample" });
  }
  // …external CORPUS last so it wins on id collision.
  const envPath = (opts?.corpusPath ?? process.env.LAWMIND_OPEN_LAW_CORPUS ?? "").trim();
  if (envPath) {
    try {
      const resolved = path.resolve(envPath);
      if (fs.existsSync(resolved)) {
        for (const r of parseCorpusText(fs.readFileSync(resolved, "utf8"))) {
          if (r?.id && r.title) {
            byId.set(r.id, { ...r, origin: "external" });
          }
        }
      }
    } catch {
      /* skip unreadable */
    }
  }
  return [...byId.values()];
}

export function loadOpenLawCorpus(opts?: { corpusPath?: string }): OpenLawRecord[] {
  return loadOpenLawCorpusWithOrigin(opts).map(({ origin: _origin, ...r }) => r);
}

/**
 * Tokenize for mixed CJK/Latin queries.
 * Whitespace/punct splits plus 2–3-grams over Han runs so
 * "民法典解除" matches tags/titles like "民法典" / "解除".
 */
function tokenize(q: string): string[] {
  const normalized = q.normalize("NFKC").toLowerCase();
  const parts = normalized
    .split(/[\s\p{P}]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length >= 1);
  const out = new Set<string>(parts);
  for (const part of parts) {
    const hans = part.match(/[\u4e00-\u9fff]+/g) ?? [];
    for (const run of hans) {
      if (run.length < 2) {
        continue;
      }
      out.add(run);
      for (let n = 2; n <= 3; n++) {
        if (run.length < n) {
          continue;
        }
        for (let i = 0; i <= run.length - n; i++) {
          out.add(run.slice(i, i + n));
        }
      }
    }
  }
  return [...out];
}

function isCorpusEnvMarkedDemo(): boolean {
  const raw = (process.env.LAWMIND_OPEN_LAW_CORPUS_DEMO ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

function recordIsDemo(
  r: OpenLawRecord,
  origin: "sample" | "external",
  corpusEnvDemo: boolean,
): boolean {
  if (origin === "sample") {
    return true;
  }
  // 环境级 kill-switch：LAWMIND_OPEN_LAW_CORPUS_DEMO=1 时整库按演示处理（覆盖 demo:false）。
  if (corpusEnvDemo) {
    return true;
  }
  // 显式 demo:true 或带 demo 标签 → 演示。
  if (r.demo === true) {
    return true;
  }
  if ((r.tags ?? []).some((t) => String(t).toLowerCase() === "demo")) {
    return true;
  }
  // 显式 demo:false → 视作正式（用户明确声明该条目已核验）。
  if (r.demo === false) {
    return false;
  }
  // 保守默认（N-A4）：未标注的外部 CORPUS 一律按演示语料处理——
  // 许可与核验状态不明，不应被当作正式权威直接用于成稿。
  return true;
}

export function searchOpenLawCorpus(
  query: string,
  opts?: { corpusPath?: string; limit?: number },
): AuthorityHit[] {
  const records = loadOpenLawCorpusWithOrigin(opts);
  const terms = tokenize(query);
  if (terms.length === 0 || records.length === 0) {
    return [];
  }
  const corpusEnvDemo = isCorpusEnvMarkedDemo();
  const scored = records.map((r) => {
    const hay = [r.title, r.citation, r.excerpt, r.body, ...(r.tags ?? [])]
      .filter(Boolean)
      .join("\n")
      .toLowerCase();
    let score = 0;
    for (const t of terms) {
      if (hay.includes(t)) {
        score += t.length >= 2 ? 2 : 1;
      }
      if (r.title.toLowerCase().includes(t)) {
        score += 3;
      }
      if (r.citation?.toLowerCase().includes(t)) {
        score += 2;
      }
    }
    return { r, score };
  });
  const limit = opts?.limit ?? 12;
  return scored
    .filter((x) => x.score > 0)
    .toSorted((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ r }) => {
      const demo = recordIsDemo(r, r.origin, corpusEnvDemo);
      const corpusId = r.corpusId ?? (r.origin === "sample" ? "bundled_sample" : "external_corpus");
      const licenseNote =
        r.licenseNote ??
        (demo
          ? "演示语料：公开法律文本摘录；非正式完整法库，正式引用须核对官方法条"
          : "外部开放语料：许可由用户自行确认；非北大法宝/Lexis");
      return {
        id: r.id,
        title: r.title,
        kind: r.kind ?? "statute",
        citation: r.citation,
        excerpt: (r.excerpt ?? r.body ?? "").slice(0, 500),
        url: r.url,
        provider: r.provider ?? OPEN_LAW_PROVIDER.local,
        corpusId,
        licenseNote,
        ...(demo ? { demo: true } : {}),
      };
    });
}

export function openLawCorpusStats(opts?: { corpusPath?: string }): {
  recordCount: number;
  bundledSample: boolean;
  externalCorpus: boolean;
  corpusPath: string | null;
} {
  const envPath = (opts?.corpusPath ?? process.env.LAWMIND_OPEN_LAW_CORPUS ?? "").trim();
  const embedded = loadEmbeddedOpenLawSample();
  const records = loadOpenLawCorpus(opts);
  const externalOk = Boolean(envPath && fs.existsSync(path.resolve(envPath)));
  return {
    recordCount: records.length,
    bundledSample: embedded.length > 0,
    externalCorpus: externalOk,
    corpusPath: envPath || null,
  };
}
