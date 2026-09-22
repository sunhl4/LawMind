/**
 * G3：判断项明细 + 待定夺项 API。
 *
 * 律师可见面只出现「什么项目、由谁判的、为什么需要您定夺」——
 * **`itemKey`/判定表键是内部 id，不出现在 API 的律师面字段里**（见 `ui-copy-lint` 禁词表）。
 * 需要 id 的地方只在工程侧（`items[].key`，供后续 POST 回填），且客户端不得直接渲染。
 */

import { listDrafts } from "../../../src/lawmind/drafts/index.js";
import {
  readGuardianItemOutcomes,
  summarizeGuardianItemOutcomes,
} from "../../../src/lawmind/guardian/item-outcome.js";
import { ITEM_JUDGMENTS } from "../../../src/lawmind/guardian/item-judgments.js";
import { judgmentLabel } from "../../../src/lawmind/delivery/judgment-labels.js";
import {
  formatJudgmentCoverageNote,
  readJudgmentEscalation,
} from "../../../src/lawmind/platform/judgment-escalation.js";
import {
  isLawyerEscalationAvailable,
  resolveEscalationPosture,
} from "../../../src/lawmind/policy/judgment-tiering.js";
import { readWorkspacePolicyFile } from "../../../src/lawmind/policy/workspace-policy.js";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";
import { sendJson } from "./lawmind-server-helpers.js";
import { sendJsonError } from "./lawmind-api-error.js";

/** 判定表键 → 律师可读标签（缺省回落到键本身，绝不留空）。 */
function labelFor(key: string): string {
  return judgmentLabel(key);
}

/**
 * 升级通道的**可展示性自述**。
 *
 * 为什么必须回给客户端（而不是让界面自己猜）：
 *
 * - `channel: "off"` —— 升级通道没接通，主观项仍由模型判。此时"待定夺列表为空"
 *   **不是**「本件没有取舍事项」，而是「这批项这一轮还没被摘出来」。两者对律师的含义不同，
 *   界面不能自己编一个。
 * - `posture: "advisory"` / `"block"` —— 决定文案口径：`advisory`（单人执业缺省）
 *   **不打断**，只是把系统没替律师决定的事摆出来；`block` 已经在对话里停下等确认。
 *   同一个列表，两种说法；说错一种会让律师以为流程被卡住（或以为没人管）。
 *
 * 两者都来自**服务端**的解析结果，与引擎实际行为同源——界面不重复实现这套判定。
 *
 * 「与引擎同源」这条要能成立，两边就得用**同一份输入**：都按工作区策略文件解析
 * （`policy` 显式 → env → edition 缺省）。此前这里也是无参调用，于是
 * `lawmind.policy.json` 里的 `judgmentEscalation` / `judgmentEscalationPosture` /
 * `edition` 对界面口径不生效——只有 env 生效，界面会播报一个引擎并不遵守的姿态。
 */
function escalationChannelView(workspaceDir: string): {
  channel: "off" | "on";
  posture: "advisory" | "block";
} {
  const policy = readWorkspacePolicyFile(workspaceDir);
  return {
    channel: isLawyerEscalationAvailable({ policy }) ? "on" : "off",
    posture: resolveEscalationPosture({ policy }),
  };
}

