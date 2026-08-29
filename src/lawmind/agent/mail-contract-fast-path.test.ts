import { describe, expect, it } from "vitest";
import {
  extractSuggestedReplyTo,
  isMailContractFastPathInstruction,
  MAIL_CONTRACT_FAST_PATH_PROMPT,
  MAIL_CONTRACT_FAST_PATH_TOOL_NAMES,
  mailContractFastPathAllowNames,
} from "./mail-contract-fast-path.js";

describe("mail-contract-fast-path", () => {
  it("detects tracked automation instruction", () => {
    expect(
      isMailContractFastPathInstruction(
        "【邮件合同审阅改稿 · 短路径】\n默认 contract_edit_baseline_path=`cases/x/a.docx`\nrender_tracked_draft",
      ),
    ).toBe(true);
  });

  it("rejects ordinary chat and file-page Word edit", () => {
    expect(isMailContractFastPathInstruction("请帮我查一下合同法条")).toBe(false);
    expect(
      isMailContractFastPathInstruction(
        "修改合同\n默认 contract_edit_baseline_path=`泰国医疗人工智能战略合作框架协.docx`",
      ),
    ).toBe(false);
  });

  it("embeds craft skill, ops path, and span-local minimal-edit discipline", () => {
    expect(MAIL_CONTRACT_FAST_PATH_PROMPT).toContain("search_workspace");
    expect(MAIL_CONTRACT_FAST_PATH_PROMPT).toContain("redlinePending");
    expect(MAIL_CONTRACT_FAST_PATH_PROMPT).toContain("批注");
    expect(MAIL_CONTRACT_FAST_PATH_PROMPT).toContain("己方立场");
    expect(MAIL_CONTRACT_FAST_PATH_PROMPT).toContain("apply_surgical_edits");
    expect(MAIL_CONTRACT_FAST_PATH_PROMPT).toContain("空修订");
    expect(MAIL_CONTRACT_FAST_PATH_PROMPT).toContain("Craft");
    expect(MAIL_CONTRACT_FAST_PATH_PROMPT).toContain("自评量规");
    expect(MAIL_CONTRACT_FAST_PATH_PROMPT).toContain("craft_check");
    expect(MAIL_CONTRACT_FAST_PATH_PROMPT).toContain("最小修改");
    expect(MAIL_CONTRACT_FAST_PATH_PROMPT).toContain("能改几个字就只改几个字");
    expect(MAIL_CONTRACT_FAST_PATH_PROMPT).toContain("硬门禁");
    expect(MAIL_CONTRACT_FAST_PATH_PROMPT).toContain("条数不限");
    expect(MAIL_CONTRACT_FAST_PATH_PROMPT).not.toContain("最多 24");
    expect(MAIL_CONTRACT_FAST_PATH_PROMPT).not.toContain("应改尽改");
    expect(MAIL_CONTRACT_FAST_PATH_PROMPT).not.toContain("2–3 处");
    expect(MAIL_CONTRACT_FAST_PATH_PROMPT).toContain("直接拒绝");
  });

  it("locks the short-path tool table and pins reply-to", () => {
    const instruction = [
      "【邮件合同审阅改稿 · 短路径】",
      "建议回复收件人：Opp@Firm.CN",
      "render_tracked_draft",
    ].join("\n");
    expect(mailContractFastPathAllowNames(instruction)).toEqual([
      ...MAIL_CONTRACT_FAST_PATH_TOOL_NAMES,
    ]);
    expect(mailContractFastPathAllowNames("请帮我查一下合同法条")).toBeUndefined();
    expect(extractSuggestedReplyTo(instruction)).toBe("opp@firm.cn");
    expect(MAIL_CONTRACT_FAST_PATH_TOOL_NAMES).not.toContain("search_workspace");
    expect(MAIL_CONTRACT_FAST_PATH_TOOL_NAMES).not.toContain("list_more_tools");
  });
});
