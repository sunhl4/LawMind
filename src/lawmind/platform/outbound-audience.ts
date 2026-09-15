/**
 * Privilege / destination classifier for outbound mail.
 * Stamp on prepare_outbound_mail; does not send.
 */

import path from "node:path";
import { scanPrivilegeTip, type PrivilegeTip } from "../policy/privilege-sentinel.js";

export type OutboundAudienceKind =
  | "client"
  | "opposing"
  | "court"
  | "public"
  | "internal"
  | "unknown";

export type OutboundAudienceVerdict = {
  kind: OutboundAudienceKind;
  warning?: string;
};

export type OutboundPrivilegeStamp = {
  audience: OutboundAudienceVerdict;
  privilege: PrivilegeTip | null;
  attachmentFlags: string[];
};

const ATTACHMENT_PRIVILEGE_RE = /策略|内部备忘|privileged|工作成果|底线|不得外传|仅供所内/i;

const COURT_RE = /法院|仲裁委|仲裁委员会|@court\.|@court-gov|@sfb\.|检察院/;
const OPPOSING_RE = /对方|对方律师|国浩|金杜|竞对|opposing|@opposing/;
const CLIENT_RE = /客户|委托人|我方|受托人/;
const PUBLIC_RE = /新闻稿|官网|公示|公开信|媒体/;

export function classifyOutboundAudience(input: {
  to: string;
  subject?: string;
  body?: string;
}): OutboundAudienceVerdict {
  const blob = `${input.to}\n${input.subject ?? ""}\n${input.body ?? ""}`;
  if (COURT_RE.test(blob)) {
    return {
      kind: "court",
      warning: "收件人像法院/仲裁机构。核对是否含对内策略或特权材料后再送拍板。",
    };
  }
  if (PUBLIC_RE.test(blob)) {
    return {
      kind: "public",
      warning: "这封信像公开渠道。对内底稿、谈判策略不得进入正文。",
    };
  }
  if (OPPOSING_RE.test(blob)) {
    return {
      kind: "opposing",
      warning: "收件人像对方或对方律师。删除对内策略、报价底线与未确认事实。",
    };
  }
  if (CLIENT_RE.test(blob)) {
    return { kind: "client" };
  }
  if (/内部|所内|同事/.test(blob)) {
    return { kind: "internal" };
  }
  return { kind: "unknown" };
}

export function classifyOutboundPrivilege(input: {
  to: string;
  subject?: string;
  body?: string;
  attachmentPaths?: string[];
}): OutboundPrivilegeStamp {
  const audience = classifyOutboundAudience(input);
  const blob = `${input.subject ?? ""}\n${input.body ?? ""}`;
  const privilege = scanPrivilegeTip(blob);
  const attachmentFlags: string[] = [];
  for (const rel of input.attachmentPaths ?? []) {
    const name = path.basename(rel);
    if (ATTACHMENT_PRIVILEGE_RE.test(name)) {
      attachmentFlags.push(`附件「${name}」文件名像对内策略/特权材料，对外发送前请核对。`);
    }
  }
  return { audience, privilege, attachmentFlags };
}
