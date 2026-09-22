/**
 * 改稿范例（edit examples）——把「律师改了什么」当**素材**留下来，而不是压成一句偏好。
 *
 * ## 为什么要有这个模块
 *
 * 系统里已有两条通道，但它们解决的是不同问题，之间断了一环：
 *
 * | 通道 | 触发 | 存什么 | 注入方式 |
 * | ---- | ------------------------- | --------------------------------------------- | ---------------------- |
 * | 偏好 | 律师审核（带标签/备注） | 压成 ≤160 字的**一句话**，进 `LAWYER_PROFILE.md` | 每轮进 system prompt |
 * | 范例 | 律师**显式**标「质量范例」 | **整稿** JSON，进 `golden/` | 检索后注入节选 + 全文指路 |
 *
 * 断的那一环：**律师日常改稿产生的 (改前, 改后) 对照，只走了偏好那条路**——
 * `extractChangeSpan` 明明已经拿到了完整的成对文本，却立刻被
 * `formatEditLearningCandidates` 压成 160 字的描述。
 *
 * 信息在压缩时丢了：
 *
 * ```text
 * 范例（保留）：改前「…保留解除合同及要求赔偿损失的权利」
 *              → 改后「…现要求贵司于 2026 年 10 月 5 日前完成全部交付…」
 *              能看出场合、力度、落款规矩
 * 偏好（压缩）：「催告函要有明确期限和解除后果」
 *              场合没了、示范没了
 * ```
 *
 * ## 与 `golden/` 的关系：**分开存，共用检索口径**
 *
 * 刻意**不**把改稿塞进 `golden/`：
 *
 * - `golden/` 的语义是「律师**判定**这条是典范」；改稿只是「律师动过手」。
 *   很多改稿是在**修缺陷**，不是示范。混存会让检索时坏例子挤掉好例子，
 *   也会让 `golden/` 的含义变模糊。
 * - 但两者**检索打分必须同权**（见 `scorePayloadAgainstQuery`），
 *   否则「哪条更相关」在两处给出不同答案，无法解释。
 *
 * ## 框架：素材，不是闸
 *
 * 本模块的产出**只进 prompt 作参考**，不带任何拦停能力。因此：
 *   - 检索不到 ⟹ 整块不注入 ⟹ **什么都不影响**（不许抛、不许降级到假数据）；
 *   - 文案必须写成「供参考」，**绝不**写成「必须这样写」——
 *     这正是「管道修成闸」与「管道修成素材」的分界。
 */

import fs from "node:fs";
import path from "node:path";
import { scorePayloadAgainstQuery } from "../evaluation/golden-recall.js";
import type { DraftEditDelta } from "./draft-edit-learning.js";

/** 一条改稿范例：律师把 agent 的哪一段改成了什么。 */
export type EditExampleEntry = {
  /** 稳定 id（`taskId` + 栏目 + 内容指纹），跨次写入可去重。 */
  id: string;
  taskId: string;
  matterId?: string;
  deliverableType?: string;
  sectionHeading: string;
  /** agent 原稿里的那一段（即被改掉的）。 */
  before: string;
  /** 律师终稿里的那一段。 */
  after: string;
  /** 审核时律师写的说明（若有）——**这是「为什么改」的唯一线索**，很值钱。 */
  reviewNote?: string;
  recordedAt: string;
};

export const EDIT_EXAMPLES_REL = "edits/edit-examples.jsonl";

export function editExamplesPath(workspaceDir: string): string {
  return path.join(workspaceDir, EDIT_EXAMPLES_REL);
}

/** 低于此长度的改动视为琐碎（标点、错别字），不作为范例。 */
export const MIN_EXAMPLE_DELTA_CHARS = 12;
/** 单条范例的正文上限——过长会挤掉 prompt 预算。 */
export const MAX_EXAMPLE_CHARS = 600;
/**
 * **注入**时的每侧上限（比存储上限紧得多）。
 *
 * 存储要宽（将来可能用全文做别的用途），注入要省——这是实测到的：
 * 首版把 600 字两侧原样塞进 prompt，结果 prompt 打包器**在范例块中间截断**，
 * 把末尾的「律师说明」（最值钱的「为什么改」）挤掉了。
 *
 * 结论：**存得宽、注入得省**；且把最短最值钱的字段放在最前面。
 */
export const MAX_EXAMPLE_CHARS_IN_PROMPT = 220;
/** 单次注入的范例条数上限。 */
export const DEFAULT_EXAMPLE_LIMIT = 2;

function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

