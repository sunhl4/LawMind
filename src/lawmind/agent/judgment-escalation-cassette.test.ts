/**
 * G3 cassette：判断项升级卡走完**真实回合**。
 *
 * 契约（`AGENTS.md`）：fake model bytes + 真 runTurn + 真门禁 + 真收尾。
 * 断言的是**回合结束后的 `requiresAction`**——也就是律师在「待拍板」里真的会看到什么。
 *
 * 为什么这组断言是准入证：
 * 升级卡的构造器与组件都能单独测通，但**如果它没被并进 `requiresAction`**，
 * 律师永远看不到它——那正是本仓最怕的「实现了但没接线」。
 * 同理，姿态为 `advisory` 时**不得**并进去（solo 缺省不能每件都拦）。
 */

import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { persistDraft } from "../drafts/index.js";
import { persistGuardianRecord } from "../guardian/store.js";
import type { ArtifactDraft } from "../types.js";
import { cassetteAssistant, withTestLawMind } from "./testkit/index.js";
import type { AgentSession } from "./types.js";

const ENV = {
  tiering: "LAWMIND_JUDGMENT_TIERING",
  escalation: "LAWMIND_JUDGMENT_ESCALATION",
  posture: "LAWMIND_JUDGMENT_ESCALATION_POSTURE",
  edition: "LAWMIND_EDITION",
} as const;

let savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  savedEnv = {};
  for (const key of Object.values(ENV)) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of Object.values(ENV)) {
    const prev = savedEnv[key];
    if (prev === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = prev;
    }
  }
});

const TASK_ID = "task-g3-cassette";

const DRAFT: ArtifactDraft = {
  taskId: TASK_ID,
  title: "采购合同改稿",
  output: "docx",
  templateId: "word/contract-default",
  deliverableType: "contract.review",
  summary: "改管辖",
  sections: [{ heading: "争议解决", body: "由上海仲裁委员会仲裁解决。" }],
  reviewNotes: [],
  reviewStatus: "pending",
  createdAt: "2026-09-21T00:00:00.000Z",
};

/**
 * 铺一个「本回合有草稿 + 已有待定夺项」的工作区。
 *
 * 直接用 `persistGuardianRecord` 落盘待定夺项——它正是 Guardian 在
 * `tiering=on` + 通道可用时写的同一条路径（引擎侧已由
 * `platform/judgment-escalation.test.ts` 端到端覆盖，这里只验证**收尾接线**）。
 */
function seedEscalation(workspaceDir: string, withItems = true): void {
  persistDraft(workspaceDir, DRAFT);
  persistGuardianRecord(workspaceDir, {
    taskId: TASK_ID,
    at: "2026-09-21T00:00:00.000Z",
    verdict: "pass",
    round: 1,
    maxRounds: 2,
    gaps: [],
    ...(withItems
      ? {
          escalationItems: [
            { itemKey: "pr.cap", label: "责任上限的水平", reason: "属商业风险分配" },
          ],
        }
      : {}),
  });
}

type EscalationRow = { kind: string; summary: string; decisions: string[] };

function escalationsOf(session: AgentSession | undefined): EscalationRow[] {
  const turns = session?.turns ?? [];
  const last = turns[turns.length - 1];
  return ((last?.requiresAction ?? []) as EscalationRow[]).filter(
    (a) => a.kind === "judgment_escalation",
  );
}

/** 往工作区写 `lawmind.policy.json`（桌面端律师改的就是这一份）。 */
function writePolicy(workspaceDir: string, policy: Record<string, unknown>): void {
  fs.writeFileSync(
    path.join(workspaceDir, "lawmind.policy.json"),
    JSON.stringify({ schemaVersion: 1, ...policy }, null, 2),
    "utf8",
  );
}

/**
 * 走**策略文件 + 可选 env** 跑一轮。
 *
 * 新策略合同（`policy/commercial-policy.ts`）只留 IT 硬边界：`judgmentEscalation` /
 * `judgmentEscalationPosture` 这类引擎调参键会被拒绝、不再生效。策略文件仍然
 * 生效的一档是 `edition`——它决定升级卡姿态的缺省（solo→advisory，firm→block）。
 * 通道开关的存活面是 env `LAWMIND_JUDGMENT_ESCALATION`（缺省 off）。
 */
async function runTurnWithPolicy(input: {
  policy: Record<string, unknown> | null;
  env?: Partial<Record<keyof typeof ENV, string>>;
  withItems?: boolean;
}): Promise<EscalationRow[]> {
  for (const [k, v] of Object.entries(input.env ?? {})) {
    process.env[ENV[k as keyof typeof ENV]] = v;
  }
  let rows: EscalationRow[] = [];
  await withTestLawMind(
    (b) => b,
    async (h) => {
      seedEscalation(h.workspaceDir, input.withItems !== false);
      if (input.policy) {
        writePolicy(h.workspaceDir, input.policy);
      }
      h.enqueue(cassetteAssistant("记下了。"));
      await h.runTurn("继续", { linkedTaskId: TASK_ID });
      rows = escalationsOf(h.session());
    },
  );
  return rows;
}

