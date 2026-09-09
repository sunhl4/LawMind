/**
 * 审计外部锚验证工具。
 *
 * 律师 / 运维可拿外部保存的摘要与本机审计链比对：
 *   - 摘要签名是否有效（防止外部摘要被伪造）
 *   - HMAC 链是否连续（防止链文件被篡改）
 *   - 链尾 root hash 是否与外部摘要一致（防止链尾部被截断或外部锚过旧）
 *
 * 输出律师友好的中文报告，状态：通过 / 截断 / 篡改 / 签名无效。
 */

import {
  buildAuditExportSummary,
  readAuditEventsFromPath,
  verifyAuditSummarySignature,
  type AuditExportSummary,
} from "./export-summary.js";
import { createExternalAnchorUploader } from "./external-anchor.js";
import { summarizeAuditIntegrity, type AuditIntegritySummary } from "./hash-chain.js";

export type AuditExternalVerifyStatus =
  | "ok"
  | "truncated"
  | "tampered"
  | "signature_invalid"
  | "key_unavailable"
  | "external_missing";

export type AuditExternalVerifyResult = {
  status: AuditExternalVerifyStatus;
  ok: boolean;
  /** 律师友好的简短结论。 */
  detail: string;
  /** 链完整性统计。 */
  chain: AuditIntegritySummary;
  /** 外部锚摘要（读取成功时）。 */
  externalSummary?: AuditExportSummary;
  /** 外部锚签名（读取成功时）。 */
  externalSignature?: string;
  /** 链尾 root hash（当前链计算）。 */
  chainRootHash: string;
  /** 读取或验证外部锚时的错误信息。 */
  error?: string;
};

export type VerifyExternalAnchorOptions = {
  /** 显式指定验证密钥；缺省从本机解析。 */
  key?: Buffer | null;
};

function statusDetail(status: AuditExternalVerifyStatus, extra?: string): string {
  switch (status) {
    case "ok":
      return "审计链与外部锚一致，未被篡改或截断。";
    case "truncated":
      return (
        "链尾 root hash 与外部锚不一致，疑似审计链被截断或外部锚过旧。" + (extra ? ` ${extra}` : "")
      );
    case "tampered":
      return "审计链 HMAC 校验失败，链文件可能被篡改。" + (extra ? ` ${extra}` : "");
    case "key_unavailable":
      return "缺少审计链 HMAC 密钥，无法验证签名链。请确认密钥未丢失。";
    case "signature_invalid":
      return "外部摘要签名无效，外部锚可能被伪造或密钥已轮换。" + (extra ? ` ${extra}` : "");
    case "external_missing":
      return "无法读取外部锚，文件或 URL 不存在或网络失败。" + (extra ? ` ${extra}` : "");
    default:
      return "未知状态。";
  }
}

/**
 * 验证审计链与外部锚是否一致。
 *
 * @param inputPath 审计目录或单个 jsonl 文件。
 * @param externalUrl 外部锚位置（file:// 或 http(s) URL）。
 */
export async function verifyExternalAuditAnchor(
  inputPath: string,
  externalUrl: string,
  opts?: VerifyExternalAnchorOptions,
): Promise<AuditExternalVerifyResult> {
  const events = readAuditEventsFromPath(inputPath);
  const chain = summarizeAuditIntegrity(events, opts);
  const localSummary = buildAuditExportSummary(inputPath);
  const chainRootHash = localSummary.rootHash;

  let externalSummary: AuditExportSummary | undefined;
  let externalSignature: string | undefined;
  let externalReadError: string | undefined;

  try {
    const uploader = createExternalAnchorUploader(externalUrl);
    const read = await uploader.read();
    if (!read) {
      externalReadError = "external_anchor_empty";
    } else {
      externalSummary = read.summary;
      externalSignature = read.signature;
    }
  } catch (err) {
    externalReadError = err instanceof Error ? err.message : String(err);
  }

  if (externalReadError) {
    return {
      status: "external_missing",
      ok: false,
      detail: statusDetail("external_missing", externalReadError),
      chain,
      chainRootHash,
      error: externalReadError,
    };
  }

  if (!externalSignature) {
    return {
      status: "signature_invalid",
      ok: false,
      detail: statusDetail("signature_invalid", "外部锚缺少签名"),
      chain,
      externalSummary,
      externalSignature,
      chainRootHash,
    };
  }

  if (!verifyAuditSummarySignature(externalSummary!, externalSignature, opts)) {
    return {
      status: "signature_invalid",
      ok: false,
      detail: statusDetail("signature_invalid"),
      chain,
      externalSummary,
      externalSignature,
      chainRootHash,
    };
  }

  if (!chain.ok) {
    if (chain.reason === "key_unavailable") {
      return {
        status: "key_unavailable",
        ok: false,
        detail: statusDetail("key_unavailable"),
        chain,
        externalSummary,
        externalSignature,
        chainRootHash,
      };
    }
    return {
      status: "tampered",
      ok: false,
      detail: statusDetail("tampered", `断点 @${chain.brokenAt}`),
      chain,
      externalSummary,
      externalSignature,
      chainRootHash,
    };
  }

  if (externalSummary!.rootHash !== chainRootHash) {
    return {
      status: "truncated",
      ok: false,
      detail: statusDetail(
        "truncated",
        `链尾 ${chainRootHash.slice(0, 16)}… 外部 ${externalSummary!.rootHash.slice(0, 16)}…`,
      ),
      chain,
      externalSummary,
      externalSignature,
      chainRootHash,
    };
  }

  return {
    status: "ok",
    ok: true,
    detail: statusDetail("ok"),
    chain,
    externalSummary,
    externalSignature,
    chainRootHash,
  };
}

/**
 * 格式化为律师友好的验证报告。
 */
export function formatAuditExternalVerifyReport(result: AuditExternalVerifyResult): string {
  const lines = [
    "LawMind 审计链外部锚验证报告",
    "==============================",
    "",
    `结论：${result.ok ? "通过" : "未通过"}`,
    `状态：${result.status}`,
    `说明：${result.detail}`,
    "",
    "链统计",
    `  事件数：${result.chain.eventCount}`,
    `  链上事件：${result.chain.chainedCount}`,
    `  HMAC 事件：${result.chain.hmacCount}`,
    `  Legacy 事件：${result.chain.legacyCount}`,
    `  密钥可用：${result.chain.keyAvailable ? "是" : "否"}`,
    `  链尾 root hash：${result.chainRootHash || "n/a"}`,
  ];
  if (result.externalSummary) {
    lines.push(
      "",
      "外部锚摘要",
      `  时间范围：${result.externalSummary.dateRange.from || "n/a"} 至 ${result.externalSummary.dateRange.to || "n/a"}`,
      `  事件数：${result.externalSummary.eventCount}`,
      `  root hash：${result.externalSummary.rootHash || "n/a"}`,
      `  算法：${result.externalSummary.hashAlg}`,
      `  签名：${result.externalSignature ? `${result.externalSignature.slice(0, 16)}…` : "无"}`,
    );
  }
  if (result.error) {
    lines.push("", `错误：${result.error}`);
  }
  return lines.join("\n") + "\n";
}
