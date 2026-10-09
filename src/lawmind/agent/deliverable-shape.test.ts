import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CONSULT_QUESTIONS_MARKER,
  PLEADING_SECTION_MARKER,
  consultListGap,
  consultListNeedsRewrite,
  consultQuestionCount,
  formatConsultQuestionsNudge,
  formatPleadingSectionNudge,
  instructionFramesConsultQuestions,
  instructionFramesPleading,
  missingPleadingSections,
  pleadingSectionGaps,
} from "./deliverable-shape.js";

const CASE_FRAME = [
  "按题目要求用【结论】【案情简述】【分析过程】【依据法条】四段。",
  "用 write_document 写入 case-analysis-8.md。",
  "",
  "当事人要求撰写民事起诉状，并说不要给完整法律意见，只列出追问。",
].join("\n");

describe("deliverable shape", () => {
  it("leaves case-analysis frames alone even when the facts mention pleadings or follow-ups", () => {
    expect(instructionFramesPleading(CASE_FRAME)).toBe(false);
    expect(instructionFramesConsultQuestions(CASE_FRAME)).toBe(false);
  });

  it("matches a named complaint or defense, and a follow-up list in the task sentence", () => {
    expect(
      instructionFramesPleading(
        "根据材料撰写民事答辩状。\n用 write_document 写入 答辩状-5.md。\n\n案情里出现【结论】。",
      ),
    ).toBe(true);
    expect(instructionFramesPleading("请写民事起诉状。\n用 write_document 写入 memo.md。")).toBe(
      true,
    );
    expect(instructionFramesPleading("把分析写入 case-note.md。")).toBe(false);
    expect(
      instructionFramesConsultQuestions(
        "本轮不要给完整法律意见，只列出 10–25 条可核验的追问。\n用 write_document 写入 追问清单-8.md。",
      ),
    ).toBe(true);
    expect(
      instructionFramesConsultQuestions(
        "用 write_document 写入 追问清单-1.md。\n\n不要给完整法律意见。",
      ),
    ).toBe(false);
  });

  it("asks for pleading sections only after the named file exists and is incomplete", () => {
    expect(missingPleadingSections("诉讼请求：还款。\n事实：借款。\n理由：到期。")).toEqual([
      "证据",
    ]);
    expect(missingPleadingSections("答辩请求：驳回。\n事实与理由：已还。\n证据：借条。")).toEqual(
      [],
    );
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-plead-"));
    const instruction = "撰写民事起诉状。用 write_document 写入 起诉状-5.md。";
    expect(pleadingSectionGaps(dir, instruction)).toEqual([]);
    fs.writeFileSync(path.join(dir, "起诉状-5.md"), "起诉状草稿", "utf8");
    expect(pleadingSectionGaps(dir, instruction)).toContain("诉讼请求或答辩请求");
    expect(pleadingSectionGaps(dir, CASE_FRAME)).toEqual([]);
    const nudge = formatPleadingSectionNudge(["证据"]);
    expect(nudge.startsWith(PLEADING_SECTION_MARKER)).toBe(true);
    expect(nudge).toContain("证据");
    expect(nudge).toContain("已经出现的条号");
  });

  it("treats fewer than eight numbered lines as not a follow-up list", () => {
    const opinion = "法律意见\n应当起诉。\n1. 诉讼请求为还款。";
    expect(consultQuestionCount(opinion)).toBe(1);
    expect(consultListNeedsRewrite(opinion)).toBe(true);
    const questions = Array.from(
      { length: 10 },
      (_, i) => `${i + 1}. 这件事的第 ${i + 1} 个事实是什么？`,
    ).join("\n");
    expect(consultListNeedsRewrite(questions)).toBe(false);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-consult-"));
    const instruction = "不要给完整法律意见，只列出追问。\n用 write_document 写入 追问清单-8.md。";
    expect(consultListGap(dir, instruction)).toBe(false);
    fs.writeFileSync(path.join(dir, "追问清单-8.md"), opinion, "utf8");
    expect(consultListGap(dir, instruction)).toBe(true);
    expect(consultListGap(dir, CASE_FRAME)).toBe(false);
    expect(formatConsultQuestionsNudge(["追问清单-8.md"])).toContain(CONSULT_QUESTIONS_MARKER);
  });
});
