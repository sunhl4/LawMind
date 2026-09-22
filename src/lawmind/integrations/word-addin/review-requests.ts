/**
 * Word 就地审查请求（Word 插件 ⇄ 桌面端，全部走 127.0.0.1）。
 *
 * 形态：插件在 Word 里「审这份」→ 本地 API 建一条请求 → **桌面端自动取件并运行**
 * （同一套 `apply_surgical_edits` → `render_tracked_draft`；`wordAddinAutoRun` 关闭时才退回人工档）
 * → 回填带修订轨的产物路径与就地锚点 → 插件按锚点在 Word 里落成原生修订轨（改这份），
 * 或直接打开产物（导出）。
 *
 * 三条不许破的线：
 * - 只落本机：请求存 `workspace/lawmind/word-addin/reviews.json`，sourcePath 是律师本机路径，
 *   不涉任何远程控制面。
 * - 无插件零影响：桌面端不读这个文件也不会变行为（纯旁路）。
 * - 只有**最短锚点**能变成 Word 就地修改：整节重写（section 粒度）不上插件，
 *   如实计成 `skippedSectionHunks`，让律师回桌面看。
 *
 * 自动取件不是「绕过审批」：本仓库真正会打断律师的只有 `send_email`
 * （`toolRequiresLawyerPause`），改稿链本就无需二次点击。Word 里那次点击**就是**授权动作，
 * 由 `claimWordAddinReviewForRun` 写成 `authorization` 留痕（谁/哪个文件/什么内容/什么时候）。
 */

import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "../../adapters/matter-storage/io.js";
import {
  computeMinimalEditSpans,
  expressInsertAsAnchorReplace,
  insertPointInAfterText,
} from "../../drafts/minimal-edit-script.js";
import type { RedlineHunk } from "../../drafts/redline-proposal.js";

export const WORD_ADDIN_STORE_REL = path.join("lawmind", "word-addin", "reviews.json");
/** 最多保留多少条历史（防长期使用后文件无限增长）。 */
export const WORD_ADDIN_MAX_REQUESTS = 200;

/**
 * `queued` 之后由桌面端**自动取件**（`wordAddinAutoRun` 开启时），不再要求律师回桌面端点一次：
 * `queued → running → ready|failed`。三个新终态都是「如实回报、不猜」：
 * - `needs_matter`：路径无法唯一对到案卷，等 Word 任务窗格选定后重新入队；
 * - `stale`：点击到取件之间文件已被改动，拒绝用旧基线跑，请重新点「审这份」；
 * - `superseded`：同一文件同一指令的重复点击，已被更新的那条取代（不重复花钱）。
 */
export type WordAddinReviewState =
  | "queued"
  | "running"
  | "ready"
  | "failed"
  | "needs_matter"
  | "stale"
  | "superseded";

/** 仍在推进、插件需要继续轮询的状态。 */
export const WORD_ADDIN_ACTIVE_STATES: ReadonlyArray<WordAddinReviewState> = ["queued", "running"];

export function isWordAddinActiveState(state: WordAddinReviewState): boolean {
  return WORD_ADDIN_ACTIVE_STATES.includes(state);
}

/**
 * 可以安全折叠的重复请求状态：只有**还没开跑**的 `queued`。
 *
 * `running` 必须排除：那一笔的模型开销已经花掉了，它的结果必须回到律师手上。
 * 折叠它等于「钱花了、结果丢了、再花一次」，比不折叠更糟。
 */
export function isWordAddinFoldableDuplicate(state: WordAddinReviewState): boolean {
  return state === "queued";
}

/** 律师已授权这次自动运行：留痕（谁、哪个文件、什么内容、什么时候）而不是二次点击。 */
export type WordAddinRunAuthorization = {
  at: string;
  actorId: string;
  /**
   * 本次取件的**来源客户端**（本机 API 的已认证身份，通常是 `word-addin`）。
   *
   * 为什么要和 `actorId` 并列：`actorId` 回答「是谁」（律师），clientId 回答
   * 「从哪来」（Word 插件 / 桌面端）。改造前两者被压成同一个字段 —— 律师在 Word 里
   * 改的稿与在桌面端点出来的操作，审计上无法区分。这是本机 API 引入客户端身份的直接收益。
   */
  clientId: string;
  /** 律师本机文件绝对路径。 */
  sourcePath: string;
  /** 取件时重算的内容指纹：与请求登记时一致才允许跑（防旧基线）。 */
  sourceHash: string;
  /** 本次运行被授予读写的本机目录（= 源文件所在目录，仅本次运行）。 */
  grantedDir: string;
  matterId: string;
  instruction: string;
};

