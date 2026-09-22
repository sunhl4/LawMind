import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentContext } from "../agent/types.js";
import { persistDraft } from "../drafts/index.js";
import { writeRedlineProposal } from "../drafts/redline-proposal.js";
import { runLegalGuardianForTrackedDraft } from "../guardian/run.js";
import { persistGuardianRecord } from "../guardian/store.js";
import type { ArtifactDraft } from "../types.js";
import {
  buildJudgmentEscalationForTask,
  formatJudgmentCoverageNote,
  readJudgmentEscalation,
} from "./judgment-escalation.js";
import { buildJudgmentEscalationAction } from "./requires-action.js";

const tmp: string[] = [];
const ENV_KEYS = {
  tiering: "LAWMIND_JUDGMENT_TIERING",
  escalation: "LAWMIND_JUDGMENT_ESCALATION",
} as const;
let saved: Record<string, string | undefined> = {};

afterEach(() => {
  for (const key of Object.values(ENV_KEYS)) {
    const prev = saved[key];
    if (prev === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = prev;
    }
  }
  saved = {};
  for (const d of tmp) {
    fs.rmSync(d, { recursive: true, force: true });
  }
  tmp.length = 0;
});

function captureEnv(): void {
  saved = {
    [ENV_KEYS.tiering]: process.env[ENV_KEYS.tiering],
    [ENV_KEYS.escalation]: process.env[ENV_KEYS.escalation],
  };
  delete process.env[ENV_KEYS.tiering];
  delete process.env[ENV_KEYS.escalation];
}

function tmpWs(): string {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-escalation-"));
  tmp.push(ws);
  return ws;
}

const HUNKS = [
  {
    hunkId: "h1",
    sectionIndex: 0,
    sectionHeading: "争议解决",
    before: "由甲方所在地人民法院诉讼解决。",
    after: "由上海仲裁委员会仲裁解决。",
    status: "pending" as const,
    granularity: "surgical" as const,
  },
];

function procurementDraft(): ArtifactDraft {
  return {
    taskId: "t-esc",
    title: "改稿类型：采购供货\n己方立场：甲方",
    output: "docx",
    templateId: "word/contract-default",
    deliverableType: "contract.review",
    summary: "采购合同改稿",
    sections: [{ heading: "争议解决", body: "由上海仲裁委员会仲裁解决。" }],
    reviewNotes: [],
    reviewStatus: "pending",
    createdAt: "2026-09-21T00:00:00.000Z",
    contractEdit: { baselineRelativePath: "cases/m1/a.docx", mode: "surgical" },
  };
}

describe("G3 升级卡：构造与文案纪律", () => {
  it("无待定夺项时返回 undefined（不造空卡）", () => {
    expect(buildJudgmentEscalationAction({ sessionId: "s", items: [] })).toBeUndefined();
    expect(
      buildJudgmentEscalationAction({ sessionId: "s", items: [{ label: "   " }] }),
    ).toBeUndefined();
  });

  it("卡片说明这是请您定夺，不是批准/驳回", () => {
    const action = buildJudgmentEscalationAction({
      sessionId: "s",
      taskId: "t1",
      items: [{ label: "检验期限是否过短", why: "取决于行业惯例与标的特性" }],
      coverageNote: "本次机械核对 19 项。通过核对 ≠ 法律正确。",
    });
    expect(action).toBeDefined();
    expect(action!.kind).toBe("judgment_escalation");
    expect(action!.decisions).toEqual(["respond", "edit"]);
    expect(action!.summary).toContain("商业取舍");
    expect(action!.summary).toContain("检验期限是否过短");
    expect(action!.summary).toContain("取决于行业惯例");
    expect(action!.summary).toContain("不会替您选一条路继续");
    expect(action!.summary).toContain("通过核对 ≠ 法律正确");
  });

  it("**内部 itemKey 不进律师可见面**（UI 文案禁词表）", () => {
    const action = buildJudgmentEscalationAction({
      sessionId: "s",
      // 调用方只传 label / why；itemKey 由上层剥离。
      items: [{ label: "责任上限水平", why: "属商业风险分配" }],
    });
    expect(action!.summary).not.toMatch(/pr\.cap|eq\.price|verification/);
  });

  it("条目超过 8 条时收敛为「另有 N 处」，不刷屏", () => {
    const items = Array.from({ length: 11 }, (_, i) => ({ label: `事项${i + 1}` }));
    const action = buildJudgmentEscalationAction({ sessionId: "s", items });
    expect(action!.summary).toContain("另有 3 处");
    expect(action!.summary).not.toContain("事项11");
  });
});

