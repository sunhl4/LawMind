import { describe, expect, it } from "vitest";
import { readBuiltinSkillMarkdown } from "../skills/lawyer-capabilities.js";
import {
  constrainLawyerVisibleReply,
  LAWYER_CLOSE_RULES,
  lawyerVisibleGaps,
  renderLawyerClose,
} from "./lawyer-close.js";
import { buildSystemPrompt, type SystemPromptContext } from "./system-prompt.js";

const ctx: SystemPromptContext = {
  availableTools: [
    {
      name: "draft_document",
      description: "起草",
      category: "draft",
      parameters: {},
      riskLevel: "medium",
    },
  ],
};

describe("lawyer close", () => {
  it("keeps legal gaps and drops checker talk", () => {
    expect(
      lawyerVisibleGaps([
        "独立审稿已 2 轮未过。请把缺口交给律师，不要继续为过审而改稿。",
        "检查单项「pr.price」未覆盖：采购供货",
        "usedInHeadings 为空，只有案件元数据",
        "相对方名称是空白，无法核对签约主体。",
        "八份合同都没有成果权属条款。",
      ]),
    ).toEqual(["相对方名称是空白，无法核对签约主体。", "八份合同都没有成果权属条款。"]);
  });

  it("is part of the standing answer rules and the delivery skill", () => {
    expect(LAWYER_CLOSE_RULES).toContain("收口三句");
    expect(LAWYER_CLOSE_RULES).toContain("用你自己的句子");
    expect(LAWYER_CLOSE_RULES).not.toContain("lm-close");
    expect(buildSystemPrompt(ctx)).toContain("收口三句");
    expect(readBuiltinSkillMarkdown("delivery-language")).toContain("lm-draft:");
    expect(readBuiltinSkillMarkdown("delivery-language")).toContain(".canvas.tsx");
    expect(readBuiltinSkillMarkdown("delivery-language")).toContain("不要用画布代替法条");
    expect(LAWYER_CLOSE_RULES).toContain("不要用画布代替法条");
    expect(readBuiltinSkillMarkdown("delivery-language")).not.toContain("lm-close");
  });

  it("keeps the model's sentences and drops a leftover close block", () => {
    const raw = [
      "派遣协议还在草稿里，没有出 Word。[驾驶员劳务派遣协议](lm-draft:task-1)",
      "同工同酬没有写清，见 [《劳动合同法》第63条](https://flk.npc.gov.cn/detail/labor-63)。跨地区参保要单独约定。",
      "请您定：相对方名称是空白，本次是否先写成主体待核。",
      "guardian_fail，门禁终止。",
      "```lm-close",
      JSON.stringify({
        drafts: [{ title: "被丢掉的模板标题", taskId: "task-9" }],
        opinions: [{ text: "这句不该盖过模型写的意见。" }],
        decisions: ["这句也不该出现"],
      }),
      "```",
    ].join("\n");
    const text = constrainLawyerVisibleReply(raw);
    expect(text).toContain("跨地区参保要单独约定");
    expect(text).toContain("[驾驶员劳务派遣协议](lm-draft:task-1)");
    expect(text).toContain("[《劳动合同法》第63条](https://flk.npc.gov.cn/detail/labor-63)");
    expect(text).toContain("相对方名称是空白");
    expect(text).not.toContain("guardian");
    expect(text).not.toContain("lm-close");
    expect(text).not.toContain("被丢掉的模板标题");
    expect(text).not.toContain("这句不该盖过");
  });

  it("renders slots only when the reply has no prose left", () => {
    const raw = [
      "```lm-close",
      JSON.stringify({
        drafts: [{ title: "驾驶员劳务派遣协议", taskId: "task-1" }],
        opinions: [
          {
            text: "同工同酬尚未写清。",
            statute: "《劳动合同法》第63条",
            url: "https://flk.npc.gov.cn/detail/labor-63",
          },
        ],
        decisions: ["相对方名称是空白，本次是否先写成主体待核。"],
      }),
      "```",
    ].join("\n");
    const text = constrainLawyerVisibleReply(raw);
    expect(text).toContain("[驾驶员劳务派遣协议](lm-draft:task-1)");
    expect(text).toContain("同工同酬尚未写清。");
    expect(text).not.toContain("lm-close");
  });

  it("drops a statute url that is not a real https cite", () => {
    const text = renderLawyerClose({
      drafts: [],
      opinions: [
        {
          text: "跨地区社保要单独约定。",
          statute: "《社会保险法》第58条",
          url: "https://127.0.0.1/statute",
        },
      ],
      decisions: [],
      commercialBlanks: [],
    });
    expect(text).toContain("原文待核");
    expect(text).not.toContain("127.0.0.1");
  });

  it("strips checker lines when the model never emitted a close block", () => {
    const text = constrainLawyerVisibleReply(
      [
        "七份修订稿已可审。",
        "checklist_not_covered：保洁套了采购供货。",
        "请您定：主体本次是否免核。",
      ].join("\n"),
    );
    expect(text).toContain("七份修订稿已可审。");
    expect(text).toContain("主体本次是否免核");
    expect(text).not.toContain("checklist");
  });

  it("leaves an ordinary answer unchanged", () => {
    const text = "违约金比例写在第 8 条，建议改成 20%。";
    expect(constrainLawyerVisibleReply(text)).toBe(text);
  });
});