function fingerprint(text: string): string {
  // 不用 crypto：这里只要稳定去重键，不需要密码学强度。
  let h = 0;
  for (let i = 0; i < text.length; i += 1) {
    h = (h * 31 + text.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

/**
 * 把改稿 delta 折成可存的范例。
 *
 * **过滤口径**（宁可少存，不要存垃圾）：
 *   1. 改动净增内容太短 → 跳过（琐碎修正不是范例）；
 *   2. `before` 与 `after` 规范化后相同 → 跳过（纯空白/换行差异）；
 *   3. `before` 为空 → 跳过（这是**新增**，不是改稿；新增的正确性无从对照，
 *      留待将来单独处理，不混进「改稿范例」这个语义）。
 */
export function toEditExamples(input: {
  taskId: string;
  matterId?: string;
  deliverableType?: string;
  reviewNote?: string;
  deltas: readonly DraftEditDelta[];
  now?: Date;
}): EditExampleEntry[] {
  const at = (input.now ?? new Date()).toISOString();
  const out: EditExampleEntry[] = [];
  for (const d of input.deltas) {
    const before = d.removed.replace(/\s+/g, " ").trim();
    const after = d.added.replace(/\s+/g, " ").trim();
    if (!before) {
      continue; // 纯新增，不是改稿
    }
    if (after.length < MIN_EXAMPLE_DELTA_CHARS) {
      continue; // 琐碎
    }
    if (before === after) {
      continue;
    }
    const id = `${input.taskId}:${fingerprint(`${d.sectionHeading}\u0000${before}\u0000${after}`)}`;
    out.push({
      id,
      taskId: input.taskId,
      ...(input.matterId ? { matterId: input.matterId } : {}),
      ...(input.deliverableType ? { deliverableType: input.deliverableType } : {}),
      sectionHeading: d.sectionHeading,
      before: clip(before, MAX_EXAMPLE_CHARS),
      after: clip(after, MAX_EXAMPLE_CHARS),
      ...(input.reviewNote?.trim() ? { reviewNote: clip(input.reviewNote, 240) } : {}),
      recordedAt: at,
    });
  }
  return out;
}

/**
 * 落盘。**永不抛**——范例记录失败绝不该影响律师的审核动作。
 * 返回实际写入条数（已去重）。
 */
export function recordEditExamples(
  workspaceDir: string,
  entries: readonly EditExampleEntry[],
): number {
  if (entries.length === 0) {
    return 0;
  }
  try {
    const existing = new Set(readEditExamples(workspaceDir).map((e) => e.id));
    const fresh = entries.filter((e) => !existing.has(e.id));
    if (fresh.length === 0) {
      return 0;
    }
    const dest = editExamplesPath(workspaceDir);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.appendFileSync(dest, `${fresh.map((e) => JSON.stringify(e)).join("\n")}\n`, "utf8");
    return fresh.length;
  } catch {
    return 0;
  }
}

export type EditExampleReadResult = {
  present: boolean;
  rows: EditExampleEntry[];
  totalLines: number;
  skippedLines: number;
};

/** 读取端：坏行跳过并计数（与飞轮其它 reader 同口径）。 */
export function readEditExamples(workspaceDir: string): EditExampleEntry[] {
  return readEditExamplesDetailed(workspaceDir).rows;
}

export function readEditExamplesDetailed(workspaceDir: string): EditExampleReadResult {
  const file = editExamplesPath(workspaceDir);
  if (!fs.existsSync(file)) {
    return { present: false, rows: [], totalLines: 0, skippedLines: 0 };
  }
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  const rows: EditExampleEntry[] = [];
  let totalLines = 0;
  let skippedLines = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    totalLines += 1;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        skippedLines += 1;
        continue;
      }
      const r = parsed as Record<string, unknown>;
      const id = typeof r.id === "string" ? r.id.trim() : "";
      const before = typeof r.before === "string" ? r.before : "";
      const after = typeof r.after === "string" ? r.after : "";
      if (!id || !before || !after) {
        skippedLines += 1;
        continue;
      }
      rows.push({
        id,
        taskId: typeof r.taskId === "string" ? r.taskId : "",
        ...(typeof r.matterId === "string" && r.matterId.trim() ? { matterId: r.matterId } : {}),
        ...(typeof r.deliverableType === "string" && r.deliverableType.trim()
          ? { deliverableType: r.deliverableType }
          : {}),
        sectionHeading: typeof r.sectionHeading === "string" ? r.sectionHeading : "",
        before,
        after,
        ...(typeof r.reviewNote === "string" && r.reviewNote.trim()
          ? { reviewNote: r.reviewNote }
          : {}),
        recordedAt: typeof r.recordedAt === "string" ? r.recordedAt : "",
      });
    } catch {
      skippedLines += 1;
    }
  }
  return { present: true, rows, totalLines, skippedLines };
}

