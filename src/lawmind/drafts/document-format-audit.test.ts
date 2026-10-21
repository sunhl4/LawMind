import { describe, expect, it } from "vitest";
import {
  auditDocumentFormat,
  buildDocumentFormatProfile,
  canonicalFontFamily,
  chineseFontSizeLabel,
  FORMAT_STANDARD_TODO_MARKER,
  formatForLawmindText,
  renderFormatAuditText,
  type FormatAuditReport,
} from "./document-format-audit.js";
import { extractDocxLayout } from "./word-surface-layout.js";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

type ParaSpec = {
  text: string;
  font?: string;
  /** Word half-points: 32 = 16pt（三号），44 = 22pt（二号），24 = 12pt（小四）。 */
  halfPt?: number;
  align?: "center" | "right" | "both";
  /** twips; 560 = 28pt. Omit for Word's default single spacing. */
  line?: number;
  firstLineChars?: number;
};

function run(spec: ParaSpec): string {
  const font = spec.font ? `<w:rFonts w:eastAsia="${spec.font}" w:ascii="${spec.font}"/>` : "";
  const size = spec.halfPt != null ? `<w:sz w:val="${spec.halfPt}"/>` : "";
  const rPr = font || size ? `<w:rPr>${font}${size}</w:rPr>` : "";
  return `<w:r>${rPr}<w:t>${spec.text}</w:t></w:r>`;
}

function para(spec: ParaSpec): string {
  const jc = spec.align ? `<w:jc w:val="${spec.align}"/>` : "";
  const spacing = spec.line != null ? `<w:spacing w:line="${spec.line}" w:lineRule="exact"/>` : "";
  const ind =
    spec.firstLineChars != null ? `<w:ind w:firstLineChars="${spec.firstLineChars}"/>` : "";
  return `<w:p><w:pPr>${jc}${spacing}${ind}</w:pPr>${run(spec)}</w:p>`;
}

function doc(
  paragraphs: ParaSpec[],
  page?: { w: number; h: number; top?: number; right?: number; bottom?: number; left?: number },
): string {
  const sect = page
    ? `<w:sectPr><w:pgSz w:w="${page.w}" w:h="${page.h}"/><w:pgMar w:top="${
        page.top ?? 1440
      }" w:right="${page.right ?? 1440}" w:bottom="${page.bottom ?? 1440}" w:left="${
        page.left ?? 1440
      }"/></w:sectPr>`
    : "";
  return `<w:document xmlns:w="${W}"><w:body>${paragraphs.map(para).join("")}${sect}</w:body></w:document>`;
}

/** A4 + 国标版心（twips 取整）。 */
const A4_GB = { w: 11906, h: 16838, top: 2098, right: 1474, bottom: 1984, left: 1587 };

function gbDoc(page = A4_GB): string {
  return doc(
    [
      { text: "关于规范合同审查事项的通知", font: "方正小标宋简体", halfPt: 44, align: "center" },
      { text: "各有关单位：", font: "FangSong_GB2312", halfPt: 32, line: 560 },
      {
        text: "现将合同审查有关事项通知如下，请遵照执行。",
        font: "FangSong_GB2312",
        halfPt: 32,
        line: 560,
        firstLineChars: 200,
      },
      { text: "一、总体要求", font: "SimHei", halfPt: 32, line: 560, firstLineChars: 200 },
      {
        text: "各单位要高度重视，明确责任分工，抓好落实。",
        font: "FangSong_GB2312",
        halfPt: 32,
        line: 560,
        firstLineChars: 200,
      },
      { text: "2026年10月20日", font: "FangSong_GB2312", halfPt: 32, line: 560, align: "right" },
    ],
    page,
  );
}

function audit(
  xml: string,
  mode: "from-scratch" | "imported" | "retemplate",
  lawmindParagraphs?: number[],
) {
  const layout = extractDocxLayout(xml);
  return auditDocumentFormat({
    page: layout.page,
    blocks: layout.blocks,
    mode,
    lawmindParagraphs,
  });
}

function codes(report: FormatAuditReport): string[] {
  return report.findings.map((finding) => finding.code);
}

