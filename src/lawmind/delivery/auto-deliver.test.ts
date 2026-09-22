import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { appendProductMetric } from "../metrics/product-metrics.js";
import type { ArtifactDraft } from "../types.js";
import { evaluateAutoDeliver, isOutboundDraft } from "./auto-deliver.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  dirs.length = 0;
});

function draft(over: Partial<ArtifactDraft> = {}): ArtifactDraft {
  return {
    taskId: "t1",
    title: "内部备忘",
    summary: "内部核对用",
    sections: [
      { heading: "一", body: "本合同定金为本合同标的额的 10%，双方盖章签署。", citations: [] },
    ],
    reviewStatus: "pending",
    reviewNotes: [],
    output: "docx",
    templateId: "word/contract-default",
    createdAt: new Date().toISOString(),
    ...over,
  };
}

describe("auto-deliver", () => {
  it("never treats client/court letters as internal", () => {
    expect(isOutboundDraft({ audience: "客户法务", deliverableType: "memo.internal" })).toBe(true);
    expect(isOutboundDraft({ audience: "本所内部", deliverableType: "letter.demand" })).toBe(true);
    expect(isOutboundDraft({ audience: "本所内部", deliverableType: "memo.internal" })).toBe(false);
  });

  it("refuses when autonomy series is missing", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-ad-"));
    dirs.push(ws);
    const out = evaluateAutoDeliver({ workspaceDir: ws, draft: draft(), riskLevel: "low" });
    expect(out.shouldAutoDeliver).toBe(false);
    expect(out.tier).not.toBe("auto_deliver");
  });

  it("refuses when escape events exist but no delivery has completed (empty denominator)", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-ad-empty-"));
    dirs.push(ws);
    // 只有逃逸事件、零已交付：v2 口径下 lintEscapeRate=null，不得解锁自动交付
    appendProductMetric(ws, { kind: "lint_escape", outcome: "lawyer_edit" });
    appendProductMetric(ws, { kind: "lint_escape", outcome: "lawyer_edit" });
    const out = evaluateAutoDeliver({
      workspaceDir: ws,
      draft: draft({ audience: "本所内部" }),
      riskLevel: "low",
    });
    expect(out.shouldAutoDeliver).toBe(false);
    expect(out.tier).not.toBe("auto_deliver");
  });

  it("unlocks internal low-risk only with first-pass and lint-escape series", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-ad-ok-"));
    dirs.push(ws);
    for (let i = 0; i < 20; i += 1) {
      appendProductMetric(ws, { kind: "first_pass", outcome: "ok" });
    }
    // v2 口径：2 次律师实质修改 / 20 已交付 = 0.1 ≤ 0.15，仍可解锁
    appendProductMetric(ws, { kind: "lint_escape", outcome: "lawyer_edit" });
    appendProductMetric(ws, { kind: "lint_escape", outcome: "lawyer_edit" });
    const ok = evaluateAutoDeliver({
      workspaceDir: ws,
      draft: draft({ audience: "本所内部" }),
      riskLevel: "low",
    });
    expect(ok.shouldAutoDeliver).toBe(true);
    const outbound = evaluateAutoDeliver({
      workspaceDir: ws,
      draft: draft({ audience: "客户", deliverableType: "letter.demand" }),
      riskLevel: "low",
    });
    expect(outbound.shouldAutoDeliver).toBe(false);
  });

  it("refuses auto-deliver when lint still has warnings", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-ad-warn-"));
    dirs.push(ws);
    for (let i = 0; i < 20; i += 1) {
      appendProductMetric(ws, { kind: "first_pass", outcome: "ok" });
    }
    appendProductMetric(ws, { kind: "lint_escape", outcome: "lawyer_edit" });
    const out = evaluateAutoDeliver({
      workspaceDir: ws,
      draft: draft({
        audience: "本所内部",
        sections: [
          { heading: "一", body: "本合同甲方为【待补充】，标的额 10000 元。", citations: [] },
        ],
      }),
      riskLevel: "low",
    });
    expect(out.tier).toBe("auto_deliver");
    expect(out.shouldAutoDeliver).toBe(false);
  });
});
