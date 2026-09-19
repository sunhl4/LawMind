import { describe, expect, it } from "vitest";
import {
  extractTextIntent,
  instructionLooksLikeLetterQa,
  instructionRejectsContractReview,
  isContinuationUtterance,
  isLookOnlyUtterance,
  isTaskSwitchUtterance,
  instructionMentionsFolder,
  namedBracketFolders,
  shouldRequireFolderExplore,
} from "./text-intent.js";

const LETTER_QA =
  "我要你做的不是合同审核，是根据【河南堃云顿数据科技有限公司】文件夹里的信息帮我看我起草的律师函内容是否有误";

describe("text-intent", () => {
  it("does not treat 合同 inside 不是合同审核 as a contract object", () => {
    const text = extractTextIntent(LETTER_QA);
    expect(text.rejectsContractReview).toBe(true);
    expect(text.wantsContract).toBe(false);
    expect(text.wantsLetter).toBe(true);
    expect(text.verbs).toContain("letter");
    expect(instructionRejectsContractReview(LETTER_QA)).toBe(true);
    expect(isTaskSwitchUtterance(LETTER_QA)).toBe(true);
    expect(isContinuationUtterance(LETTER_QA)).toBe(false);
  });

  it("still sees 合同 when the lawyer is reviewing a contract and writing a letter", () => {
    const text = extractTextIntent("审查这份合同并写催告函");
    expect(text.rejectsContractReview).toBe(false);
    expect(text.wantsContract).toBe(true);
    expect(text.wantsLetter).toBe(true);
    expect(text.verbs).toContain("review");
  });

  it("treats 帮我看看 as look-only, not a pipeline lock", () => {
    expect(isLookOnlyUtterance("帮我看看")).toBe(true);
    expect(isLookOnlyUtterance("看看这份")).toBe(true);
    expect(isLookOnlyUtterance("请审查这份采购合同")).toBe(false);
    expect(isLookOnlyUtterance(LETTER_QA)).toBe(false);
    expect(instructionMentionsFolder("【交办】5 分钟合同审查")).toBe(false);
    expect(instructionMentionsFolder("根据【河南堃云顿数据科技有限公司】文件夹核对")).toBe(true);
    expect(
      instructionMentionsFolder(
        "【用户将下列路径标为“本回合重点”；其中 1 个小文本已嵌入正文，其余为路径引用】\n请审查这份采购合同",
      ),
    ).toBe(false);
    expect(instructionMentionsFolder("条款里写【待核实】后继续审查")).toBe(false);
    expect(instructionMentionsFolder("请审查这份采购合同的合同目录条款")).toBe(false);
    expect(instructionLooksLikeLetterQa(LETTER_QA)).toBe(true);
    expect(instructionLooksLikeLetterQa("不是合同审核，请写起诉状")).toBe(false);
    expect(instructionLooksLikeLetterQa("帮我写一份律师函，是否需要先看材料")).toBe(false);
    expect(instructionLooksLikeLetterQa("核对我起草的律师函是否有误")).toBe(true);
    expect(namedBracketFolders(LETTER_QA)).toEqual(["河南堃云顿数据科技有限公司"]);
    expect(namedBracketFolders("【交办】5 分钟合同审查")).toEqual([]);
  });

  it("requires folder explore on folder talk, not Word/mail/continue", () => {
    expect(
      shouldRequireFolderExplore({
        instruction: "根据【河南堃云顿数据科技有限公司】文件夹起草审查备忘",
      }),
    ).toBe(true);
    expect(
      shouldRequireFolderExplore({
        instruction: "请审查这份采购合同",
        hasDirectoryPin: true,
      }),
    ).toBe(true);
    expect(
      shouldRequireFolderExplore({
        instruction: "根据文件夹改这份合同",
        wordRevisionTurn: true,
      }),
    ).toBe(false);
    expect(
      shouldRequireFolderExplore({
        instruction: "根据文件夹改合同",
        mailContractTurn: true,
      }),
    ).toBe(false);
    expect(shouldRequireFolderExplore({ instruction: "继续" })).toBe(false);
    expect(shouldRequireFolderExplore({ instruction: "请审查这份采购合同" })).toBe(false);
    expect(
      shouldRequireFolderExplore({
        instruction: "把诉讼/刘学江侵权纠纷这个文件夹收进刘学江侵权案",
      }),
    ).toBe(false);
  });
});
