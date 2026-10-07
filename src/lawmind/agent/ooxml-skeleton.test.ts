import { describe, expect, it } from "vitest";
import {
  emptyFactorState,
  ingestToolResult,
  rememberBuiltinTemplateSkeleton,
  rememberJudgments,
  rememberOoxmlSkeleton,
  renderEngineReadings,
} from "./factor-state.js";
import {
  builtinTemplateHeadings,
  explicitTemplateId,
  parseOoxmlHeadingForest,
} from "./ooxml-skeleton.js";

const MEMO_XML = `
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>一、结论</w:t></w:r></w:p>
<w:p><w:pPr><w:outlineLvl w:val="1"/></w:pPr><w:r><w:t>争议焦点</w:t></w:r></w:p>
<w:p><w:r><w:t>综合证据，我方主张继续履行，这句话是正文，不应成为骨架节点。</w:t></w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>解除</w:t></w:r><w:r><w:t>路径</w:t></w:r></w:p>
</w:body></w:document>`;

describe("builtin and OOXML skeletons", () => {
  it("lists the columns the memo renderer already emits", () => {
    expect(builtinTemplateHeadings("word/legal-memo-default")).toEqual([
      "致",
      "自",
      "日期",
      "事由",
      "保密",
      "一、结论",
      "免责声明",
    ]);
    expect(builtinTemplateHeadings("word/contract-default")).toEqual(["一、一句话结论"]);
    expect(builtinTemplateHeadings("complaint")).toEqual(["当事人", "诉讼请求", "事实与理由"]);
    expect(builtinTemplateHeadings("not-a-template")).toEqual([]);
    expect(explicitTemplateId("请写一份起诉状")).toBeUndefined();
    expect(explicitTemplateId("templateId=word/legal-memo-default")).toBe(
      "word/legal-memo-default",
    );
  });

  it("reads heading styles and outline levels and drops body sentences", () => {
    const tree = parseOoxmlHeadingForest(MEMO_XML);
    expect(tree).toHaveLength(1);
    expect(tree[0]?.heading).toBe("一、结论");
    expect(tree[0]?.children.map((node) => node.heading)).toEqual(["争议焦点", "解除路径"]);
    expect(JSON.stringify(tree)).not.toContain("继续履行");
  });

  it("stores a builtin template and an OOXML outline without replacing an existing one", () => {
    const state = emptyFactorState();
    ingestToolResult(state, "render_document", { templateId: "word/demand-letter-default" });
    expect(state.skeletonHeadings).toEqual(["一、委托说明"]);
    expect(renderEngineReadings(state)).toContain("可改、可增、可删");
    rememberOoxmlSkeleton(state, MEMO_XML);
    expect(state.skeletonHeadings).toEqual(["一、委托说明"]);
    const fresh = emptyFactorState();
    rememberOoxmlSkeleton(fresh, MEMO_XML);
    expect(fresh.skeletonTree?.[0]?.children[1]?.heading).toBe("解除路径");
    rememberBuiltinTemplateSkeleton(fresh, "word/contract-default");
    expect(fresh.skeletonHeadings?.[0]).toBe("一、结论");
  });

  it("keeps a model judgment across the reading block and does not ground it", () => {
    const state = emptyFactorState();
    rememberJudgments(
      state,
      "综合证据，我方主张继续履行。根据权威来源〔npc-1〕，应当付款。经济补偿为 99999 元。",
    );
    expect(state.keptJudgments).toEqual(["综合证据，我方主张继续履行。"]);
    expect(state.factors).toEqual([]);
    const readings = renderEngineReadings(state);
    expect(readings).toContain("【判断保留】");
    expect(readings).toContain("不是证据，可改、可删");
    expect(readings).toContain("主张继续履行");
    expect(readings).not.toContain("权威来源");
    expect(readings).not.toContain("99999");
  });
});