/** Word 原生修订轨的一处落改：最短锚点 + 替换文本。 */
export type WordAddinHunk = {
  find: string;
  replace: string;
  note?: string;
};

export type WordAddinReviewRequest = {
  id: string;
  createdAt: string;
  updatedAt: string;
  state: WordAddinReviewState;
  /**
   * 登记这条请求的客户端身份（本机 API 已认证身份）。取件时原样抄进授权留痕，
   * 所以「谁从哪儿点的」在审计里始终成对出现。
   */
  clientId?: string;
  /** 律师本机上的 Word 文件绝对路径。 */
  sourcePath: string;
  fileName: string;
  matterId?: string;
  instruction: string;
  origin: "word-addin";
  /** 登记时的内容指纹（前 256 KiB + 字节数）。取件时比对，不一致就转 stale。 */
  sourceHash?: string;
  sourceSize?: number;
  sourceMtimeMs?: number;
  /** 桌面端自动取件：本次运行的工作流任务号。 */
  jobId?: string;
  /** 律师点击即授权：取件时写入，审计可见。 */
  authorization?: WordAddinRunAuthorization;
  /** `needs_matter`：路径对不唯一时给 Word 窗格的候选案卷。 */
  matterCandidates?: string[];
  /** `superseded`：取代本条的更新请求 id。 */
  supersededBy?: string;
  /** 给律师的一行说明（needs_matter / stale / failed 都写这里）。 */
  note?: string;
  /** 桌面端回填：带修订轨的产物路径（通常与源文件同目录）。 */
  outputPath?: string;
  /** 桌面端回填：可变成 Word 修订轨的最短锚点。 */
  hunks?: WordAddinHunk[];
  /** 桌面端回填：整节重写等无法就地落改的 hunk 数（如实告知）。 */
  skippedSectionHunks?: number;
  summary?: string;
  error?: string;
};

type StoreFile = {
  version: 1;
  requests: WordAddinReviewRequest[];
};

function storePath(workspaceDir: string): string {
  return path.join(path.resolve(workspaceDir), WORD_ADDIN_STORE_REL);
}

function readStore(workspaceDir: string): StoreFile {
  try {
    const raw = JSON.parse(fs.readFileSync(storePath(workspaceDir), "utf8")) as StoreFile;
    if (!raw || !Array.isArray(raw.requests)) {
      return { version: 1, requests: [] };
    }
    return { version: 1, requests: raw.requests.filter((r) => r && typeof r.id === "string") };
  } catch {
    return { version: 1, requests: [] };
  }
}

function writeStore(workspaceDir: string, store: StoreFile): void {
  const target = storePath(workspaceDir);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  writeJsonAtomic(target, {
    version: 1,
    requests: store.requests.slice(0, WORD_ADDIN_MAX_REQUESTS),
  });
}

const WORD_EXTS = new Set([".docx", ".doc", ".docm"]);

/** 校验插件传来的本机路径：必须是 Word 文件，且不得含上跳段。 */
export function normalizeWordSourcePath(
  raw: unknown,
): { ok: true; abs: string } | { ok: false; error: string } {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) {
    return { ok: false, error: "缺少 Word 文件路径（未保存的文档没有路径，请先另存为 .docx）。" };
  }
  if (value.includes("\0") || value.split(/[/\\]/).includes("..")) {
    return { ok: false, error: "Word 文件路径非法。" };
  }
  if (!path.isAbsolute(value)) {
    return { ok: false, error: "Word 文件路径必须是绝对路径。" };
  }
  if (!WORD_EXTS.has(path.extname(value).toLowerCase())) {
    return { ok: false, error: "只支持 .docx / .doc / .docm 文档。" };
  }
  return { ok: true, abs: path.normalize(value) };
}

/** 内容指纹取样上限：只读前 256 KiB，避免大文件在登记请求时同步卡住。 */
const WORD_ADDIN_FINGERPRINT_BYTES = 256 * 1024;