describe("document format audit · 字体归一", () => {
  it("reads the CSS stacks the preview builds", () => {
    expect(canonicalFontFamily('"STFangsong", FangSong, "Songti SC", serif')).toBe("仿宋");
    expect(canonicalFontFamily('SimSun, "NSimSun", "Songti SC", "STSong", serif')).toBe("宋体");
    expect(canonicalFontFamily('"Kaiti SC", "STKaiti", KaiTi, serif')).toBe("楷体");
    expect(canonicalFontFamily('"Heiti SC", "STHeiti", SimHei, sans-serif')).toBe("黑体");
    expect(canonicalFontFamily("仿宋_GB2312")).toBe("仿宋");
    expect(canonicalFontFamily("方正小标宋简体")).toBe("小标宋");
    expect(canonicalFontFamily(undefined)).toBeUndefined();
  });

  it("names Chinese sizes", () => {
    expect(chineseFontSizeLabel(16)).toBe("三号");
    expect(chineseFontSizeLabel(22)).toBe("二号");
    expect(chineseFontSizeLabel(12)).toBe("小四");
  });
});

describe("document format audit · 从零起草（国标草案）", () => {
  it("passes a GB-shaped document and still reports what it did not check", () => {
    const report = audit(gbDoc(), "from-scratch");
    expect(report.ok).toBe(true);
    expect(report.counts.error).toBe(0);
    expect(report.findings).toEqual([]);
    // 不假装通过：页脚、版记、每面行数都明确写着未检查。
    expect(report.unchecked.join("")).toContain("页码");
    expect(report.unchecked.join("")).toContain("版记");
    expect(report.unchecked.join("")).toContain("22 行");
  });

  it("gives LawMind text the GB body format when drafting from scratch", () => {
    const layout = extractDocxLayout(gbDoc());
    const format = formatForLawmindText({ mode: "from-scratch", blocks: layout.blocks });
    expect(format.source).toBe("gb-t-9704-2012");
    expect(format.fontFamily).toBe("仿宋_GB2312");
    expect(format.fontSizePx).toBeCloseTo(21.3, 1);
    expect(format.fontSizePt).toBe(16);
    expect(format.line).toEqual({ rule: "exact", px: 37.3 });
    expect(format.firstIndentChars).toBe(2);
  });

  it("keeps the provisional standard banner visible", () => {
    const report = audit(gbDoc(), "from-scratch");
    expect(report.standard.provisional).toBe(true);
    expect(report.standard.todoMarker).toBe(FORMAT_STANDARD_TODO_MARKER);
    expect(report.standard.noticeZh).toContain("待律师确认");
    const text = renderFormatAuditText(report);
    expect(text).toContain("从零起草");
    expect(text).toContain("待律师确认");
    expect(text).toContain("未检查");
  });

  it("flags a Word-default page, 宋体小四 body, missing fixed spacing and Chinese date", () => {
    const xml = doc(
      [
        { text: "关于规范合同审查事项的通知", font: "SimSun", halfPt: 24, align: "center" },
        { text: "现将合同审查有关事项通知如下，请遵照执行。", font: "SimSun", halfPt: 24 },
        { text: "一、总体要求", font: "SimSun", halfPt: 24 },
        { text: "2026年10月20日", font: "SimSun", halfPt: 24, align: "right" },
      ],
      { w: 12240, h: 15840 },
    );
    const report = audit(xml, "from-scratch");
    expect(report.ok).toBe(false);
    expect(codes(report)).toEqual(
      expect.arrayContaining([
        "page.size",
        "page.margin",
        "title.font",
        "title.size",
        "body.font",
        "body.size",
        "body.line",
        "heading1.font",
      ]),
    );
    expect(report.counts.error).toBeGreaterThan(5);
  });

  it("tells 小三 (15.5pt) from 三号 (16pt) instead of merging them in px", () => {
    const xml = doc([
      {
        text: "现将合同审查有关事项通知如下，请遵照执行。",
        font: "FangSong_GB2312",
        halfPt: 31,
        line: 560,
        firstLineChars: 200,
      },
    ]);
    const report = audit(xml, "from-scratch");
    const finding = report.findings.find((row) => row.code === "body.size");
    expect(finding?.actual).toBe("15.5pt");
  });

  it("rejects Chinese numerals in the 成文日期 and flags zero padding", () => {
    const chinese = doc(
      [{ text: "2026年10月20日", font: "FangSong_GB2312", halfPt: 32, align: "right" }],
      A4_GB,
    ).replace("2026年10月20日", "二〇二六年十月二十日");
    const report = audit(chinese, "retemplate");
    expect(codes(report)).toContain("date.numerals");

    const padded = doc(
      [{ text: "2026年01月05日", font: "FangSong_GB2312", halfPt: 32, align: "right" }],
      A4_GB,
    );
    expect(codes(audit(padded, "retemplate"))).toContain("date.padding");
  });
});

