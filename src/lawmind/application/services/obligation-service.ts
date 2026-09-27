/**
 * 义务记录。真相源：`workspace/matters/<matterId>/obligations.jsonl`。
 * 金额保留原文。只有纯数字（可带「元」和小数）才记成分，读不出不拒绝这条。
 */

import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  appendObligation,
  readObligations,
  type ObligationRecord,
} from "../../adapters/matter-storage/index.js";
import { matterDir, withExclusiveFileLock } from "../../adapters/matter-storage/io.js";
import { createMatterIfMissing } from "./matter-write-service.js";

export type RecordObligationInput = {
  matterId: string;
  title: string;
  obligor?: string;
  amountText?: string;
  dueAt?: string;
  deadlineId?: string;
  sourceQuote?: string;
};

/** 元以下的整数分。约数、万元、带说明的句子返回 undefined。 */
export function amountMinorFromText(text: string | undefined): number | undefined {
  if (!text?.trim()) {
    return undefined;
  }
  const compact = text.trim().replace(/[,，\s]/g, "");
  const matched = /^(\d+)(?:\.(\d{1,2}))?元?$/.exec(compact);
  if (!matched) {
    return undefined;
  }
  const yuan = Number(matched[1]);
  const fenDigits = matched[2] ?? "";
  const fen = fenDigits ? Number(fenDigits.padEnd(2, "0")) : 0;
  if (!Number.isSafeInteger(yuan) || yuan > 1_000_000_000_000) {
    return undefined;
  }
  return yuan * 100 + fen;
}

export function listObligationsForMatter(
  workspaceDir: string,
  matterId: string,
): ObligationRecord[] {
  return readObligations(workspaceDir, matterId);
}

export function recordObligation(
  workspaceDir: string,
  input: RecordObligationInput,
): ObligationRecord {
  createMatterIfMissing(workspaceDir, { matterId: input.matterId });
  const now = new Date().toISOString();
  const amountText = input.amountText?.trim();
  const amountMinor = amountMinorFromText(amountText);
  const lockPath = path.join(matterDir(workspaceDir, input.matterId), "obligations.jsonl.lock");
  return withExclusiveFileLock(lockPath, () => {
    const record: ObligationRecord = {
      obligationId: randomUUID(),
      matterId: input.matterId,
      title: input.title.trim(),
      status: "open",
      createdAt: now,
      updatedAt: now,
      ...(input.obligor?.trim() ? { obligor: input.obligor.trim() } : {}),
      ...(amountText ? { amountText } : {}),
      ...(amountMinor !== undefined ? { amountMinor } : {}),
      ...(input.dueAt?.trim() ? { dueAt: input.dueAt.trim() } : {}),
      ...(input.deadlineId?.trim() ? { deadlineId: input.deadlineId.trim() } : {}),
      ...(input.sourceQuote?.trim() ? { sourceQuote: input.sourceQuote.trim() } : {}),
    };
    appendObligation(workspaceDir, record);
    return record;
  });
}
