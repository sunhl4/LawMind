/**
 * 自动办件派单台账（防重复派单）。
 *
 * 背景（真实事故）：`邮件合同审阅改稿` 每 120 分钟派一次同一份附件；那一件已被
 * 独立审稿门禁停在 `guardian_exhausted`，于是同一份材料被反复重派、反复撞同一道门禁。
 *
 * 规则（Codex 对齐「不要重跑注定失败的同一件事」）：
 * - 派单前按 **matter + 附件相对路径 + 内容指纹** 记账；
 * - 同一指纹上次派单已因门禁停下（`blocked`）→ 不再重复派，只更新交办摘要；
 * - 附件内容变了（指纹变）或律师处置/继续（`clearBlockedDispatch`）→ 立刻恢复派单。
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { withExclusiveFileLock, writeJsonAtomic } from "../adapters/matter-storage/io.js";

const LEDGER_REL = path.join("lawmind", "automation-dispatch-ledger.json");
const MAX_ENTRIES = 200;

export type DispatchLedgerState = "dispatched" | "blocked";

export type DispatchLedgerEntry = {
  /** `<matterId>|<relativePath>|<fingerprint>` */
  key: string;
  matterId: string;
  relativePath: string;
  fingerprint: string;
  state: DispatchLedgerState;
  automationId: string;
  at: string;
  /** 停下来的原因（门禁口径），供交办摘要在律师面说明。 */
  reason?: string;
};

type LedgerFile = { entries: DispatchLedgerEntry[] };

export function dispatchLedgerPath(workspaceDir: string): string {
  return path.join(path.resolve(workspaceDir), LEDGER_REL);
}

export function dispatchFingerprint(workspaceDir: string, relativePath: string): string {
  const rel = relativePath.trim().replace(/\\/g, "/");
  if (!rel) {
    return "";
  }
  const abs = path.resolve(workspaceDir, rel);
  try {
    const stat = fs.statSync(abs);
    const hash = createHash("sha256");
    hash.update(`${stat.size}:${Math.floor(stat.mtimeMs)}`);
    if (stat.size > 0 && stat.size <= 4 * 1024 * 1024) {
      hash.update(fs.readFileSync(abs));
    }
    return hash.digest("hex").slice(0, 16);
  } catch {
    // 文件读不到（尚未同步/已被移动）：只用路径，宁可保守记账。
    return createHash("sha256").update(rel).digest("hex").slice(0, 16);
  }
}

export function dispatchKey(matterId: string, relativePath: string, fingerprint: string): string {
  return `${matterId.trim()}|${relativePath.trim().replace(/\\/g, "/")}|${fingerprint}`;
}

function readLedger(workspaceDir: string): DispatchLedgerEntry[] {
  try {
    const raw = JSON.parse(fs.readFileSync(dispatchLedgerPath(workspaceDir), "utf8")) as LedgerFile;
    if (!Array.isArray(raw.entries)) {
      return [];
    }
    return raw.entries.filter(
      (e): e is DispatchLedgerEntry =>
        Boolean(e) && typeof e.key === "string" && typeof e.fingerprint === "string",
    );
  } catch {
    return [];
  }
}

