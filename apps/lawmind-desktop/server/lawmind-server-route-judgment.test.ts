import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import http from "node:http";
import { appendGuardianItemOutcomes } from "../../../src/lawmind/guardian/item-outcome.js";
import { persistGuardianRecord } from "../../../src/lawmind/guardian/store.js";
import { handleJudgmentRoutes } from "./lawmind-server-route-judgment.js";
import type { LawmindDispatchContext } from "./lawmind-server-route-types.js";

function mockRes(): http.ServerResponse & { body?: unknown; status?: number } {
  return {
    status: 200,
    body: undefined as unknown,
    writeHead(code: number) {
      this.status = code;
    },
    end(payload?: string) {
      if (payload) {
        this.body = JSON.parse(payload);
      }
    },
  } as http.ServerResponse & { body?: unknown; status?: number };
}

function call(
  ctx: LawmindDispatchContext,
  url: string,
  method = "GET",
): { handled: boolean; status: number; body: Record<string, unknown> } {
  const parsed = new URL(`http://127.0.0.1${url}`);
  const res = mockRes();
  const handled = handleJudgmentRoutes({
    ctx,
    req: { method } as http.IncomingMessage,
    res,
    url: parsed,
    pathname: parsed.pathname,
    c: {},
  });
  return {
    handled,
    status: res.status ?? 200,
    body: (res.body ?? {}) as Record<string, unknown>,
  };
}

