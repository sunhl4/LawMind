/**
 * E2E mock 的**契约测试**（放在这里与 `e2e-spec-partition.test.ts` 同址：都是 e2e 机制）。
 *
 * 为什么需要：`e2e/mock-api.mjs` 是浏览器套件的唯一后端，但它自己**没有任何测试**。
 * 一旦形状漂移（比如 `breakdown` 从 `{ buckets, total }` 改成数组），受影响的 spec 报的是
 * 「元素找不到」这类远离根因的错误；而 mock 是 `pnpm lawmind:desktop:e2e`（CI mock 作业）
 * 的依赖，漂移的代价落在无关 PR 上。
 *
 * 这里只锁**接线面**：新增的上下文用量字段与续接路由的形状能否被渲染端消费。
 * 引擎侧的真实语义（种子内容、闸门迁移、阻塞判定）由 `src/lawmind/agent/session-carryover.test.ts`
 * 与 `lawmind-server-route-sessions.test.ts` 覆盖 —— mock 不替引擎做那些判断，也不该假装做了。
 */

import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mockScript = path.join(desktopDir, "e2e", "mock-api.mjs");
/** 用一个与本机常规端口不同的端口，避免与正在跑的 dev/CI mock 抢端口。 */
const port = 48_900 + (process.pid % 100);
const base = `http://127.0.0.1:${port}`;
const scope = "mock-contract";

let child: ChildProcess | undefined;

function headers(): Record<string, string> {
  return { "content-type": "application/json", "x-lawmind-e2e-scope": scope };
}

async function waitForHealth(timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) {
        return;
      }
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error("mock-api did not become healthy");
}

beforeAll(async () => {
  child = spawn(process.execPath, [mockScript], {
    env: { ...process.env, LAWMIND_E2E_MOCK_PORT: String(port) },
    stdio: "ignore",
  });
  await waitForHealth();
}, 30_000);

afterAll(() => {
  child?.kill("SIGTERM");
});

describe("mock-api: 上下文用量契约", () => {
  it("缺省与旧行为一致（ok / 12k / 100k / compactCount 0），因此不出建议卡", async () => {
    const res = await fetch(`${base}/api/sessions/e2e-session-1/context-budget`, {
      headers: headers(),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      used?: number;
      effectiveLimit?: number;
      level?: string;
      compactCount?: number;
      lastCompact?: unknown;
      breakdown?: { buckets?: Array<{ id: string; tokens: number }>; total?: number };
      window?: { contextTokens?: number; usedAsLimit?: number; midTurnCompactLimit?: number };
      modelId?: string;
      tuning?: { carryover?: { suggestMinCompacts?: number } };
      tuningOverrides?: string[];
    };
    expect(body.level).toBe("ok");
    expect(body.used).toBe(12_000);
    expect(body.effectiveLimit).toBe(100_000);
    expect(body.compactCount).toBe(0);
    expect(body.lastCompact).toBeNull();
    expect(body.modelId).toBeTruthy();
    // 分层用量形状必须与 `estimateTokenBudgetBreakdown` 一致，否则面板渲染空壳、
    // e2e 断言等于没测。
    expect(Array.isArray(body.breakdown?.buckets)).toBe(true);
    expect(body.breakdown?.total).toBe(body.used);
    expect(body.breakdown?.buckets?.some((b) => b.id === "toolResults")).toBe(true);
    // 窗口三元组（面板那行文案的来源）。
    expect(body.window?.contextTokens).toBe(128_000);
    expect(body.window?.midTurnCompactLimit).toBe(90_000);
    // 高级设置：默认门槛与引擎默认一致（2），且没有 override。
    expect(body.tuning?.carryover?.suggestMinCompacts).toBe(2);
    expect(body.tuningOverrides).toEqual([]);
  });

  it("控制路由能改成 warn + compactCount + midTurn，且按作用域隔离", async () => {
    const set = await fetch(`${base}/__e2e__/context-budget`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ used: 80_000, effectiveLimit: 100_000, level: "warn", compactCount: 2 }),
    });
    expect(set.ok).toBe(true);

    const mine = (await (
      await fetch(`${base}/api/sessions/e2e-session-1/context-budget`, { headers: headers() })
    ).json()) as { level?: string; compactCount?: number; lastCompact?: unknown };
    expect(mine.level).toBe("warn");
    expect(mine.compactCount).toBe(2);
    expect(mine.lastCompact).toBeNull();

    // 另一个作用域必须仍是初始状态：否则并行跑的 spec 会互相污染。
    const other = (await (
      await fetch(`${base}/api/sessions/e2e-session-1/context-budget`, {
        headers: { "content-type": "application/json", "x-lawmind-e2e-scope": "another" },
      })
    ).json()) as { level?: string; compactCount?: number };
    expect(other.level).toBe("ok");
    expect(other.compactCount).toBe(0);

    // 门槛可被 E2E 开关改写 → 面板判定跟着变（policy `context.carryover.suggestMinCompacts`）。
    await fetch(`${base}/__e2e__/context-budget`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ suggestMinCompacts: 5 }),
    });
    const tuned = (await (
      await fetch(`${base}/api/sessions/e2e-session-1/context-budget`, { headers: headers() })
    ).json()) as {
      tuning?: { carryover?: { suggestMinCompacts?: number } };
      tuningOverrides?: string[];
    };
    expect(tuned.tuning?.carryover?.suggestMinCompacts).toBe(5);
    expect(tuned.tuningOverrides).toEqual(["context.carryover.suggestMinCompacts"]);

    await fetch(`${base}/__e2e__/context-budget`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ midTurn: true }),
    });
    const withMidTurn = (await (
      await fetch(`${base}/api/sessions/e2e-session-1/context-budget`, { headers: headers() })
    ).json()) as { lastCompact?: { midTurn?: boolean; droppedMessageCount?: number } | null };
    expect(withMidTurn.lastCompact?.midTurn).toBe(true);
    expect(withMidTurn.lastCompact?.droppedMessageCount).toBeGreaterThan(0);

    // reset 回到初始状态（spec 的 afterEach 依赖它）。
    await fetch(`${base}/__e2e__/context-budget`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ reset: true }),
    });
    const afterReset = (await (
      await fetch(`${base}/api/sessions/e2e-session-1/context-budget`, { headers: headers() })
    ).json()) as { level?: string; compactCount?: number; lastCompact?: unknown };
    expect(afterReset).toMatchObject({ level: "ok", compactCount: 0, lastCompact: null });
  });
});