export type WordFileFingerprint = {
  hash: string;
  size: number;
  mtimeMs: number;
};

/**
 * 轻量指纹：文件头 (≤256 KiB) + 总字节数 → sha256。
 * 只用来回答「取件时这份文件还是律师点击时那一版吗」，不是内容寻址。
 */
export function fingerprintWordFile(abs: string): WordFileFingerprint | undefined {
  try {
    const stat = fs.statSync(abs);
    if (!stat.isFile()) {
      return undefined;
    }
    const fd = fs.openSync(abs, "r");
    let head: Buffer;
    try {
      const len = Math.min(stat.size, WORD_ADDIN_FINGERPRINT_BYTES);
      head = Buffer.alloc(len);
      if (len > 0) {
        fs.readSync(fd, head, 0, len, 0);
      }
    } finally {
      fs.closeSync(fd);
    }
    const hash = createHash("sha256")
      .update(String(stat.size))
      .update("\0")
      .update(head)
      .digest("hex");
    return { hash, size: stat.size, mtimeMs: stat.mtimeMs };
  } catch {
    return undefined;
  }
}

/** 同一文件同一指令在这个窗口内的重复点击视为「同一次」，不重复花钱。 */
export const WORD_ADDIN_DEDUPE_WINDOW_MS = 10 * 60 * 1000;

function sameSourcePath(a: string, b: string): boolean {
  return path.normalize(a).toLowerCase() === path.normalize(b).toLowerCase();
}

/**
 * 这次点击是否可以直接复用一条在途请求。
 *
 * 为什么需要：桌面端起服时插件 POST 后会立刻 wake 取件，所以「连点两次」的真实时序是
 * POST#1 → 立刻被领成 `running` → POST#2 到达。此时旧规则（只折叠 `queued`）不会折掉
 * POST#1，于是两条各跑一遍 → **同一份文件、同一条指令、花两次模型钱**
 * （真机实测复现）。正确语义不是「折叠掉一条」，而是「这次点击幂等」：
 * 直接把它接到已经在跑的那条上，律师拿到同一个 id 继续轮询。
 *
 * 三个条件缺一不可，否则会错接：
 * - 同文件 + 同指令 + **同内容指纹**（改了文件再点 = 真的要重新审，不能复用旧基线）；
 * - 在途（`queued` / `running`）——已失败/已作废的不算；
 * - 在去重窗口内（律师隔天再点同一份文件应重新开一次，而不是接上一次的旧结果）。
 */
export function findReusableWordAddinReview(
  workspaceDir: string,
  input: { sourcePath: string; instruction: string; sourceHash: string },
  nowMs = Date.now(),
  windowMs = WORD_ADDIN_DEDUPE_WINDOW_MS,
): WordAddinReviewRequest | undefined {
  const store = readStore(workspaceDir);
  const hit = store.requests
    .filter(
      (row) =>
        isWordAddinActiveState(row.state) &&
        sameSourcePath(row.sourcePath, input.sourcePath) &&
        row.instruction.trim() === input.instruction.trim() &&
        Boolean(input.sourceHash) &&
        row.sourceHash === input.sourceHash,
    )
    .filter((row) => {
      const age = nowMs - Date.parse(row.createdAt);
      return Number.isFinite(age) && age <= windowMs;
    })
    // 最新的那条：接最近一次点击，语义最直观。
    .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt));
  return hit[0];
}

/**
 * 新请求入队时把**还没开跑**的同文件同指令旧请求标成 `superseded`。
 * 真机实测律师会连点「审这份」；不折叠就是 N 倍模型开销。
 *
 * 刻意**不动 `running`**：那一笔已经付过钱了，它的结果必须回到律师手上。
 * 折叠它等于「钱花了、结果丢了，还要再花一次」——比不折叠更糟。
 * （在途请求的重复点击由 `findReusableWordAddinReview` 直接复用解决。）
 */
