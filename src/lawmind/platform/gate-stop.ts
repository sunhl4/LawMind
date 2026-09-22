/**
 * 门禁「到此为止」的结构化识别。
 *
 * 背景（真实事故）：独立审稿连续 block 到 `guardian_exhausted` 后，轮次虽已收口，
 * 但本件仍留在 `running`、缺口只散落在对话正文里，律师在「在办/待拍板」看不到
 * 「这一件正等着我处置」。自动化因此还会把同一份材料再派一次。
 *
 * 这里只做一件事：把「验证器已判停」这件事从多个来源归一成一个可复用判定，
 * 供轮次收尾（置待律师 + 生成待办卡片）与自动化防重派共用。
 */

import type { GateDecision } from "./contracts.js";

export type GateStopSignal = {
  stopped: boolean;
  /** 律师面短因（gateDecision.reason 口径）。 */
  reason?: string;
  /** 触发停的缺口码（如 guardian_exhausted）。 */
  codes?: string[];
  /** 缺口摘要（逐条，最多 6 条），用进待办卡片。 */
  gaps?: string[];
};

const EMPTY: GateStopSignal = { stopped: false };

/** 验证器自己写明「不要再改 / 交给律师」的措辞（与 legal-guardian 的收尾指令对齐）。 */
const STOP_PHRASE_RE = /不要继续为过审而改稿|已达审稿轮次上限|请把缺口交给律师|验收已停/;

type TerminalVerifyIssue = { code?: string; message?: string; terminal?: boolean };

export function detectGateStop(input: {
  gateDecisions?: GateDecision[] | null;
  sameTurnVerify?: { issues?: TerminalVerifyIssue[] } | null;
}): GateStopSignal {
  const codes: string[] = [];
  const gaps: string[] = [];
  let reason: string | undefined;

  for (const issue of input.sameTurnVerify?.issues ?? []) {
    if (issue.terminal !== true) {
      continue;
    }
    if (issue.code) {
      codes.push(issue.code);
    }
    if (issue.message?.trim()) {
      gaps.push(issue.message.trim());
    }
  }

  for (const decision of input.gateDecisions ?? []) {
    if (decision.decision !== "block") {
      continue;
    }
    const text = decision.reason?.trim() ?? "";
    if (!text) {
      continue;
    }
    if (STOP_PHRASE_RE.test(text)) {
      reason = reason ?? text;
      continue;
    }
    // 缺口码直报（`[guardian_exhausted] …`）时也算停。
    if (/guardian_exhausted/.test(text)) {
      reason = reason ?? text;
      codes.push("guardian_exhausted");
    }
  }

  if (codes.length === 0 && !reason) {
    return EMPTY;
  }
  return {
    stopped: true,
    ...(reason ? { reason } : {}),
    ...(codes.length > 0 ? { codes: [...new Set(codes)] } : {}),
    ...(gaps.length > 0 ? { gaps: gaps.slice(0, 6) } : {}),
  };
}

/** 待办卡片正文：把缺口原样给律师，不要把工程师码当结论。 */
export function formatGateStopSummary(signal: GateStopSignal): string {
  const lines = ["验证器已把本件停下（继续为过审改稿没有意义），缺口需要您处置："];
  for (const gap of signal.gaps ?? []) {
    lines.push(`- ${gap}`);
  }
  if ((signal.gaps ?? []).length === 0 && signal.reason) {
    lines.push(`- ${signal.reason}`);
  }
  lines.push("", "处置后可以让我接着改，或另出意见书。");
  return lines.join("\n");
}
