/**
 * Seed a realistic litigation file + a light contract matter into a workspace
 * so the lawyer desk can be walked with live dates, summons, mail, and drafts.
 * Idempotent: stable ids, skip rows that already exist.
 */

import fs from "node:fs";
import path from "node:path";
import { loadMatter, readApprovals, saveMatter } from "../adapters/matter-storage/index.js";
import { requestApproval } from "../application/services/approval-service.js";
import {
  completeDeadline,
  listDeadlinesForMatter,
  recordDeadline,
} from "../application/services/deadline-service.js";
import {
  createMatterIfMissing,
  drainMatterProjections,
  updateMatterProfile,
} from "../application/services/matter-write-service.js";
import { persistDraft } from "../drafts/index.js";
import { caseFilePath } from "../memory/case-workspace.js";
import { writeMatterMailMessage } from "../platform/lawyer-automations.js";
import { ensureTaskRecord, updateTaskRecord } from "../tasks/index.js";
import type { ArtifactDraft, TaskIntent, TaskLifecycleStatus } from "../types.js";
import { loadDailyPlan, localDateKey, saveDailyPlan } from "./daily-plan.js";
import { compileIntakeBrief, saveIntakeBrief } from "./intake-brief.js";

export const SAMPLE_LITIGATION_MATTER_ID = "xinghui-sale-876";
export const SAMPLE_CONTRACT_MATTER_ID = "xinghui-nda-2026";
export const SAMPLE_CLOSED_MATTER_ID = "lianhua-sale-2022";

const PLAN_REF = "sample-desk-seed";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Local wall-clock stamp without Z, matching desk deadline parsing. */
export function localStamp(now: Date, dayOffset: number, hour: number, minute = 0): string {
  const d = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + dayOffset,
    hour,
    minute,
    0,
    0,
  );
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
}