export function supersedeOlderWordAddinReviews(
  workspaceDir: string,
  request: WordAddinReviewRequest,
  nowMs = Date.now(),
  windowMs = WORD_ADDIN_DEDUPE_WINDOW_MS,
): string[] {
  const store = readStore(workspaceDir);
  const superseded: string[] = [];
  let changed = false;
  for (const row of store.requests) {
    if (row.id === request.id || !sameSourcePath(row.sourcePath, request.sourcePath)) {
      continue;
    }
    if (!isWordAddinFoldableDuplicate(row.state)) {
      continue;
    }
    if (row.instruction.trim() !== request.instruction.trim()) {
      continue;
    }
    const age = nowMs - Date.parse(row.createdAt);
    if (!Number.isFinite(age) || age > windowMs) {
      continue;
    }
    row.state = "superseded";
    row.supersededBy = request.id;
    row.note = `已被更新的同文件请求 ${request.id} 取代（重复点击不重复审查）。`;
    row.updatedAt = new Date(nowMs).toISOString();
    superseded.push(row.id);
    changed = true;
  }
  if (changed) {
    writeStore(workspaceDir, store);
  }
  return superseded;
}

/**
 * 原子取件：把 `queued` 改成 `running` 并写入授权留痕。
 * 已在 running 的返回失败（另一个 tick 已领走），避免同一请求跑两遍。
 *
 * 授权留痕由调用方用 `buildWordAddinRunAuthorization` 造好再传进来：这样
 * 「谁/哪个文件/什么内容/哪个目录」只有一处定义，测的也就是写盘的那一份。
 */
export function claimWordAddinReviewForRun(params: {
  workspaceDir: string;
  id: string;
  authorization: WordAddinRunAuthorization;
  /** 取件时重算的指纹；与登记时不一致就不许跑。 */
  fingerprint?: WordFileFingerprint;
  at?: Date;
}): { ok: true; request: WordAddinReviewRequest } | { ok: false; reason: string } {
  const store = readStore(params.workspaceDir);
  const idx = store.requests.findIndex((r) => r.id === params.id);
  if (idx < 0) {
    return { ok: false, reason: "not_found" };
  }
  const row = store.requests[idx];
  if (row.state !== "queued") {
    return { ok: false, reason: `not_queued:${row.state}` };
  }
  const at = (params.at ?? new Date()).toISOString();
  const fp = params.fingerprint;
  if (row.sourceHash && fp && row.sourceHash !== fp.hash) {
    store.requests[idx] = {
      ...row,
      state: "stale",
      updatedAt: at,
      note: "这份 Word 在你点「审这份」之后已被改动。为免用旧基线出稿，请重新点一次「审这份」。",
    };
    writeStore(params.workspaceDir, store);
    return { ok: false, reason: "stale" };
  }
  const next: WordAddinReviewRequest = {
    ...row,
    state: "running",
    updatedAt: at,
    ...(params.authorization.matterId ? { matterId: params.authorization.matterId } : {}),
    authorization: params.authorization,
  };
  if (fp) {
    next.sourceHash = fp.hash;
    next.sourceSize = fp.size;
    next.sourceMtimeMs = fp.mtimeMs;
  }
  delete next.note;
  store.requests[idx] = next;
  writeStore(params.workspaceDir, store);
  return { ok: true, request: next };
}

/**
 * 取件时折叠同文件同指令的其它**还没开跑**的请求。
 *
 * 为什么要在取件时也做一次：创建时折叠只看「新建那一刻」的在途请求；
 * 升级前就躺在队列里的重复行（真机实测点过 5 次）、或创建窗口之外的老请求，
 * 都会各跑一遍。取件时既然已确定要跑「这份文件 + 这条指令」，
 * 同口径的其它 `queued` 就应该共用这一次结果，而不是排队再烧一遍模型。
 *
 * 同样**不动 `running`**：已在跑的请求结果照常回填，不因后来者被丢弃。
 */
export function supersedeSiblingWordAddinReviews(
  workspaceDir: string,
  running: WordAddinReviewRequest,
  nowMs = Date.now(),
): string[] {
  const store = readStore(workspaceDir);
  const superseded: string[] = [];
  let changed = false;
  for (const row of store.requests) {
    if (row.id === running.id || !isWordAddinFoldableDuplicate(row.state)) {
      continue;
    }
    if (!sameSourcePath(row.sourcePath, running.sourcePath)) {
      continue;
    }
    if (row.instruction.trim() !== running.instruction.trim()) {
      continue;
    }
    row.state = "superseded";
    row.supersededBy = running.id;
    row.note = `与正在跑的请求 ${running.id} 同文件同指令，共用这一次结果。`;
    row.updatedAt = new Date(nowMs).toISOString();
    superseded.push(row.id);
    changed = true;
  }
  if (changed) {
    writeStore(workspaceDir, store);
  }
  return superseded;
}

