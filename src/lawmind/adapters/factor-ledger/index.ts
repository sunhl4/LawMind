import fs from "node:fs";
import path from "node:path";
import { appendJsonl, rewriteJsonl, withExclusiveFileLock } from "../matter-storage/io.js";
import {
  FACTOR_LEDGER_VERSION,
  FactorLedgerRecordSchema,
  type FactorLedgerRecord,
} from "./schema.js";

export type FactorLedgerScope = {
  sessionId?: string;
  matterId?: string;
};

export type FactorLedgerRetentionOptions = {
  /** Keep at most this many valid records; default 10,000. */
  maxRecords?: number;
  /** Keep at most this many UTF-8 bytes; default 25 MiB. */
  maxBytes?: number;
  /** Remove valid records older than this age; default disabled. */
  maxAgeMs?: number;
  /** Lock acquisition timeout; primarily for tests/operations. */
  lockTimeoutMs?: number;
  /** Test clock / operational replay clock. */
  nowMs?: number;
};

export type FactorLedgerCleanupReport = {
  path: string;
  beforeRecords: number;
  afterRecords: number;
  droppedRecords: number;
  beforeBytes: number;
  afterBytes: number;
  reason: "records" | "bytes" | "age" | "none";
};

const DEFAULT_MAX_RECORDS = 10_000;
const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;

export function factorLedgerPath(workspaceDir: string, scope: FactorLedgerScope): string {
  const matterId = scope.matterId?.trim();
  if (matterId) {
    return path.join(workspaceDir, "matters", matterId, "factor-ledger.jsonl");
  }
  const sessionId = scope.sessionId?.trim();
  if (!sessionId) {
    throw new Error("factor ledger scope needs sessionId or matterId");
  }
  return path.join(workspaceDir, "sessions", `${sessionId}.factor-ledger.jsonl`);
}

function factorLedgerLockPath(filePath: string): string {
  return `${filePath}.lock`;
}

function recordBytes(record: FactorLedgerRecord): number {
  return Buffer.byteLength(JSON.stringify(record), "utf8") + 1;
}

export function appendFactorLedgerRecord(
  workspaceDir: string,
  record: FactorLedgerRecord,
): FactorLedgerRecord {
  const parsed = FactorLedgerRecordSchema.parse({
    ...record,
    v: FACTOR_LEDGER_VERSION,
  });
  const filePath = factorLedgerPath(workspaceDir, parsed);
  // Append remains atomic at the line level. Cleanup takes the same lock.
  appendJsonl(filePath, FactorLedgerRecordSchema, parsed);
  return parsed;
}

/**
 * Explicit, operator-invoked cleanup. It never runs from a model turn.
 * The newest valid record is retained even when it alone exceeds maxBytes.
 */
export function cleanupFactorLedger(
  workspaceDir: string,
  scope: FactorLedgerScope,
  options: FactorLedgerRetentionOptions = {},
): FactorLedgerCleanupReport {
  const filePath = factorLedgerPath(workspaceDir, scope);
  const maxRecords = normalizePositive(options.maxRecords, DEFAULT_MAX_RECORDS);
  const maxBytes = normalizePositive(options.maxBytes, DEFAULT_MAX_BYTES);
  const maxAgeMs = normalizePositive(options.maxAgeMs, 0);
  const nowMs = options.nowMs ?? Date.now();
  return withExclusiveFileLock(
    factorLedgerLockPath(filePath),
    () => {
      const beforeRaw = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
      const rows = readRowsUnlocked(filePath);
      let kept = maxAgeMs > 0 ? rows.filter((row) => !isOlderThan(row, nowMs, maxAgeMs)) : rows;
      let reason: FactorLedgerCleanupReport["reason"] = kept.length < rows.length ? "age" : "none";
      if (kept.length > maxRecords) {
        kept = kept.slice(-maxRecords);
        reason = "records";
      }
      let bytes = kept.reduce((sum, row) => sum + recordBytes(row), 0);
      if (bytes > maxBytes && kept.length > 1) {
        const bounded: FactorLedgerRecord[] = [];
        for (let index = kept.length - 1; index >= 0; index -= 1) {
          const row = kept[index];
          if (!row) {
            continue;
          }
          const nextBytes = bytesForRows(bounded) + recordBytes(row);
          if (bounded.length > 0 && nextBytes > maxBytes) {
            break;
          }
          bounded.push(row);
        }
        kept = bounded.toReversed();
        bytes = bytesForRows(kept);
        reason = "bytes";
      }
      if (
        kept.length !== rows.length ||
        Buffer.byteLength(beforeRaw, "utf8") !== bytesForRows(rows)
      ) {
        rewriteJsonl(filePath, FactorLedgerRecordSchema, kept);
      }
      return {
        path: filePath,
        beforeRecords: rows.length,
        afterRecords: kept.length,
        droppedRecords: rows.length - kept.length,
        beforeBytes: Buffer.byteLength(beforeRaw, "utf8"),
        afterBytes: bytes,
        reason,
      };
    },
    { timeoutMs: options.lockTimeoutMs },
  );
}

function normalizePositive(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function isOlderThan(record: FactorLedgerRecord, nowMs: number, maxAgeMs: number): boolean {
  const at = Date.parse(record.at);
  return Number.isFinite(at) && at < nowMs - maxAgeMs;
}

function bytesForRows(rows: readonly FactorLedgerRecord[]): number {
  return rows.reduce((sum, row) => sum + recordBytes(row), 0);
}

function readRowsUnlocked(filePath: string): FactorLedgerRecord[] {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  const out: FactorLedgerRecord[] = [];
  const raw = fs.readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const parsed = safeParseRecord(line);
    if (parsed) {
      out.push(parsed);
    }
  }
  return out;
}

function safeParseRecord(line: string): FactorLedgerRecord | undefined {
  if (!line.trim()) {
    return undefined;
  }
  try {
    const parsed = FactorLedgerRecordSchema.safeParse(JSON.parse(line));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export function readFactorLedgerRecords(
  workspaceDir: string,
  scope: FactorLedgerScope,
  options: { limit?: number } = {},
): FactorLedgerRecord[] {
  const rows = readRowsUnlocked(factorLedgerPath(workspaceDir, scope));
  const limit = options.limit;
  if (limit === undefined || !Number.isFinite(limit) || limit <= 0) {
    return rows;
  }
  return rows.slice(-Math.floor(limit));
}

export { FACTOR_LEDGER_VERSION, FactorLedgerKindSchema } from "./schema.js";
export type { FactorLedgerKind, FactorLedgerRecord } from "./schema.js";
