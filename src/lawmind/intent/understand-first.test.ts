import { describe, expect, it } from "vitest";
import { compileIntent } from "./compile-intent.js";
import {
  compiledIntentInjectsSkillBodies,
  formatIntentHypothesisBlock,
  formatUnderstandFirstPromptBlock,
  INTENT_HYPOTHESIS_HEADING,
  UNDERSTAND_FIRST_HEADING,
} from "./understand-first.js";

describe("understand-first", () => {
  it("does not dump Skill bodies for a keyword-only 律师函 QA", () => {
    const compiled = compileIntent({
      instruction:
        "我要你做的不是合同审核，是根据【河南堃云顿数据科技有限公司】文件夹里的信息帮我看我起草的律师函内容是否有误",
      previousCapabilityId: "contract.review",
    });
    expect(compiled.source).toBe("keyword");
    expect(compiledIntentInjectsSkillBodies(compiled)).toBe(false);
    expect(formatIntentHypothesisBlock(compiled)).toContain("letter.draft");
    expect(formatIntentHypothesisBlock(compiled)).toContain("核对已起草律师函");
    expect(formatUnderstandFirstPromptBlock()).toContain(UNDERSTAND_FIRST_HEADING);
    expect(formatUnderstandFirstPromptBlock()).toContain("explore_folder");
  });

  it("still dumps Skill bodies for file-page Word 改稿 and mail short path", () => {
    const word = compileIntent({
      instruction: [
        "【用户在 LawMind 文件页将下列路径标为“本回合重点”】",
        "- [项目 · 路径引用] `买卖合同.docx`",
        "修改合同",
      ].join("\n"),
    });
    expect(compiledIntentInjectsSkillBodies(word)).toBe(true);

    const mail = compileIntent({
      instruction: "【邮件合同审阅改稿 · 短路径 · 原文件审阅痕迹】\n审查合同",
    });
    expect(compiledIntentInjectsSkillBodies(mail)).toBe(true);
  });

  it("does not dump Skill bodies for a look-only 帮我看看 plus a contract file", () => {
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
    expect(compiled.source).toBe("joint");
    expect(compiled.confidence).toBe("medium");
    expect(compiledIntentInjectsSkillBodies(compiled)).toBe(false);
    expect(formatIntentHypothesisBlock(compiled)).toContain(INTENT_HYPOTHESIS_HEADING);
  });

  it("dumps Skill bodies for an explicit 审查 plus a contract file", () => {
    const compiled = compileIntent({
      instruction: "请审查这份采购合同",
      pins: [
        {
          pinKind: "file",
          root: "project",
          relPath: "采购合同.docx",
          kind: "file",
        },
      ],
    });
    expect(compiled.source).toBe("joint");
    expect(compiled.confidence).toBe("high");
    expect(compiledIntentInjectsSkillBodies(compiled)).toBe(true);
  });

  it("does not dump Skill bodies for a sticky 继续 after a keyword bind", () => {
    const compiled = compileIntent({
      instruction: "继续",
      previousCapabilityId: "contract.review",
    });
    expect(compiled.source).toBe("continue");
    expect(compiledIntentInjectsSkillBodies(compiled)).toBe(false);
  });

  it("does not dump Skill bodies for a medium quick ask", () => {
    const compiled = compileIntent({ instruction: "他一直拖欠工资这算不算违法" });
    expect(compiled.source).toBe("specialized");
    expect(compiled.confidence).toBe("medium");
    expect(compiledIntentInjectsSkillBodies(compiled)).toBe(false);
  });

  it("does not dump Skill bodies for 函件 QA plus a pinned letter file", () => {
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
    expect(compiled.source).toBe("joint");
    expect(compiled.confidence).toBe("medium");
    expect(compiledIntentInjectsSkillBodies(compiled)).toBe(false);
  });
});
