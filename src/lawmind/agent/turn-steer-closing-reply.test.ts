/**
 * 「改这一轮」 that arrives while the closing sentence is streaming
 * must be sampled before the turn ends. Subagents do not see it.
 */
import { describe, expect, it } from "vitest";
import { queuePendingSteer } from "./session-context-steer.js";
import { cassetteAssistant } from "./testkit/index.js";
import { TestLawMind } from "./testkit/test-lawmind.js";

describe("steer during the closing reply", () => {
  it("samples the correction before the turn completes", async () => {
    const harness = await TestLawMind.builder().build();
    try {
      const session = harness.seedHistory([]);
      let queued = false;
      harness.onModelRequest(() => {
        if (queued) {
          return;
        }
        queued = true;
        queuePendingSteer(harness.workspaceDir, session.sessionId, "不要写解除");
      });
      harness.enqueue(
        cassetteAssistant("合同可以解除。"),
        cassetteAssistant("已按指示，不写解除。"),
      );
      const result = await harness.runTurn("审查解除权", { sessionId: session.sessionId });
      expect(harness.requests.length).toBeGreaterThanOrEqual(2);
      expect(harness.request(1).contains("不要写解除")).toBe(true);
      expect(result.reply).toContain("不写解除");
      expect(result.turn.status).toBe("completed");
    } finally {
      await harness.close();
    }
  });
});