describe("document format audit · 外来件跟随原文", () => {
  const importedXml = doc(
    [
      {
        text: "本合同自双方签字之日起生效。",
        font: "SimSun",
        halfPt: 24,
        line: 360,
        firstLineChars: 200,
      },
      {
        text: "乙方应在收到货物后十日内完成验收。",
        font: "SimSun",
        halfPt: 24,
        line: 360,
        firstLineChars: 200,
      },
      {
        text: "甲方应于验收合格后三十日内支付价款。",
        font: "FangSong_GB2312",
        halfPt: 32,
        line: 360,
        firstLineChars: 200,
      },
    ],
    { w: 12240, h: 15840 },
  );

  it("builds the dominant format from the file itself", () => {
    const profile = buildDocumentFormatProfile(extractDocxLayout(importedXml).blocks);
    expect(profile.fontFamily).toBe("宋体");
    expect(profile.fontSizePx).toBeCloseTo(16, 0);
    expect(profile.fontSizePt).toBe(12);
    expect(profile.labelZh).toContain("小四");
    expect(profile.labelZh).toContain("12pt");
    expect(profile.firstIndentChars).toBe(2);
    expect(profile.share).toBeCloseTo(0.67, 1);
  });

  it("does not apply the GB template to page or whole-document layout", () => {
    const report = audit(importedXml, "imported", [2]);
    expect(report.standard.id).toBe("document-self");
    expect(report.standard.provisional).toBe(false);
    expect(report.standard.noticeZh).toContain("外来件");
    expect(codes(report).some((code) => code.startsWith("page."))).toBe(false);
    expect(codes(report)).not.toContain("body.line");
    expect(report.unchecked.join("")).toContain("保持原样");
  });

  it("flags LawMind-written paragraphs that drift from the document's own format", () => {
    const report = audit(importedXml, "imported", [2]);
    expect(report.ok).toBe(false);
    expect(codes(report)).toEqual(expect.arrayContaining(["imported.font", "imported.size"]));
    const [first] = report.findings;
    expect(first?.paragraphIndex).toBe(2);
    expect(first?.expected).toBe("宋体");
  });

  it("stays quiet when LawMind wrote nothing, and only warns when the file has no dominant format", () => {
    expect(audit(importedXml, "imported").ok).toBe(true);
    expect(audit(importedXml, "imported").findings).toEqual([]);

    const unstable = doc([
      { text: "第一部分内容用宋体排版的正文。", font: "SimSun", halfPt: 24 },
      { text: "第二部分内容换成了仿宋的正文。", font: "FangSong_GB2312", halfPt: 32 },
      { text: "第三部分内容又换成了楷体的正文。", font: "KaiTi", halfPt: 28 },
    ]);
    const report = audit(unstable, "imported");
    expect(codes(report)).toContain("imported.unstable");
    expect(report.ok).toBe(true);
  });

  it("gives LawMind text the file's own format, including the raw rFonts tag", () => {
    const layout = extractDocxLayout(importedXml);
    const format = formatForLawmindText({ mode: "imported", blocks: layout.blocks });
    expect(format.source).toBe("document-self");
    expect(format.fontFamily).toBe("宋体");
    expect(format.fontSizePx).toBeCloseTo(16, 0);
    expect(format.fontSizePt).toBe(12);
    expect(format.line?.rule).toBe("exact");
    expect(format.rFontsXml).toContain("SimSun");
  });
});

describe("document format audit · 律师要求整体套模板", () => {
  it("runs the GB checks only when the lawyer asked for it", () => {
    const xml = doc([{ text: "本合同自双方签字之日起生效。", font: "SimSun", halfPt: 24 }]);
    const report = audit(xml, "retemplate");
    expect(report.mode).toBe("retemplate");
    expect(report.standard.requestedByLawyer).toBe(true);
    expect(report.standard.noticeZh).toContain("律师明确要求");
    expect(report.counts.error).toBeGreaterThan(0);
  });
});