function writeLedger(workspaceDir: string, entries: DispatchLedgerEntry[]): void {
  const file = dispatchLedgerPath(workspaceDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeJsonAtomic(file, { entries: entries.slice(-MAX_ENTRIES) } satisfies LedgerFile);
}

export function listDispatchLedger(workspaceDir: string): DispatchLedgerEntry[] {
  return readLedger(workspaceDir);
}

export function upsertDispatchEntry(
  workspaceDir: string,
  entry: Omit<DispatchLedgerEntry, "key"> & { key?: string },
): void {
  const key = entry.key ?? dispatchKey(entry.matterId, entry.relativePath, entry.fingerprint);
  const file = dispatchLedgerPath(workspaceDir);
  withExclusiveFileLock(`${file}.lock`, () => {
    const entries = readLedger(workspaceDir).filter((e) => e.key !== key);
    entries.push({ ...entry, key });
    writeLedger(workspaceDir, entries);
  });
}

/** 已因门禁停下、且附件内容未变的派单：命中即不再重复派。 */
export function findBlockedDispatch(
  workspaceDir: string,
  input: { matterId: string; relativePath: string; fingerprint: string },
): DispatchLedgerEntry | undefined {
  const key = dispatchKey(input.matterId, input.relativePath, input.fingerprint);
  return readLedger(workspaceDir).find((e) => e.key === key && e.state === "blocked");
}

/** 门禁停下时记账（幂等）。 */
export function markDispatchBlocked(
  workspaceDir: string,
  input: {
    matterId: string;
    relativePath: string;
    fingerprint?: string;
    automationId?: string;
    reason: string;
    at?: string;
  },
): boolean {
  const fingerprint = input.fingerprint ?? dispatchFingerprint(workspaceDir, input.relativePath);
  const key = dispatchKey(input.matterId, input.relativePath, fingerprint);
  const existing = readLedger(workspaceDir).find((e) => e.key === key);
  if (existing?.state === "blocked") {
    return false;
  }
  upsertDispatchEntry(workspaceDir, {
    matterId: input.matterId,
    relativePath: input.relativePath,
    fingerprint,
    state: "blocked",
    automationId: input.automationId ?? existing?.automationId ?? "",
    reason: input.reason.slice(0, 500),
    at: input.at ?? new Date().toISOString(),
  });
  return true;
}

/** 律师处置/继续、或换了材料：解除拦截。 */
export function clearBlockedDispatch(
  workspaceDir: string,
  input: { matterId: string; relativePath: string },
): number {
  const matterId = input.matterId.trim();
  const rel = input.relativePath.trim().replace(/\\/g, "/");
  const file = dispatchLedgerPath(workspaceDir);
  let cleared = 0;
  withExclusiveFileLock(`${file}.lock`, () => {
    const entries = readLedger(workspaceDir).filter((e) => {
      const match = e.matterId === matterId && e.relativePath === rel && e.state === "blocked";
      if (match) {
        cleared += 1;
      }
      return !match;
    });
    if (cleared > 0) {
      writeLedger(workspaceDir, entries);
    }
  });
  return cleared;
}

/** 派单摘要里给律师的说明。 */
export function formatBlockedDispatchNote(entry: DispatchLedgerEntry): string {
  return [
    "同一份材料上次已被门禁停下，本次不再重复派单（避免反复撞同一道门禁）：",
    `- 基线：\`${entry.relativePath}\``,
    entry.reason ? `- 上次停因：${entry.reason}` : "",
    "",
    "材料内容有更新、或已在对话里让我继续本件后，会自动恢复派单。",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * 从工单指令里解析改稿基线路径（邮件短路径 / Word 改稿 / 协作派单共用同一批措辞）。
 */
export function baselinePathFromInstruction(instruction: string | undefined): string {
  const text = instruction?.trim() ?? "";
  if (!text) {
    return "";
  }
  const patterns = [
    /contract_edit_baseline_path\s*=\s*`([^`]+)`/,
    /默认\s*Word\s*基线[：:]\s*`([^`]+)`/,
    /默认分析附件[：:]\s*`([^`]+)`/,
  ];
  for (const re of patterns) {
    const m = re.exec(text);
    const hit = m?.[1]?.trim();
    if (hit) {
      return hit.replace(/\\/g, "/");
    }
  }
  return "";
}

/**
 * 轮次收尾挂钩：门禁停下 → 记账拦截；正常收口 → 解除拦截。
 * 只按指令里点名的基线路径记账；没点名就什么都不做（不猜）。
 */
export function syncDispatchLedgerForTurn(params: {
  workspaceDir: string;
  matterId?: string;
  instruction?: string;
  gateStop: boolean;
  reason?: string;
  at?: string;
}): void {
  const matterId = params.matterId?.trim();
  const relativePath = baselinePathFromInstruction(params.instruction);
  if (!matterId || !relativePath) {
    return;
  }
  try {
    if (params.gateStop) {
      markDispatchBlocked(params.workspaceDir, {
        matterId,
        relativePath,
        reason: params.reason ?? "门禁把本件停下",
        ...(params.at ? { at: params.at } : {}),
      });
      return;
    }
    clearBlockedDispatch(params.workspaceDir, { matterId, relativePath });
  } catch {
    /* 台账是防重派的尽力而为，不影响对话结果 */
  }
}
