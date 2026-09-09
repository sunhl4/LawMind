/**
 * Retrieval protocol for unlocked 意见 / 检索 / 快问.
 * Mail short path and Word tracked lock skip this (no search on those turns).
 */

export const STATUTE_TRIAL_TOOLS = ["search_statute", "search_case_law"] as const;

export function shouldInjectResearchProtocol(
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
  return (
    bound.id === "research.memo" ||
    bound.id === "analysis.quick" ||
    bound.id === "contract.review" ||
    bound.id === "letter.draft" ||
    bound.id === "litigation.draft"
  );
}

export function statuteTrialHappenedThisTurn(counts?: Record<string, number> | null): boolean {
  if (!counts) {
    return false;
  }
  return STATUTE_TRIAL_TOOLS.some((name) => (counts[name] ?? 0) > 0);
}

/** Same shape as lint citation-validity; used to soft-stamp unverified 条号. */
const CITE_RE = /《([^》]{1,40})》\s*第\s*([0-9一二三四五六七八九十百]+)\s*条/;

export function looksLikeStatuteCitation(text: string): boolean {
  return CITE_RE.test(text);
}

export function shouldEnforceStatuteTrial(
  bound:
    | {
        id: string;
        pipeline: string;
      }
    | null
    | undefined,
): boolean {
  return shouldInjectResearchProtocol(bound);
}

export function formatResearchProtocolPromptBlock(): string {
  return [
    "## 检索协议",
    "写现行法条或类案之前：先按命题矩阵调用 `search_statute`（核心工具）和已披露的 `search_case_law`，每个争点试检 1–2 条再扩。",
    "无命中或本回合工具不可用：栏目保留并标【待核实】，不得把模型记忆写成条号。废止的《合同法》《民法通则》《物权法》《担保法》《侵权责任法》不得当有效依据。",
    "邮件短路径与指定目录 Word 改稿不要为了引用去检索。",
  ].join("\n");
}

export function formatUnretrievedStatuteBody(): string {
  return "本回合尚未试检 `search_statute` / `search_case_law`。不得把模型记忆写成现行法条。先检索；无工具则标【待核实】并继续分析框架。";
}