function isoDaysAgo(now: Date, days: number, hour = 9): string {
  const d = new Date(now.getTime() - days * 86_400_000);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

function hasDeadline(workspaceDir: string, matterId: string, deadlineId: string): boolean {
  return listDeadlinesForMatter(workspaceDir, matterId).some(
    (row) => row.deadlineId === deadlineId,
  );
}

function ensureDeadline(workspaceDir: string, input: Parameters<typeof recordDeadline>[1]): void {
  if (input.deadlineId && hasDeadline(workspaceDir, input.matterId, input.deadlineId)) {
    return;
  }
  recordDeadline(workspaceDir, input);
}

function taskIntent(
  partial: Omit<TaskIntent, "models" | "requiresConfirmation"> & { requiresConfirmation?: boolean },
): TaskIntent {
  return {
    ...partial,
    models: ["legal"],
    requiresConfirmation: partial.requiresConfirmation ?? true,
  };
}

function seedTask(
  workspaceDir: string,
  intent: TaskIntent,
  status: TaskLifecycleStatus,
  title: string,
): void {
  ensureTaskRecord(workspaceDir, intent);
  updateTaskRecord(workspaceDir, intent.taskId, { status, title });
}

function seedDraft(workspaceDir: string, draft: ArtifactDraft): void {
  const existing = path.join(workspaceDir, "drafts", `${draft.taskId}.json`);
  if (fs.existsSync(existing)) {
    return;
  }
  persistDraft(workspaceDir, draft);
}

function replaceFromSection2(raw: string, rest: string): string {
  const idx = raw.search(/\n## 2\./);
  if (idx >= 0) {
    return `${raw.slice(0, idx).trimEnd()}\n\n${rest.trimEnd()}\n`;
  }
  return `${raw.trimEnd()}\n\n${rest.trimEnd()}\n`;
}

async function writeCaseRest(workspaceDir: string, matterId: string, rest: string): Promise<void> {
  const file = caseFilePath(workspaceDir, matterId);
  const raw = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, replaceFromSection2(raw, rest), "utf8");
}

async function seedLitigation(workspaceDir: string, now: Date): Promise<void> {
  const matterId = SAMPLE_LITIGATION_MATTER_ID;
  createMatterIfMissing(workspaceDir, {
    matterId,
    title: "星辉精密诉环宇科技 · 买卖合同纠纷",
    status: "active",
    matterKind: "litigation",
    clientId: "星辉精密设备有限公司",
    ownerLawyerId: "陈律师",
    docket: {
      caseNo: "（2024）沪01民初876号",
      court: "上海市第一中级人民法院",
      instance: "一审",
      standing: "原告代理",
      hearingAt: localStamp(now, 9, 9, 0),
    },
  });
  await updateMatterProfile(workspaceDir, {
    matterId,
    status: "active",
    title: "星辉精密诉环宇科技 · 买卖合同纠纷",
    clientId: "星辉精密设备有限公司",
    counterparty: "环宇科技股份有限公司",
    causeOfAction: "买卖合同纠纷",
    matterKind: "litigation",
    docket: {
      caseNo: "（2024）沪01民初876号",
      court: "上海市第一中级人民法院",
      instance: "一审",
      standing: "原告代理",
      hearingAt: localStamp(now, 9, 9, 0),
    },
  });
  const rec = loadMatter(workspaceDir, matterId);
  if (rec) {
    saveMatter(workspaceDir, {
      ...rec,
      createdAt: "2026-04-12T01:30:00.000Z",
      ownerLawyerId: "陈律师",
      updatedAt: rec.updatedAt,
    });
  }

  const hearingAt = localStamp(now, 9, 9, 0);
  const evidenceAt = localStamp(now, 3, 17, 0);
  const todayFilingAt = localStamp(now, 0, 17, 0);
  ensureDeadline(workspaceDir, {
    matterId,
    deadlineId: "sample-876-hearing",
    title: "开庭（第三法庭）",
    dueAt: hearingAt,
    eventKind: "hearing",
    source: "document_extract",
    notes: "传票载明：2026年请携带身份证件及授权委托书到第三法庭应诉。",
  });
  ensureDeadline(workspaceDir, {
    matterId,
    deadlineId: "sample-876-evidence",
    title: "举证期限届满",
    dueAt: evidenceAt,
    eventKind: "limitation",
    source: "document_extract",
    notes: "举证通知书：逾期提交的证据，法院可能不予组织质证。",
  });
  ensureDeadline(workspaceDir, {
    matterId,
    deadlineId: "sample-876-today-list",
    title: "向法院提交补充证据说明",
    dueAt: todayFilingAt,
    eventKind: "filing",
    source: "manual",
    notes: "审判员今天上午电话：今日 17:00 前补交付款凭证目录。",
  });
  if (!hasDeadline(workspaceDir, matterId, "sample-876-filed")) {
    recordDeadline(workspaceDir, {
      matterId,
      deadlineId: "sample-876-filed",
      title: "立案材料提交",
      dueAt: "2026-05-20T16:00:00",
      eventKind: "filing",
      source: "manual",
    });
    completeDeadline(workspaceDir, matterId, "sample-876-filed");
  }

  writeMatterMailMessage(workspaceDir, matterId, {
    id: "sample-876-summons",
    from: "上海一中院诉讼服务 <litigation@court.example>",
    to: "chen@firm.example",
    subject: "传票 · （2024）沪01民初876号 开庭通知",
    receivedAt: isoDaysAgo(now, 12, 10),
    bodyText:
      "星辉精密设备有限公司：本院受理你司与环宇科技股份有限公司买卖合同纠纷一案。传票：请于开庭日 09:00 到第三法庭参加诉讼。案号（2024）沪01民初876号。请携带身份证件及授权委托书。12368 可查询排期。",
    attachments: [{ name: "传票.pdf" }, { name: "举证通知书.pdf" }],
  });
  writeMatterMailMessage(workspaceDir, matterId, {
    id: "sample-876-client",
    from: "王敏 <wang.min@xinghui.example>",
    to: "chen@firm.example",
    subject: "今晚代理意见三页要点请尽快确认",
    receivedAt: localStamp(now, 0, 8, 22),
    bodyText:
      "陈律师，您好。老板问今晚能否把代理意见的三页要点发我？烦请今日回复。另外付款凭证扫描件我下午四点前传到网盘。",
    attachments: [],
  });
  writeMatterMailMessage(workspaceDir, matterId, {
    id: "sample-876-opp",
    from: "对方代理 李律师 <li@globaltech.example>",
    to: "chen@firm.example",
    subject: "和解协议修订稿.docx 请阅",
    receivedAt: isoDaysAgo(now, 1, 16),
    bodyText: "陈律师：附件为和解协议修订稿，请贵司确认是否同意第 4 条分期付款安排。",
    attachments: [{ name: "和解协议修订稿.docx" }],
  });

  const complaintId = "sample-876-complaint";
  const evidenceTaskId = "sample-876-evidence-list";
  const briefId = "sample-876-brief";
  seedTask(
    workspaceDir,
    taskIntent({
      taskId: complaintId,
      kind: "draft.word",
      output: "docx",
      instruction: "根据本案卷宗起草民事起诉状",
      summary: "起草民事起诉状",
      matterId,
      createdAt: isoDaysAgo(now, 40),
      deliverableType: "litigation.complaint",
    }),
    "drafted",
    "起草民事起诉状",
  );
  seedTask(
    workspaceDir,
    taskIntent({
      taskId: evidenceTaskId,
      kind: "draft.word",
      output: "docx",
      instruction: "整理向法院提交的证据目录",
      summary: "整理证据目录",
      matterId,
      createdAt: isoDaysAgo(now, 8),
    }),
    "drafted",
    "整理证据目录",
  );
  seedTask(
    workspaceDir,
    taskIntent({
      taskId: briefId,
      kind: "draft.word",
      output: "docx",
      instruction: "起草开庭代理词提纲",
      summary: "起草代理词提纲",
      matterId,
      createdAt: isoDaysAgo(now, 2),
    }),
    "drafted",
    "起草代理词提纲",
  );
  seedTask(
    workspaceDir,
    taskIntent({
      taskId: "sample-876-conflict",
      kind: "research.legal",
      output: "none",
      instruction: "冲突检索",
      summary: "冲突检索",
      matterId,
      createdAt: isoDaysAgo(now, 120),
      requiresConfirmation: false,
    }),
    "completed",
    "冲突检索",
  );

  seedDraft(workspaceDir, {
    taskId: complaintId,
    matterId,
    title: "民事起诉状",
    output: "docx",
    templateId: "litigation/complaint",
    summary: "请求解除合同、返还定金 280 万元并赔偿逾期交货损失。",
    audience: "court",
    sections: [
      {
        heading: "诉讼请求",
        body: "1. 解除双方 2024 年 1 月 8 日签订的《精密部件采购合同》；\n2. 判令被告返还定金 280 万元；\n3. 判令被告赔偿因逾期交货造成的停工损失 46 万元。",
      },
      {
        heading: "事实与理由",
        body: "原告已按约支付定金。被告迟延至 2024 年 3 月仍未交付约定规格的主轴部件，经催告后仍未履行。",
      },
    ],
    reviewNotes: [],
    reviewStatus: "pending",
    createdAt: isoDaysAgo(now, 6),
  });
  seedDraft(workspaceDir, {
    taskId: evidenceTaskId,
    matterId,
    title: "证据目录",
    output: "docx",
    templateId: "litigation/evidence-list",
    summary: "合同、定金收据、催告函、往来邮件。付款凭证待客户今日补扫。",
    audience: "court",
    sections: [{ heading: "证据一", body: "《精密部件采购合同》原件。" }],
    reviewNotes: [],
    reviewStatus: "pending",
    createdAt: isoDaysAgo(now, 3),
  });
  const briefOut = path.join("artifacts", "星辉-代理词提纲.docx");
  fs.mkdirSync(path.join(workspaceDir, "artifacts"), { recursive: true });
  const briefAbs = path.join(workspaceDir, briefOut);
  if (!fs.existsSync(briefAbs)) {
    fs.writeFileSync(briefAbs, "LawMind sample brief outline placeholder\n", "utf8");
  }
  seedDraft(workspaceDir, {
    taskId: briefId,
    matterId,
    title: "代理词提纲",
    output: "docx",
    templateId: "litigation/brief",
    summary: "围绕解除权、定金罚则与损失举证三条线。",
    audience: "internal",
    sections: [
      { heading: "要点", body: "解除条件已成就；定金依法不返还抗辩不能成立；损失需补齐停工台账。" },
    ],
    reviewNotes: [],
    reviewStatus: "approved",
    reviewedBy: "陈律师",
    reviewedAt: isoDaysAgo(now, 1),
    outputPath: briefOut,
    createdAt: isoDaysAgo(now, 2),
  });

  if (
    !readApprovals(workspaceDir, matterId).some(
      (a) => a.approvalId === "sample-876-approve-complaint",
    )
  ) {
    requestApproval(workspaceDir, {
      matterId,
      approvalId: "sample-876-approve-complaint",
      requestedBy: "助理-周",
      reason: "民事起诉状拟提交法院，请拍板是否按现稿立案",
      riskLevel: "high",
    });
  }

  const incomingDir = path.join(workspaceDir, "cases", matterId, "incoming");
  fs.mkdirSync(incomingDir, { recursive: true });
  const summonsPath = path.join(incomingDir, "传票-沪01民初876号.txt");
  if (!fs.existsSync(summonsPath)) {
    fs.writeFileSync(
      summonsPath,
      `上海市第一中级人民法院 传票\n案号：（2024）沪01民初876号\n案由：买卖合同纠纷\n原告：星辉精密设备有限公司\n被告：环宇科技股份有限公司\n开庭时间：${hearingAt.replace("T", " ")}\n地点：第三法庭\n`,
      "utf8",
    );
  }

  const talk = [
    "客户王敏说希望解除合同并要回 280 万定金。",
    "已付定金，合同约定 2024 年 2 月底交货，实际一直未交主轴部件。",
    "对方主张疫情和供应商停产，但催告函发过两次。",
    "务必在开庭前补齐银行转账凭证和停工台账。",
  ].join("\n");
  if (!fs.existsSync(path.join(workspaceDir, "matters", matterId, "intake-brief.json"))) {
    const brief = compileIntakeBrief({ matterId, transcript: talk, workspaceDir });
    await saveIntakeBrief(workspaceDir, {
      ...brief,
      confirmedAt: isoDaysAgo(now, 5),
      nextActions: ["今日 17:00 前提交补充证据说明", "补银行转账凭证", "把代理词三页要点发给客户"],
    });
  }

  await writeCaseRest(
    workspaceDir,
    matterId,
    `## 2. 当事人

- 甲方: 星辉精密设备有限公司（原告 / 客户）
- 乙方: 环宇科技股份有限公司（被告）
- 其他相关方: 主轴部件次级供应商（未列为本案被告）

## 3. 事实摘要

- 2024-01-08 双方签订《精密部件采购合同》，标的为数控机床主轴部件 12 套。
- 原告于 2024-01-12 支付定金 280 万元。合同约定 2024-02-29 前交货。
- 被告至 2024-03 仍未交付约定规格部件。原告两次书面催告。
- 2024-04-12 本所收案。2024-05-20 立案。传票已到，开庭日见卷宗。

## 4. 核心争点

- 逾期未交是否构成根本违约、能否解除。
- 定金条款能否适用，对方不可抗力抗辩能否成立。
- 停工损失 46 万元的证据是否充分。

## 5. 证据与材料清单

- 合同原件、定金收据、催告函及快递底单。
- 待补：银行转账凭证、停工台账、对方回复邮件原件。
- 传票与举证通知书见 incoming/传票-沪01民初876号.txt。

## 6. 当前任务目标

- 今日向法院提交补充证据说明。
- 起诉状待拍板后提交。
- 开庭代理词要点今晚回客户。

## 7. 风险与待确认事项

- 付款凭证若今日补不齐，举证期限届满后可能无法质证。
- 和解协议修订稿尚未表态，避免与起诉请求口径冲突。

## 8. 工作进展记录

- [2026-04-12] 收案、冲突检索完成。
- [2026-05-20] 立案材料提交。
- [2026-08-28] 收到开庭传票及举证通知书。
- [今日] 审判员电话要求 17:00 前补证据目录说明。

## 9. 生成产物

- 民事起诉状（待审核）
- 证据目录（待客户补扫描件）
- 代理词提纲 -> ${briefOut}
- 传票摘录 -> cases/${matterId}/incoming/传票-沪01民初876号.txt
`,
  );
}

async function seedContract(workspaceDir: string, now: Date): Promise<void> {
  const matterId = SAMPLE_CONTRACT_MATTER_ID;
  createMatterIfMissing(workspaceDir, {
    matterId,
    title: "星辉 × 环宇 采购框架协议审查",
    status: "under_review",
    matterKind: "contract",
    clientId: "星辉精密设备有限公司",
    ownerLawyerId: "陈律师",
  });
  await updateMatterProfile(workspaceDir, {
    matterId,
    status: "under_review",
    title: "星辉 × 环宇 采购框架协议审查",
    clientId: "星辉精密设备有限公司",
    counterparty: "环宇科技股份有限公司",
    causeOfAction: "合同审查",
    matterKind: "contract",
  });
  ensureDeadline(workspaceDir, {
    matterId,
    deadlineId: "sample-nda-renew",
    title: "框架协议续约窗口",
    dueAt: localStamp(now, 14, 18, 0),
    eventKind: "custom",
    notes: "客户希望开庭前谈完框架协议，避免两案口径打架。",
  });
  const taskId = "sample-nda-review";
  seedTask(
    workspaceDir,
    taskIntent({
      taskId,
      kind: "analyze.contract",
      output: "docx",
      instruction: "审查采购框架协议违约金与解约条款",
      summary: "审查采购框架协议",
      matterId,
      createdAt: isoDaysAgo(now, 4),
      deliverableType: "contract.review",
    }),
    "drafted",
    "审查采购框架协议",
  );
  seedDraft(workspaceDir, {
    taskId,
    matterId,
    title: "采购框架协议审查意见",
    output: "docx",
    templateId: "contract/review",
    summary: "解约通知期过短，建议与诉讼请求中的解除权表述对齐。",
    audience: "client",
    sections: [
      { heading: "主要风险", body: "第 8 条违约金上限偏低；第 12 条单方解约通知期仅 3 日。" },
    ],
    reviewNotes: [],
    reviewStatus: "pending",
    createdAt: isoDaysAgo(now, 1),
  });
}

async function seedClosedSimilar(workspaceDir: string): Promise<void> {
  const matterId = SAMPLE_CLOSED_MATTER_ID;
  createMatterIfMissing(workspaceDir, {
    matterId,
    title: "联华机械诉某供应商 · 买卖合同纠纷（已结）",
    status: "closed",
    matterKind: "litigation",
    clientId: "联华机械",
    ownerLawyerId: "陈律师",
  });
  await updateMatterProfile(workspaceDir, {
    matterId,
    status: "closed",
    counterparty: "某部件供应商",
    causeOfAction: "买卖合同纠纷",
    matterKind: "litigation",
    docket: {
      caseNo: "（2022）沪0115民初2201号",
      court: "上海市浦东新区人民法院",
      instance: "一审",
      standing: "原告代理",
    },
  });
  await writeCaseRest(
    workspaceDir,
    matterId,
    `## 2. 当事人

- 甲方: 联华机械（原告）
- 乙方: 某部件供应商（被告）

## 3. 事实摘要

- 买方已付定金，卖方逾期未交货。后调解结案，定金退还。

## 4. 核心争点

- 买卖合同纠纷中解除权与定金罚则如何并用。

## 5. 证据与材料清单

- 合同、定金收据、催告函。付款凭证在举证期限前补齐，质证顺利。

## 9. 生成产物

- 调解书（已归档）
`,
  );
}

async function seedTodayPlan(workspaceDir: string, now: Date): Promise<void> {
  const date = localDateKey(now);
  const plan = loadDailyPlan(workspaceDir, date);
  if (plan.items.some((item) => item.sourceRef === PLAN_REF)) {
    return;
  }
  const createdAt = now.toISOString();
  plan.items.push(
    {
      id: "sample-desk-plan-evidence",
      text: "核对本案证据清单是否齐（星辉诉环宇）",
      done: false,
      source: "lawyer",
      sourceRef: PLAN_REF,
      matterId: SAMPLE_LITIGATION_MATTER_ID,
      createdAt,
    },
    {
      id: "sample-desk-plan-reply",
      text: "给星辉法务回今晚代理意见三页要点",
      done: false,
      source: "lawyer",
      sourceRef: PLAN_REF,
      matterId: SAMPLE_LITIGATION_MATTER_ID,
      createdAt,
    },
    {
      id: "sample-desk-plan-conflict",
      text: "冲突检索（星辉诉环宇）",
      done: true,
      source: "lawyer",
      sourceRef: PLAN_REF,
      matterId: SAMPLE_LITIGATION_MATTER_ID,
      createdAt,
    },
  );
  await saveDailyPlan(workspaceDir, plan);
}

export async function seedSampleDesk(
  workspaceDir: string,
  now = new Date(),
): Promise<{
  litigationMatterId: string;
  contractMatterId: string;
  closedMatterId: string;
}> {
  fs.mkdirSync(workspaceDir, { recursive: true });
  await seedLitigation(workspaceDir, now);
  await seedContract(workspaceDir, now);
  await seedClosedSimilar(workspaceDir);
  await seedTodayPlan(workspaceDir, now);
  await drainMatterProjections();
  return {
    litigationMatterId: SAMPLE_LITIGATION_MATTER_ID,
    contractMatterId: SAMPLE_CONTRACT_MATTER_ID,
    closedMatterId: SAMPLE_CLOSED_MATTER_ID,
  };
}
