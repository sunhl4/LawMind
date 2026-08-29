import { describe, expect, it } from "vitest";
import {
  isWordRevisionInstruction,
  isWordRevisionTurn,
  WORD_REVISION_PROMPT,
  WORD_REVISION_TOOL_NAMES,
  wordRevisionAllowNames,
} from "./word-revision-instruction.js";

const FILE_PAGE_THAILAND = [
  "【用户在 LawMind 文件页将下列路径标为“本回合重点”（路径引用，需助手读取）】",
  "- [项目 · 路径引用] `泰国医疗人工智能战略合作框架协.docx` — 路径引用（未嵌入正文）：请用 read_project_file 读取。",
  "",
  "修改合同",
].join("\n");

describe("word-revision-instruction", () => {
  it("detects file-page pin + 修改合同", () => {
    expect(isWordRevisionInstruction(FILE_PAGE_THAILAND)).toBe(true);
    expect(wordRevisionAllowNames(FILE_PAGE_THAILAND)).toEqual([...WORD_REVISION_TOOL_NAMES]);
  });

  it("does not steal mail short path or 5-minute opinion", () => {
    expect(
      isWordRevisionInstruction(
        "【邮件合同审阅改稿 · 短路径】\n默认 contract_edit_baseline_path=`cases/m/a.docx`",
      ),
    ).toBe(false);
    expect(
      isWordRevisionInstruction(
        "【交办】5 分钟合同审查\n交付物类型：合同审查意见\n- 己方立场：中立\n- 审查重点：管辖",
      ),
    ).toBe(false);
  });

  it("does not lock ordinary chat without a Word file", () => {
    expect(isWordRevisionInstruction("修改合同怎么收费？")).toBe(false);
    expect(isWordRevisionInstruction("请帮我审一下这份合同")).toBe(false);
  });

  it("locks dialog follow-ups when a Word is pinned", () => {
    const pins = [
      {
        pinKind: "file" as const,
        root: "project" as const,
        relPath: "泰国医疗人工智能战略合作框架协议.docx",
        kind: "file" as const,
      },
    ];
    expect(isWordRevisionTurn({ instruction: "立场甲方，导出", pins })).toBe(true);
    expect(isWordRevisionTurn({ instruction: "修改合同", pins })).toBe(true);
    expect(isWordRevisionTurn({ instruction: "改合同，代表甲方", pins })).toBe(true);
    expect(wordRevisionAllowNames("导出", pins)).toEqual([...WORD_REVISION_TOOL_NAMES]);
    expect(isWordRevisionTurn({ instruction: "今天开庭准备什么？", pins })).toBe(false);
  });

  it("ignores stale type/stance marker lines on later non-edit questions", () => {
    const pins = [
      {
        pinKind: "file" as const,
        root: "project" as const,
        relPath: "某中院判决书.docx",
        kind: "file" as const,
      },
    ];
    expect(
      isWordRevisionTurn({
        instruction: "改稿类型：采购供货\n己方立场：甲方\n这份判决的管辖怎么理解",
        pins,
      }),
    ).toBe(false);
    expect(
      isWordRevisionTurn({
        instruction: "改稿类型：采购供货\n己方立场：甲方\n改合同，导出带修订 Word",
        pins,
      }),
    ).toBe(true);
  });

  it("locks the tracked table and never advertises mail or template rebuild", () => {
    expect(WORD_REVISION_TOOL_NAMES).toContain("apply_surgical_edits");
    expect(WORD_REVISION_TOOL_NAMES).toContain("render_tracked_draft");
    expect(WORD_REVISION_TOOL_NAMES).toContain("read_project_file");
    expect(WORD_REVISION_TOOL_NAMES).not.toContain("prepare_outbound_mail");
    expect(WORD_REVISION_TOOL_NAMES).not.toContain("send_email");
    expect(WORD_REVISION_TOOL_NAMES).not.toContain("render_document");
    expect(WORD_REVISION_PROMPT).toContain("源文件同一目录");
    expect(WORD_REVISION_PROMPT).toContain("YYYYMMDD_01");
    expect(WORD_REVISION_PROMPT).toContain("禁止 `render_document`");
    expect(WORD_REVISION_PROMPT).toContain("禁止 `prepare_outbound_mail`");
    expect(WORD_REVISION_PROMPT).toContain("成功一次即可");
    expect(WORD_REVISION_PROMPT).toContain("不要再 `analyze_document`");
    expect(WORD_REVISION_PROMPT).toContain("不要读 `playbooks/`");
    expect(WORD_REVISION_PROMPT).toContain("改稿要点");
    expect(WORD_REVISION_PROMPT).toContain("不是必须全改");
  });
});
