import { describe, expect, it } from "vitest";
import { CONTRACT_FAST_LANE_TOOL_NAMES } from "./contract-fast-lane-instruction.js";
import { MAIL_CONTRACT_FAST_PATH_TOOL_NAMES } from "./mail-contract-short-path-instruction.js";
import { resolvePlaybookToolLock } from "./playbook-tool-lock.js";
import { WORD_REVISION_TOOL_NAMES } from "./word-revision-instruction.js";

describe("resolvePlaybookToolLock", () => {
  it("prefers mail-contract when the instruction is the short path", () => {
    const lock = resolvePlaybookToolLock(
      "【邮件合同审阅改稿 · 短路径】\n默认 contract_edit_baseline_path=`cases/m/a.docx`",
    );
    expect(lock?.id).toBe("mail-contract");
    expect(lock?.allowNames).toEqual([...MAIL_CONTRACT_FAST_PATH_TOOL_NAMES]);
  });

  it("locks file-page 修改合同 to Word revision, not mail", () => {
    const lock = resolvePlaybookToolLock(
      [
        "【用户在 LawMind 文件页将下列路径标为“本回合重点”（路径引用，需助手读取）】",
        "- [项目 · 路径引用] `泰国医疗人工智能战略合作框架协.docx`",
        "",
        "修改合同",
        "默认 contract_edit_baseline_path=`泰国医疗人工智能战略合作框架协.docx`",
      ].join("\n"),
    );
    expect(lock?.id).toBe("word-revision");
    expect(lock?.allowNames).toEqual([...WORD_REVISION_TOOL_NAMES]);
    expect(lock?.allowNames).not.toContain("prepare_outbound_mail");
    expect(lock?.allowNames).not.toContain("render_document");
  });

  it("locks 5-minute contract review to the opinion table", () => {
    const lock = resolvePlaybookToolLock(
      "【交办】5 分钟合同审查\n交付物类型：合同审查意见\n- 己方立场：中立\n审查深度：标准。",
    );
    expect(lock?.id).toBe("contract-review");
    expect(lock?.allowNames).toEqual([...CONTRACT_FAST_LANE_TOOL_NAMES]);
    expect(lock?.denyHint).toContain("合同审查快车道");
  });

  it("leaves ordinary chat unlocked", () => {
    expect(resolvePlaybookToolLock("今天开庭准备什么？")).toBeUndefined();
  });

  it("locks dialog 导出 when a Word pin is present", () => {
    const lock = resolvePlaybookToolLock("立场甲方，导出", [
      {
        pinKind: "file",
        root: "project",
        relPath: "泰国医疗人工智能战略合作框架协议.docx",
        kind: "file",
      },
    ]);
    expect(lock?.id).toBe("word-revision");
    expect(lock?.allowNames).not.toContain("render_document");
  });
});
