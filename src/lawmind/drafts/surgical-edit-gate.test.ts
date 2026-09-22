import { describe, expect, it } from "vitest";
import type { ArtifactDraft } from "../types.js";
import {
  evaluateSurgicalEditGate,
  evaluateSurgicalEditGateHard,
  surgicalAmplitudeEnforceEnabled,
} from "./surgical-edit-gate.js";

function draft(body: string): ArtifactDraft {
  return {
    taskId: "t1",
    title: "合同",
    output: "docx",
    templateId: "word/contract-default",
    deliverableType: "contract.general",
    summary: "",
    sections: [{ heading: "正文", body }],
    reviewNotes: [],
    reviewStatus: "pending",
    createdAt: new Date().toISOString(),
    contractEdit: { baselineRelativePath: "c.docx", mode: "surgical" },
  };
}

describe("evaluateSurgicalEditGate", () => {
  it("allows a minimal two-character rewrite", () => {
    const gate = evaluateSurgicalEditGate({
      beforeDraft: draft("甲方应在三十日内支付全部价款。"),
      afterDraft: draft("甲方应在十五日内支付全部价款。"),
    });
    expect(gate.ok).toBe(true);
    expect(gate.exceededSoftThreshold).toBe(false);
  });

  it("soft-coaches a near-total rewrite without blocking", () => {
    const before = "甲".repeat(200) + "应依约履行付款义务并承担违约责任。";
    const after = "乙".repeat(220) + "可随时解除合同且无需通知。";
    const gate = evaluateSurgicalEditGate({
      beforeDraft: draft(before),
      afterDraft: draft(after),
    });
    expect(gate.ok).toBe(true);
    expect(gate.exceededSoftThreshold).toBe(true);
    expect(gate.message).toMatch(/幅度|apply_surgical_edits/);
  });

  it("legacy hard helper still rejects oversized rewrites", () => {
    const before = "甲".repeat(200) + "应依约履行付款义务并承担违约责任。";
    const after = "乙".repeat(220) + "可随时解除合同且无需通知。";
    const gate = evaluateSurgicalEditGateHard({
      beforeDraft: draft(before),
      afterDraft: draft(after),
    });
    expect(gate.ok).toBe(false);
    if (!gate.ok) {
      expect(gate.code).toBe("rewrite_amplitude_exceeded");
    }
  });

  it("reads LAWMIND_SURGICAL_ENFORCE for abuse rail", () => {
    expect(surgicalAmplitudeEnforceEnabled({})).toBe(false);
    expect(surgicalAmplitudeEnforceEnabled({ LAWMIND_SURGICAL_ENFORCE: "1" })).toBe(true);
  });
});
