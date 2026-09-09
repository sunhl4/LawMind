/**
 * 对内底稿 ≠ 对外稿. Never blocks. Mail/Word tracked redline keep frozen delivery copy.
 */

export const DRAFT_AUDIENCES = ["internal", "client", "court"] as const;
export type DraftAudience = (typeof DRAFT_AUDIENCES)[number];

const COURT_RE = /(起诉状|答辩状|代理词|给法院|呈请法院|此致.{0,8}人民法院)/;
const CLIENT_RE = /(给客户|发给客户|对外意见|给对方律师|可发给对方)/;

export function inferDraftAudience(instruction: string): DraftAudience {
  if (COURT_RE.test(instruction)) {
    return "court";
  }
  if (CLIENT_RE.test(instruction)) {
    return "client";
  }
  return "internal";
}

export function shouldInjectAudienceSplit(
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
  return true;
}

export function formatAudienceSplitPromptBlock(audience: DraftAudience): string {
  if (audience === "court") {
    return [
      "## 交件对象",
      "本稿面向法院/仲裁。删除内部策略、胜率猜测和攻击性评价。用可证明事实和请求权构成。",
    ].join("\n");
  }
  if (audience === "client") {
    return [
      "## 交件对象",
      "本稿可给客户看。删除所内策略、报价底线和攻击对方的句子。保留风险、改法与下一步。仍称供审核稿，除非律师已签批。",
    ].join("\n");
  }
  return [
    "## 交件对象",
    "本稿是对内底稿。可保留假设、策略和升级理由。不得写成已对客户或对方签发。",
  ].join("\n");
}
