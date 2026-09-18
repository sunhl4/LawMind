import { describe, expect, it } from "vitest";
import {
  MAIL_CONTRACT_DENY_TOOL_NAMES,
  MAIL_CONTRACT_FAST_PATH_TOOL_NAMES,
} from "./mail-contract-short-path-instruction.js";
import { resolvePlaybookToolLock } from "./playbook-tool-lock.js";
import { WORD_REVISION_DENY_TOOL_NAMES } from "./word-revision-instruction.js";

describe("resolvePlaybookToolLock", () => {
  it("prefers mail-contract when the instruction is the short path", () => {
    const lock = resolvePlaybookToolLock(
      "【邮件合同审阅改稿 · 短路径】\n默认 contract_edit_baseline_path=`cases/m/a.docx`",
    );
    expect(lock?.id).toBe("mail-contract");
    expect(lock?.denyNames).toEqual([...MAIL_CONTRACT_DENY_TOOL_NAMES]);
    expect(lock?.denyNames).toContain("send_email");
    expect(lock?.denyNames).toContain("render_document");
    expect(lock?.denyNames).not.toContain("search_statute");
    expect(lock?.denyNames).not.toContain("apply_legal_events");
    expect(lock?.denyNames).not.toContain("update_matter_profile");
    expect(MAIL_CONTRACT_FAST_PATH_TOOL_NAMES).toContain("prepare_outbound_mail");
  });

  it("denies mail/rebuild on file-page 修改合同, not the whole table", () => {
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
    expect(lock?.denyNames).toEqual([...WORD_REVISION_DENY_TOOL_NAMES]);
    expect(lock?.denyNames).toContain("prepare_outbound_mail");
    expect(lock?.denyNames).toContain("render_document");
    expect(lock?.denyNames).not.toContain("search_statute");
  });

  it("does not treat file-page 用户将 chrome as a folder lock", () => {
    const lock = resolvePlaybookToolLock(
      [
        "【用户将下列路径标为“本回合重点”；其中 1 个小文本已嵌入正文，其余为路径引用】",
        "- [工作区 · 已嵌入正文] `采购合同摘录.txt`",
        "",
        "请审查这份采购合同",
      ].join("\n"),
    );
    expect(lock).toBeUndefined();
  });

  it("does not treat 合同目录 as a folder lock", () => {
    expect(resolvePlaybookToolLock("请审查这份采购合同的合同目录条款")).toBeUndefined();
  });

  it("does not lock 5-minute contract review", () => {
    expect(
      resolvePlaybookToolLock(
        "【交办】5 分钟合同审查\n交付物类型：合同审查意见\n- 己方立场：中立\n审查深度：标准。",
      ),
    ).toBeUndefined();
  });

  it("leaves ordinary chat unlocked", () => {
    expect(resolvePlaybookToolLock("今天开庭准备什么？")).toBeUndefined();
  });

  it("read-first denies mutate tools for 律师函 QA", () => {
    const lock = resolvePlaybookToolLock(
      "不是合同审核，根据文件夹里的信息看我起草的律师函是否有误",
    );
    expect(lock?.id).toBe("read-first");
    expect(lock?.denyNames).toContain("apply_surgical_edits");
    expect(lock?.denyNames).toContain("draft_document");
    expect(lock?.denyNames).toContain("draft_worker");
    expect(lock?.denyNames).toContain("render_document");
    expect(lock?.denyNames).toContain("render_tracked_draft");
  });

  it("does not treat 写起诉状 after rejecting 合同审核 as 函件 QA", () => {
    expect(resolvePlaybookToolLock("不是合同审核，请写起诉状")).toBeUndefined();
  });

  it("folder mention on a contract review only denies mutate tools", () => {
    const lock = resolvePlaybookToolLock("根据文件夹审查这份采购合同");
    expect(lock?.id).toBe("read-first");
    expect(lock?.denyNames).toContain("apply_surgical_edits");
    expect(lock?.denyNames).not.toContain("draft_document");
  });

  it("look-only denies redline without locking draft_document", () => {
    const lock = resolvePlaybookToolLock("帮我看看");
    expect(lock?.id).toBe("read-first");
    expect(lock?.denyNames).toContain("apply_surgical_edits");
    expect(lock?.denyNames).not.toContain("draft_document");
  });

  it("does not lock dialog 立场/导出 when a Word pin is present", () => {
    const lock = resolvePlaybookToolLock("立场甲方，导出", [
      {
        pinKind: "file",
        root: "project",
        relPath: "泰国医疗人工智能战略合作框架协议.docx",
        kind: "file",
      },
    ]);
    expect(lock).toBeUndefined();
  });
});