// ─────────────────────────────────────────────
// 检索与注入
// ─────────────────────────────────────────────

export type EditExampleHint = {
  id: string;
  taskId: string;
  sectionHeading: string;
  before: string;
  after: string;
  reviewNote?: string;
  score: number;
};

/**
 * 检索与当前交办相关的改稿范例。**永不抛**：检索是可选增强。
 *
 * 与 `loadGoldenExamplesForDrafting` 同口径打分（`scorePayloadAgainstQuery`），
 * 保证两个通道对「哪条更相关」给出可解释的一致答案。
 */
export function loadEditExamplesForDrafting(opts: {
  workspaceDir: string;
  instruction: string;
  deliverableType?: string;
  limit?: number;
}): EditExampleHint[] {
  try {
    const all = readEditExamples(opts.workspaceDir);
    if (all.length === 0) {
      return [];
    }
    const scored: EditExampleHint[] = [];
    for (const row of all) {
      const score = scorePayloadAgainstQuery({
        query: opts.instruction,
        ...(opts.deliverableType ? { deliverableType: opts.deliverableType } : {}),
        ...(row.deliverableType ? { entryDeliverableType: row.deliverableType } : {}),
        titleHay: `${row.sectionHeading}\n${row.deliverableType ?? ""}`,
        headingHay: row.sectionHeading,
        bodyText: `${row.before}\n${row.after}`,
      });
      // 类型不同且无任何文本命中 → 不相关，丢掉。同类则保留（类型是最强先验）。
      if (score <= 0 && row.deliverableType !== opts.deliverableType) {
        continue;
      }
      scored.push({
        id: row.id,
        taskId: row.taskId,
        sectionHeading: row.sectionHeading,
        before: row.before,
        after: row.after,
        ...(row.reviewNote ? { reviewNote: row.reviewNote } : {}),
        score,
      });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, opts.limit ?? DEFAULT_EXAMPLE_LIMIT);
  } catch {
    return [];
  }
}

/**
 * 渲染成 prompt 块。
 *
 * **文案即契约**：这是素材不是指令。三处措辞都是刻意的：
 *   - 「供参照」而非「请照此」；
 *   - 明确说改前那版是**系统自己**写的（不甩锅给律师，也让模型知道要避开什么）；
 *   - 明确说「本次仍以交办与材料为准」——防止范例压过当前事实。
 *
 * **字段顺序也是设计**：律师说明写在**标题行**（每例最靠前的位置）。
 * 这不是排版偏好——实测过：首版把说明放在每例末尾，结果 prompt 打包器
 * 在范例块中间截断，恰好把「为什么改」挤掉了。
 *
 * 返回 `undefined` 表示无范例、不注入（而不是注入一个空标题）。
 */
export function formatEditExamplesPromptBlock(
  hints: readonly EditExampleHint[],
): string | undefined {
  if (hints.length === 0) {
    return undefined;
  }
  const blocks: string[] = [
    "## 改稿参照（本所律师对系统稿的实际修改）",
    "以下「改前」是**系统当时写的那一版**，「改后」是律师交付的版本。仅供参照：",
    "对齐这类场合的措辞力度与结构，但**本次仍以当前交办与材料为准**，不要照搬其中的事实或当事人。",
  ];
  for (const h of hints) {
    // 律师说明放标题行：最短、最值钱、最靠前 —— 预算截断时它最后才受影响。
    const head = h.sectionHeading ? `「${h.sectionHeading}」` : "（无栏目名）";
    const why = h.reviewNote ? `（律师说明：${h.reviewNote}）` : "";
    blocks.push(
      [
        `### ${head}${why}`,
        `改前（系统稿）：${clip(h.before, MAX_EXAMPLE_CHARS_IN_PROMPT)}`,
        `改后（律师稿）：${clip(h.after, MAX_EXAMPLE_CHARS_IN_PROMPT)}`,
      ].join("\n"),
    );
  }
  return blocks.join("\n\n");
}

/** 供 Doctor / CLI：一句话概括当前范例库规模。 */
export function describeEditExamples(workspaceDir: string): string {
  const read = readEditExamplesDetailed(workspaceDir);
  if (!read.present) {
    return "改稿范例库：尚无记录（律师改稿尚未产生范例对）。";
  }
  const types = new Set(read.rows.map((r) => r.deliverableType).filter(Boolean));
  return `改稿范例库：${read.rows.length} 条，覆盖 ${types.size} 类交付物${
    read.skippedLines > 0 ? `（跳过坏行 ${read.skippedLines}）` : ""
  }。`;
}
