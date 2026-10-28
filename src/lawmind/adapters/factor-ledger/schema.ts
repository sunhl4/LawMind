/**
 * 因子账本落盘契约。
 *
 * 账本只放「观察」，不放律师正文。每条记录带会话、可选案件与回合，
 * payload 由各观察通道自己定义；读侧按 schema 校验，坏行跳过。
 */

import { z } from "zod";

export const FACTOR_LEDGER_VERSION = 1 as const;

export const FactorLedgerKindSchema = z.enum([
  "correction",
  "syndrome",
  "repair",
  "witness",
  "relation",
  "review",
  "summary",
]);
export type FactorLedgerKind = z.infer<typeof FactorLedgerKindSchema>;

export const FactorLedgerRecordSchema = z.object({
  v: z.literal(FACTOR_LEDGER_VERSION),
  at: z.string().min(1),
  kind: FactorLedgerKindSchema,
  sessionId: z.string().min(1),
  turnId: z.string().min(1).optional(),
  matterId: z.string().min(1).optional(),
  payload: z.record(z.string(), z.unknown()),
});
export type FactorLedgerRecord = z.infer<typeof FactorLedgerRecordSchema>;
