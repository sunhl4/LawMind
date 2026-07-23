import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ArtifactDraft } from "../types.js";
import { readProductMetricEvents } from "./assistant-growth.js";
import {
  avgAbsCharDelta,
  computeRewriteAmplitude,
  draftPlainText,
  loadRewriteAmplitudeStore,
  recordRewriteAmplitude,
} from "./rewrite-amplitude.js";

function draft(
  partial: Partial<ArtifactDraft> & Pick<ArtifactDraft, "taskId" | "title">,
): ArtifactDraft {
  return {
    summary: "",
    sections: [],
    reviewStatus: "pending",
    reviewNotes: [],
    output: "docx" as const,
    templateId: "general",
    createdAt: new Date().toISOString(),
    ...partial,
  };
}

describe("rewrite-amplitude", () => {
  let dir: string;

  afterEach(() => {
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("computes char and paragraph deltas", () => {
    const before = "一段。\n\n两段。";
    const after = "一段改写更长一些。\n\n两段。\n\n三段。";
    const amp = computeRewriteAmplitude(before, after);
    expect(amp.charDelta).toBe(after.length - before.length);
    expect(amp.absCharDelta).toBe(Math.abs(amp.charDelta));
    expect(amp.paragraphsBefore).toBe(2);
    expect(amp.paragraphsAfter).toBe(3);
    expect(amp.absParagraphDelta).toBe(1);
  });

  it("records quality meta and product metric without learning writes", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-amp-"));
    const before = draftPlainText(
      draft({
        taskId: "t1",
        title: "意见",
        summary: "摘要短",
        sections: [{ heading: "一", body: "原文。" }],
      }),
    );
    const after = draftPlainText(
      draft({
        taskId: "t1",
        title: "意见",
        summary: "摘要加长若干字",
        sections: [
          { heading: "一", body: "改写后的正文更长。" },
          { heading: "二", body: "新增节。" },
        ],
      }),
    );
    const sample = recordRewriteAmplitude({
      workspaceDir: dir,
      assistantId: "asst_c",
      taskId: "t1",
      matterId: "m1",
      beforeText: before,
      afterText: after,
    });
    expect(sample.absCharDelta).toBeGreaterThan(0);
    const store = loadRewriteAmplitudeStore(dir);
    expect(store.byAssistant.asst_c?.samples).toBe(1);
    expect(avgAbsCharDelta(store.byAssistant.asst_c)).toBe(sample.absCharDelta);
    const events = readProductMetricEvents(dir);
    expect(events.some((e) => e.kind === "rewrite_amplitude")).toBe(true);
    expect(fs.existsSync(path.join(dir, "LAWYER_PROFILE.md"))).toBe(false);
  });
});
