import { describe, expect, it } from "vitest";
import {
  ApprovalRecordSchema,
  DeadlineRecordSchema,
  DeliverableRecordSchema,
  MatterRecordSchema,
  QueueRecordSchema,
} from "./schema.js";

describe("matter-storage schema", () => {
  it("accepts a minimal matter record and fills defaults", () => {
    const parsed = MatterRecordSchema.parse({
      matterId: "m1",
      title: "NDA 审查",
      status: "active",
      sensitivity: "normal",
      strategyStatus: "draft",
    });
    expect(parsed.openQuestionIds).toEqual([]);
    expect(parsed.nextActions).toEqual([]);
  });

  it("rejects empty matterId / title", () => {
    expect(() =>
      MatterRecordSchema.parse({
        matterId: "",
        title: "x",
        status: "active",
        sensitivity: "normal",
        strategyStatus: "missing",
      }),
    ).toThrow();
    expect(() =>
      MatterRecordSchema.parse({
        matterId: "m1",
        title: "",
        status: "active",
        sensitivity: "normal",
        strategyStatus: "missing",
      }),
    ).toThrow();
  });

  it("parses deliverable / approval / queue / deadline smoke shapes", () => {
    const now = "2026-07-18T10:00:00.000Z";
    expect(
      DeliverableRecordSchema.parse({
        deliverableId: "d1",
        matterId: "m1",
        kind: "contract-review",
        audience: "internal",
        status: "drafting",
        createdAt: now,
        updatedAt: now,
      }).kind,
    ).toBe("contract-review");

    expect(
      ApprovalRecordSchema.parse({
        approvalId: "a1",
        matterId: "m1",
        requestedBy: "lawyer",
        requestedAt: now,
        reason: "高风险导出",
        riskLevel: "high",
        status: "pending",
      }).status,
    ).toBe("pending");

    expect(
      QueueRecordSchema.parse({
        queueItemId: "q1",
        matterId: "m1",
        kind: "need_lawyer_review",
        status: "open",
        priority: "high",
        title: "待审",
        createdAt: now,
        updatedAt: now,
      }).kind,
    ).toBe("need_lawyer_review");

    expect(
      DeadlineRecordSchema.parse({
        deadlineId: "dl1",
        matterId: "m1",
        title: "举证期限",
        dueAt: now,
        severity: "hard",
        source: "manual",
        status: "open",
      }).severity,
    ).toBe("hard");
  });
});
