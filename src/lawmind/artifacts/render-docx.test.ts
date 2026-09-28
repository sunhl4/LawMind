import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Document, Packer, Paragraph, TextRun } from "docx";
import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createProvenanceEvent } from "../drafts/provenance.js";
import type { ArtifactDraft } from "../types.js";
import { renderDocxWithOptions } from "./render-docx.js";

function makeDraft(overrides: Partial<ArtifactDraft> = {}): ArtifactDraft {
  return {
    taskId: "docx-task-id",
    title: "Docx Template Test",
    output: "docx",
    templateId: "word/legal-memo-default",
    summary: "summary",
    sections: [{ heading: "结论", body: "正文", citations: ["src-1"] }],
    reviewNotes: [],
    reviewStatus: "approved",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("renderDocxWithOptions", () => {
  let outputDir: string;

  beforeEach(async () => {
    outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "lawmind-docx-render-"));
  });

  afterEach(async () => {
    await fs.rm(outputDir, { recursive: true, force: true });
  });

  it("renders a pending draft for local export", async () => {
    const result = await renderDocxWithOptions(makeDraft({ reviewStatus: "pending" }), outputDir, {
      templateVariant: "contractReview",
    });
    expect(result.ok).toBe(true);
    expect(result.outputPath).toMatch(/\.docx$/);
  });

  it("rejects a rejected draft", async () => {
    const result = await renderDocxWithOptions(makeDraft({ reviewStatus: "rejected" }), outputDir, {
      templateVariant: "contractReview",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("已驳回");
  });

  it("renders with built-in contract review variant", async () => {
    const result = await renderDocxWithOptions(makeDraft(), outputDir, {
      templateVariant: "contractReview",
    });
    expect(result.ok).toBe(true);
    expect(result.outputPath).toMatch(/\.docx$/);
  });

  it("renders with uploaded template mapping metadata", async () => {
    const templatePath = path.join(outputDir, "firm-brief-template.docx");
    const templateDoc = new Document({
      sections: [
        {
          children: [
            new Paragraph({ children: [new TextRun("{{case_title}}")] }),
            new Paragraph({ children: [new TextRun("{{case_summary}}")] }),
          ],
        },
      ],
    });
    await fs.writeFile(templatePath, Buffer.from(await Packer.toBuffer(templateDoc)));

    const result = await renderDocxWithOptions(makeDraft(), outputDir, {
      templateVariant: "uploadedMapped",
      uploadedTemplate: {
        id: "upload/firm-brief",
        format: "docx",
        label: "Firm Brief",
        sourcePath: templatePath,
        version: 2,
        enabled: true,
        placeholderMap: {
          case_title: "title",
          case_summary: "summary",
        },
        uploadedAt: new Date().toISOString(),
      },
    });
    expect(result.ok).toBe(true);
    const stat = await fs.stat(result.outputPath!);
    expect(stat.size).toBeGreaterThan(1000);
  });

  it("includes provenance as Word comments when includeProvenance is true", async () => {
    const draft = makeDraft({
      sections: [
        {
          heading: "结论",
          body: "正文",
          citations: [],
          provenance: {
            events: [
              createProvenanceEvent("ai_suggest", "model", {
                timestamp: "2026-09-03T09:30:00.000Z",
              }),
            ],
          },
        },
      ],
    });
    const result = await renderDocxWithOptions(draft, outputDir, { includeProvenance: true });
    expect(result.ok).toBe(true);
    const data = await fs.readFile(result.outputPath!);
    const zip = await JSZip.loadAsync(data);
    const commentsXml = await zip.file("word/comments.xml")?.async("string");
    expect(commentsXml).toBeDefined();
    expect(commentsXml).toContain("AI 建议");
    expect(commentsXml).toContain("未再改动");
    const documentXml = await zip.file("word/document.xml")?.async("string");
    expect(documentXml).toContain("commentRangeStart");
    expect(documentXml).toContain("commentRangeEnd");
  });

  it("does not embed provenance comment text by default", async () => {
    const draft = makeDraft({
      sections: [
        {
          heading: "结论",
          body: "正文",
          citations: [],
          provenance: {
            events: [
              createProvenanceEvent("ai_suggest", "model", {
                timestamp: "2026-09-03T09:30:00.000Z",
              }),
            ],
          },
        },
      ],
    });
    const result = await renderDocxWithOptions(draft, outputDir, {});
    expect(result.ok).toBe(true);
    const data = await fs.readFile(result.outputPath!);
    const zip = await JSZip.loadAsync(data);
    const commentsXml = await zip.file("word/comments.xml")?.async("string");
    expect(commentsXml).toBeDefined();
    expect(commentsXml).not.toContain("AI 建议");
    const documentXml = await zip.file("word/document.xml")?.async("string");
    expect(documentXml).not.toContain("commentRangeStart");
  });

  it("renders the default research memo without AI workbench sections", async () => {
    const result = await renderDocxWithOptions(
      makeDraft({
        title: "竞业限制补偿",
        audience: "甲公司",
        createdAt: "2026-04-24T00:00:00.000Z",
        summary: "补偿标准可能低于法定下限。",
        sections: [
          {
            heading: "二、事实概要",
            body: "（一）已知事实\n劳动者于离职时签署竞业协议。\n1、协议约定补偿按月支付。",
            citations: [],
          },
          { heading: "三、法律分析", body: "需结合当地司法实践判断。", citations: [] },
        ],
        reviewNotes: ["内部备注不应出现在报告里"],
      }),
      outputDir,
      {},
    );
    expect(result.ok).toBe(true);
    const data = await fs.readFile(result.outputPath!);
    const zip = await JSZip.loadAsync(data);
    const documentXml = await zip.file("word/document.xml")?.async("string");
    expect(documentXml).toContain("SimSun");
    expect(documentXml).toContain('w:val="000000"');
    expect(documentXml).toContain("致：甲公司");
    expect(documentXml).toContain("自：");
    expect(documentXml).toContain("2026 年 4 月 24 日");
    expect(documentXml).toContain("关于竞业限制补偿的法律备忘录");
    expect(documentXml).toContain("一、结论");
    expect(documentXml).toContain("二、事实概要");
    expect(documentXml).toContain("（一）已知事实");
    expect(documentXml).toContain("1、协议约定补偿按月支付。");
    expect(documentXml).toContain("免责声明");
    expect(documentXml).not.toContain("检索/研究策略");
    expect(documentXml).not.toContain("可靠性");
    expect(documentXml).not.toContain("{{");
    expect(documentXml).not.toContain("审阅备注");
    expect(documentXml).not.toContain("内部备注不应出现在报告里");
    expect(documentXml).not.toContain("SimHei");
  });

  it("renders research reports in thesis body style without school front matter", async () => {
    const result = await renderDocxWithOptions(
      makeDraft({
        title: "关于竞业限制补偿标准的法律调研报告",
        templateId: "word/research-report-default",
        audience: "甲公司",
        createdAt: "2026-04-24T00:00:00.000Z",
        summary: "补偿标准可能低于法定下限。",
        sections: [
          {
            heading: "二、委托事项与背景",
            body: "（一）委托问题\n客户询问竞业限制补偿的法定下限。\n1、协议约定按月支付。",
            citations: [],
          },
        ],
        reviewNotes: ["内部备注不应出现在报告里"],
      }),
      outputDir,
      { templateVariant: "researchReport" },
    );
    expect(result.ok).toBe(true);
    const data = await fs.readFile(result.outputPath!);
    const zip = await JSZip.loadAsync(data);
    const documentXml = await zip.file("word/document.xml")?.async("string");
    const stylesXml = await zip.file("word/styles.xml")?.async("string");
    const footerXml = await zip.file("word/footer1.xml")?.async("string");
    const settingsXml = await zip.file("word/settings.xml")?.async("string");
    expect(documentXml).toContain("SimSun");
    expect(documentXml).toContain("Times New Roman");
    expect(documentXml).toContain('w:val="32"');
    expect(documentXml).toContain('w:val="28"');
    expect(documentXml).toContain('w:top="1440"');
    expect(documentXml).toContain('w:left="1800"');
    expect(documentXml).toContain('w:right="1800"');
    expect(documentXml).toContain('w:linePitch="312"');
    expect(documentXml).toContain("目录");
    const titleAt = documentXml.indexOf("关于竞业限制补偿标准的法律调研报告");
    const tocHeadingAt = documentXml.indexOf(">目录</w:t>");
    expect(titleAt).toBeGreaterThan(0);
    expect(tocHeadingAt).toBeGreaterThan(titleAt);
    expect(documentXml).toContain("TOC \\h \\o &quot;1-3&quot; \\u");
    expect(documentXml).toContain('w:pos="8296"');
    expect(stylesXml).toContain('w:beforeLines="100"');
    expect(stylesXml).toContain('w:afterLines="200"');
    expect(stylesXml).toContain('w:beforeLines="50"');
    expect(stylesXml).toContain('w:firstLineChars="200"');
    expect(stylesXml).toContain('w:line="416"');
    expect(stylesXml).toContain('w:line="480"');
    expect(stylesXml).toContain('w:leader="dot"');
    expect(stylesXml).toContain('w:leftChars="200"');
    expect(stylesXml).toContain('w:outlineLvl w:val="9"');
    expect(settingsXml).toContain("updateFields");
    expect(documentXml).toContain("关于竞业限制补偿标准的法律调研报告");
    expect(documentXml).toContain("二、委托事项与背景");
    expect(documentXml).toContain("（一）委托问题");
    expect(documentXml).toContain("1、协议约定按月支付。");
    expect(documentXml).toContain("一、调研结论");
    expect(documentXml).toContain("本报告系基于");
    expect(documentXml).not.toContain("南京大学");
    expect(documentXml).not.toContain("致：");
    expect(documentXml).not.toContain("博士学位论文");
    expect(documentXml).not.toContain("审阅备注");
    expect(documentXml).not.toContain("内部备注不应出现在报告里");
    expect(footerXml).toBeDefined();
    expect(footerXml).toContain("PAGE");
  });

  it("lays out report charts and tables like the thesis", async () => {
    const result = await renderDocxWithOptions(
      makeDraft({
        title: "关于补偿标准的法律调研报告",
        summary: "",
        sections: [
          {
            heading: "四、法律分析",
            body: [
              "各地口径不同。",
              "表 补偿对照",
              "| 地区 | 月补偿 |",
              "| --- | --- |",
              "| 甲市 | 30 |",
              "",
              "```lm-chart",
              JSON.stringify({
                title: "补偿对比",
                type: "bar",
                categories: ["甲市", "乙市"],
                series: [{ name: "月补偿", values: [30, 20] }],
              }),
              "```",
            ].join("\n"),
            citations: [],
          },
        ],
      }),
      outputDir,
      { templateVariant: "researchReport" },
    );
    expect(result.ok).toBe(true);
    const zip = await JSZip.loadAsync(await fs.readFile(result.outputPath!));
    const documentXml = await zip.file("word/document.xml")?.async("string");
    const stylesXml = await zip.file("word/styles.xml")?.async("string");
    expect(documentXml).toContain("表 1-1 补偿对照");
    expect(documentXml).toContain("图 1-1 补偿对比");
    expect(documentXml).toContain('w:val="single"');
    expect(documentXml).toContain('w:sz="12"');
    expect(documentXml).toContain("svgBlip");
    expect(stylesXml).toContain("图表题注");
    expect(stylesXml).toContain('w:afterLines="100"');
    expect(documentXml).not.toContain("南京大学");
  });

  it("skips de-AI polish for existing-Word contract edits", async () => {
    const result = await renderDocxWithOptions(
      makeDraft({
        title: "合同改稿壳",
        deliverableType: "report.general",
        contractEdit: {
          baselineRelativePath: "contracts/a.docx",
          mode: "surgical",
        },
        sections: [
          {
            heading: "四、法律分析",
            body: "自：LawMind 法律助理\n保留闭环用语。",
            citations: [],
          },
        ],
      }),
      outputDir,
      { applyDeliverableDeai: false },
    );
    expect(result.ok).toBe(true);
    const data = await fs.readFile(result.outputPath!);
    const zip = await JSZip.loadAsync(data);
    const documentXml = await zip.file("word/document.xml")?.async("string");
    // 原 Word 路径：不改栏目名、不扫套话。
    expect(documentXml).toContain("四、法律分析");
    expect(documentXml).toContain("闭环");
  });

  it("applies default de-AI polish before writing Word", async () => {
    const result = await renderDocxWithOptions(
      makeDraft({
        title: "项目进度",
        deliverableType: "report.general",
        audience: "甲公司",
        createdAt: "2026-09-28T00:00:00.000Z",
        summary: "总之，按期推进。",
        sections: [
          { heading: "0. 检索/研究策略", body: "关键词：进度", citations: [] },
          {
            heading: "四、法律分析",
            body: "自：LawMind 法律助理\n希望这对你有帮助。进度正常。",
            citations: [],
          },
        ],
      }),
      outputDir,
      {},
    );
    expect(result.ok).toBe(true);
    const data = await fs.readFile(result.outputPath!);
    const zip = await JSZip.loadAsync(data);
    const documentXml = await zip.file("word/document.xml")?.async("string");
    expect(documentXml).toContain("四、分析");
    expect(documentXml).not.toContain("法律分析");
    expect(documentXml).not.toContain("LawMind");
    expect(documentXml).not.toContain("检索/研究策略");
    expect(documentXml).not.toContain("希望这对你有帮助");
    expect(documentXml).toContain("自：");
  });

  it("keeps contract review on Songti black with formal sizes", async () => {
    const result = await renderDocxWithOptions(
      makeDraft({ deliverableType: "contract.general" }),
      outputDir,
      {
        templateVariant: "contractReview",
      },
    );
    expect(result.ok).toBe(true);
    const data = await fs.readFile(result.outputPath!);
    const zip = await JSZip.loadAsync(data);
    const documentXml = await zip.file("word/document.xml")?.async("string");
    expect(documentXml).toContain("SimSun");
    expect(documentXml).toContain("一、一句话结论");
    expect(documentXml).not.toContain("SimHei");
    expect(documentXml).not.toContain("楷体_GB2312");
    expect(documentXml).not.toContain("免责声明");
  });

  it("renders see-also citations with urls as clickable hyperlinks", async () => {
    const draft = makeDraft({
      sections: [
        {
          heading: "法律依据",
          body: "依据民法典相关规定。",
          citations: ["npc-flk:1", "src-2"],
        },
      ],
    });
    const result = await renderDocxWithOptions(draft, outputDir, {
      sources: [
        {
          id: "npc-flk:1",
          title: "中华人民共和国民法典",
          citation: "《民法典》第577条",
          kind: "statute",
          url: "https://flk.npc.gov.cn/detail.html?npc-1",
        },
        { id: "src-2", citation: "《合同法》第107条", kind: "statute" },
      ],
    });
    expect(result.ok).toBe(true);
    const data = await fs.readFile(result.outputPath!);
    const zip = await JSZip.loadAsync(data);
    const documentXml = await zip.file("word/document.xml")?.async("string");
    const relsXml = await zip.file("word/_rels/document.xml.rels")?.async("string");
    expect(documentXml).toContain("参见：");
    expect(documentXml).toContain("<w:hyperlink");
    expect(relsXml).toContain("https://flk.npc.gov.cn/detail.html?npc-1");
    // 无 url 的来源保持纯文本，不出现在关系表。
    expect(relsXml).not.toContain("合同法");
  });
});
