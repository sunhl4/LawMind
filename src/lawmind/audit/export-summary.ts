/**
 * 审计摘要导出（用于外部锚定）。
 *
 * 将某段审计链浓缩为可打印/可上传的摘要：
 *   - 时间范围
 *   - 事件数
 *   - 链尾 root hash
 *   - 哈希算法标记
 *   - 同目录外锚 audit-root.log 最新记录
 * 摘要本身用本机审计链 HMAC 密钥签名，便于律师/第三方持有独立副本后验证。
 */

import { createHmac } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveAuditChainKeys } from "./audit-key.js";
import { AUDIT_HASH_ALG_HMAC, type AuditEventWithIntegrity } from "./hash-chain.js";
import { readAuditRootAnchors, type AuditRootAnchorEntry } from "./root-anchor.js";

export type AuditExportDateRange = {
  from: string;
  to: string;
};

export type AuditExportSummary = {
  dateRange: AuditExportDateRange;
  eventCount: number;
  /** 链尾最新 root hash（无链则为空字符串）。 */
  rootHash: string;
  /** 链哈希算法标记；hmac-sha256 / legacy / mixed。 */
  hashAlg: "hmac-sha256" | "legacy" | "mixed";
  /** 同目录 audit-root.log 最新记录（无则为 null）。 */
  tailAnchor: Pick<AuditRootAnchorEntry, "date" | "rootHash" | "timestamp" | "eventId"> | null;
  /** 签名时使用的密钥标识（仅签名时写入）。 */
  hmacKeyId?: string;
};

export type SignedAuditExportSummary = {
  summary: AuditExportSummary;
  /** HMAC-SHA256(hex) 签名。 */
  signature: string;
  hmacKeyId: string;
};

export type AuditExportSummaryOptions = {
  /** 显式指定签名密钥；缺省从本机密钥解析（create:false）。 */
  key?: Buffer | null;
  /** 签名密钥标识；默认 "audit-chain"。 */
  hmacKeyId?: string;
};

/** 规范化签名字符串：字段顺序固定、无额外空白。 */
function canonicalSummaryString(summary: AuditExportSummary): string {
  return JSON.stringify({
    dateRange: summary.dateRange,
    eventCount: summary.eventCount,
    rootHash: summary.rootHash,
    hashAlg: summary.hashAlg,
    tailAnchor: summary.tailAnchor,
  });
}

function readAllAuditLogsSync(auditDir: string): AuditEventWithIntegrity[] {
  let entries: string[];
  try {
    entries = fs
      .readdirSync(auditDir)
      .filter((name) => name.endsWith(".jsonl"))
      .toSorted();
  } catch {
    return [];
  }
  const all: AuditEventWithIntegrity[] = [];
  for (const name of entries) {
    const raw = fs.readFileSync(path.join(auditDir, name), "utf8");
    const events = raw
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as AuditEventWithIntegrity);
    all.push(...events);
  }
  return all;
}

export function readAuditEventsFromPath(inputPath: string): AuditEventWithIntegrity[] {
  let stat: fs.Stats | undefined;
  try {
    stat = fs.statSync(inputPath);
  } catch {
    return [];
  }
  if (stat.isDirectory()) {
    return readAllAuditLogsSync(inputPath);
  }
  const raw = fs.readFileSync(inputPath, "utf8");
  return raw
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as AuditEventWithIntegrity);
}

function latestTailAnchor(auditDir: string): AuditExportSummary["tailAnchor"] {
  const all = readAuditRootAnchors(auditDir);
  if (all.length === 0) {
    return null;
  }
  const latest = all[all.length - 1];
  return {
    date: latest.date,
    rootHash: latest.rootHash,
    timestamp: latest.timestamp,
    eventId: latest.eventId,
  };
}

function computeSummaryHashAlg(events: AuditEventWithIntegrity[]): AuditExportSummary["hashAlg"] {
  let hmac = 0;
  let legacy = 0;
  for (const e of events) {
    if (e.hashAlg === AUDIT_HASH_ALG_HMAC) {
      hmac++;
    } else if (e.eventHash) {
      legacy++;
    }
  }
  if (hmac > 0 && legacy > 0) {
    return "mixed";
  }
  if (hmac > 0) {
    return "hmac-sha256";
  }
  if (legacy > 0) {
    return "legacy";
  }
  return "hmac-sha256";
}

/**
 * 从审计目录或单个审计文件构建摘要（不签名）。
 */
