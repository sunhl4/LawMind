import { describe, expect, it } from "vitest";
import {
  computeBehaviorSummary,
  computeConvergenceHints,
  computeProductExperiments,
  computeRoadmapCards,
  type InteractionEvent,
} from "./index.js";

function ev(
  partial: Partial<InteractionEvent> & { matterId: string; action: InteractionEvent["action"] },
): InteractionEvent {
  return {
    kind: "ux.matter_action",
    taskId: "t-1",
    timestamp: "2026-04-01T10:00:00Z",
    surface: "cockpit",
    label: "查看草稿",
    ...partial,
  };
}

describe("insights", () => {
  it("computeBehaviorSummary aggregates counts and dominant action", () => {
    const events: InteractionEvent[] = [
      ev({ matterId: "m1", action: "open_review" }),
      ev({ matterId: "m1", action: "open_review" }),
      ev({ matterId: "m1", action: "open_review" }),
      ev({ matterId: "m1", action: "save_upgrade_suggestion" }),
      ev({ matterId: "m1", action: "write_case_note" }),
    ];
    const summary = computeBehaviorSummary(events);
    expect(summary.total).toBe(5);
    expect(summary.reviewOpenCount).toBe(3);
    expect(summary.memorySaveCount).toBe(1);
    expect(summary.caseWriteCount).toBe(1);
    expect(summary.dominantAction).toBe("review");
    expect(summary.dominantSurface?.label).toBe("cockpit");
  });

  it("computeConvergenceHints returns hints when thresholds are met", () => {
    const events: InteractionEvent[] = Array.from({ length: 6 }, () =>
      ev({ matterId: "m1", action: "open_review" }),
    );
    const summary = computeBehaviorSummary(events);
    const hints = computeConvergenceHints(summary);
    expect(hints.length).toBeGreaterThan(0);
    expect(hints.find((h) => h.key === "review_loop_dominant")).toBeTruthy();
  });

  it("computeConvergenceHints returns empty for empty summary", () => {
    const summary = computeBehaviorSummary([]);
    expect(computeConvergenceHints(summary)).toHaveLength(0);
  });

  it("computeProductExperiments mirrors hot signals", () => {
    const events: InteractionEvent[] = Array.from({ length: 5 }, () =>
      ev({ matterId: "m1", action: "open_review" }),
    );
    const summary = computeBehaviorSummary(events);
    const experiments = computeProductExperiments(summary);
    expect(experiments.find((e) => e.key === "exp_inline_acceptance_score")).toBeTruthy();
  });

  it("computeRoadmapCards aggregates across matters and skips singletons", () => {
    const events: InteractionEvent[] = [
      ev({ matterId: "m1", action: "open_review", label: "review_pending" }),
      ev({ matterId: "m2", action: "open_review", label: "review_pending" }),
      ev({ matterId: "m3", action: "open_review", label: "review_pending" }),
      ev({ matterId: "m4", action: "save_upgrade_suggestion", label: "rare_label" }),
    ];
    const cards = computeRoadmapCards(events);
    expect(cards.length).toBe(1);
    expect(cards[0].title).toContain("review_pending");
    expect(cards[0].matterCount).toBe(3);
    expect(cards[0].totalEvents).toBe(3);
    expect(cards[0].urgency).toBe("now");
  });
});
