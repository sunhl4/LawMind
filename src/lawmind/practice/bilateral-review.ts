/**
 * 己方纸 / 对方纸 × 销售 / 采购 — Anthropic playbook structure, independent copy.
 * Opinion / draft paths only. Mail short path and Word tracked redline keep frozen packs.
 */

import type { ClosedContractTypeId } from "../contracts/closed-contract-type.js";
import type { LoadedPracticePlaybook } from "./practice-playbook.js";

export type PaperSide = "our_paper" | "their_paper" | "unknown";
export type DealRole = "sell" | "buy" | "unknown";

export function inferPaperSide(instruction: string): PaperSide {
  if (/(我方(合同|模板|范本|纸)|我方起草|我方出具的合同)/.test(instruction)) {
    return "our_paper";
  }
  if (/(对方(合同|模板|范本|纸)|对方出具|甲方提供的合同|乙方模板)/.test(instruction)) {
    return "their_paper";
  }
  return "unknown";
}

export function inferDealRole(instruction: string, closedTypeId?: ClosedContractTypeId): DealRole {
  if (/(我方采购|作为买方|采购合同|购销)/.test(instruction)) {
    return "buy";
  }
  if (/(我方销售|作为卖方|销售合同|供货方立场)/.test(instruction)) {
    return "sell";
  }
  if (closedTypeId === "sale") {
    if (/销售/.test(instruction) && !/采购/.test(instruction)) {
      return "sell";
    }
    if (/采购|供货/.test(instruction)) {
      return "buy";
    }
  }
  return "unknown";
}

export function shouldInjectBilateralReview(
  bound:
    | {
        id: string;
        pipeline: string;
      }
    | null
    | undefined,
): boolean {
  if (!bound || bound.pipeline === "tracked_redline" || bound.id === "mail.contract") {
    return false;
  }
  return bound.id === "contract.review" || bound.id === "contract.draft";
}

export function formatBilateralReviewPromptBlock(params: {
  paper: PaperSide;
  role: DealRole;
  playbook: LoadedPracticePlaybook;
}): string {
  const paperLabel =
    params.paper === "our_paper"
      ? "己方纸（在我方模板上改，少让步）"
      : params.paper === "their_paper"
        ? "对方纸（按委托方风险审，给可谈判改法）"
        : "未写明纸侧：按对方稿审（中立偏委托方），不要停下来三问";
  const roleLabel =
    params.role === "sell"
      ? "销售侧：收款、验收、责任上限、退出"
      : params.role === "buy"
        ? "采购侧：交付、质量、知识产权、数据、解约"
        : "未写明买卖角色：按封闭类型的交易结构审，责任上限四个位置都要看";
  const never = params.playbook.neverAccept.map((item) => `- ${item}`).join("\n");
  return [
    "## 纸侧与交易角色",
    `纸侧：${paperLabel}。`,
    `角色：${roleLabel}。`,
    "标准：直接损失有上限；间接/可得利益默认排除；人身/故意/重大过失/知识产权/数据泄露作 carve-out。",
    "可接受回退：上限金额可谈；管辖可改为双方所在地或约定仲裁。",
    "永不接受（默认，工作区可改）：",
    never,
    "无档案也用上述默认审完。改设置只影响之后任务。",
  ].join("\n");
}
