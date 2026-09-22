/**
 * Infer 咨询→立案→一审→裁判→执行/上诉 from the instruction.
 * Writes a header line; does not add a new 办件 or invent a docket.
 */

import {
  APPEAL_RE,
  CRIMINAL_MATTER_RE,
  ENFORCEMENT_RE,
  FILING_PACK_RE,
} from "../skills/capability-patterns.js";

export type LitigationStage =
  | "consult"
  | "filing"
  | "first_instance"
  | "judgment"
  | "appeal"
  | "enforcement"
  | "criminal"
  | "unknown";

export type InferredLitigationStage = {
  stage: LitigationStage;
  label: string;
  assumed: boolean;
};

const STAGE_LABEL: Record<LitigationStage, string> = {
  consult: "咨询",
  filing: "立案",
  first_instance: "一审",
  judgment: "裁判",
  appeal: "上诉",
  enforcement: "执行",
  criminal: "刑事程序",
  unknown: "未写明",
};

export function inferLitigationStage(instruction: string): InferredLitigationStage {
  const text = instruction.trim();
  if (!text) {
    return { stage: "unknown", label: STAGE_LABEL.unknown, assumed: true };
  }
  if (CRIMINAL_MATTER_RE.test(text)) {
    return { stage: "criminal", label: STAGE_LABEL.criminal, assumed: false };
  }
  if (APPEAL_RE.test(text) || /不服.{0,8}(判决|裁定)/.test(text)) {
    return { stage: "appeal", label: STAGE_LABEL.appeal, assumed: false };
  }
  if (ENFORCEMENT_RE.test(text) || /执行案号/.test(text)) {
    return { stage: "enforcement", label: STAGE_LABEL.enforcement, assumed: false };
  }
  if (FILING_PACK_RE.test(text)) {
    return { stage: "filing", label: STAGE_LABEL.filing, assumed: false };
  }
  if (/判决书|裁定书|一审判决|已判决/.test(text)) {
    return { stage: "judgment", label: STAGE_LABEL.judgment, assumed: false };
  }
  if (/传票|开庭|举证期限|质证/.test(text)) {
    return { stage: "first_instance", label: STAGE_LABEL.first_instance, assumed: false };
  }
  if (/起诉状|写起诉/.test(text)) {
    return { stage: "first_instance", label: STAGE_LABEL.first_instance, assumed: false };
  }
  if (/能不能告|咨询一下|是否起诉/.test(text)) {
    return { stage: "consult", label: STAGE_LABEL.consult, assumed: false };
  }
  return { stage: "unknown", label: STAGE_LABEL.unknown, assumed: true };
}

export function formatLitigationStageLine(instruction: string): string {
  const inf = inferLitigationStage(instruction);
  if (inf.stage === "criminal") {
    return `阶段：${inf.label}。不要套民事起诉状。`;
  }
  if (inf.assumed) {
    return `阶段（按材料推定）：${inf.label}。材料不够按最接近阶段写。`;
  }
  return `阶段：${inf.label}。`;
}
