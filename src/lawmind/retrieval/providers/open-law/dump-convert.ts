/**
 * Convert common open Chinese-law dump shapes → OpenLawRecord JSONL rows.
 *
 * Supported:
 * 1. FLK-style JSON array / JSONL (twang2218 law-datasets shape: title, content, office, …)
 * 2. Article-line text: 《法名》第N条规定，……
 * 3. HF china-effective-laws JSON/JSONL（title + text + category + status；不读 parquet）
 *
 * Does NOT download megabyte dumps. Users convert locally; unclear-license
 * GitHub/HF corpora are manual-only (see README).
 */

import { createHash } from "node:crypto";
import type { OpenLawRecord } from "./types.js";
import { OPEN_LAW_PROVIDER } from "./types.js";

const FLK_DUMP_LICENSE =
  "用户自备 FLK/官方法规 dump；文本源自政府公开法规，整理包许可须自行确认（LawMind 不捆绑大型第三方包）";

const ARTICLE_LINE_LICENSE = "用户自备条文行文本；许可须自行确认；不得当作北大法宝转授权";

const HF_CHINA_LAWS_LICENSE =
  "用户自备 HF 全国现行法律法规快照（如 senry5433/china-effective-laws-regulations）；汇编声明须自行核对；正式引用回链 flk.npc.gov.cn；LawMind 不自动下载";

type HfChinaLawRow = {
  id?: string;
  title?: string;
  name?: string;
  text?: string;
  body?: string;
  content?: string;
  category?: string;
  status?: string;
  issuer?: string;
  office?: string;
  document_number?: string;
  source_url?: string;
  source?: string;
  url?: string;
};

type FlkDumpRow = {
  id?: string;
  title?: string;
  name?: string;
  content?: string;
  body?: string;
  excerpt?: string;
  office?: string;
  publish?: string;
  expiry?: string;
  type?: string;
  status?: string;
  url?: string;
  download_link_word?: string;
  download_link_html?: string;
  download_link_pdf?: string;
};

function stableId(prefix: string, seed: string): string {
  const h = createHash("sha1").update(seed).digest("hex").slice(0, 12);
  return `${prefix}-${h}`;
}

function mapTypeToKind(type: string | undefined): OpenLawRecord["kind"] {
  const t = (type ?? "").trim();
  if (/案例|判决|裁定/.test(t)) {
    return "case";
  }
  if (/法规|条例|规章|司法解释/.test(t)) {
    return "regulation";
  }
  if (/法律|宪法/.test(t)) {
    return "statute";
  }
  return "statute";
}

function parseJsonOrJsonl(raw: string): unknown[] {
  const trimmed = raw.trim();
  if (!trimmed) {
    return [];
  }
  if (trimmed.startsWith("[")) {
    const arr = JSON.parse(trimmed) as unknown;
    return Array.isArray(arr) ? arr : [];
  }
  const out: unknown[] = [];
  for (const line of trimmed.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("//") || t.startsWith("#")) {
      continue;
    }
    try {
      out.push(JSON.parse(t));
    } catch {
      /* skip */
    }
  }
  return out;
}

/** Convert FLK-style dump JSON/JSONL → OpenLawRecord[]. */
export function convertFlkDumpToOpenLawRecords(
  raw: string,
  opts?: { markDemo?: boolean; limit?: number },
): OpenLawRecord[] {
  const rows = parseJsonOrJsonl(raw);
  const limit = opts?.limit ?? Number.POSITIVE_INFINITY;
  const out: OpenLawRecord[] = [];
  for (const row of rows) {
    if (out.length >= limit) {
      break;
    }
    if (!row || typeof row !== "object") {
      continue;
    }
    const r = row as FlkDumpRow;
    const title = (r.title ?? r.name ?? "").trim();
    if (!title) {
      continue;
    }
    const body = (r.content ?? r.body ?? "").trim();
    const id = (r.id ?? "").trim() || stableId("flk-dump", `${title}\n${body.slice(0, 80)}`);
    const excerpt = (r.excerpt ?? body).slice(0, 500);
    out.push({
      id: id.startsWith("flk-dump:") || id.includes("-") ? id : `flk-dump:${id}`,
      title,
      kind: mapTypeToKind(r.type),
      citation: title,
      excerpt,
      body: body || undefined,
      url: r.url?.trim() || "https://flk.npc.gov.cn/",
      status: r.status?.trim() || undefined,
      office: r.office?.trim() || undefined,
      tags: [r.type, r.publish].filter((x): x is string => Boolean(x?.trim())),
      demo: opts?.markDemo === true ? true : undefined,
      provider: OPEN_LAW_PROVIDER.local,
      corpusId: "flk_dump",
      licenseNote: FLK_DUMP_LICENSE,
    });
  }
  return out;
}

/**
 * Convert article-line corpora (one provision per line), e.g.:
 * 《中华人民共和国民法典》第八条规定，民事主体从事民事活动，…
 */
