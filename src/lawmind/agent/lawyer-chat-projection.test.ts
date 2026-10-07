import { describe, expect, it } from "vitest";
import {
  projectLawyerChatBubbles,
  scrubLawyerFacingAssistantText,
} from "./lawyer-chat-projection.js";
import type { AgentMessage } from "./types.js";

describe("scrubLawyerFacingAssistantText", () => {
  it("hides notes/json inventory but keeps Word paths as links", () => {
    const raw = [
      "七份审阅稿已可打开。",
      "",
      "（另有 5 个 .xxx.redline-manifest.json 同级隐藏文件，是修订记录，不用管。）",
      "",
      "二、本轮新出的文字稿 (Markdown，在本案 notes/)",
      "",
      "| 文件 | 内容 |",
      "| --- | --- |",
      "| `notes/合同群办理总表_20260928.md` | 全目录三档状态总表 |",
      "| `notes/合同审改一览_20260928.md` | 上轮清单 |",
      "",
      "请打开 `非技术相关/采购合同模板/外协外包类合同/小型施工合同_01.docx` 核对。",
    ].join("\n");

    const text = scrubLawyerFacingAssistantText(raw);
    expect(text).toContain("七份审阅稿已可打开");
    expect(text).toContain(
      "[小型施工合同_01.docx](非技术相关/采购合同模板/外协外包类合同/小型施工合同_01.docx)",
    );
    expect(text).not.toContain("notes/");
    expect(text).not.toContain("redline-manifest");
    expect(text).not.toContain("文字稿");
    expect(text).not.toContain(".md");
  });

  it("hides engine measurement notes and keeps the judgment plus the Word link", () => {
    const raw = [
      "综合隐蔽验收，两种路径都写进意见。",
      "",
      "【机械核定】下面几项以引擎为准，上文判断仍保留。",
      "- amount:interest：【待核实】4321；99999",
      "- negation:方可不得：【待核实】方可不得",
      "",
      "请打开 [小型施工合同.docx](非技术相关/采购合同模板/外协外包类合同/小型施工合同.docx) 核对。",
    ].join("\n");
    const text = scrubLawyerFacingAssistantText(raw);
    expect(text).toContain("两种路径");
    expect(text).toContain("小型施工合同.docx");
    expect(text).toContain("请在修订里改");
    expect(text).not.toContain("【机械核定】");
    expect(text).not.toContain("amount:");
    expect(text).not.toContain("negation:");
  });

  it("leaves ordinary legal prose unchanged", () => {
    const text = "违约金比例写在第 8 条，建议改成 20%。";
    expect(scrubLawyerFacingAssistantText(text)).toBe(text);
  });

  it("drops leftover continue-ritual copy without touching 继续履行", () => {
    const text = "建议继续履行合同。缺的事实留在文中待确认，不用再回复继续。";
    const next = scrubLawyerFacingAssistantText(text);
    expect(next).toContain("继续履行");
    expect(next).not.toContain("回复继续");
    expect(next).toContain("待确认");
  });
});

describe("projectLawyerChatBubbles", () => {
  it("scrubs notes inventory from the lawyer bubble", () => {
    const history: AgentMessage[] = [
      { role: "user", content: "把剩余合同改完", timestamp: "t1" },
      {
        role: "assistant",
        content: [
          "已落改。",
          "详见 `notes/合同审改一览.md`。",
          "稿：`非技术相关/foo_01.docx`",
        ].join("\n"),
        timestamp: "t2",
      },
    ];
    const bubbles = projectLawyerChatBubbles(history);
    expect(bubbles).toHaveLength(2);
    expect(bubbles[1]?.text).toContain("[foo_01.docx](非技术相关/foo_01.docx)");
    expect(bubbles[1]?.text).not.toContain("notes/");
  });
});
