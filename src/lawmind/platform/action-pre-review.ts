/**
 * 动作级审前评审（借鉴评审 D1）——默认 off；shadow 只记不改行为；on 才多问。
 *
 * 不替代确定性闸（permission / playbook deny / legalVerify / machine-verifiers）。
 * 2026-10-01 起没有 pause 工具（send_email 改 inbox_signoff 写入待发信）；
 * 本层只对高风险本机动作（run_host_command）在 on 模式下加问。
 */

import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { irreversibleDisposition } from "../agent/tool-name-sets.js";

export type ActionPreReviewMode = "off" | "shadow" | "on";

export type ActionPreReviewRecommend = "allow" | "ask";

export type ActionPreReviewClassification = {
  toolName: string;
  recommend: ActionPreReviewRecommend;
  /** 为何归入 ask（律师/日志可读，无工程 id 堆砌） */
  reasonZh: string;
  /** 是否本层在 on 模式下会真正打断（与已有 pause 不重复） */
  ownedByThisLayer: boolean;
};

export function resolveActionPreReviewMode(
  env: NodeJS.ProcessEnv = process.env,
): ActionPreReviewMode {
  const raw = (env.LAWMIND_ACTION_PRE_REVIEW ?? "").trim().toLowerCase();
  if (raw === "shadow" || raw === "on" || raw === "off") {
    return raw;
  }
  return "off";
}

/**
 * 分类：pause 工具已不存在（send_email 2026-10-01 改 inbox_signoff）；保留分支
 * 仅为语义完整。on 模式本层加问：run_host_command（本机命令可能改状态）。
 */
export function classifyActionForPreReview(toolName: string): ActionPreReviewClassification {
  const n = toolName.trim();
  const disposition = irreversibleDisposition(n);
  if (disposition === "pause") {
    return {
      toolName: n,
      recommend: "ask",
      reasonZh: "不可逆外发，须律师确认",
      ownedByThisLayer: false,
    };
  }
  if (n === "run_host_command") {
    return {
      toolName: n,
      recommend: "ask",
      reasonZh: "本机命令可能改动文件或状态，须律师确认",
      ownedByThisLayer: true,
    };
  }
  if (disposition === "inbox_signoff") {
    return {
      toolName: n,
      recommend: "allow",
      reasonZh: "只写入待发信，发送另有批准",
      ownedByThisLayer: false,
    };
  }
  return {
    toolName: n,
    recommend: "allow",
    reasonZh: "常规动作",
    ownedByThisLayer: false,
  };
}

export type ActionPreReviewDecision = {
  mode: ActionPreReviewMode;
  classification: ActionPreReviewClassification;
  /** 是否应在本中间件返回 approvalRequest */
  shouldAsk: boolean;
  /** shadow 是否应落盘 */
  shouldRecord: boolean;
};

export function resolveActionPreReview(input: {
  toolName: string;
  alreadyApproved: boolean;
  mode?: ActionPreReviewMode;
}): ActionPreReviewDecision {
  const mode = input.mode ?? resolveActionPreReviewMode();
  const classification = classifyActionForPreReview(input.toolName);
  if (mode === "off") {
    return { mode, classification, shouldAsk: false, shouldRecord: false };
  }
  const interesting = classification.recommend === "ask" || classification.ownedByThisLayer;
  const shouldRecord = mode === "shadow" || mode === "on" ? interesting : false;
  const shouldAsk =
    mode === "on" &&
    classification.ownedByThisLayer &&
    classification.recommend === "ask" &&
    !input.alreadyApproved;
  return { mode, classification, shouldAsk, shouldRecord };
}

export function actionPreReviewLogPath(workspaceDir: string): string {
  return path.join(workspaceDir, "lawmind", "decision", "action-pre-review.jsonl");
}

export function recordActionPreReviewShadow(
  workspaceDir: string,
  row: {
    toolName: string;
    mode: ActionPreReviewMode;
    recommend: ActionPreReviewRecommend;
    reasonZh: string;
    wouldAsk: boolean;
    sessionId?: string;
  },
): void {
  const file = actionPreReviewLogPath(workspaceDir);
  mkdirSync(path.dirname(file), { recursive: true });
  const line = JSON.stringify({
    recordedAt: new Date().toISOString(),
    ...row,
  });
  appendFileSync(file, `${line}\n`, "utf8");
}

export function actionPreReviewLogExists(workspaceDir: string): boolean {
  return existsSync(actionPreReviewLogPath(workspaceDir));
}
