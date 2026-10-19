/**
 * 方向 6「审稿探针」第一层：审稿意见的结构化入口（只记录，不处置）。
 *
 * docs/量子启发.md §二(6)。协议要求每条审稿意见必须附带原文片段并指向
 * 一个真实锚；不满足即拒收，而不是静默修理后照单全收。
 *
 * 观察不是证据：本模块不写 FactorState、不升级读数、不触发改稿。把观察
 * 接进账本通道（fuseProposal）属于第二批接线，接入前须过消融验收。
 */

import { isFactorAnchor } from "./factor-state.js";

export type ReviewObservation = {
  /** 目标锚，必须是 fact-anchor 形态（clause:/amount:/defined:/citation:/party:/negation:/redline:）。 */
  anchor: string;
  /** 原文片段：审稿意见声称的依据文本，供后续核对，不是结论。 */
  span: string;
  /** 问题类型或一句话说明。 */
  label: string;
  /** 该片段所在来源（材料/条款 id），缺省表示审稿模型未给出来源。 */
  sourceId?: string;
  /** 来源版本或文档版本，用于同一来源在不同版本下的区分。 */
  version?: string;
};

export type ReviewObservationRejection = {
  index: number;
  reason: "not_an_object" | "missing_anchor" | "anchor_shape" | "missing_span" | "missing_label";
};

export type ReviewObservationBatch = {
  accepted: ReviewObservation[];
  rejected: ReviewObservationRejection[];
};

export function normalizeReviewObservations(input: unknown): ReviewObservationBatch {
  const accepted: ReviewObservation[] = [];
  const rejected: ReviewObservationRejection[] = [];
  if (!Array.isArray(input)) {
    return {
      accepted,
      rejected:
        input === undefined || input === null ? [] : [{ index: 0, reason: "not_an_object" }],
    };
  }
  input.forEach((raw, index) => {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      rejected.push({ index, reason: "not_an_object" });
      return;
    }
    const row = raw as Record<string, unknown>;
    const anchor = typeof row.anchor === "string" ? row.anchor.trim() : "";
    const span = typeof row.span === "string" ? row.span.trim() : "";
    const label = typeof row.label === "string" ? row.label.trim() : "";
    const sourceId = typeof row.sourceId === "string" ? row.sourceId.trim() : "";
    const version = typeof row.version === "string" ? row.version.trim() : "";
    if (!anchor) {
      rejected.push({ index, reason: "missing_anchor" });
      return;
    }
    if (!isFactorAnchor(anchor)) {
      rejected.push({ index, reason: "anchor_shape" });
      return;
    }
    if (!span) {
      rejected.push({ index, reason: "missing_span" });
      return;
    }
    if (!label) {
      rejected.push({ index, reason: "missing_label" });
      return;
    }
    accepted.push({
      anchor,
      span,
      label,
      ...(sourceId ? { sourceId } : {}),
      ...(version ? { version } : {}),
    });
  });
  return { accepted, rejected };
}

/**
 * 渲染成注入用观察块。块内明确「不是证据、不改稿、不选边」，与
 * renderEngineReadings 的已核读数区分；即使将来两者走同一信道，权限也不同。
 */
export function renderReviewObservations(observations: readonly ReviewObservation[]): string {
  if (observations.length === 0) {
    return "";
  }
  const lines = observations.map((row) => {
    const source = [row.sourceId, row.version].filter(Boolean).join("@");
    const head = source ? `${row.anchor}（${source}）` : row.anchor;
    return `- ${head}：${row.label}（原文片段：${row.span}）`;
  });
  return [
    "【审稿观察】下面是审稿模型的待核对意见，每条附原文片段、指向一个锚。",
    ...lines,
    "以上是观察不是证据：不改稿、不选边、不升级账本读数。",
  ].join("\n");
}
