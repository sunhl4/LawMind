import { describe, expect, it } from "vitest";
import { formatCapabilityCatalogIndex } from "./catalog.js";
import { compileIntent, extractIntentSignals } from "./compile-intent.js";

describe("compileIntent", () => {
  it("nails mail short path and explicit lock over keywords", () => {
    expect(
      compileIntent({
        instruction: "【邮件合同审阅改稿 · 短路径 · 原文件审阅痕迹】\n审查合同",
      }).capabilityId,
    ).toBe("mail.contract");
    expect(
      compileIntent({
        instruction: "【办件】能力：litigation.draft\n请审查这份采购合同",
      }).capabilityId,
    ).toBe("litigation.draft");
  });

  it("uses file genre when the lawyer only says 帮我看看", () => {
    const compiled = compileIntent({
      instruction: "帮我看看",
      pins: [
        {
          pinKind: "file",
          root: "project",
          relPath: "买卖合同.docx",
          kind: "file",
        },
      ],
    });
    expect(compiled.capabilityId).toBe("contract.review");
    expect(compiled.source).toBe("joint");
    expect(compiled.lawyerSummary).toContain("合同审查");
  });

  it("does not treat a complaint that quotes a contract as contract review", () => {
    const compiled = compileIntent({
      instruction: "帮我看看",
      documents: [
        {
          relPath: "起诉材料.docx",
          peekText: "民事起诉状\n原告：张三\n被告：李四\n诉讼请求：解除合同。",
        },
      ],
    });
    expect(compiled.capabilityId).toBe("litigation.draft");
  });

  it("treats review words on a complaint file as litigation without asking the lawyer", () => {
    const compiled = compileIntent({
      instruction: "请审查这份采购合同",
      pins: [
        {
          pinKind: "file",
          root: "project",
          relPath: "民事起诉状.docx",
          kind: "file",
        },
      ],
    });
    expect(compiled.capabilityId).toBe("litigation.draft");
    expect(compiled.softAsk).toBeUndefined();
    expect(compiled.alternatives).toEqual([]);
  });

  it("prefers the contract file when mixed papers meet an explicit review instruction", () => {
    const compiled = compileIntent({
      instruction: "请审查这份采购合同",
      pins: [
        {
          pinKind: "file",
          root: "project",
          relPath: "采购合同.docx",
          kind: "file",
        },
        {
          pinKind: "file",
          root: "project",
          relPath: "民事起诉状.docx",
          kind: "file",
        },
      ],
    });
    expect(compiled.capabilityId).toBe("contract.review");
    expect(compiled.softAsk).toBeUndefined();
  });

  it("binds Word 改稿 on a pleading to litigation, not contract review", () => {
    const compiled = compileIntent({
      instruction: "帮我改一下",
      pins: [
        {
          pinKind: "file",
          root: "project",
          relPath: "民事起诉状.docx",
          kind: "file",
        },
      ],
    });
    expect(compiled.capabilityId).toBe("litigation.draft");
    expect(compiled.source).toBe("word_revision");
    expect(compiled.pipelineOverride).toBe("tracked_redline");
    expect(compiled.skillIdsOverride).toEqual(["complaint-elements-fill"]);
  });

  it("does not sticky-continue after a correction utterance", () => {
    const corrected = compileIntent({
      instruction: "不对",
      previousCapabilityId: "contract.review",
    });
    expect(corrected.capabilityId).toBeUndefined();
    expect(
      compileIntent({
        instruction: "继续",
        previousCapabilityId: undefined,
      }).capabilityId,
    ).toBeUndefined();
  });

  it("extracts mixed signals for a pinned word plus vague text", () => {
    const signals = extractIntentSignals({
      instruction: "看看这个",
      pins: [
        {
          pinKind: "file",
          root: "project",
          relPath: "服务合同.docx",
          kind: "file",
        },
      ],
    });
    expect(signals.dominantGenre).toBe("contract");
    expect(signals.hasMaterials).toBe(true);
  });

  it("keeps the Codex catalog under the character budget", () => {
    const block = formatCapabilityCatalogIndex();
    expect(block).toContain("contract.review");
    expect(block).not.toContain("mail.contract");
    expect(block.length).toBeLessThanOrEqual(8000);
  });
});
