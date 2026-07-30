import { describe, expect, it } from "vitest";
import {
  approvalStatusLabel,
  formatShortDateTime,
  priorityLabel,
  queueKindLabel,
  reviewStatusLabel,
  riskLevelLabel,
} from "./matter-display-labels.js";

describe("matter-display-labels", () => {
  it("labels queue kinds", () => {
    expect(queueKindLabel("need_lawyer_review")).toBe("待律师审核");
    expect(queueKindLabel("ready_to_render")).toBe("可渲染交付");
  });

  it("labels approval and review status", () => {
    expect(approvalStatusLabel("pending")).toBe("待审批");
    expect(reviewStatusLabel("modified")).toBe("需修改");
  });

  it("labels priority", () => {
    expect(priorityLabel("high")).toBe("高");
    expect(priorityLabel("normal")).toBe("中");
  });

  it("labels risk level", () => {
    expect(riskLevelLabel("critical")).toBe("紧急");
    expect(riskLevelLabel("high")).toBe("高");
    expect(riskLevelLabel("medium")).toBe("中");
    expect(riskLevelLabel(null)).toBe("—");
  });

  it("formats short datetime", () => {
    expect(formatShortDateTime(undefined)).toBe("—");
    expect(formatShortDateTime("2026-05-20T10:30:00.000Z")).toMatch(/\d/);
  });
});