async function runTurnWithEscalation(input: {
  env: Partial<Record<keyof typeof ENV, string>>;
  withItems?: boolean;
}): Promise<EscalationRow[]> {
  for (const [k, v] of Object.entries(input.env)) {
    process.env[ENV[k as keyof typeof ENV]] = v;
  }
  let rows: EscalationRow[] = [];
  await withTestLawMind(
    (b) => b,
    async (h) => {
      seedEscalation(h.workspaceDir, input.withItems !== false);
      h.enqueue(cassetteAssistant("记下了。"));
      await h.runTurn("继续", { linkedTaskId: TASK_ID });
      rows = escalationsOf(h.session());
    },
  );
  return rows;
}

describe("G3 cassette：升级卡在真实回合里被并进 requiresAction", () => {
  it("通道开 + 姿态 block → 卡片出现在回合待办里，且文案可读", async () => {
    const cards = await runTurnWithEscalation({
      env: { tiering: "on", escalation: "on", posture: "block" },
    });
    expect(cards).toHaveLength(1);
    expect(cards[0].summary).toContain("责任上限的水平");
    expect(cards[0].summary).toContain("属商业风险分配");
    expect(cards[0].summary).toContain("不会替您选一条路继续");
    // 这是「请拍板」，不是「批准/驳回」。
    expect(cards[0].decisions).toEqual(["respond", "edit"]);
    // 内部 id 不得出现在律师可见面。
    expect(cards[0].summary).not.toContain("pr.cap");
  });

  it("**姿态 advisory（solo 缺省）→ 不打断**：卡片不进 requiresAction", async () => {
    const cards = await runTurnWithEscalation({
      env: { tiering: "on", escalation: "on" },
    });
    // 单人执业每件都拦是不可接受的；卡片由审核台按需展示。
    expect(cards).toHaveLength(0);
  });

  it("通道未开 → 不产出卡片（闸门有效，主观项仍由模型判）", async () => {
    const cards = await runTurnWithEscalation({
      env: { tiering: "on", posture: "block" },
    });
    expect(cards).toHaveLength(0);
  });

  it("没有待定夺项时不产生空卡（不编条目不刷屏）", async () => {
    const cards = await runTurnWithEscalation({
      env: { tiering: "on", escalation: "on", posture: "block" },
      withItems: false,
    });
    expect(cards).toHaveLength(0);
  });
});

describe("G3 cassette：策略文件的 edition 那一档真的接上了（不是只认 env）", () => {
  it("通道由 env 开 + 策略文件写 edition=firm → 姿态取 edition 缺省 block → 卡片进待办", async () => {
    const cards = await runTurnWithPolicy({
      policy: { edition: "firm" },
      env: { tiering: "on", escalation: "on" },
    });
    expect(cards).toHaveLength(1);
    expect(cards[0].summary).toContain("责任上限的水平");
    // 姿态取 edition 缺省（firm → block）：写的是「不会替您选一条路继续」。
    expect(cards[0].summary).toContain("不会替您选一条路继续");
  });

  it("同一通道开到 solo → 姿态回落 advisory：不打断，卡片不进待办", async () => {
    const cards = await runTurnWithPolicy({
      policy: { edition: "solo" },
      env: { tiering: "on", escalation: "on" },
    });
    expect(cards).toHaveLength(0);
  });

  it("env 显式姿态优先于 edition 缺省（firm 也能被压成 advisory）", async () => {
    const cards = await runTurnWithPolicy({
      policy: { edition: "firm" },
      env: { tiering: "on", escalation: "on", posture: "advisory" },
    });
    expect(cards).toHaveLength(0);
  });

  it("通道没开 → 不产出卡片（不因为写了 edition 就默认开通道）", async () => {
    const cards = await runTurnWithPolicy({ policy: { edition: "firm" } });
    expect(cards).toHaveLength(0);
  });

  it("策略文件写 judgmentEscalation 被判为「不是律所策略键」并拒绝，通道不会因此打开", async () => {
    let rejected: Array<{ key: string; reason: string }> = [];
    const cards = await (async () => {
      let rows: EscalationRow[] = [];
      await withTestLawMind(
        (b) => b,
        async (h) => {
          seedEscalation(h.workspaceDir);
          writePolicy(h.workspaceDir, { edition: "firm", judgmentEscalation: "on" });
          const { inspectWorkspacePolicyFile } = await import("../policy/workspace-policy.js");
          rejected = inspectWorkspacePolicyFile(h.workspaceDir).rejected;
          h.enqueue(cassetteAssistant("记下了。"));
          await h.runTurn("继续", { linkedTaskId: TASK_ID });
          rows = escalationsOf(h.session());
        },
      );
      return rows;
    })();
    // 引擎调参键不进策略合同：拒绝并说明原因，且不静默生效。
    expect(rejected.some((r) => r.key === "judgmentEscalation")).toBe(true);
    expect(cards).toHaveLength(0);
  });
});