describe("G3 API：/api/judgment/*", () => {
  let workspaceDir: string;
  let ctx: LawmindDispatchContext;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join("/tmp", "lawmind-judgment-"));
    await fs.mkdir(path.join(workspaceDir, "audit"), { recursive: true });
    ctx = {
      workspaceDir,
      envFile: undefined,
      userEnvPath: path.join(workspaceDir, ".env.lawmind"),
      policy: { loaded: false, policy: null },
    };
  });

  afterEach(async () => {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  it("未注册的路径返回 false（不抢别的路由）", () => {
    expect(call(ctx, "/api/other").handled).toBe(false);
    expect(call(ctx, "/api/judgment/summary", "POST").handled).toBe(false);
  });

  it("GET /api/judgment/tiering 报出判定表规模与三级分布", () => {
    const { handled, body } = call(ctx, "/api/judgment/tiering");
    expect(handled).toBe(true);
    expect(body.tableSize).toBe(150);
    const byTier = body.byTier as Record<string, number>;
    expect(byTier.machine + byTier.judge + byTier.lawyer).toBe(150);
    expect(byTier.machine).toBeGreaterThan(0);
    expect(byTier.lawyer).toBeGreaterThan(0);
  });

  it("GET /api/judgment/summary 无数据时诚实报 present:false（不编 0）", () => {
    const { body } = call(ctx, "/api/judgment/summary");
    expect(body.present).toBe(false);
    expect(body.total).toBe(0);
    expect(body.items).toEqual([]);
  });

  it("GET /api/judgment/summary 有数据时给出**律师可读标签**，不是判定表键", () => {
    appendGuardianItemOutcomes(workspaceDir, [
      {
        ts: "2026-09-21T00:00:00.000Z",
        taskId: "t1",
        itemKey: "pr.deposit",
        tier: "machine",
        decidedBy: "machine",
        supported: false,
      },
    ]);
    const { body } = call(ctx, "/api/judgment/summary");
    expect(body.present).toBe(true);
    const items = body.items as Array<{ key: string; label: string; notCoveredRate: number | null }>;
    const deposit = items.find((i) => i.key === "pr.deposit");
    expect(deposit).toBeDefined();
    // 标签从既有检查单派生 —— 不得等于键本身。
    expect(deposit!.label).not.toBe("pr.deposit");
    expect(deposit!.label.length).toBeGreaterThan(4);
  });

  it("GET /api/judgment/task 缺 taskId → 400（不静默返回空）", () => {
    const { status, body } = call(ctx, "/api/judgment/task");
    expect(status).toBe(400);
    expect(body.ok).toBe(false);
  });

  it("GET /api/judgment/task 给出计数、未覆盖项与覆盖自述", () => {
    appendGuardianItemOutcomes(workspaceDir, [
      {
        ts: "2026-09-21T00:00:00.000Z",
        taskId: "t1",
        itemKey: "pr.pay",
        tier: "judge",
        decidedBy: "model",
        supported: false,
      },
      {
        ts: "2026-09-21T00:00:00.000Z",
        taskId: "t1",
        itemKey: "pr.deposit",
        tier: "machine",
        decidedBy: "machine",
        supported: true,
      },
      {
        ts: "2026-09-21T00:00:00.000Z",
        taskId: "t1",
        itemKey: "loan.rate",
        tier: "machine",
        decidedBy: "machine",
        supported: false,
        unavailable: true,
      },
    ]);
    const { body } = call(ctx, "/api/judgment/task?taskId=t1");
    expect(body.present).toBe(true);
    const counts = body.counts as Record<string, number>;
    expect(counts.total).toBe(3);
    expect(counts.machine).toBe(2);
    expect(counts.judged).toBe(1);
    expect(counts.notCovered).toBe(1);
    // 不可用**不算未覆盖**——它是"没判出来"，不是"判出问题"。
    expect(counts.unavailable).toBe(1);
    expect(body.coverageNote).toContain("通过核对 ≠ 法律正确");
    const notCovered = body.notCovered as Array<{ key: string; label: string }>;
    expect(notCovered.map((n) => n.key)).toEqual(["pr.pay"]);
    expect(notCovered[0].label).not.toBe("pr.pay");
  });

  it("**待定夺项剥掉内部 id**（`itemKey` 不得进律师面字段）", () => {
    persistGuardianRecord(workspaceDir, {
      taskId: "t-esc",
      at: "2026-09-21T00:00:00.000Z",
      verdict: "pass",
      round: 1,
      maxRounds: 2,
      gaps: [],
      escalationItems: [
        { itemKey: "pr.cap", label: "责任上限的水平", reason: "属商业风险分配" },
      ],
    });
    const { body } = call(ctx, "/api/judgment/task?taskId=t-esc");
    const escalation = body.escalation as Array<Record<string, unknown>>;
    expect(escalation).toHaveLength(1);
    expect(escalation[0].label).toBe("责任上限的水平");
    expect(escalation[0].reason).toBe("属商业风险分配");
    // 内部 id 必须被剥掉。
    expect(JSON.stringify(escalation)).not.toContain("pr.cap");
    expect(escalation[0].itemKey).toBeUndefined();
  });

  it("GET /api/judgment/escalations 汇总全工作区待定夺清单", () => {
    persistGuardianRecord(workspaceDir, {
      taskId: "t-a",
      at: "2026-09-21T00:00:00.000Z",
      verdict: "pass",
      round: 1,
      maxRounds: 2,
      gaps: [],
      escalationItems: [{ itemKey: "pr.cap", label: "责任上限", reason: "商业取舍" }],
    });
    const { body } = call(ctx, "/api/judgment/escalations");
    expect(body.ok).toBe(true);
    // 没有草稿注册该 taskId 时，清单为空（不编条目）。
    expect(Array.isArray(body.tasks)).toBe(true);
  });

  /**
   * 升级通道的可展示性自述（G3 欠账二）。
   *
   * 界面靠这两个字段决定「这条列表该怎么读、该怎么说」——所以它们必须与
   * **引擎的实际行为同源**，不能由界面自己猜。
   */
  describe("升级通道姿态（界面文案口径的唯一来源）", () => {
    const ENV_KEYS = [
      "LAWMIND_JUDGMENT_ESCALATION",
      "LAWMIND_JUDGMENT_ESCALATION_POSTURE",
      // 策略文件那一档要与 env 隔离：不删掉 LAWMIND_EDITION，就分不清是 policy 还是 env 在说话。
      "LAWMIND_EDITION",
    ] as const;
    const saved: Record<string, string | undefined> = {};

    beforeEach(() => {
      for (const k of ENV_KEYS) {
        saved[k] = process.env[k];
        delete process.env[k];
      }
    });

    afterEach(() => {
      for (const k of ENV_KEYS) {
        if (saved[k] === undefined) {
          delete process.env[k];
        } else {
          process.env[k] = saved[k];
        }
      }
    });

    it("通道未接通时如实报 `off`（「列表为空」不等于「本件没有取舍事项」）", () => {
      const { body } = call(ctx, "/api/judgment/task?taskId=t1");
      expect(body.escalationChannel).toBe("off");
    });

    it("通道接通时报 `on`，并带上姿态", () => {
      process.env.LAWMIND_JUDGMENT_ESCALATION = "on";
      process.env.LAWMIND_JUDGMENT_ESCALATION_POSTURE = "advisory";
      const { body } = call(ctx, "/api/judgment/task?taskId=t1");
      expect(body.escalationChannel).toBe("on");
      expect(body.escalationPosture).toBe("advisory");
    });

    it("`block` 姿态如实透出（firm / 私有部署缺省）", () => {
      process.env.LAWMIND_JUDGMENT_ESCALATION = "on";
      process.env.LAWMIND_JUDGMENT_ESCALATION_POSTURE = "block";
      const { body } = call(ctx, "/api/judgment/task?taskId=t1");
      expect(body.escalationPosture).toBe("block");
    });

    it("全工作区清单同样带姿态（`/escalations` 的调用方也需要同一口径）", () => {
      process.env.LAWMIND_JUDGMENT_ESCALATION = "on";
      process.env.LAWMIND_JUDGMENT_ESCALATION_POSTURE = "advisory";
      const { body } = call(ctx, "/api/judgment/escalations");
      expect(body.escalationChannel).toBe("on");
      expect(body.escalationPosture).toBe("advisory");
    });

    it("姿态取值写坏时**不按免检处理**：回落到 edition 缺省，绝不返回未知值", () => {
      process.env.LAWMIND_JUDGMENT_ESCALATION = "on";
      process.env.LAWMIND_JUDGMENT_ESCALATION_POSTURE = "advis0ry";
      const { body } = call(ctx, "/api/judgment/task?taskId=t1");
      expect(["advisory", "block"]).toContain(body.escalationPosture);
    });

    /**
     * 策略文件那一档（`policy` 显式 → env → edition 缺省 的第一档）。
     *
     * 这一档曾经是死的：路由侧与引擎收尾侧都是**无参**调用解析器，于是
     * `lawmind.policy.json` 写的 `judgmentEscalation` / `judgmentEscalationPosture` / `edition`
     * 对界面口径与引擎行为都不生效——界面会播报一个引擎并不遵守的姿态。
     * 这里与 `agent/judgment-escalation-cassette.test.ts` 的「策略文件档」互为两侧，
     * 一起保证「界面说的」与「引擎做的」同源。
     */
    async function writePolicy(policy: Record<string, unknown>): Promise<void> {
      await fs.writeFile(
        path.join(workspaceDir, "lawmind.policy.json"),
        JSON.stringify({ schemaVersion: 1, ...policy }, null, 2),
        "utf8",
      );
    }

    it("策略文件写 edition=firm 时姿态是 block；判断通道不由策略文件打开", async () => {
      await writePolicy({ edition: "firm", judgmentEscalation: "on" });
      const { body } = call(ctx, "/api/judgment/task?taskId=t1");
      expect(body.escalationChannel).toBe("off");
      expect(body.escalationPosture).toBe("block");
    });

    it("同一份策略写到 solo → advisory", async () => {
      await writePolicy({ edition: "solo", judgmentEscalation: "on" });
      const { body } = call(ctx, "/api/judgment/escalations");
      expect(body.escalationChannel).toBe("off");
      expect(body.escalationPosture).toBe("advisory");
    });

    it("策略里的放宽姿态不生效，律所仍是 block", async () => {
      await writePolicy({
        edition: "firm",
        judgmentEscalation: "on",
        judgmentEscalationPosture: "advisory",
      });
      const { body } = call(ctx, "/api/judgment/task?taskId=t1");
      expect(body.escalationPosture).toBe("block");
    });

    it("策略文件坏掉（schemaVersion 缺失）→ 不算「配了」：回落 env，通道如实报 off", async () => {
      await fs.writeFile(
        path.join(workspaceDir, "lawmind.policy.json"),
        JSON.stringify({ edition: "firm", judgmentEscalation: "on" }),
        "utf8",
      );
      const { body } = call(ctx, "/api/judgment/task?taskId=t1");
      expect(body.escalationChannel).toBe("off");
    });
  });
});
