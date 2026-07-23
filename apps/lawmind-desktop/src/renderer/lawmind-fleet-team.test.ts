import { describe, expect, it } from "vitest";
import type { AgentRunSummary } from "./lawmind-agent-fleet-api";
import {
  buildFleetTeamRows,
  filterRunsByAssistant,
  formatGrowthTrend,
  FLEET_UNASSIGNED_ID,
  fleetTeamBusyLabel,
} from "./lawmind-fleet-team";

function run(partial: Partial<AgentRunSummary> & Pick<AgentRunSummary, "id" | "status">): AgentRunSummary {
  return {
    kind: "pending_review",
    title: partial.title ?? "任务",
    updatedAt: "2026-07-21T00:00:00.000Z",
    createdAt: "2026-07-21T00:00:00.000Z",
    priority: 0,
    ...partial,
  };
}

describe("lawmind-fleet-team", () => {
  it("aggregates awaiting items per assistant and ranks 待你拍板 first", () => {
    const rows = buildFleetTeamRows({
      runs: [
        run({ id: "1", status: "awaiting_review", assistantId: "a1", title: "合同意见" }),
        run({ id: "2", status: "running", assistantId: "a2", title: "检索中" }),
        run({ id: "3", status: "awaiting_clarification", title: "无助手" }),
      ],
      displayById: { a1: "合同助手", a2: "诉讼助手" },
      growth: {
        windowDays: 30,
        assistants: [
          {
            assistantId: "a1",
            roleId: "contract_review",
            lifetime: {
              tasksReviewed: 10,
              firstPassApprovals: 6,
              materialRewrites: 4,
              firstPassRate: 0.6,
              rewriteRate: 0.4,
            },
            window: {
              tasksReviewed: 4,
              firstPassApprovals: 3,
              materialRewrites: 1,
              firstPassRate: 0.75,
              rewriteRate: 0.25,
            },
            pendingAdoptions: 2,
            rewriteAmplitude: {
              samples: 3,
              avgAbsCharDelta: 120,
              avgAbsParagraphDelta: 1.5,
              lastAbsCharDelta: 80,
            },
          },
          {
            assistantId: "a3",
            lifetime: {
              tasksReviewed: 1,
              firstPassApprovals: 1,
              materialRewrites: 0,
              firstPassRate: 1,
              rewriteRate: 0,
            },
            window: {
              tasksReviewed: 0,
              firstPassApprovals: 0,
              materialRewrites: 0,
              firstPassRate: 0,
              rewriteRate: 0,
            },
            pendingAdoptions: 0,
          },
        ],
      },
    });
    expect(rows[0]?.assistantId).toBe("a1");
    expect(rows[0]?.busy).toBe("awaiting_lawyer");
    expect(rows[0]?.displayName).toBe("合同助手");
    expect(rows[0]?.windowFirstPassRate).toBe(0.75);
    expect(rows[0]?.lifetimeFirstPassRate).toBe(0.6);
    expect(formatGrowthTrend(rows[0])).toBe("60% → 75%");
    expect(rows[0]?.pendingAdoptions).toBe(2);
    expect(rows[0]?.avgRewriteAbsChars).toBe(120);
    expect(rows.some((r) => r.assistantId === "a2" && r.busy === "working")).toBe(true);
    expect(rows.some((r) => r.assistantId === FLEET_UNASSIGNED_ID)).toBe(true);
    expect(rows.some((r) => r.assistantId === "a3" && r.busy === "idle")).toBe(true);
    expect(fleetTeamBusyLabel("awaiting_lawyer")).toBe("待你拍板");
  });

  it("filters runs by assistant including unassigned", () => {
    const runs = [
      run({ id: "1", status: "awaiting_review", assistantId: "a1" }),
      run({ id: "2", status: "awaiting_review" }),
    ];
    expect(filterRunsByAssistant(runs, "a1")).toHaveLength(1);
    expect(filterRunsByAssistant(runs, FLEET_UNASSIGNED_ID)).toHaveLength(1);
    expect(filterRunsByAssistant(runs, null)).toHaveLength(2);
  });
});