export function handleJudgmentRoutes({
  ctx,
  pathname,
  req,
  res,
  c,
  url,
}: LawmindRouteContext): boolean {
  const { workspaceDir } = ctx;

  // ── GET /api/judgment/summary ── 逐项战绩（按项聚合，供 Doctor / 审核台）
  if (pathname === "/api/judgment/summary" && req.method === "GET") {
    const summary = summarizeGuardianItemOutcomes(workspaceDir);
    if (!summary.present) {
      // 缺数据诚实报缺，**不编 0%**。
      sendJson(res, 200, { ok: true, present: false, total: 0, byItem: [], items: [] }, c);
      return true;
    }
    sendJson(
      res,
      200,
      {
        ok: true,
        present: true,
        total: summary.total,
        skippedLines: summary.skippedLines,
        items: summary.byItem.map((row) => ({
          key: row.itemKey,
          label: labelFor(row.itemKey),
          tier: row.tier,
          samples: row.samples,
          decided: row.decided,
          notCovered: row.notCovered,
          unavailable: row.unavailable,
          conflicts: row.conflicts,
          // 无已决样本时是 null，不是 0。
          notCoveredRate: row.notCoveredRate,
        })),
      },
      c,
    );
    return true;
  }

  // ── GET /api/judgment/task?taskId=… ── 单任务的判定明细 + 待定夺项
  if (pathname === "/api/judgment/task" && req.method === "GET") {
    const taskId = url.searchParams.get("taskId")?.trim() ?? "";
    if (!taskId) {
      sendJsonError(res, 400, "missing_task_id", "缺少 taskId。", c);
      return true;
    }
    const read = readGuardianItemOutcomes(workspaceDir);
    const rows = read.rows.filter((r) => r.taskId === taskId);
    const escalation = readJudgmentEscalation(workspaceDir, taskId);
    const channelView = escalationChannelView(workspaceDir);

    const notCovered = rows.filter((r) => r.supported === false && r.unavailable !== true);
    const unavailable = rows.filter((r) => r.unavailable === true);
    const machineCount = rows.filter((r) => r.decidedBy === "machine").length;
    const judgedCount = rows.filter((r) => r.decidedBy === "model").length;

    sendJson(
      res,
      200,
      {
        ok: true,
        taskId,
        present: read.present && rows.length > 0,
        // 升级通道状态（决定界面文案口径，见 escalationChannelView 的注释）。
        escalationChannel: channelView.channel,
        escalationPosture: channelView.posture,
        coverageNote: formatJudgmentCoverageNote({
          checkedTotal: rows.length,
          machineCount,
          escalatedCount: escalation.items.length,
        }),
        counts: {
          total: rows.length,
          machine: machineCount,
          judged: judgedCount,
          decidedByLawyer: rows.filter((r) => r.decidedBy === "lawyer").length,
          notCovered: notCovered.length,
          unavailable: unavailable.length,
        },
        // 未覆盖项（律师要看的重点）。
        notCovered: notCovered.map((r) => ({
          key: r.itemKey,
          label: labelFor(r.itemKey),
          tier: r.tier,
        })),
        unavailable: unavailable.map((r) => ({
          key: r.itemKey,
          label: labelFor(r.itemKey),
        })),
        /** 待律师定夺（主观裁量项）。**已剥掉内部 id**。 */
        escalation: escalation.items.map((i) => ({
          label: i.label,
          reason: i.reason,
        })),
      },
      c,
    );
    return true;
  }

  // ── GET /api/judgment/escalations ── 全工作区待定夺清单（按草稿）
  if (pathname === "/api/judgment/escalations" && req.method === "GET") {
    const channelView = escalationChannelView(workspaceDir);
    const drafts = listDrafts(workspaceDir);
    const rows: Array<{
      taskId: string;
      title: string;
      deliverableType?: string;
      items: Array<{ label: string; reason: string }>;
    }> = [];
    for (const draft of drafts.slice(0, 200)) {
      const taskId = draft.taskId?.trim();
      if (!taskId) {
        continue;
      }
      const escalation = readJudgmentEscalation(workspaceDir, taskId);
      if (!escalation.present) {
        continue;
      }
      rows.push({
        taskId,
        title: draft.title ?? "",
        ...(draft.deliverableType ? { deliverableType: draft.deliverableType } : {}),
        items: escalation.items.map((i) => ({ label: i.label, reason: i.reason })),
      });
    }
    sendJson(
      res,
      200,
      {
        ok: true,
        present: rows.length > 0,
        escalationChannel: channelView.channel,
        escalationPosture: channelView.posture,
        tasks: rows,
      },
      c,
    );
    return true;
  }

  // ── GET /api/judgment/tiering ── 分级覆盖自述（Doctor）
  if (pathname === "/api/judgment/tiering" && req.method === "GET") {
    const byTier = { machine: 0, judge: 0, lawyer: 0 };
    for (const j of Object.values(ITEM_JUDGMENTS)) {
      byTier[j.tier] += 1;
    }
    sendJson(
      res,
      200,
      {
        ok: true,
        /** 判定表总项数——「这次核对了多少项」的分母。 */
        tableSize: Object.keys(ITEM_JUDGMENTS).length,
        byTier,
        byItem: Object.fromEntries(
          Object.entries(ITEM_JUDGMENTS).map(([key, j]) => [key, j.tier]),
        ),
      },
      c,
    );
    return true;
  }

  return false;
}
