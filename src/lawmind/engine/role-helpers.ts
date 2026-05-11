/**
 * 共用 helper：从 TaskIntent 推导 deliverable kind / audience。
 * 抽出来避免 shared.ts 与 drafting.ts 重复实现。
 */

import type { DeliverableKind } from "../core/contracts.js";
import type { TaskIntent } from "../types.js";

export function classifyDeliverableKindFromIntent(intent: TaskIntent): DeliverableKind {
  const text =
    `${intent.summary}\n${intent.kind}\n${intent.deliverableType ?? ""}\n${intent.templateId ?? ""}`.toLowerCase();
  if (text.includes("contract") || text.includes("合同")) {
    return "contract-review";
  }
  if (text.includes("demand") || text.includes("律师函")) {
    return "demand-letter";
  }
  if (text.includes("litigation") || text.includes("诉讼")) {
    return "litigation-outline";
  }
  if (text.includes("brief") || intent.output === "pptx") {
    return "client-brief";
  }
  if (text.includes("timeline") || text.includes("时间线")) {
    return "evidence-timeline";
  }
  if (text.includes("memo") || text.includes("意见")) {
    return "legal-memo";
  }
  return "general-document";
}

export function classifyAudienceFromIntent(
  intent: TaskIntent,
): "internal" | "client" | "counterparty" | "court" | "unknown" {
  const value = intent.audience?.trim().toLowerCase() ?? "";
  if (!value) {
    return "unknown";
  }
  if (value.includes("client") || value.includes("客户")) {
    return "client";
  }
  if (value.includes("court") || value.includes("法院")) {
    return "court";
  }
  if (value.includes("counterparty") || value.includes("对方")) {
    return "counterparty";
  }
  if (value.includes("internal") || value.includes("内部") || value.includes("lawyer")) {
    return "internal";
  }
  return "unknown";
}
