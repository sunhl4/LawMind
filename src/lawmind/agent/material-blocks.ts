/**
 * 素材块合并（D10）——把多个「给模型看的素材」通道收进**一个**受预算约束的片段。
 *
 * ## 为什么需要它
 *
 * 判断层的设计把「素材」与「闸」分开之后，素材通道长出了三个：
 *
 * | 通道 | 内容 | 来源 |
 * | --------------- | ------------------------------ | ---------------------------------------- |
 * | 派生事实 | 算好的数字（占比、合计、算式） | `reasoning/derived-facts.ts` |
 * | 改稿范例 | 律师对系统稿的实际修改对照 | `learning/edit-examples.ts` |
 * | 黄金范例 | 律师判定为典范的整稿（节选） | `evaluation/golden-recall.ts` |
 *
 * 三者此各自 `queue("memory_hit", ...)`，各自 cap、各自优先级。**实测撞了两次截断**：
 * prompt 打包器在**块中间**切开，把后面的整条内容削掉——被腰斩的素材比没有更糟，
 * 因为它看起来像一句完整的话。
 *
 * 本模块把三者合成一个片段，由一个预算统一裁决，并保证：
 *
 * 1. **整块取舍**：放不下的通道整条丢弃，绝不在通道内部拦腰截断；
 * 2. **固定优先级**：顺序即优先级，缺预算时从末尾开始丢；
 * 3. **丢弃可见**：被丢掉的通道**具名说明**，而不是悄悄消失——
 *    否则「这次没看到范例」与「本来就没有范例」无法区分。
 *
 * ## 顺序为什么是「事实 → 改稿范例 → 黄金范例」
 *
 * - **派生事实最先**：它是**代码算出来的**，可靠度最高，且能纠正模型本来会算错的数字。
 *   预算不足时最不该丢的就是它。
 * - **改稿范例次之**：本所律师的真实改法，信息密度高、独有性强。
 * - **黄金范例最后**：它本来就是「结构参考」，且块内已写明
 *   「完整样例请用 read_workspace_file 读取」——丢了它模型仍可主动去取。
 *
 * ## 不做什么
 *
 * 本模块只做**拼接与取舍**，不生成任何内容；不判断素材好坏；不参与门禁。
 */

import { appendProductMetric, listProductMetricEvents } from "../metrics/product-metrics.js";
import type { PromptFragmentKind } from "./prompt-fragments.js";

/** 素材通道 id。顺序即优先级。 */
export const MATERIAL_SECTION_ORDER = [
  "derived_facts",
  "edit_examples",
  "golden_examples",
] as const;

export type MaterialSectionId = (typeof MATERIAL_SECTION_ORDER)[number];

/** 律师/工程师可读的通道名（用于「丢弃说明」）。 */
const SECTION_LABELS: Record<MaterialSectionId, string> = {
  derived_facts: "已算好的事实",
  edit_examples: "改稿参照",
  golden_examples: "质量范例",
};

export type MaterialSection = {
  id: MaterialSectionId;
  /** 已渲染好的块；`undefined` 表示本次没有该通道的内容。 */
  body: string | undefined;
};

/**
 * 合并后的素材块预算（字符）。
 *
 * 口径：CJK 约 1 token/字（见 `context-budget.ts` 的 `estimateTextTokens`），
 * 所以 1000 字 ≈ 620 tokens。三个通道的典型量级是
 * 事实 ~450 / 改稿范例 ~200 / 黄金范例 ~150 —— 合计约 800，留出余量。
 */
export const MATERIALS_BLOCK_MAX_CHARS = 1000;

/** 与预算配套的 token 上限，供 `queue(..., { capTokens })` 使用。 */
export const MATERIALS_BLOCK_CAP_TOKENS = 660;

/**
 * 素材块统一挂的片段 kind。
 *
 * 复用 `memory_hit`（而不是新造一个 kind）是刻意的：新 kind 要在
 * `FRAGMENT_CAPS` 里加默认值、可能影响既有的打包排序与测试。这里只是把
 * **原来同 kind 的三个片段收成一个**，不引入新的预算类别。
 */
export const MATERIALS_FRAGMENT_KIND: PromptFragmentKind = "memory_hit";

