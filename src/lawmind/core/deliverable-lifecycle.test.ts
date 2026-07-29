import { describe, expect, it } from "vitest";
import {
  DELIVERABLE_LIFECYCLE_STATUSES,
  canTransitionDeliverable,
  deliverableStatusLabel,
  nextDeliverableStatuses,
} from "./deliverable-lifecycle.js";

describe("deliverable lifecycle", () => {
  it("models the complete Q1 lifecycle", () => {
    expect(DELIVERABLE_LIFECYCLE_STATUSES).toEqual([
      "planned",
      "drafting",
      "pending_review",
      "approved",
      "rendered",
      "delivered",
      "learned",
      "blocked",
    ]);
  });

  it("allows the happy path through delivery and learning", () => {
    expect(canTransitionDeliverable("planned", "drafting")).toBe(true);
    expect(canTransitionDeliverable("drafting", "pending_review")).toBe(true);
    expect(canTransitionDeliverable("pending_review", "approved")).toBe(true);
    expect(canTransitionDeliverable("approved", "rendered")).toBe(true);
    expect(canTransitionDeliverable("rendered", "delivered")).toBe(true);
    expect(canTransitionDeliverable("delivered", "learned")).toBe(true);
  });

  it("blocks shortcut transitions that skip review", () => {
    expect(canTransitionDeliverable("planned", "rendered")).toBe(false);
    expect(nextDeliverableStatuses("pending_review")).toEqual(["approved", "blocked"]);
  });

  it("has lawyer-readable labels", () => {
    expect(deliverableStatusLabel("learned")).toBe("已沉淀");
  });

  it("labels every lifecycle status", () => {
    expect(deliverableStatusLabel("planned")).toBe("已规划");
    expect(deliverableStatusLabel("drafting")).toBe("起草中");
    expect(deliverableStatusLabel("pending_review")).toBe("待审核");
    expect(deliverableStatusLabel("approved")).toBe("已批准");
    expect(deliverableStatusLabel("rendered")).toBe("已渲染");
    expect(deliverableStatusLabel("delivered")).toBe("已交付");
    expect(deliverableStatusLabel("blocked")).toBe("已阻塞");
  });

  it("allows noop transition to same status", () => {
    expect(canTransitionDeliverable("drafting", "drafting")).toBe(true);
    expect(nextDeliverableStatuses("approved")).toEqual(["rendered"]);
  });
});