export function convertArticleLinesToOpenLawRecords(
  raw: string,
  opts?: { markDemo?: boolean; limit?: number },
): OpenLawRecord[] {
  const limit = opts?.limit ?? Number.POSITIVE_INFINITY;
  const out: OpenLawRecord[] = [];
  const re =
    /^[《「]([^》」]+)[》」]\s*(第[零〇一二三四五六七八九十百千0-9]+条)\s*规定[，,：:]\s*(.+)$/u;
  for (const line of raw.split(/\r?\n/)) {
    if (out.length >= limit) {
      break;
    }
    const t = line.trim();
    if (!t || t.startsWith("#") || t.startsWith("//")) {
      continue;
    }
    const m = t.match(re);
    if (!m) {
      continue;
    }
    const law = m[1].trim();
    const article = m[2].trim();
    const text = m[3].trim();
    const citation = `《${law}》${article}`;
    const title = `${law}${article}`;
    out.push({
      id: stableId("article-line", `${citation}\n${text.slice(0, 64)}`),
      title,
      kind: "statute",
      citation,
      excerpt: text.slice(0, 500),
      body: `${article}　${text}`,
      url: "https://flk.npc.gov.cn/",
      tags: [law, article],
      demo: opts?.markDemo === true ? true : undefined,
      provider: OPEN_LAW_PROVIDER.local,
      corpusId: "article_line",
      licenseNote: ARTICLE_LINE_LICENSE,
    });
  }
  return out;
}

function looksLikeHfChinaLawRow(row: unknown): boolean {
  if (!row || typeof row !== "object") {
    return false;
  }
  const r = row as HfChinaLawRow;
  return Boolean(
    (r.title ?? r.name)?.trim() && (r.text ?? r.body)?.trim() && (r.category || r.status),
  );
}

/** Convert HF china-effective-laws documents JSON/JSONL → OpenLawRecord[]. */
export function convertHfChinaLawsToOpenLawRecords(
  raw: string,
  opts?: { markDemo?: boolean; limit?: number },
): OpenLawRecord[] {
  const rows = parseJsonOrJsonl(raw);
  const limit = opts?.limit ?? Number.POSITIVE_INFINITY;
  const out: OpenLawRecord[] = [];
  for (const row of rows) {
    if (out.length >= limit) {
      break;
    }
    if (!looksLikeHfChinaLawRow(row)) {
      continue;
    }
    const r = row as HfChinaLawRow;
    const title = (r.title ?? r.name ?? "").trim();
    const body = (r.text ?? r.body ?? r.content ?? "").trim();
    const id = (r.id ?? "").trim() || stableId("hf-cn", `${title}\n${body.slice(0, 80)}`);
    const category = (r.category ?? "").trim();
    out.push({
      id: id.includes(":") ? id : `hf-cn:${id}`,
      title,
      kind: mapTypeToKind(category),
      citation: title,
      excerpt: body.slice(0, 500),
      body: body || undefined,
      url: (r.source_url ?? r.url ?? r.source ?? "").trim() || "https://flk.npc.gov.cn/",
      status: r.status?.trim() || undefined,
      office: (r.issuer ?? r.office ?? "").trim() || undefined,
      tags: [category, r.document_number].filter((x): x is string => Boolean(x?.trim())),
      demo: opts?.markDemo === true ? true : undefined,
      provider: OPEN_LAW_PROVIDER.local,
      corpusId: "hf_china_laws",
      licenseNote: HF_CHINA_LAWS_LICENSE,
    });
  }
  return out;
}

/** Serialize records as JSONL (one object per line). */
export function openLawRecordsToJsonl(records: OpenLawRecord[]): string {
  return records.map((r) => JSON.stringify(r)).join("\n") + (records.length ? "\n" : "");
}

export type OpenLawDumpFormat = "flk_json" | "article_line" | "hf_china_laws";

export function detectAndConvertOpenLawDump(
  raw: string,
  opts?: { format?: "auto" | OpenLawDumpFormat; markDemo?: boolean; limit?: number },
): { format: OpenLawDumpFormat; records: OpenLawRecord[] } {
  const format = opts?.format ?? "auto";
  if (format === "flk_json") {
    return { format, records: convertFlkDumpToOpenLawRecords(raw, opts) };
  }
  if (format === "article_line") {
    return { format, records: convertArticleLinesToOpenLawRecords(raw, opts) };
  }
  if (format === "hf_china_laws") {
    return { format, records: convertHfChinaLawsToOpenLawRecords(raw, opts) };
  }
  const trimmed = raw.trim();
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    const parsed = parseJsonOrJsonl(raw);
    if (parsed.some(looksLikeHfChinaLawRow)) {
      return { format: "hf_china_laws", records: convertHfChinaLawsToOpenLawRecords(raw, opts) };
    }
    return { format: "flk_json", records: convertFlkDumpToOpenLawRecords(raw, opts) };
  }
  const article = convertArticleLinesToOpenLawRecords(raw, opts);
  if (article.length > 0) {
    return { format: "article_line", records: article };
  }
  return { format: "flk_json", records: convertFlkDumpToOpenLawRecords(raw, opts) };
}
