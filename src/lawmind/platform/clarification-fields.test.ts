import { describe, expect, it } from "vitest";
import {
  appendEncodedLine,
  buildClarificationAnswerMap,
  CLARIFY_ATTACHMENTS_KEY,
  CLARIFY_SESSIONS_KEY,
  clarificationAnswersComplete,
  clarificationQuestionRequired,
  collectClarificationFilePins,
  collectClarificationSessionRefs,
  displayClarificationAnswer,
  encodeClarificationFileAnswer,
  encodeClarificationSessionRef,
  formatClarificationResumeMessage,
  isClarificationShortConfirm,
  normalizeClarificationInputType,
  parseClarificationFileAnswer,
  parseClarificationSessionRef,
  removeEncodedLine,
} from "./clarification-fields.js";

describe("clarification-fields", () => {
  it("normalizes input types and short-confirm heuristic", () => {
    expect(
      normalizeClarificationInputType({
        key: "parties",
        question: "请补充当事人",
        inputType: "text",
      }),
    ).toBe("text");
    expect(
      normalizeClarificationInputType({
        key: "scan",
        question: "请上传合同扫描件",
      }),
    ).toBe("file");
    expect(
      isClarificationShortConfirm([
        { key: "a", question: "管辖地？", options: ["北京", "上海"] },
        { key: "b", question: "是否已起诉？" },
      ]),
    ).toBe(true);
    expect(isClarificationShortConfirm([{ key: "scan", question: "请上传合同扫描件" }])).toBe(
      false,
    );
  });

  it("encodes file pins into resume message", () => {
    const encoded = encodeClarificationFileAnswer({
      root: "workspace",
      relPath: "evidence/nda.pdf",
      kind: "file",
    });
    expect(parseClarificationFileAnswer(encoded)?.relPath).toBe("evidence/nda.pdf");
    const msg = formatClarificationResumeMessage({ scan: encoded, name: "甲乙" }, [
      { key: "scan", question: "合同扫描件", inputType: "file" },
      { key: "name", question: "当事人" },
    ]);
    expect(msg).toContain("律师在补充信息时挂接的材料");
    expect(msg).toContain("evidence/nda.pdf");
    expect(msg).toContain("答：甲乙");
  });

  it("collects multi-line attachments and session refs", () => {
    const a = encodeClarificationFileAnswer({
      root: "workspace",
      relPath: "a.pdf",
      kind: "file",
    });
    const b = encodeClarificationFileAnswer({
      root: "workspace",
      relPath: "docs",
      kind: "directory",
    });
    const s = encodeClarificationSessionRef({ sessionId: "sess-1", title: "合同审查" });
    expect(parseClarificationSessionRef(s)?.sessionId).toBe("sess-1");
    const answers = {
      purpose: "诉讼",
      [CLARIFY_ATTACHMENTS_KEY]: appendEncodedLine(appendEncodedLine("", a), b),
      [CLARIFY_SESSIONS_KEY]: s,
    };
    expect(collectClarificationFilePins(answers)).toHaveLength(2);
    expect(collectClarificationSessionRefs(answers)[0]?.title).toBe("合同审查");
    const mapped = buildClarificationAnswerMap([{ key: "purpose", question: "用途" }], answers);
    expect(mapped[CLARIFY_ATTACHMENTS_KEY]).toContain("a.pdf");
    expect(mapped[CLARIFY_SESSIONS_KEY]).toContain("sess-1");
    const msg = formatClarificationResumeMessage(mapped, [{ key: "purpose", question: "用途" }]);
    expect(msg).toContain("带入的对话");
    expect(msg).toContain("合同审查");
    expect(msg).toContain("docs");
    expect(removeEncodedLine(answers[CLARIFY_ATTACHMENTS_KEY], a)).toContain("docs");
  });

  it("requires all required fields", () => {
    const qs = [
      { key: "a", question: "A", required: true },
      { key: "b", question: "B", required: false },
    ];
    expect(clarificationAnswersComplete(qs, { a: "x" })).toBe(true);
    expect(clarificationAnswersComplete(qs, { b: "y" })).toBe(false);
    expect(
      clarificationAnswersComplete([], { [CLARIFY_ATTACHMENTS_KEY]: "【材料】workspace:file:x" }),
    ).toBe(false);
  });

  it("displayClarificationAnswer formats file pins and bool answers", () => {
    const file = encodeClarificationFileAnswer({
      root: "workspace",
      relPath: "x.pdf",
      kind: "file",
    });
    expect(
      displayClarificationAnswer(
        { key: "scan", question: "请上传扫描件", inputType: "file" },
        file,
      ),
    ).toContain("x.pdf");
    expect(
      displayClarificationAnswer({ key: "ok", question: "是否起诉？", inputType: "bool" }, "yes"),
    ).toBe("是");
    expect(displayClarificationAnswer({ key: "city", question: "管辖地" }, "  ")).toBe("");
    expect(displayClarificationAnswer({ key: "city", question: "管辖地" }, "北京")).toBe("北京");
  });

  it("clarificationQuestionRequired defaults true unless explicitly optional", () => {
    expect(clarificationQuestionRequired({ key: "a", question: "A" })).toBe(true);
    expect(clarificationQuestionRequired({ key: "b", question: "B", required: false })).toBe(false);
  });

  it("normalizeClarificationInputType maps options to enum and honors date", () => {
    expect(
      normalizeClarificationInputType({
        key: "court",
        question: "法院",
        options: ["一中院", "二中院"],
      }),
    ).toBe("enum");
    expect(
      normalizeClarificationInputType({
        key: "signed_on",
        question: "签订日",
        inputType: "date",
      }),
    ).toBe("date");
  });
});
