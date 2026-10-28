/**
 * 外发批准绑定：批准的是「这一版」邮件，不是「这个工具」。
 *
 * 签批前律师核对的是收件人、主题、正文与附件内容。若签批后附件被重新导出、
 * 正文在文书台又改过，而发送仍按旧批准放行，等于批准的内容与实际外发的内容
 * 不是同一份。这里在排队时把四样东西绑定成指纹，发送前逐项复核。
 *
 * 只做本地可判定的事：
 *   - 收件人（归一化后比较）
 *   - 主题与正文的稳定哈希
 *   - 每个附件的完整内容版本（大小 + mtime + 全字节 sha256）
 * 不判断内容是否合法，也不替代律师复核。
 */

import { createHash } from "node:crypto";
import path from "node:path";
import { fileVersionOf } from "../runtime/file-version.js";
import { normalizeOutboundRecipient } from "./lawyer-outbound-decision.js";

export type OutboundAttachmentBinding = {
  /** 工作区相对路径。 */
  path: string;
  /** `fileVersionOf` 的结果；`null` 表示排队时文件已不存在，发送前必须重新确认。 */
  version: string | null;
};

/** 整包交付绑定：批准的是这一版包，而不是邮件里碰巧带上的附件。 */
export type OutboundPacketBinding = {
  packetId: string;
  packetHash: string;
};

export type OutboundBinding = {
  to: string;
  subjectHash: string;
  bodyHash: string;
  attachments: OutboundAttachmentBinding[];
  /** 有值表示本次外发绑定的是整个 `DeliveryPacket`。 */
  packet?: OutboundPacketBinding;
  boundAt: string;
};

export type BindableMail = {
  to: string;
  subject: string;
  body: string;
  attachmentRelativePaths?: string[];
  /** `buildPacketManifest()` 的 packetId / packetHash。 */
  packet?: OutboundPacketBinding;
};

function normalizeRel(raw: string): string {
  return raw.trim().replace(/\\/g, "/").replace(/^\.\//, "");
}

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

function absOf(workspaceDir: string, rel: string): string {
  return path.resolve(workspaceDir, normalizeRel(rel));
}

/** 排队/待批准时调用：把当前这一版邮件钉成指纹。 */
export function buildOutboundBinding(workspaceDir: string, mail: BindableMail): OutboundBinding {
  const attachments = (mail.attachmentRelativePaths ?? [])
    .map(normalizeRel)
    .filter(Boolean)
    .toSorted()
    .map((rel) => ({
      path: rel,
      version: fileVersionOf(absOf(workspaceDir, rel)) ?? null,
    }));
  return {
    to: normalizeOutboundRecipient(mail.to),
    subjectHash: hashText(mail.subject.trim()),
    bodyHash: hashText(mail.body),
    attachments,
    ...(mail.packet
      ? { packet: { packetId: mail.packet.packetId, packetHash: mail.packet.packetHash } }
      : {}),
    boundAt: new Date().toISOString(),
  };
}

function versionNow(workspaceDir: string, rel: string): string | null {
  return fileVersionOf(absOf(workspaceDir, rel)) ?? null;
}

/**
 * 发送前复核。返回律师可读的问题清单；空数组表示仍是批准的那一版。
 * 调用方应在问题非空时**拒绝发送**，而不是带警告照发。
 */
export function outboundBindingProblems(
  workspaceDir: string,
  binding: OutboundBinding,
  mail: BindableMail,
): string[] {
  const problems: string[] = [];
  const toNow = normalizeOutboundRecipient(mail.to);
  if (toNow !== binding.to) {
    problems.push(`收件人已从「${binding.to}」改为「${toNow}」，批准的是原收件人。`);
  }
  if (hashText(mail.subject.trim()) !== binding.subjectHash) {
    problems.push("主题在签批后被改过。");
  }
  if (hashText(mail.body) !== binding.bodyHash) {
    problems.push("正文在签批后被改过。");
  }

  const boundPacket = binding.packet;
  const nowPacket = mail.packet;
  if (boundPacket && !nowPacket) {
    problems.push("批准时绑定的是整个交付包，本次发送没有提供包信息。");
  } else if (!boundPacket && nowPacket) {
    problems.push("本次发送是交付包，但批准时只核对了邮件字段。");
  } else if (boundPacket && nowPacket) {
    if (boundPacket.packetId !== nowPacket.packetId) {
      problems.push(`交付包已从「${boundPacket.packetId}」换成「${nowPacket.packetId}」。`);
    }
    if (boundPacket.packetHash !== nowPacket.packetHash) {
      problems.push("交付包的文件、顺序、封面或受众在签批后变了。");
    }
  }

  const bound = new Map(binding.attachments.map((row) => [row.path, row.version] as const));
  const nowPaths = (mail.attachmentRelativePaths ?? [])
    .map(normalizeRel)
    .filter(Boolean)
    .toSorted();
  for (const rel of nowPaths) {
    if (!bound.has(rel)) {
      problems.push(`新增了批准时没有的附件：${rel}。`);
      continue;
    }
    if (bound.get(rel) !== versionNow(workspaceDir, rel)) {
      problems.push(`附件「${rel}」在签批后内容变了（可能重新导出过）。`);
    }
  }
  for (const rel of bound.keys()) {
    if (!nowPaths.includes(rel)) {
      problems.push(`批准时的附件「${rel}」已不在本次发送清单里。`);
    }
  }
  return problems;
}

/** 律师面摘要：批准绑定了什么，以及什么变化需要重新批准。 */
export function outboundBindingSummary(binding: OutboundBinding): string {
  const files = binding.attachments
    .map((row) => `${row.path}${row.version === null ? "（排队时不存在）" : ""}`)
    .join("、");
  return [
    `收件人：${binding.to}`,
    files ? `附件：${files}` : "附件：（无）",
    ...(binding.packet
      ? [`交付包：${binding.packet.packetId}（指纹 ${binding.packet.packetHash.slice(0, 8)}）`]
      : []),
    "签批后若收件人、主题、正文、附件内容或交付包有任何变化，需要重新批准。",
  ].join("\n");
}
