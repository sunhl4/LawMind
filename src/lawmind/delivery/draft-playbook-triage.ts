/**
 * 起草落盘时给合同、意见书/备忘与诉讼文书草稿跑一次本所剧本三色分流。
 *
 * 只在**工作区恰好一份适用的剧本**时启用：多份剧本没有选择依据，宁可不出结论，
 * 也不把别的案型剧本套到这一份上。非合同类交付物不跑条款抽取，只跑正文级检查。
 *
 * 证据来自草稿正文本身（合同按条款抽取逐字切出；其它按章节/表述/引用逐字切出），
 * 不是模型给的引用，所以走纯 `triageAgainstPlaybook`，不需要再做文件回读。
 */

import { extractClauses } from "../clause/extract.js";
import { listWorkspacePlaybooks, loadWorkspacePlaybook } from "../deliverables/playbook-store.js";
import {
  observationsFromDocument,
  playbookAppliesToDeliverableType,
  triageAgainstPlaybook,
  type Playbook,
  type PlaybookTriage,
} from "../deliverables/playbook-triage.js";

/**
 * 可套本所剧本的交付物前缀。
 *
 * 合同走条款抽取；意见书/备忘录与诉讼文书只走正文级检查（章节、必含/禁止表述、
 * 法律依据引用），不做条款抽取。没有对应检查的条件仍由律师给结论。
 */
export const PLAYBOOK_TRIAGE_DELIVERABLE_PREFIXES = ["contract.", "memo.", "litigation."] as const;

/** 只有合同类交付物做条款抽取。 */
export const PLAYBOOK_TRIAGE_CONTRACT_PREFIX = "contract.";

export function isPlaybookTriageDeliverableType(deliverableType: string | undefined): boolean {
  const type = (deliverableType ?? "").trim();
  return PLAYBOOK_TRIAGE_DELIVERABLE_PREFIXES.some((prefix) => type.startsWith(prefix));
}

/**
 * 选出本次草稿要用的剧本。
 *
 * 先按 `deliverableTypes` 前缀过滤；过滤后恰好一份才用。
 * 0 份（没依据）或多份（仍然分不清）都返回 undefined，不猜。
 */
export function resolveDraftPlaybook(input: {
  workspaceDir: string;
  deliverableType?: string;
}): Playbook | undefined {
  if (!isPlaybookTriageDeliverableType(input.deliverableType)) {
    return undefined;
  }
  const matching = listWorkspacePlaybooks(input.workspaceDir).filter((summary) =>
    playbookAppliesToDeliverableType(summary, input.deliverableType),
  );
  if (matching.length !== 1) {
    return undefined;
  }
  return loadWorkspacePlaybook(input.workspaceDir, matching[0]?.id ?? "");
}

export function triageDraftAgainstPlaybook(input: {
  workspaceDir: string;
  deliverableType?: string;
  text: string;
}): PlaybookTriage | undefined {
  const playbook = resolveDraftPlaybook(input);
  if (!playbook) {
    return undefined;
  }
  const text = input.text ?? "";
  const isContract = (input.deliverableType ?? "")
    .trim()
    .startsWith(PLAYBOOK_TRIAGE_CONTRACT_PREFIX);
  const observations = isContract
    ? (() => {
        const doc = extractClauses(text);
        return observationsFromDocument({
          playbook,
          text: doc.text,
          clauses: doc.clauses,
        });
      })()
    : observationsFromDocument({ playbook, text });
  return triageAgainstPlaybook({ playbook, observations });
}
