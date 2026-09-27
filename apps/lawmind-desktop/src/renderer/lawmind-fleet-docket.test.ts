import { describe, expect, it } from "vitest";
import type { AgentRunSummary } from "./lawmind-agent-fleet-api";
import {
  buildFleetDocket,
  docketInstruction,
  docketRowTitle,
  docketStopLine,
  docketWhenLabel,
  initialDocketOpen,
} from "./lawmind-fleet-docket";

function run(partial: Partial<AgentRunSummary> & { id: string }): AgentRunSummary {
  return {
    kind: "chat",
    status: "running",
    title: partial.id,
    updatedAt: "2026-09-26T08:00:00.000Z",
    createdAt: "2026-09-26T08:00:00.000Z",
    priority: 2,
    ...partial,
  } as AgentRunSummary;
}

const now = new Date("2026-09-26T10:00:00.000Z");

describe("buildFleetDocket", () => {
  it("puts decisions, in-flight work, and today's completions in separate bands", () => {
    const docket = buildFleetDocket({
      fleetRuns: [
        run({
          id: "send",
          kind: "automation_send",
          status: "awaiting_approval",
          title: "待发信",
          priority: 1,
        }),
        run({
          id: "chat:live",
          kind: "chat",
          status: "running",
          title: "检索判例",
          updatedAt: "2026-09-26T09:00:00.000Z",
        }),
        run({
          id: "chat:done",
          kind: "chat",
          status: "completed",
          title: "备忘录",
          updatedAt: "2026-09-26T07:00:00.000Z",
        }),
        run({
          id: "chat:old",
          kind: "chat",
          status: "completed",
          title: "上周的稿",
          updatedAt: "2026-09-20T07:00:00.000Z",
        }),
        run({
          id: "queue:internal",
          kind: "queue_item",
          status: "queued",
          title: "助手待起草",
        }),
        run({
          id: "review:hidden",
          kind: "pending_review",
          status: "awaiting_review",
          title: "内部审稿",
        }),
      ],
      pendingReviewDrafts: [],
      automationInbox: [],
      snoozed: new Set(),
      now,
    });
    expect(docket.needsYou.map((r) => r.id)).toEqual(["send"]);
    expect(docket.inFlight.map((r) => r.id)).toEqual(["chat:live"]);
    expect(docket.settled.map((r) => r.id)).toEqual(["chat:done"]);
  });

  it("keeps a recent failure in 停在你这里 and an interruption beside it", () => {
    const docket = buildFleetDocket({
      fleetRuns: [
        run({
          id: "chat:fail",
          status: "failed",
          title: "没办完",
          updatedAt: "2026-09-25T10:00:00.000Z",
          priority: 8,
        }),
        run({
          id: "chat:stop",
          status: "interrupted",
          title: "中断",
          priority: 5,
        }),
      ],
      pendingReviewDrafts: [],
      automationInbox: [],
      snoozed: new Set(),
      now,
    });
    expect(docket.needsYou.map((r) => r.id)).toEqual(["chat:stop", "chat:fail"]);
    expect(docket.inFlight).toEqual([]);
    expect(docket.settled).toEqual([]);
  });

  it("does not repeat a work item that already needs the lawyer", () => {
    const docket = buildFleetDocket({
      fleetRuns: [
        run({
          id: "chat:1",
          status: "awaiting_clarification",
          title: "要补充",
          workId: "w1",
          priority: 1,
        }),
        run({
          id: "job:1",
          kind: "workflow_job",
          status: "running",
          title: "同一件还在跑",
          workId: "w1",
        }),
      ],
      pendingReviewDrafts: [],
      automationInbox: [],
      snoozed: new Set(),
      now,
    });
    expect(docket.needsYou.map((r) => r.id)).toEqual(["chat:1"]);
    expect(docket.inFlight).toEqual([]);
  });

  it("keeps one row when a delegation and its chat are the same work", () => {
    const running = buildFleetDocket({
      fleetRuns: [
        run({
          id: "chat:child",
          kind: "chat",
          status: "running",
          title: "New Chat",
          sessionId: "s-child",
        }),
        run({
          id: "delegation:1",
          kind: "delegation",
          status: "running",
          title: "检索类案",
          sessionId: "s-child",
        }),
      ],
      pendingReviewDrafts: [],
      automationInbox: [],
      snoozed: new Set(),
      now,
    });
    expect(running.inFlight.map((r) => r.id)).toEqual(["delegation:1"]);

    const waiting = buildFleetDocket({
      fleetRuns: [
        run({
          id: "chat:child",
          kind: "chat",
          status: "awaiting_clarification",
          title: "要补当事人",
          sessionId: "s-child",
          priority: 1,
        }),
        run({
          id: "delegation:1",
          kind: "delegation",
          status: "running",
          title: "检索类案",
          sessionId: "s-child",
        }),
      ],
      pendingReviewDrafts: [],
      automationInbox: [],
      snoozed: new Set(),
      now,
    });
    expect(waiting.needsYou.map((r) => r.id)).toEqual(["chat:child"]);
    expect(waiting.inFlight).toEqual([]);
  });

  it("puts the failure note on the stop line and hides the placeholder title", () => {
    const failed = run({
      id: "chat:fail",
      status: "failed",
      title: "New Chat",
      subtitle: "写备忘录",
      note: "材料缺了主体",
    });
    expect(docketStopLine(failed)).toBe("没有办完。材料缺了主体");
    expect(docketRowTitle(failed, "New Chat")).toBe("写备忘录");
  });

  it("drops snoozed rows from every band", () => {
    const docket = buildFleetDocket({
      fleetRuns: [
        run({ id: "chat:live", status: "running", title: "在跑" }),
      ],
      pendingReviewDrafts: [],
      automationInbox: [
        {
          id: "inb-1",
          status: "open",
          title: "待发信",
          summary: "",
          createdAt: "2026-09-26T08:00:00.000Z",
          pendingSend: { to: "a@b.com", subject: "稿", body: "请查收" },
        },
      ] as never,
      snoozed: new Set(["chat:live", "automation-send:inb-1"]),
      now,
    });
    expect(docket.needsYou).toEqual([]);
    expect(docket.inFlight).toEqual([]);
  });
});

describe("docket copy", () => {
  it("reads the lawyer instruction and skips source labels", () => {
    expect(
      docketInstruction(
        run({ id: "1", subtitle: "本件：核对责任上限", title: "股权转让协议" }),
      ),
    ).toBe("核对责任上限");
    expect(
      docketInstruction(run({ id: "1", subtitle: "交给另一位助手", title: "检索类案" })),
    ).toBe("");
    expect(docketInstruction(run({ id: "1", title: "同一句", subtitle: "同一句" }))).toBe("");
    expect(docketStopLine(run({ id: "1", kind: "automation_send", status: "awaiting_approval" }))).toBe(
      "信已经写好，发出前要你看过。",
    );
    expect(docketWhenLabel("2026-09-26T09:30:00.000Z", now)).toBe("30 分钟前");
  });

  it("opens in-flight when the list is short, and today's completions when nothing else is live", () => {
    expect(initialDocketOpen({ needsYou: 1, inFlight: 3, settled: 2 })).toEqual({
      inFlight: true,
      settled: false,
    });
    expect(initialDocketOpen({ needsYou: 0, inFlight: 8, settled: 1 })).toEqual({
      inFlight: false,
      settled: false,
    });
    expect(initialDocketOpen({ needsYou: 0, inFlight: 0, settled: 2 })).toEqual({
      inFlight: false,
      settled: true,
    });
  });
});
