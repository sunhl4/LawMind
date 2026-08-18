/**
 * Desk 试点包：三场景门禁与绑定，无真实 API key 时走 keyword/规则。
 * 不断言模型质量分。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderDocxWithOptions } from "../artifacts/render-docx.js";
import { describeDraftScaffold, validateDraftAgainstSpec } from "../deliverables/index.js";
import { buildClauseGraphFromDraft } from "../reasoning/clause-graph.js";
import { applyDraftCritic, buildDraft } from "../reasoning/index.js";
import { route } from "../router/index.js";
import { bindSidecarIngestToTask } from "../sidecar/bindings.js";
import { ingestSidecarSelection } from "../sidecar/ingest.js";
import { persistSidecarOutboxFromDraft, readSidecarOutbox } from "../sidecar/outbox.js";
import type { ArtifactDraft, ResearchBundle, TaskIntent } from "../types.js";

const FIXTURE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../workspace/fixtures/desk-pilot",
);

export type DeskPilotCheck = {
  name: string;
  ok: boolean;
  detail: string;
};

export type DeskPilotResult = {
  checks: DeskPilotCheck[];
  failed: DeskPilotCheck[];
};

function emptyBundle(taskId: string, query: string): ResearchBundle {
  return {
    taskId,
    query,
    sources: [],
    claims: [],
    riskFlags: [],
    missingItems: [],
    requiresReview: false,
    completedAt: new Date().toISOString(),
  };
}

function rentalIntent(taskId: string, instruction: string): TaskIntent {
  return {
    taskId,
    kind: "draft.word",
    output: "docx",
    instruction,
    summary: "房屋租赁合同",
    riskLevel: "high",
    models: ["general", "legal"],
    requiresConfirmation: true,
    createdAt: new Date().toISOString(),
    deliverableType: "contract.rental",
    templateId: "word/contract-default",
  };
}

function readFixture(name: string): string {
  return fs.readFileSync(path.join(FIXTURE_DIR, name), "utf8");
}

function finishedRentalDraft(): ArtifactDraft {
  const body = readFixture("rental-finished.md");
  if (!body.includes("缺管辖")) {
    throw new Error("rental-finished fixture missing 缺管辖 cue");
  }
  return {
    taskId: "desk-pilot-rental-finished",
    title: "房屋租赁合同",
    output: "docx",
    templateId: "word/contract-default",
    deliverableType: "contract.rental",
    summary: "成稿对照：无骨架占位，仍缺管辖",
    sections: [
      {
        heading: "合同当事人",
        body: "出租人（甲方）：北京示例房屋租赁有限公司\n承租人（乙方）：李某",
      },
      {
        heading: "第一条 房屋基本情况",
        body: "甲方出租给乙方的房屋坐落于北京市朝阳区示例路 1 号 801 室，建筑面积 86 平方米，用途为居住。",
      },
      {
        heading: "第二条 租赁期限与交付",
        body: "租赁期限自 2026 年 9 月 1 日起至 2027 年 8 月 31 日止。甲方应于起租日前将房屋按可正常使用状态交付乙方。",
      },
      {
        heading: "第三条 租金、押金及支付方式",
        body: "月租金人民币 8000 元，押金人民币 16000 元。乙方应于每月 1 日前支付当期租金。",
      },
      {
        heading: "第四条 双方权利义务",
        body: "甲方保证对出租房屋享有合法处分权。乙方应按约定用途使用房屋，不得擅自转租。",
      },
      {
        heading: "第五条 维修、保养与费用承担",
        body: "房屋主体结构维修由甲方承担；因乙方使用不当导致的维修由乙方承担。",
      },
      {
        heading: "第六条 违约责任",
        body: "乙方逾期支付租金超过 15 日的，甲方有权解除合同并要求支付违约金。",
      },
      {
        heading: "签署页",
        body: "出租人（甲方）：________________\n承租人（乙方）：________________",
      },
    ],
    reviewNotes: [],
    reviewStatus: "pending",
    createdAt: new Date().toISOString(),
  };
}

function demandLetterDraft(): ArtifactDraft {
  return {
    taskId: "desk-pilot-demand",
    title: "催款函",
    output: "docx",
    templateId: "word/demand-letter-default",
    deliverableType: "letter.demand",
    summary: readFixture("demand-letter.md").trim(),
    sections: [{ heading: "主张", body: "请立即履行付款义务。" }],
    reviewNotes: [],
    reviewStatus: "pending",
    createdAt: new Date().toISOString(),
  };
}

function check(name: string, ok: boolean, detail: string): DeskPilotCheck {
  return { name, ok, detail };
}

export async function runDeskPilot(): Promise<DeskPilotResult> {
  process.env.LAWMIND_REASONING_MODE = "keyword";
  process.env.LAWMIND_ROUTER_MODE = "keyword";
  delete process.env.LAWMIND_AGENT_API_KEY;
  delete process.env.OPENAI_API_KEY;

  const checks: DeskPilotCheck[] = [];
  const scaffoldCue = readFixture("rental-scaffold.md");
  if (!scaffoldCue.includes("骨架")) {
    throw new Error("rental-scaffold fixture missing 骨架 cue");
  }

  const scaffold = buildDraft({
    intent: rentalIntent("desk-pilot-rental-scaffold", "起草一份房屋租赁合同"),
    bundle: emptyBundle("desk-pilot-rental-scaffold", "房屋租赁合同"),
  });
  const scaffoldView = describeDraftScaffold(scaffold);
  const scaffoldGate = validateDraftAgainstSpec(scaffold);
  checks.push(
    check(
      "rental-scaffold-dense",

      scaffoldView.dense,
      `dense=${scaffoldView.dense} label=${scaffoldView.label}`,
    ),
  );
  checks.push(
    check(
      "rental-scaffold-not-ready",
      !scaffoldGate.ready,
      `ready=${scaffoldGate.ready} blockers=${scaffoldGate.blockerCount}`,
    ),
  );

  const finished = applyDraftCritic(finishedRentalDraft());
  checks.push(
    check(
      "rental-finished-critic",
      finished.reviewNotes.some((note) => note.startsWith("复核：")),
      `notes=${finished.reviewNotes.join(" | ")}`,
    ),
  );
  checks.push(
    check(
      "rental-finished-unsigned",
      finished.reviewStatus !== "approved",
      `reviewStatus=${finished.reviewStatus}`,
    ),
  );

  const demand = applyDraftCritic(demandLetterDraft());
  checks.push(
    check(
      "demand-critic",
      demand.reviewNotes.some((note) => note.startsWith("复核：") && note.includes("履行期限")),
      `notes=${demand.reviewNotes.join(" | ")}`,
    ),
  );

  const researchQ = readFixture("research-question.md").trim();
  const researchIntent = route({ instruction: researchQ });
  checks.push(
    check(
      "research-routes-query",
      researchIntent.kind === "research.legal",
      `kind=${researchIntent.kind} instruction=${researchQ.slice(0, 40)}`,
    ),
  );
  const researchDraft = buildDraft({
    intent: researchIntent,
    bundle: emptyBundle(researchIntent.taskId, researchQ),
  });
  const researchGate = validateDraftAgainstSpec(researchDraft);
  checks.push(
    check(
      "research-not-outbound",
      researchDraft.reviewStatus !== "approved" && !researchGate.ready,
      `kind=${researchIntent.kind} status=${researchDraft.reviewStatus} ready=${researchGate.ready}`,
    ),
  );

  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-desk-pilot-"));
  try {
    const ingested = ingestSidecarSelection(ws, {
      source: "word",
      title: "违约金条款",
      text: "第三条 甲方逾期应支付违约金。",
      verb: "review",
    });
    bindSidecarIngestToTask(ws, ingested.relativePath, finished.taskId);
    persistSidecarOutboxFromDraft(ws, finished, buildClauseGraphFromDraft(finished));
    const outbox = readSidecarOutbox(ws);
    checks.push(
      check(
        "sidecar-bind-outbox",
        outbox?.ingestRelativePath === ingested.relativePath && outbox.taskId === finished.taskId,
        `ingest=${ingested.relativePath} outbox=${outbox?.ingestRelativePath ?? "none"}`,
      ),
    );

    const unsignedRender = await renderDocxWithOptions(finished, ws, {});
    checks.push(
      check(
        "unsigned-not-outbound",
        !unsignedRender.ok && (unsignedRender.error ?? "").includes("未通过审核"),
        unsignedRender.error ?? "missing error",
      ),
    );
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }

  return { checks, failed: checks.filter((item) => !item.ok) };
}

export function assertDeskPilot(result: DeskPilotResult): void {
  if (result.failed.length === 0) {
    return;
  }
  const lines = result.failed.map((item) => `- ${item.name}: ${item.detail}`).join("\n");
  throw new Error(`desk pilot failed:\n${lines}`);
}