describe("mock-api: 续接路由契约", () => {  it("fork 返回新会话 id 与统计，并让新会话带上 carriedOverFrom", async () => {
    const res = await fetch(`${base}/api/sessions/e2e-session-1/fork-with-carryover`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ clientNonce: "n-contract" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok?: boolean;
      sessionId?: string;
      reused?: boolean;
      digestSource?: string;
      stats?: { droppedMessageCount?: number };
    };
    expect(body.ok).toBe(true);
    expect(body.sessionId).toBeTruthy();
    expect(body.reused).toBe(false);
    expect(body.digestSource).toBe("extractive");
    expect(body.stats?.droppedMessageCount).toBeGreaterThan(0);

    // 律师侧「续接来源」卡的数据来自会话详情：缺了它，spec 里的卡永远不出现。
    const detail = (await (
      await fetch(`${base}/api/sessions/${body.sessionId}`, { headers: headers() })
    ).json()) as {
      carriedOverFrom?: {
        sessionId?: string;
        droppedMessageCount?: number;
        digestPreview?: string;
      };
    };
    expect(detail.carriedOverFrom?.sessionId).toBe("e2e-session-1");
    expect(detail.carriedOverFrom?.droppedMessageCount).toBeGreaterThan(0);
    expect(detail.carriedOverFrom?.digestPreview).toBeTruthy();
  });

  it("blocked 模式：409 + blockingActions（授权不能跨会话搬）", async () => {
    await fetch(`${base}/__e2e__/fork`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ mode: "blocked" }),
    });
    const res = await fetch(`${base}/api/sessions/e2e-session-1/fork-with-carryover`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { ok?: boolean; code?: string; blockingActions?: string[] };
    expect(body.ok).toBe(false);
    expect(body.code).toBe("pending_authorization");
    expect(body.blockingActions).toEqual(["tool_approval"]);

    // 复位后恢复可续接。
    await fetch(`${base}/__e2e__/fork`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ mode: "ok" }),
    });
    const ok = await fetch(`${base}/api/sessions/e2e-session-1/fork-with-carryover`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({}),
    });
    expect(ok.status).toBe(200);
  });
});

describe("mock-api: resume 标记按作用域隔离（跨文件状态泄漏回归）", () => {
  it("A 作用域 resume 出的「已继续」不泄漏给 B 作用域", async () => {
    // 回归：resume 这条链曾不走作用域 —— golden-path 里一次 `/api/chat/resume`
    // 会把「已按您的确认继续处理」写进**全局**会话库，于是同进程里后跑的
    // workspace-chat 打开同一会话时看到的是「已继续」而不是种子里的待批准卡
    // （`--workers=1` 也照样红；只跑 workspace-chat 则绿）。这里用两个作用域钉住隔离性。
    const a = { "content-type": "application/json", "x-lawmind-e2e-scope": `${scope}-a` };
    const b = { "content-type": "application/json", "x-lawmind-e2e-scope": `${scope}-b` };

    // 先钉住 B 的起点：种子里的待批准卡（不是「已继续」）。
    const bBefore = (await (
      await fetch(`${base}/api/sessions/e2e-session-1`, { headers: b })
    ).json()) as { messages?: Array<{ text?: string }> };
    expect(JSON.stringify(bBefore.messages)).not.toContain("已按您的确认继续处理");

    const resume = await fetch(`${base}/api/chat/resume`, {
      method: "POST",
      headers: a,
      body: JSON.stringify({ sessionId: "e2e-session-1", decision: "approve" }),
    });
    expect(resume.status).toBe(200);

    // A 侧：resume 后（含重载）一直呈现「已继续」。
    for (let i = 0; i < 2; i += 1) {
      const aLoad = (await (
        await fetch(`${base}/api/sessions/e2e-session-1`, { headers: a })
      ).json()) as { messages?: Array<{ text?: string }> };
      expect(JSON.stringify(aLoad.messages)).toContain("已按您的确认继续处理");
    }

    // B 侧：一次都不该看到 A 的 resume 痕迹。
    const bAfter = (await (
      await fetch(`${base}/api/sessions/e2e-session-1`, { headers: b })
    ).json()) as { messages?: Array<{ text?: string }> };
    expect(JSON.stringify(bAfter.messages)).not.toContain("已按您的确认继续处理");

    // 复位只影响调用方自己的作用域。
    await fetch(`${base}/__e2e__/reset`, { method: "POST", headers: b });
    const aStillResumed = (await (
      await fetch(`${base}/api/sessions/e2e-session-1`, { headers: a })
    ).json()) as { messages?: Array<{ text?: string }> };
    expect(JSON.stringify(aStillResumed.messages)).toContain("已按您的确认继续处理");
  });
});