/**
 * 素材块的整体优先级。
 *
 * 45 —— **高于** `memory_hit` 默认的 40（在 memory hit 之间素材优先），
 * 但**低于** `protocol`(55) / `skill_index`(70) / `craft`(80)：
 * 素材是增强，不该挤占起草指引与协议约束。
 */
export const MATERIALS_FRAGMENT_PRIORITY = 45;

export type ComposeMaterialsResult = {
  /** 合并后的块；`undefined` 表示三个通道都没有内容 → **整块不注入**。 */
  body: string | undefined;
  /** 实际纳入的通道（按优先级）。 */
  included: MaterialSectionId[];
  /** 因预算被整条丢弃的通道。 */
  dropped: MaterialSectionId[];
};

/**
 * 把各素材通道合成一个块。
 *
 * 行为：
 *   - 空通道跳过（不产生空标题）；
 *   - 按 `MATERIAL_SECTION_ORDER` 逐个追加，超预算则**从这个通道起全部丢弃**；
 *   - 有丢弃时在末尾具名说明；
 *   - 全部为空 → `body: undefined`。
 *
 * **整块取舍**：不会出现「某个通道被切一半」。这是本模块存在的全部理由。
 */
export function composeMaterialsBlock(
  sections: readonly MaterialSection[],
  opts?: { maxChars?: number },
): ComposeMaterialsResult {
  const cap = Math.max(120, opts?.maxChars ?? MATERIALS_BLOCK_MAX_CHARS);
  const byId = new Map(sections.map((s) => [s.id, s]));
  const included: MaterialSectionId[] = [];
  const dropped: MaterialSectionId[] = [];
  const parts: string[] = [];
  let used = 0;

  for (const id of MATERIAL_SECTION_ORDER) {
    const body = byId.get(id)?.body?.trim();
    if (!body) {
      continue; // 本次没有该通道的内容 —— 不算「丢弃」
    }
    if (used + body.length > cap) {
      dropped.push(id);
      continue;
    }
    parts.push(body);
    used += body.length;
    included.push(id);
  }

  if (parts.length === 0) {
    return { body: undefined, included: [], dropped };
  }

  if (dropped.length > 0) {
    const names = dropped.map((id) => SECTION_LABELS[id]).join("、");
    // 具名说明：否则「这次没看到」与「本来就没有」无法区分
    parts.push(`（本次因篇幅未展开：${names}。）`);
  }

  return { body: parts.join("\n\n"), included, dropped };
}

// ─────────────────────────────────────────────
// 可观测（D10 收口）：丢弃必须**可测**，不只是写在文案里
// ─────────────────────────────────────────────

/**
 * 记录一次素材块合成结果。
 *
 * **永不抛**：观测设施不得拖垮 prompt 组装——与其它「optional」块同一纪律。
 *
 * `meta` 用**逗号连接的名字**而不是数组，因为 `ProductMetricEvent.meta` 的类型是
 * `Record<string, string | number | boolean | null>`（不含数组）。为一个观测字段
 * 去放宽共享的事件类型，blast radius 不划算；名字集合很小、解析也直接。
 *
 * **只记「本来有内容」的通道**：某通道本来就没内容（没改稿范例、没黄金范例）
 * 不算「被丢」，所以 `included`/`dropped` 两个集合的并集才是本次的「在场」集合。
 */
export function recordMaterialBlockEvent(
  workspaceDir: string,
  result: ComposeMaterialsResult,
  opts?: { taskId?: string; matterId?: string },
): void {
  try {
    // 三通道全空时不记——那不是「丢弃」，是「本来就没有素材」
    if (result.included.length === 0 && result.dropped.length === 0) {
      return;
    }
    appendProductMetric(workspaceDir, {
      kind: "material_block",
      outcome: result.dropped.length > 0 ? "dropped" : "complete",
      ...(opts?.taskId ? { taskId: opts.taskId } : {}),
      ...(opts?.matterId ? { matterId: opts.matterId } : {}),
      meta: {
        included: result.included.join(","),
        dropped: result.dropped.join(","),
        droppedCount: result.dropped.length,
        chars: result.body?.length ?? 0,
      },
    });
  } catch {
    /* optional */
  }
}

export type MaterialChannelHealth = {
  channel: MaterialSectionId;
  /** 被纳入的次数。 */
  includedCount: number;
  /** 因预算被**整条丢弃**的次数。 */
  droppedCount: number;
  /** 看到过该通道内容的次数（纳入 + 丢弃）——即「本来有，但可能被丢」。 */
  presentCount: number;
  /** 丢弃率；`presentCount === 0` 时为 `null`（**不编造 0%**）。 */
  dropRate: number | null;
};

