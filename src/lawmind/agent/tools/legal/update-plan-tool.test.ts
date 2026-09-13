import { describe, expect, it } from "vitest";
import type { AgentContext } from "../../types.js";
import { ToolRegistry } from "../registry.js";
import { updatePlanTool } from "./update-plan-tool.js";

const ctx: AgentContext = {
  workspaceDir: "/tmp/lawmind-update-plan",
  sessionId: "s1",
  actorId: "test",
};

describe("update_plan tool", () => {
  it("writes a pendingTurnPlan onto ctx and returns a short receipt", async () => {
    const result = await updatePlanTool.execute(
      {
        plan: [
          { step: "读合同与钉选材料", status: "in_progress" },
          { step: "标风险与缺口", status: "pending" },
          { step: "给出修订建议", status: "pending" },
        ],
      },
      ctx,
    );
    expect(result.ok).toBe(true);
    expect(ctx.pendingTurnPlan?.items).toHaveLength(3);
    const data = result.data as { message?: string; plan?: { items: unknown[] } };
    expect(data.message).toContain("0/3");
    expect(data.plan?.items).toHaveLength(3);
  });

  it("rejects an unbounded essay-sized list", async () => {
    const result = await updatePlanTool.execute(
      {
        plan: Array.from({ length: 12 }, (_, i) => ({
          step: `步骤${i + 1}`,
          status: i === 0 ? "in_progress" : "pending",
        })),
      },
      ctx,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("2–8");
  });

  it("advertises a bounded items schema so the model can emit structured steps", () => {
    const registry = new ToolRegistry();
    registry.register(updatePlanTool);
    const spec = registry.toOpenAITools({ names: ["update_plan"] })[0];
    const plan = spec?.function.parameters.properties.plan as {
      type?: string;
      items?: { type?: string; required?: string[] };
    };
    expect(spec?.function.parameters.required).toContain("plan");
    expect(plan.type).toBe("array");
    expect(plan.items?.type).toBe("object");
    expect(plan.items?.required).toEqual(["step", "status"]);
  });
});
