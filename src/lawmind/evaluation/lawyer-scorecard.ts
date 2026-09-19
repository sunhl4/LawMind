/**
 * 律师个人「交办成绩单」（对标 Harvey Command Center 的个人版）。
 *
 * 只读汇总本机指标：交办一次通过率、lint 拦截率、真稿比对趋势、法源直播状态。
 * 不新增采集；数据来自既有 product-metrics / north-star / 真稿闸门报告 / 法源状态。
 */

import fs from "node:fs";
import path from "node:path";
import type { TrueManuscriptReport } from "../evaluation/true-manuscript-gate.js";
import { buildNorthStarSnapshot, readNorthStarSnapshot } from "../metrics/north-star.js";
import { summarizeProductMetrics } from "../metrics/product-metrics.js";
import { isAuthorityLive, isAuthorityOfficialPublic } from "../retrieval/authority-source-tier.js";

export type ScorecardRow = {
  id: string;
  label: string;
  /** 展示值（已格式化；无样本时为「暂无样本」）。 */
  value: string;
  /** 0–1；无样本时 null。 */
  rate: number | null;
  detail?: string;
};

export type LawyerScorecard = {
  generatedAt: string;
  rows: ScorecardRow[];
  trueManuscript: {
    status: TrueManuscriptReport["status"] | "not_run";
    passed: number;
    total: number;
    detail: string;
  };
  authority: {
    live: boolean;
    officialPublic: boolean;
    label: string;
  };
};

function pct(rate: number | null): string {
  return rate == null ? "暂无样本" : `${Math.round(rate * 100)}%`;
}

function readTrueManuscriptReport(workspaceDir: string): TrueManuscriptReport | undefined {
  try {
    const raw = JSON.parse(
      fs.readFileSync(
        path.join(workspaceDir, "lawmind", "metrics", "true-manuscript-report.json"),
        "utf8",
      ),
    ) as TrueManuscriptReport;
    return raw && typeof raw.status === "string" ? raw : undefined;
  } catch {
    return undefined;
  }
}

export function buildLawyerScorecard(workspaceDir: string, now = new Date()): LawyerScorecard {
  const northStar = readNorthStarSnapshot(workspaceDir) ?? buildNorthStarSnapshot(workspaceDir);
  const product = summarizeProductMetrics(workspaceDir);

  const rewrites = product.byKind.rewrite ?? 0;
  const gateFailures = product.gateFailures;
  const lintBlocked = product.byKind.lint_escape ?? 0;
  const deliveries = northStar.samples.deliveries;
  const lintBlockRate =
    deliveries + lintBlocked > 0 ? lintBlocked / (deliveries + lintBlocked) : null;

  const rows: ScorecardRow[] = [
    {
      id: "first_pass",
      label: "一次通过率",
      value: pct(northStar.firstPassRate),
      rate: northStar.firstPassRate,
      detail: `样本 ${northStar.samples.firstPassOk}/${northStar.samples.firstPassOk + northStar.samples.firstPassFail}`,
    },
    {
      id: "unattended",
      label: "无干预办完率",
      value: pct(northStar.unattendedCompleteRate),
      rate: northStar.unattendedCompleteRate,
      detail: `无干预 ${northStar.samples.unattended} · 需拍板 ${northStar.samples.attended}`,
    },
    {
      id: "rewrite",
      label: "需要重写",
      value: deliveries > 0 ? `${rewrites} 次 / ${deliveries} 交件` : "暂无样本",
      rate: deliveries > 0 ? rewrites / deliveries : null,
      detail: "重写越少越省律师时间",
    },
    {
      id: "lint_block",
      label: "机械核对拦截率",
      value: pct(lintBlockRate),
      rate: lintBlockRate,
      detail: `口径：lint 逃逸 ${lintBlocked} / 交件 ${deliveries}`,
    },
    {
      id: "gate_failure",
      label: "核对失败次数",
      value: gateFailures > 0 ? `${gateFailures} 次` : "0 次",
      rate: null,
      detail: "空修订、引用对不上、未试检等硬门禁触发",
    },
  ];

  const report = readTrueManuscriptReport(workspaceDir);
  const trueManuscript = report
    ? {
        status: report.status,
        passed: report.baselines.filter((b) => b.ok).length,
        total: report.baselines.length,
        detail:
          report.status === "skip"
            ? "尚未放入真稿：把脱敏 .docx/.pdf 放进 fixtures/lawmind-true-manuscript/ 后重跑闸门。"
            : `真稿基线 ${report.baselines.filter((b) => b.ok).length}/${report.baselines.length} 通过。`,
      }
    : {
        status: "not_run" as const,
        passed: 0,
        total: 0,
        detail: "还没跑过真稿闸门（pnpm lawmind:true-manuscript）。",
      };

  const live = isAuthorityLive();
  const officialPublic = isAuthorityOfficialPublic();
  const authority = {
    live,
    officialPublic,
    label: live
      ? "商业权威库已连接"
      : officialPublic
        ? "国家法律法规数据库（官方公开）"
        : "仅演示语料（未接权威库）",
  };

  return {
    generatedAt: now.toISOString(),
    rows,
    trueManuscript,
    authority,
  };
}

/** Doctor 区的展示行（含真稿与法源两行）。 */
export function scorecardDisplayRows(scorecard: LawyerScorecard): ScorecardRow[] {
  return [
    ...scorecard.rows,
    {
      id: "true_manuscript",
      label: "真稿比对",
      value:
        scorecard.trueManuscript.status === "not_run"
          ? "未跑"
          : scorecard.trueManuscript.status === "skip"
            ? "未放夹具"
            : `${scorecard.trueManuscript.passed}/${scorecard.trueManuscript.total}`,
      rate: null,
      detail: scorecard.trueManuscript.detail,
    },
    {
      id: "authority",
      label: "法源",
      value: scorecard.authority.label,
      rate: null,
      detail: scorecard.authority.live
        ? "引用可核验到商业库"
        : scorecard.authority.officialPublic
          ? "引用可核验到官方法规库"
          : "正式引用需自行核对原文",
    },
  ];
}