export function buildAuditExportSummary(inputPath: string): AuditExportSummary {
  const events = readAuditEventsFromPath(inputPath);
  const sorted = events.toSorted((a, b) => a.timestamp.localeCompare(b.timestamp));
  const chained = sorted.filter((e) => typeof e.eventHash === "string" && e.eventHash.length > 0);
  const tailEvent = chained.length > 0 ? chained[chained.length - 1] : null;
  let isDirectory = false;
  try {
    isDirectory = fs.statSync(inputPath).isDirectory();
  } catch {
    /* 路径不存在时按文件处理，取 dirname 用于外锚读取（会进一步安全失败）。 */
  }
  const auditDir = isDirectory ? inputPath : path.dirname(inputPath);
  const tailAnchor = latestTailAnchor(auditDir);
  const rootHash = tailEvent?.eventHash ?? tailAnchor?.rootHash ?? "";
  const hashAlg = computeSummaryHashAlg(chained);
  const dateRange: AuditExportDateRange =
    sorted.length > 0
      ? {
          from: sorted[0].timestamp,
          to: sorted[sorted.length - 1].timestamp,
        }
      : {
          from: tailAnchor?.timestamp ?? "",
          to: tailAnchor?.timestamp ?? "",
        };
  return {
    dateRange,
    eventCount: events.length,
    rootHash,
    hashAlg,
    tailAnchor,
  };
}

/**
 * 用 HMAC-SHA256 对摘要签名。密钥缺省时从本机解析（不创建新密钥）。
 */
export function signAuditSummary(
  summary: AuditExportSummary,
  opts?: AuditExportSummaryOptions,
): SignedAuditExportSummary | null {
  const hmacKeyId = opts?.hmacKeyId ?? "audit-chain";
  const key =
    opts?.key !== undefined ? opts.key : (resolveAuditChainKeys({ create: false })[0] ?? null);
  if (!key) {
    return null;
  }
  const payload = canonicalSummaryString(summary);
  const signature = createHmac("sha256", key).update(payload, "utf8").digest("hex");
  return {
    summary: { ...summary, hmacKeyId },
    signature,
    hmacKeyId,
  };
}

/**
 * 验证摘要签名。接受本机任意可用审计链密钥（env / key 文件并存场景）。
 */
export function verifyAuditSummarySignature(
  summary: AuditExportSummary,
  signature: string,
  opts?: { key?: Buffer | null },
): boolean {
  if (!signature) {
    return false;
  }
  const keys =
    opts?.key !== undefined
      ? opts.key
        ? [opts.key]
        : []
      : resolveAuditChainKeys({ create: false });
  if (keys.length === 0) {
    return false;
  }
  const payload = canonicalSummaryString(summary);
  return keys.some(
    (key) => createHmac("sha256", key).update(payload, "utf8").digest("hex") === signature,
  );
}

/**
 * 一键构建并签名摘要。
 */
export function buildSignedAuditExportSummary(
  inputPath: string,
  opts?: AuditExportSummaryOptions,
): { summary: AuditExportSummary; signature?: string; hmacKeyId?: string } {
  const summary = buildAuditExportSummary(inputPath);
  const signed = signAuditSummary(summary, opts);
  if (!signed) {
    return { summary };
  }
  return {
    summary: signed.summary,
    signature: signed.signature,
    hmacKeyId: signed.hmacKeyId,
  };
}

/** 纯文本格式，适合打印存档。 */
export function formatAuditSummaryPlainText(
  summary: AuditExportSummary,
  signature?: string,
): string {
  const lines = [
    "LawMind Audit Summary",
    "=====================",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Period: ${summary.dateRange.from || "n/a"} to ${summary.dateRange.to || "n/a"}`,
    `Events: ${summary.eventCount}`,
    `Root Hash: ${summary.rootHash || "n/a"}`,
    `Hash Algorithm: ${summary.hashAlg}`,
    `Tail Anchor: ${summary.tailAnchor ? `${summary.tailAnchor.date} ${summary.tailAnchor.rootHash}` : "n/a"}`,
  ];
  if (summary.hmacKeyId) {
    lines.push(`HMAC Key ID: ${summary.hmacKeyId}`);
  }
  if (signature) {
    lines.push(`Signature: ${signature}`);
  }
  return lines.join("\n") + "\n";
}

/**
 * 将签名后的摘要写入指定路径。仅支持 file:// 或绝对/相对文件路径。
 */
export function exportAuditSummaryToFile(
  inputPath: string,
  outPath: string,
  opts?: AuditExportSummaryOptions,
): { summary: AuditExportSummary; signature?: string; writtenPath: string } {
  const target = outPath.replace(/^file:\/\/+/, "");
  const { summary, signature } = buildSignedAuditExportSummary(inputPath, opts);
  const body = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    summary,
    signature,
  };
  fs.mkdirSync(path.dirname(path.resolve(target)), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(body, null, 2)}\n`, "utf8");
  return { summary, signature, writtenPath: target };
}

/** 环境变量名：外部锚定 URL。 */
export const AUDIT_EXTERNAL_ANCHOR_URL_ENV = "LAWMIND_AUDIT_EXTERNAL_ANCHOR_URL";

/** 解析外部锚 URL（优先环境变量，允许空字符串表示未配置）。 */
export function resolveExternalAnchorUrl(): string | undefined {
  const raw = process.env[AUDIT_EXTERNAL_ANCHOR_URL_ENV]?.trim();
  return raw || undefined;
}
