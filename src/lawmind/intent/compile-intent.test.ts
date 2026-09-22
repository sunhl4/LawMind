import { describe, expect, it } from "vitest";
import { formatCapabilityCatalogIndex } from "./catalog.js";
import { compileIntent, compiledIntentPlanItems, extractIntentSignals } from "./compile-intent.js";

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
    expect(compiled.confidence).toBe("medium");
    expect(compiled.lawyerSummary).toContain("合同审查");
    expect(compiled.lawyerSummary).toContain("本轮初步判断");
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

  it("keeps contract.review but does not lock tracked redline for an opinion sidecar", () => {
    const compiled = compileIntent({
      instruction: "请根据这个合同去给我一些审查意见放到桌面，不要在源文件上修改",
      pins: [
        {
          pinKind: "file",
          root: "project",
          relPath: "采购合同.docx",
          kind: "file",
        },
      ],
    });
    expect(compiled.capabilityId).toBe("contract.review");
    expect(compiled.pipelineOverride).toBeUndefined();
    expect(compiled.delivery.artifactShape).toBe("opinion_memo");
    expect(compiled.delivery.outputPlace).toBe("desktop");
    expect(compiled.delivery.mutateSource).toBe("forbid");
  });

  it("does not freeze 5-minute 合同审查意见 into opinion-only when a Word is pinned", () => {
    const compiled = compileIntent({
      instruction: [
        "【交办】5 分钟合同审查",
        "交付物类型：合同审查意见",
        "- 己方立场：中立",
        "- 审查重点：管辖",
      ].join("\n"),
      pins: [
        {
          pinKind: "file",
          root: "project",
          relPath: "采购合同.docx",
          kind: "file",
        },
      ],
    });
    expect(compiled.capabilityId).toBe("contract.review");
    expect(compiled.delivery.artifactShape).toBe("unspecified");
  });

  it("does not lock tracked redline for 立场/导出 when a Word is pinned", () => {
    const compiled = compileIntent({
      instruction: "立场甲方，导出",
      pins: [
        {
          pinKind: "file",
          root: "project",
          relPath: "采购合同.docx",
          kind: "file",
        },
      ],
    });
    expect(compiled.capabilityId).toBe("contract.review");
    expect(compiled.pipelineOverride).toBeUndefined();
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

  it("does not bind contract.review when the lawyer rejects 合同审核 and asks to check a 律师函", () => {
    const compiled = compileIntent({
      instruction:
        "我要你做的不是合同审核，是根据【河南堃云顿数据科技有限公司】文件夹里的信息帮我看我起草的律师函内容是否有误",
      previousCapabilityId: "contract.review",
    });
    expect(compiled.capabilityId).toBe("letter.draft");
    expect(compiled.source).toBe("keyword");
    expect(compiled.lawyerSummary).toContain("核对已起草律师函");
    expect(compiled.lawyerSummary).toContain("本轮初步判断");
    expect(compiled.lawyerSummary).toContain("以律师本轮原话为准");
    expect(compiled.lawyerSummary).toContain("勿续上轮合同审查");
    expect(compiled.pipelineOverride).toBeUndefined();
  });

  it("keeps 函件 QA plus a pinned letter as a soft hypothesis, not a Skill dump", () => {
    const compiled = compileIntent({
      instruction: "核对我起草的律师函是否有误",
      pins: [
        {
          pinKind: "file",
          root: "project",
          relPath: "律师函.docx",
          kind: "file",
        },
      ],
    });
    expect(compiled.capabilityId).toBe("letter.draft");
    expect(compiled.source).toBe("joint");
    expect(compiled.confidence).toBe("medium");
    expect(compiled.lawyerSummary).toContain("核对已起草律师函");
    expect(compiled.lawyerSummary).toContain("本轮初步判断");
  });

  it("does not auto-seed a checklist from a keyword-only bind", () => {
    const compiled = compileIntent({
      instruction: "审查这份合同并写催告函",
    });
    expect(compiled.source).toBe("keyword");
    expect(compiled.chain.length).toBeGreaterThanOrEqual(2);
    expect(compiledIntentPlanItems(compiled)).toEqual([]);
  });

  it("keeps explicit 审查 plus a contract file as review even when the line also asks for a 催告函", () => {
    const compiled = compileIntent({
      instruction: "审查这份合同并写催告函",
      pins: [
        {
          pinKind: "file",
          root: "project",
          relPath: "采购合同.docx",
          kind: "file",
        },
      ],
    });
    expect(compiled.capabilityId).toBe("contract.review");
    expect(compiled.chain).toContain("letter.draft");
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