export type MaterialBlockHealth = {
  /** 有记录的回合数；0 表示尚无观测数据。 */
  samples: number;
  byChannel: MaterialChannelHealth[];
  /** 丢弃率最高且样本足够的通道——最值得关注的那一个。 */
  worstChannel: MaterialSectionId | null;
  /** 至少出现 1 次丢弃的通道（用于一句话摘要）。 */
  anyDropped: boolean;
};

/** 判定「丢弃率」有意义所需的最小样本（太少时比例会剧烈跳动）。 */
export const MATERIAL_HEALTH_MIN_SAMPLES_PER_CHANNEL = 5;

/**
 * 从产品指标汇总各素材通道的丢弃情况。
 *
 * 口径：
 *   - `presentCount` = 纳入 + 丢弃。**只有「本来有内容」的回合才进分母**——
 *     某通道本来就没内容（没改稿范例、没黄金范例）不算「被丢」。
 *   - `dropRate` 在 `presentCount === 0` 时为 `null`：不编造 0%。
 *     参照 `metrics/north-star.ts` 的 *Missing samples stay null*。
 */
export function summarizeMaterialBlockHealth(workspaceDir: string): MaterialBlockHealth {
  let samples = 0;
  const acc = new Map<MaterialSectionId, { included: number; dropped: number }>();
  for (const id of MATERIAL_SECTION_ORDER) {
    acc.set(id, { included: 0, dropped: 0 });
  }

  try {
    for (const ev of listProductMetricEvents(workspaceDir)) {
      if (ev.kind !== "material_block") {
        continue;
      }
      samples += 1;
      for (const raw of String(ev.meta?.included ?? "").split(",")) {
        const id = raw.trim() as MaterialSectionId;
        const row = acc.get(id);
        if (row) {
          row.included += 1;
        }
      }
      for (const raw of String(ev.meta?.dropped ?? "").split(",")) {
        const id = raw.trim() as MaterialSectionId;
        const row = acc.get(id);
        if (row) {
          row.dropped += 1;
        }
      }
    }
  } catch {
    return { samples: 0, byChannel: [], worstChannel: null, anyDropped: false };
  }

  const byChannel: MaterialChannelHealth[] = [];
  for (const id of MATERIAL_SECTION_ORDER) {
    const row = acc.get(id) ?? { included: 0, dropped: 0 };
    const presentCount = row.included + row.dropped;
    byChannel.push({
      channel: id,
      includedCount: row.included,
      droppedCount: row.dropped,
      presentCount,
      dropRate: presentCount > 0 ? row.dropped / presentCount : null,
    });
  }

  const eligible = byChannel.filter(
    (c) => c.presentCount >= MATERIAL_HEALTH_MIN_SAMPLES_PER_CHANNEL && (c.dropRate ?? 0) > 0,
  );
  const worstChannel =
    eligible.length > 0
      ? eligible.toSorted((a, b) => (b.dropRate ?? 0) - (a.dropRate ?? 0))[0].channel
      : null;

  return {
    samples,
    byChannel,
    worstChannel,
    anyDropped: byChannel.some((c) => c.droppedCount > 0),
  };
}

/** 一行摘要（供 Doctor / CLI）。样本不足时**如实说不足**，不给百分比。 */
export function describeMaterialBlockHealth(health: MaterialBlockHealth): string {
  if (health.samples === 0) {
    return "素材块：尚无观测数据（还没有跑过带素材的回合）。";
  }
  const parts = health.byChannel
    .filter((c) => c.presentCount > 0)
    .map((c) =>
      c.dropRate === null
        ? `${c.channel} 纳入 ${c.includedCount}`
        : `${c.channel} 纳入 ${c.includedCount}/丢 ${c.droppedCount}（${(c.dropRate * 100).toFixed(0)}%）`,
    );
  const summary = parts.length > 0 ? parts.join("，") : "各通道均未出现内容";
  const worst =
    health.worstChannel === null
      ? health.anyDropped
        ? "（丢弃率样本不足，暂不给比例）"
        : ""
      : `；最需关注：${health.worstChannel}`;
  return `素材块：${health.samples} 个回合 — ${summary}${worst}`;
}