describe("G3 升级卡：从 Guardian sidecar 读取", () => {
  it("没有 sidecar → present: false（不是「空数组」，两者含义不同）", () => {
    const read = readJudgmentEscalation(tmpWs(), "t-none");
    expect(read.present).toBe(false);
    expect(read.items).toEqual([]);
    expect(
      buildJudgmentEscalationForTask({ workspaceDir: tmpWs(), taskId: "t-none", sessionId: "s" }),
    ).toBeUndefined();
  });

  it("sidecar 有 escalationItems → 读出并进卡片", () => {
    const ws = tmpWs();
    persistGuardianRecord(ws, {
      taskId: "t1",
      at: "2026-09-21T00:00:00.000Z",
      verdict: "pass",
      round: 1,
      maxRounds: 2,
      gaps: [],
      escalationItems: [
        { itemKey: "pr.inspect", label: "检验期限是否过短", reason: "取决于行业惯例" },
      ],
    });
    const read = readJudgmentEscalation(ws, "t1");
    expect(read.present).toBe(true);
    expect(read.items[0]?.itemKey).toBe("pr.inspect");

    const action = buildJudgmentEscalationForTask({
      workspaceDir: ws,
      taskId: "t1",
      sessionId: "s",
    });
    expect(action).toBeDefined();
    expect(action!.summary).toContain("检验期限是否过短");
    // 内部 id 不出现在卡片上。
    expect(action!.summary).not.toContain("pr.inspect");
  });

  it("**落盘不留哑字段**：无待定夺项时 sidecar 里不写 escalationItems", () => {
    const ws = tmpWs();
    persistGuardianRecord(ws, {
      taskId: "t2",
      at: "2026-09-21T00:00:00.000Z",
      verdict: "pass",
      round: 1,
      maxRounds: 2,
      gaps: [],
    });
    const raw = fs.readFileSync(path.join(ws, "drafts", "t2.guardian.json"), "utf8");
    expect(raw).not.toContain("escalationItems");
  });

  it("**回归**：escalationItems 必须真的落盘（stripRaw 是白名单，漏加就静默丢失）", () => {
    const ws = tmpWs();
    persistGuardianRecord(ws, {
      taskId: "t3",
      at: "2026-09-21T00:00:00.000Z",
      verdict: "pass",
      round: 1,
      maxRounds: 2,
      gaps: [],
      escalationItems: [{ itemKey: "eq.price", label: "对价与估值口径", reason: "商业谈判结果" }],
    });
    const raw = fs.readFileSync(path.join(ws, "drafts", "t3.guardian.json"), "utf8");
    expect(raw).toContain("escalationItems");
    expect(readJudgmentEscalation(ws, "t3").present).toBe(true);
  });
});

describe("G3 端到端：升级通道开启后主观项真的进了卡片", () => {
  it("on + 升级通道开 → lawyer 项离开提示词，且出现在 sidecar 的待定夺项里", async () => {
    captureEnv();
    const ws = tmpWs();
    process.env[ENV_KEYS.tiering] = "on";
    process.env[ENV_KEYS.escalation] = "on";
    const draft = procurementDraft();
    persistDraft(ws, draft);
    writeRedlineProposal(ws, {
      taskId: draft.taskId,
      baselineSections: [{ heading: "争议解决", body: "由甲方所在地人民法院诉讼解决。" }],
      hunks: HUNKS,
      updatedAt: new Date().toISOString(),
    });
    let seenUser = "";
    const ctx: AgentContext = {
      workspaceDir: ws,
      sessionId: "s",
      actorId: "esc",
      guardianCaller: async ({ user }: { system: string; user: string }) => {
        seenUser = user;
        return JSON.stringify({ items: [], summaryGaps: [] });
      },
    };
    await runLegalGuardianForTrackedDraft({
      workspaceDir: ws,
      draft,
      hunks: HUNKS,
      allowEmptyRedline: false,
      ctx,
    });

    // 主观项不在提示词里（交给升级卡）。
    expect(seenUser).not.toContain('"id": "pr.cap"');
    expect(seenUser).not.toContain('"id": "pr.inspect"');

    const read = readJudgmentEscalation(ws, draft.taskId);
    expect(read.present).toBe(true);
    const keys = read.items.map((i) => i.itemKey).toSorted();
    expect(keys).toContain("pr.cap");
    expect(keys).toContain("pr.inspect");
    // 每条都带律师可读的理由。
    for (const item of read.items) {
      expect(item.label.trim().length).toBeGreaterThan(0);
      expect(item.reason.trim().length).toBeGreaterThan(0);
    }
  });

  it("升级通道未开启 → 主观项仍由模型判，且没有待定夺项（闸门有效）", async () => {
    captureEnv();
    const ws = tmpWs();
    process.env[ENV_KEYS.tiering] = "on";
    // 不设 escalation env → 通道不可用。
    const draft = procurementDraft();
    persistDraft(ws, draft);
    writeRedlineProposal(ws, {
      taskId: draft.taskId,
      baselineSections: [{ heading: "争议解决", body: "由甲方所在地人民法院诉讼解决。" }],
      hunks: HUNKS,
      updatedAt: new Date().toISOString(),
    });
    let seenUser = "";
    const ctx: AgentContext = {
      workspaceDir: ws,
      sessionId: "s",
      actorId: "esc2",
      guardianCaller: async ({ user }: { system: string; user: string }) => {
        seenUser = user;
        return JSON.stringify({ items: [], summaryGaps: [] });
      },
    };
    await runLegalGuardianForTrackedDraft({
      workspaceDir: ws,
      draft,
      hunks: HUNKS,
      allowEmptyRedline: false,
      ctx,
    });
    // 通道没接通 → 主观项必须继续问模型（不得静默消失）。
    expect(seenUser).toContain('"id": "pr.cap"');
    expect(readJudgmentEscalation(ws, draft.taskId).present).toBe(false);
  });
});

describe("G3 覆盖自述：诚实呈现", () => {
  it("自述核对项数与机器判定数，并重申「通过 ≠ 法律正确」", () => {
    const note = formatJudgmentCoverageNote({
      checkedTotal: 19,
      machineCount: 2,
      escalatedCount: 2,
    });
    expect(note).toContain("本次机械核对 19 项");
    expect(note).toContain("其中 2 项由确定性规则判定");
    expect(note).toContain("2 项需您定夺");
    expect(note).toContain("通过核对 ≠ 法律正确");
  });

  it("没有机器判定项 / 待定夺项时不写多余的 0", () => {
    const note = formatJudgmentCoverageNote({
      checkedTotal: 5,
      machineCount: 0,
      escalatedCount: 0,
    });
    expect(note).toContain("本次机械核对 5 项");
    expect(note).not.toContain("0 项");
  });
});