export function listWordAddinReviewsByState(
  workspaceDir: string,
  state: WordAddinReviewState,
): WordAddinReviewRequest[] {
  return listWordAddinReviews(workspaceDir, { state });
}

export function listWordAddinReviews(
  workspaceDir: string,
  opts?: { since?: string; state?: WordAddinReviewState; sourcePath?: string },
): WordAddinReviewRequest[] {
  const all = readStore(workspaceDir).requests;
  const filtered = all.filter((r) => {
    if (opts?.state && r.state !== opts.state) {
      return false;
    }
    if (opts?.since && r.updatedAt <= opts.since) {
      return false;
    }
    if (opts?.sourcePath && r.sourcePath !== path.normalize(opts.sourcePath)) {
      return false;
    }
    return true;
  });
  return filtered.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * 这份文档该给律师看哪一条：**有结果就先给结果**。
 * 刚排队的空请求不该把已经拿到手的修订轨盖住（真机实测踩到）；
 * 没有任何 ready 时才回最新一条（排队/进行中/失败都如实显示）。
 */
export function pickWordAddinReviewForDocument<
  T extends { state: WordAddinReviewState; createdAt: string },
>(items: T[]): T | undefined {
  if (items.length === 0) {
    return undefined;
  }
  const sorted = [...items].toSorted((a, b) => b.createdAt.localeCompare(a.createdAt));
  return sorted.find((row) => row.state === "ready") ?? sorted[0];
}

export function readWordAddinReview(
  workspaceDir: string,
  id: string,
): WordAddinReviewRequest | undefined {
  return readStore(workspaceDir).requests.find((r) => r.id === id);
}

export async function createWordAddinReview(
  workspaceDir: string,
  input: { sourcePath: unknown; matterId?: unknown; instruction?: unknown; clientId?: unknown },
): Promise<
  { ok: true; request: WordAddinReviewRequest; reused: boolean } | { ok: false; error: string }
> {
  const normalized = normalizeWordSourcePath(input.sourcePath);
  if (!normalized.ok) {
    return normalized;
  }
  const now = new Date().toISOString();
  const matterId = typeof input.matterId === "string" ? input.matterId.trim() : "";
  const clientId = typeof input.clientId === "string" ? input.clientId.trim() : "";
  const instruction =
    typeof input.instruction === "string" && input.instruction.trim()
      ? input.instruction.trim().slice(0, 2000)
      : "审查这份合同：出最短锚点修订轨，逐处说明依据；不确定的标待补，不要改写事实。";
  const fingerprint = fingerprintWordFile(normalized.abs);
  // 幂等：同一份文件（同一内容）同一条指令在途时，连点第二次不该再开一次——直接接上。
  if (fingerprint) {
    const reusable = findReusableWordAddinReview(workspaceDir, {
      sourcePath: normalized.abs,
      instruction,
      sourceHash: fingerprint.hash,
    });
    if (reusable) {
      return { ok: true, request: reusable, reused: true };
    }
  }
  const request: WordAddinReviewRequest = {
    id: `waddin-${randomUUID().slice(0, 8)}`,
    createdAt: now,
    updatedAt: now,
    state: "queued",
    sourcePath: normalized.abs,
    fileName: path.basename(normalized.abs),
    ...(matterId ? { matterId } : {}),
    instruction,
    origin: "word-addin",
    ...(clientId ? { clientId } : {}),
    ...(fingerprint
      ? {
          sourceHash: fingerprint.hash,
          sourceSize: fingerprint.size,
          sourceMtimeMs: fingerprint.mtimeMs,
        }
      : {}),
  };
  const store = readStore(workspaceDir);
  store.requests = [request, ...store.requests];
  writeStore(workspaceDir, store);
  // 折叠同一文件同一指令、**还没开跑**的重复点击（在跑的已由上面复用掉）。
  supersedeOlderWordAddinReviews(workspaceDir, request);
  return { ok: true, request, reused: false };
}

export async function updateWordAddinReview(
  workspaceDir: string,
  id: string,
  patch: {
    state?: WordAddinReviewState;
    outputPath?: string;
    hunks?: WordAddinHunk[];
    skippedSectionHunks?: number;
    summary?: string;
    error?: string;
    note?: string;
    jobId?: string;
    matterId?: string;
    matterCandidates?: string[];
    authorization?: WordAddinRunAuthorization;
  },
): Promise<{ ok: true; request: WordAddinReviewRequest } | { ok: false; error: string }> {
  const store = readStore(workspaceDir);
  const idx = store.requests.findIndex((r) => r.id === id);
  if (idx < 0) {
    return { ok: false, error: "not_found" };
  }
  const next: WordAddinReviewRequest = {
    ...store.requests[idx],
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  if (patch.state === "ready" && !next.outputPath && (!next.hunks || next.hunks.length === 0)) {
    return { ok: false, error: "ready_without_result" };
  }
  store.requests[idx] = next;
  writeStore(workspaceDir, store);
  return { ok: true, request: next };
}

/**
 * 插件只落「短片段的替换」：超过这个长度的改动不适合在任务窗格里就地做
 * （律师应回桌面端看上下文），如实计入 skippedSectionHunks。
 */
export const WORD_ADDIN_MAX_ANCHOR_CHARS = 60;

/** 纯插入时取插入点之后多少字作为锚点（与 officecli lookbehind 同一思路）。 */
const WORD_ADDIN_INSERT_ANCHOR_CHARS = 6;

/**
 * 从 Redline 提案取「能变成 Word 原生修订轨」的最短锚点。
 *
 * 硬不变量（最短改动）：*不*照抄 hunk 的粒度——历史 section hunk 的 before/after
 * 可能是整节，直接塞给插件就会变成整节删+整节增。这里一律用 computeMinimalEditSpans
 * 重算：中间没动的字留在修订轨之外，只把真正变动的字交给 Word。
 *
 * 三类处理：
 * - 替换类最短片段 → find/replace 直接用；
 * - 纯插入 → 换成「插入点之后 6 字锚点」的替换（插入内容 + 锚点），一个字都不删；
 * - 过长的改动（真换整节、或改动本身很长）→ 不上插件，计入 skippedSectionHunks。
 */
export function hunksFromRedlineProposal(proposal: { hunks: RedlineHunk[] }): {
  hunks: WordAddinHunk[];
  skippedSectionHunks: number;
} {
  const hunks: WordAddinHunk[] = [];
  let skipped = 0;
  for (const hunk of proposal.hunks ?? []) {
    if (hunk.status === "rejected") {
      continue;
    }
    const before = hunk.before ?? "";
    const after = hunk.after ?? "";
    if (!before.trim() && !after.trim()) {
      continue;
    }
    if (before === after) {
      continue;
    }
    for (const span of computeMinimalEditSpans(before, after)) {
      const note = hunk.rationale ? { note: hunk.rationale } : {};
      if (span.before.length > 0) {
        if (span.before.length > WORD_ADDIN_MAX_ANCHOR_CHARS) {
          skipped += 1;
          continue;
        }
        hunks.push({ find: span.before, replace: span.after, ...note });
        continue;
      }
      // 纯插入：以插入点之后的原文作锚点，把「插入内容 + 锚点」整体替换回去。
      const expressed = expressInsertAsAnchorReplace({
        insertAt: insertPointInAfterText(span),
        inserted: span.after,
        afterText: after,
        anchorChars: WORD_ADDIN_INSERT_ANCHOR_CHARS,
      });
      if (!expressed) {
        // 文末插入：插件不猜位置。
        skipped += 1;
        continue;
      }
      hunks.push({ ...expressed, ...note });
    }
  }
  return { hunks, skippedSectionHunks: skipped };
}

/** 插件静态资源与本地 API 同源：路径必须落在仓库内的插件目录。 */
export function resolveWordAddinAssetPath(
  addinDir: string,
  relPath: string,
): { ok: true; abs: string } | { ok: false; error: string } {
  const clean = path.normalize(relPath.replace(/^[/\\]+/, ""));
  if (!clean || clean.includes("\0") || clean.split(/[/\\]/).includes("..")) {
    return { ok: false, error: "invalid_asset_path" };
  }
  const root = path.resolve(addinDir);
  const abs = path.resolve(root, clean);
  if (abs !== root && !abs.startsWith(`${root}${path.sep}`)) {
    return { ok: false, error: "asset_outside_addin_dir" };
  }
  return { ok: true, abs };
}
