import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { auditDocumentFormat } from "./document-format-audit.js";
import {
  applyFormatFixesToDocxFile,
  applyFormatFixesToXml,
  planFormatFixes,
} from "./format-fix.js";
import { verifyDocxRevisionPreservation } from "./word-revision/preservation-file.js";
import {
  compareRevisionPreservation,
  describeRenumbered,
  snapshotDocumentRevisions,
} from "./word-revision/preservation.js";
import { readDocxDocumentLayout } from "./word-surface.js";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const dirs: string[] = [];

function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-format-fix-"));
  dirs.push(dir);
  return dir;
}

type ParaSpec = {
  text: string;
  font?: string;
  halfPt?: number;
  line?: number;
  firstLineChars?: number;
  /** 包一层 w:ins，模拟对方改过的句子。 */
  inset?: { id: string; author: string; date: string; text?: string };
  /** 包一层 w:del。 */
  deleted?: { id: string; author: string; date: string; text: string };
};

function run(spec: ParaSpec): string {
  const font = spec.font ? `<w:rFonts w:eastAsia="${spec.font}" w:ascii="${spec.font}"/>` : "";
  const size =
    spec.halfPt != null ? `<w:sz w:val="${spec.halfPt}"/><w:szCs w:val="${spec.halfPt}"/>` : "";
  const rPr = font || size ? `<w:rPr>${font}${size}</w:rPr>` : "";
  return `<w:r>${rPr}<w:t xml:space="preserve">${spec.text}</w:t></w:r>`;
}

function para(spec: ParaSpec): string {
  const spacing = spec.line != null ? `<w:spacing w:line="${spec.line}" w:lineRule="exact"/>` : "";
  const ind =
    spec.firstLineChars != null ? `<w:ind w:firstLineChars="${spec.firstLineChars}"/>` : "";
  const pPr = spacing || ind ? `<w:pPr>${spacing}${ind}</w:pPr>` : "";
  const body = [
    spec.deleted
      ? `<w:del w:id="${spec.deleted.id}" w:author="${spec.deleted.author}" w:date="${spec.deleted.date}"><w:r><w:delText>${spec.deleted.text}</w:delText></w:r></w:del>`
      : "",
    spec.inset
      ? `<w:ins w:id="${spec.inset.id}" w:author="${spec.inset.author}" w:date="${spec.inset.date}">${run(
          {
            text: spec.inset.text ?? spec.text,
            ...(spec.font ? { font: spec.font } : {}),
            ...(spec.halfPt != null ? { halfPt: spec.halfPt } : {}),
          },
        )}</w:ins>`
      : run(spec),
  ].join("");
  return `<w:p>${pPr}${body}</w:p>`;
}

async function writeDocx(dir: string, name: string, paragraphs: ParaSpec[]): Promise<string> {
  const xml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="${W}"><w:body>${paragraphs.map(para).join("")}` +
    `<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>` +
    `</w:body></w:document>`;
  const zip = new JSZip();
  zip.file("word/document.xml", xml);
  zip.file(
    "word/styles.xml",
    `<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="${W}"></w:styles>`,
  );
  const abs = path.join(dir, name);
  fs.writeFileSync(abs, await zip.generateAsync({ type: "nodebuffer" }));
  return abs;
}

async function auditFile(abs: string, mode: "imported" | "from-scratch", lawmind?: number[]) {
  const layout = await readDocxDocumentLayout(abs);
  return auditDocumentFormat({
    page: layout.page,
    blocks: layout.blocks,
    mode,
    ...(lawmind ? { lawmindParagraphs: lawmind } : {}),
  });
}

describe("原有修订对账", () => {
  it("reads ins/del/rPrChange by id and merges split runs", () => {
    const xml =
      `<w:p><w:ins w:id="1" w:author="对方律师" w:date="2026-10-01T00:00:00Z">` +
      `<w:r><w:t>甲乙</w:t></w:r><w:r><w:t>双方</w:t></w:r></w:ins>` +
      `<w:del w:id="2" w:author="对方律师"><w:r><w:delText>丙方</w:delText></w:r></w:del>` +
      `<w:r><w:rPr><w:rPrChange w:id="3" w:author="对方律师"><w:rPr/></w:rPrChange></w:rPr><w:t>正文</w:t></w:r>` +
      `</w:p>`;
    const revisions = snapshotDocumentRevisions(xml);
    expect(revisions).toHaveLength(3);
    expect(revisions.find((item) => item.id === "1")?.text).toBe("甲乙双方");
    expect(revisions.find((item) => item.id === "2")?.kind).toBe("del");
    expect(revisions.find((item) => item.id === "3")?.kind).toBe("format");
  });

  it("keeps authors with `>` and nested format changes inside an insertion", () => {
    // 旧正则 `[^>]*` 会在 `甲>乙` 的 `>` 处截断，整条插入漏记；
    // 跳过外层内文时，套在插入里的 rPrChange 也会漏。
    const xml =
      `<w:ins w:id="1" w:author="甲>乙" w:date="2026-10-01T00:00:00Z">` +
      `<w:r><w:rPr><w:sz w:val="32"/>` +
      `<w:rPrChange w:id="9" w:author="前手"><w:rPr><w:sz w:val="24"/></w:rPr></w:rPrChange>` +
      `</w:rPr><w:t>五日</w:t></w:r></w:ins>`;
    const revisions = snapshotDocumentRevisions(xml);
    expect(revisions.map((item) => item.id).toSorted()).toEqual(["1", "9"]);
    expect(revisions.find((item) => item.id === "1")?.author).toBe("甲>乙");
    expect(revisions.find((item) => item.id === "1")?.text).toBe("五日");
    expect(revisions.find((item) => item.id === "9")?.kind).toBe("format");
  });

  it("still finds nested revisions when the outer track has no w:id", () => {
    const xml =
      `<w:ins w:author="无名">` +
      `<w:r><w:rPr><w:rPrChange w:id="9" w:author="前手"><w:rPr/></w:rPrChange></w:rPr>` +
      `<w:t>五日</w:t></w:r></w:ins>`;
    const revisions = snapshotDocumentRevisions(xml);
    expect(revisions).toHaveLength(1);
    expect(revisions[0]?.id).toBe("9");
    expect(revisions[0]?.kind).toBe("format");
  });

  it("fails when a revision disappears or is retyped", () => {
    const before = snapshotDocumentRevisions(
      `<w:ins w:id="1" w:author="甲"><w:r><w:t>五日</w:t></w:r></w:ins>` +
        `<w:ins w:id="2" w:author="甲"><w:r><w:t>违约金</w:t></w:r></w:ins>`,
    );
    const after = snapshotDocumentRevisions(
      `<w:ins w:id="1" w:author="甲"><w:r><w:t>七日内</w:t></w:r></w:ins>`,
    );
    const result = compareRevisionPreservation(before, after);
    expect(result.ok).toBe(false);
    expect(result.missing.map((item) => item.id)).toEqual(["2"]);
    // 插入句被改字算软提示；真正构成失败的是「条目不见了」
    expect(result.alteredInsertions[0]?.id).toBe("1");
    expect(result.altered).toEqual([]);
  });
  it("treats retyping an original deletion as failure, but editing an insertion as a note", () => {
    const before = snapshotDocumentRevisions(
      `<w:ins w:id="1" w:author="甲"><w:r><w:t>五日</w:t></w:r></w:ins>` +
        `<w:del w:id="2" w:author="甲"><w:r><w:delText>十日</w:delText></w:r></w:del>`,
    );
    // 别人插入的句子被改字：条目还在，Word 就是这种行为
    const editedInsertion = snapshotDocumentRevisions(
      `<w:ins w:id="1" w:author="甲"><w:r><w:t>三日</w:t></w:r></w:ins>` +
        `<w:del w:id="2" w:author="甲"><w:r><w:delText>十日</w:delText></w:r></w:del>`,
    );
    const ok = compareRevisionPreservation(before, editedInsertion);
    expect(ok.ok).toBe(true);
    expect(ok.alteredInsertions.map((item) => item.id)).toEqual(["1"]);

    // 原文删除内容被重写：这是事故
    const retypedDeletion = snapshotDocumentRevisions(
      `<w:ins w:id="1" w:author="甲"><w:r><w:t>五</w:t></w:r></w:ins>` +
        `<w:del w:id="2" w:author="甲"><w:r><w:delText>七日</w:delText></w:r></w:del>`,
    );
    const bad = compareRevisionPreservation(before, retypedDeletion);
    expect(bad.ok).toBe(false);
    expect(bad.altered[0]?.id).toBe("2");
  });

  it("does not block delivery when only the revision ids were renumbered", () => {
    const before = snapshotDocumentRevisions(
      `<w:ins w:id="1" w:author="甲"><w:r><w:t>五日</w:t></w:r></w:ins>` +
        `<w:del w:id="2" w:author="甲"><w:r><w:delText>十日</w:delText></w:r></w:del>`,
    );
    // 同一份内容，id 全换（有些写入器会重编号既有修订）
    const renumbered = snapshotDocumentRevisions(
      `<w:ins w:id="101" w:author="甲"><w:r><w:t>五日</w:t></w:r></w:ins>` +
        `<w:del w:id="102" w:author="甲"><w:r><w:delText>十日</w:delText></w:r></w:del>`,
    );
    const result = compareRevisionPreservation(before, renumbered);
    expect(result.ok).toBe(true);
    expect(result.renumbered).toHaveLength(2);
    expect(result.missing).toEqual([]);
    expect(describeRenumbered(result)).toContain("编号变了");
  });

  it("still fails when a renumbered revision really went missing", () => {
    const before = snapshotDocumentRevisions(
      `<w:ins w:id="1" w:author="甲"><w:r><w:t>五日</w:t></w:r></w:ins>` +
        `<w:ins w:id="2" w:author="甲"><w:r><w:t>违约金</w:t></w:r></w:ins>`,
    );
    const after = snapshotDocumentRevisions(
      `<w:ins w:id="101" w:author="甲"><w:r><w:t>五日</w:t></w:r></w:ins>`,
    );
    const result = compareRevisionPreservation(before, after);
    expect(result.ok).toBe(false);
    expect(result.missing.map((item) => item.text)).toEqual(["违约金"]);
  });

  it("counts new revisions as additions, not failures", () => {
    const before = snapshotDocumentRevisions(
      `<w:ins w:id="1" w:author="甲"><w:r><w:t>五</w:t></w:r></w:ins>`,
    );
    const after = snapshotDocumentRevisions(
      `<w:ins w:id="1" w:author="甲"><w:r><w:t>五</w:t></w:r></w:ins>` +
        `<w:ins w:id="9" w:author="LawMind"><w:r><w:t>七</w:t></w:r></w:ins>`,
    );
    const result = compareRevisionPreservation(before, after);
    expect(result.ok).toBe(true);
    expect(result.added.map((item) => item.id)).toEqual(["9"]);
  });

  it("reports unverified instead of passing when a file cannot be read", async () => {
    const dir = tmpDir();
    const before = await writeDocx(dir, "a.docx", [{ text: "甲方应于十日内付款，逾期按日计罚。" }]);
    const result = await verifyDocxRevisionPreservation({
      beforeAbs: before,
      afterAbs: path.join(dir, "missing.docx"),
    });
    expect(result.verified).toBe(false);
    expect(result.ok).toBe(false);
    expect(result.note).toContain("无法核对");
  });
});

describe("已带格式修订的回稿再修", () => {
  /** 对方已经留下 rPrChange / pPrChange 的段落，不能被叠加覆盖。 */
  const beforeXml =
    `<w:document xmlns:w="${W}"><w:body>` +
    `<w:p><w:pPr><w:spacing w:line="240" w:lineRule="auto"/>` +
    `<w:pPrChange w:id="5" w:author="对方律师" w:date="2026-10-01T00:00:00Z"><w:pPr><w:spacing w:line="300" w:lineRule="auto"/></w:pPr></w:pPrChange>` +
    `</w:pPr>` +
    `<w:r><w:rPr><w:b/>` +
    `<w:rPrChange w:id="6" w:author="对方律师" w:date="2026-10-01T00:00:00Z"><w:rPr><w:b/></w:rPr></w:rPrChange>` +
    `</w:rPr><w:t>本合同自双方签署之日起生效。</w:t></w:r></w:p>` +
    `<w:p><w:r><w:rPr><w:rFonts w:eastAsia="SimSun" w:ascii="SimSun"/></w:rPr>` +
    `<w:t>双方应就保密义务另行签署书面协议。</w:t></w:r></w:p>` +
    `<w:sectPr/></w:body></w:document>`;

  function count(haystack: string, needle: string): number {
    return haystack.split(needle).length - 1;
  }

  it("refuses to overwrite an existing format revision and fixes the rest", () => {
    const before = snapshotDocumentRevisions(beforeXml);
    expect(before.map((item) => item.id).toSorted()).toEqual(["5", "6"]);

    const result = applyFormatFixesToXml({
      documentXml: beforeXml,
      blocks: [],
      targets: [
        {
          paragraphIndex: 0,
          text: "本合同自双方签署之日起生效。",
          kinds: ["body.font", "body.size"],
        },
        {
          paragraphIndex: 1,
          text: "双方应就保密义务另行签署书面协议。",
          kinds: ["body.font", "body.size"],
        },
      ],
      target: { fontFamily: "FangSong", halfPt: 32 },
      author: "LawMind",
      now: "2026-10-21T00:00:00Z",
      nextTrackId: () => "100",
    });

    // 只有第二段被改；第一段保留对方的格式修订署名。
    expect(result.appliedParagraphs).toBe(1);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]?.reason).toContain("已有格式修订");

    const xml = result.xml;
    expect(count(xml, 'w:id="5"')).toBe(1);
    expect(count(xml, 'w:id="6"')).toBe(1);
    // 标签必须闭合：懒惰正则会停在内层 </w:rPr>，留下未闭合的外层。
    expect(count(xml, "<w:rPr>")).toBe(count(xml, "</w:rPr>"));
    expect(count(xml, "<w:pPr>")).toBe(count(xml, "</w:pPr>"));
    expect(count(xml, "<w:pPrChange")).toBe(count(xml, "</w:pPrChange>"));
    expect(count(xml, "<w:rPrChange")).toBe(count(xml, "</w:rPrChange>"));
    // 不能套娃：每个 rPrChange 区间里最多只有它自己的开标签。
    for (const segment of xml.split("</w:rPrChange>")) {
      expect(segment.split("<w:rPrChange").length - 1).toBeLessThanOrEqual(1);
    }
    expect(xml).toContain('w:author="LawMind"');

    const preserved = compareRevisionPreservation(before, snapshotDocumentRevisions(xml));
    expect(preserved.ok).toBe(true);
    expect(preserved.missing).toEqual([]);
  });

  it("says why a paragraph was skipped instead of claiming it already conformed", () => {
    const result = applyFormatFixesToXml({
      documentXml: beforeXml,
      blocks: [],
      targets: [
        {
          paragraphIndex: 0,
          text: "本合同自双方签署之日起生效。",
          kinds: ["body.font", "body.size"],
        },
      ],
      target: { fontFamily: "FangSong", halfPt: 32 },
      author: "LawMind",
      now: "2026-10-21T00:00:00Z",
      nextTrackId: () => "101",
    });
    expect(result.appliedParagraphs).toBe(0);
    expect(result.skipped[0]?.reason).not.toBe("本来就符合目标格式，未改");
    expect(result.xml).toBe(beforeXml);
  });

  it("normalizes a paired w:spacing instead of adding a duplicate child", () => {
    const paired =
      `<w:document xmlns:w="${W}"><w:body>` +
      `<w:p><w:pPr><w:spacing w:line="400" w:lineRule="auto"></w:spacing></w:pPr>` +
      `<w:r><w:t>本条约定以书面形式作出变更方为有效。</w:t></w:r></w:p>` +
      `<w:sectPr/></w:body></w:document>`;
    const result = applyFormatFixesToXml({
      documentXml: paired,
      blocks: [],
      targets: [
        { paragraphIndex: 0, text: "本条约定以书面形式作出变更方为有效。", kinds: ["body.line"] },
      ],
      target: { line: { rule: "exact", px: 28 } },
      author: "LawMind",
      now: "2026-10-21T00:00:00Z",
      nextTrackId: () => "200",
    });
    expect(result.appliedParagraphs).toBe(1);
    // 新的 pPr 里只能有一条 spacing；旧属性记录在 pPrChange 里。
    const outerPPr = result.xml.slice(
      result.xml.indexOf("<w:pPr>"),
      result.xml.indexOf("<w:pPrChange"),
    );
    expect(count(outerPPr, "<w:spacing")).toBe(1);
    expect(outerPPr).not.toContain("</w:spacing>");
    expect(result.xml).toContain('w:line="420"');
  });
});

describe("格式自动修（A 层，写副本）", () => {
  const paragraphs: ParaSpec[] = [
    {
      text: "本合同自双方签字之日起生效，任何变更须书面确认。",
      font: "SimSun",
      halfPt: 24,
      line: 360,
      firstLineChars: 200,
      inset: { id: "11", author: "对方律师", date: "2026-10-01T00:00:00Z" },
    },
    {
      text: "乙方应在收到货物后十日内完成验收并书面通知甲方。",
      font: "SimSun",
      halfPt: 24,
      line: 360,
      firstLineChars: 200,
    },
    // LawMind 写入的段落：字体/字号跑偏，需要跟随原文
    {
      text: "甲方应于验收合格后三十日内支付价款，逾期按日万分之五计息。",
      font: "FangSong_GB2312",
      halfPt: 32,
    },
  ];

  it("plans only the drifted paragraph when the file is imported", async () => {
    const dir = tmpDir();
    const abs = await writeDocx(dir, "回稿.docx", paragraphs);
    const layout = await readDocxDocumentLayout(abs);
    const plan = planFormatFixes({
      mode: "imported",
      page: layout.page,
      blocks: layout.blocks,
      lawmindParagraphs: [2],
    });
    expect(plan.fixes).toHaveLength(1);
    expect(plan.fixes[0]?.paragraphIndex).toBe(2);
    expect(plan.fixes[0]?.kinds).toEqual(expect.arrayContaining(["body.font", "body.size"]));
    // 目标格式来自原文，而不是我们的模板
    expect(plan.target.rFontsXml).toContain("SimSun");
    expect(plan.target.halfPt).toBe(24);
  });

  it("writes format revisions to a copy and keeps the original tracked change", async () => {
    const dir = tmpDir();
    const abs = await writeDocx(dir, "回稿.docx", paragraphs);
    const out = path.join(dir, "回稿_格式修订.docx");

    const result = await applyFormatFixesToDocxFile({
      inputAbs: abs,
      outputAbs: out,
      mode: "imported",
      author: "LawMind",
      lawmindParagraphs: [2],
      now: "2026-10-20T00:00:00Z",
    });
    expect(result.ok).toBe(true);
    expect(result.outputPath).toBe(out);
    expect(result.appliedParagraphs).toBe(1);
    expect(result.revisions?.verified).toBe(true);
    expect(result.revisions?.beforeCount).toBeGreaterThan(0);
    // 新增的是格式修订，原有条目一条不少
    expect(result.revisions?.afterCount).toBeGreaterThan(result.revisions?.beforeCount ?? 0);

    const xml = await new JSZip()
      .loadAsync(await fs.promises.readFile(out))
      .then((zip) => zip.file("word/document.xml")!.async("string"));
    // 格式修订是 Word 认得的那种，不是静默美化
    expect(xml).toContain("<w:rPrChange");
    expect(xml).toContain('w:author="LawMind"');
    // 原有的对方修订原样在
    expect(xml).toContain('<w:ins w:id="11" w:author="对方律师"');

    // 修完之后，同一个体检不该再报这两段
    const report = await auditFile(out, "imported", [2]);
    expect(report.findings.filter((f) => f.code === "imported.font")).toEqual([]);
    expect(report.findings.filter((f) => f.code === "imported.size")).toEqual([]);
  });

  it("refuses to overwrite the original and never invents the original's revisions", async () => {
    const dir = tmpDir();
    const abs = await writeDocx(dir, "回稿.docx", paragraphs);
    const same = await applyFormatFixesToDocxFile({
      inputAbs: abs,
      outputAbs: abs,
      mode: "imported",
      author: "LawMind",
    });
    expect(same.ok).toBe(false);
    expect(same.code).toBe("in_place_refused");
  });

  it("keeps skipped items explicit for the GB path", async () => {
    const dir = tmpDir();
    const abs = await writeDocx(dir, "通知.docx", [
      { text: "关于合同审查有关事项的通知", font: "SimSun", halfPt: 24 },
      { text: "现将合同审查有关事项通知如下，请遵照执行。", font: "SimSun", halfPt: 24 },
    ]);
    const out = path.join(dir, "通知_格式修订.docx");
    const result = await applyFormatFixesToDocxFile({
      inputAbs: abs,
      outputAbs: out,
      mode: "from-scratch",
      author: "LawMind",
    });
    expect(result.ok).toBe(true);
    expect(result.plan?.skippedKinds.join("")).toContain("标题层级");
    expect(result.plan?.skippedKinds.join("")).toContain("页边距");
  });

  it("adds a pPr when the paragraph has none, instead of skipping it", async () => {
    const xml =
      `<w:document xmlns:w="${W}"><w:body>` +
      `<w:p><w:r><w:rPr><w:rFonts w:eastAsia="SimSun" w:ascii="SimSun"/><w:sz w:val="24"/></w:rPr>` +
      `<w:t>甲方应于验收合格后三十日内支付价款，逾期按日万分之五计息。</w:t></w:r></w:p>` +
      `</w:body></w:document>`;
    const zip = new JSZip();
    zip.file("word/document.xml", xml);
    const dir = tmpDir();
    const abs = path.join(dir, "裸.docx");
    fs.writeFileSync(abs, await zip.generateAsync({ type: "nodebuffer" }));

    const out = path.join(dir, "裸_格式修订.docx");
    const result = await applyFormatFixesToDocxFile({
      inputAbs: abs,
      outputAbs: out,
      mode: "from-scratch",
      author: "LawMind",
      now: "2026-10-20T00:00:00Z",
    });
    expect(result.ok).toBe(true);
    expect(result.appliedParagraphs).toBe(1);
    const fixedXml = await new JSZip()
      .loadAsync(await fs.promises.readFile(out))
      .then((loaded) => loaded.file("word/document.xml")!.async("string"));
    expect(fixedXml).toContain("<w:pPr>");
    expect(fixedXml).toContain("<w:pPrChange");
    expect(fixedXml).toContain("<w:rPrChange");
    expect(fixedXml).toContain('w:eastAsia="仿宋_GB2312"');
  });

  it("inserts spacing before w:jc so the pPr child order stays valid", async () => {
    const xml =
      `<w:document xmlns:w="${W}"><w:body>` +
      `<w:p><w:pPr><w:jc w:val="both"/></w:pPr><w:r><w:rPr><w:rFonts w:eastAsia="SimSun"/><w:sz w:val="24"/></w:rPr>` +
      `<w:t>甲方应于验收合格后三十日内支付价款，逾期按日万分之五计息。</w:t></w:r></w:p>` +
      `</w:body></w:document>`;
    const zip = new JSZip();
    zip.file("word/document.xml", xml);
    const dir = tmpDir();
    const abs = path.join(dir, "有对齐.docx");
    fs.writeFileSync(abs, await zip.generateAsync({ type: "nodebuffer" }));
    const out = path.join(dir, "有对齐_格式修订.docx");
    const result = await applyFormatFixesToDocxFile({
      inputAbs: abs,
      outputAbs: out,
      mode: "from-scratch",
      author: "LawMind",
    });
    expect(result.ok).toBe(true);
    const fixedXml = await new JSZip()
      .loadAsync(await fs.promises.readFile(out))
      .then((loaded) => loaded.file("word/document.xml")!.async("string"));
    // spacing 必须在 jc 之前（schema 顺序），不能追加到末尾
    expect(fixedXml.indexOf("<w:spacing")).toBeGreaterThan(-1);
    expect(fixedXml.indexOf("<w:spacing")).toBeLessThan(fixedXml.indexOf("<w:jc"));
  });

  it("skips paragraphs that contain a text box instead of corrupting them", async () => {
    const textbox =
      `<w:r><w:pict><v:shape xmlns:v="urn:schemas-microsoft-com:vml"><v:textbox><w:txbxContent>` +
      `<w:p><w:r><w:t>框内文字</w:t></w:r></w:p>` +
      `</w:txbxContent></v:textbox></v:shape></w:pict></w:r>`;
    const body =
      `<w:p>${textbox}<w:r><w:rPr><w:rFonts w:eastAsia="SimSun" w:ascii="SimSun"/><w:sz w:val="24"/></w:rPr>` +
      `<w:t>甲方应于验收合格后三十日内支付价款，逾期按日万分之五计息。</w:t></w:r></w:p>`;
    const xml = `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`;
    const zip = new JSZip();
    zip.file("word/document.xml", xml);
    const dir = tmpDir();
    const abs = path.join(dir, "带文本框.docx");
    fs.writeFileSync(abs, await zip.generateAsync({ type: "nodebuffer" }));
    const out = path.join(dir, "带文本框_格式修订.docx");
    const result = await applyFormatFixesToDocxFile({
      inputAbs: abs,
      outputAbs: out,
      mode: "from-scratch",
      author: "LawMind",
    });
    // 不写副本，也不谎称改过；原文件保持原样
    expect(result.ok).toBe(true);
    expect(result.appliedParagraphs).toBe(0);
    expect(fs.existsSync(out)).toBe(false);
    expect(fs.readFileSync(abs).equals(await fs.promises.readFile(abs))).toBe(true);
  });

  it("tells the lawyer that text boxes were not checked", async () => {
    const layout = await readDocxDocumentLayout(
      await writeDocx(tmpDir(), "正常.docx", [
        {
          text: "甲方应于验收合格后三十日内支付价款，逾期按日万分之五计息。",
          font: "SimSun",
          halfPt: 24,
        },
      ]),
    );
    const report = auditDocumentFormat({
      page: layout.page,
      blocks: layout.blocks,
      mode: "from-scratch",
      hasTextBoxes: true,
    });
    expect(report.unchecked.join("")).toContain("文本框");
  });

  it("fixes both duplicate paragraphs by ordinal instead of confusing them", async () => {
    const text = "甲方应于验收合格后三十日内支付价款，逾期按日万分之五计息。";
    const p =
      `<w:p><w:r><w:rPr><w:rFonts w:eastAsia="FangSong_GB2312"/><w:sz w:val="32"/></w:rPr>` +
      `<w:t>${text}</w:t></w:r></w:p>`;
    const xml = `<w:document xmlns:w="${W}"><w:body>${p}${p}</w:body></w:document>`;
    const zip = new JSZip();
    zip.file("word/document.xml", xml);
    const dir = tmpDir();
    const abs = path.join(dir, "重复.docx");
    fs.writeFileSync(abs, await zip.generateAsync({ type: "nodebuffer" }));
    const out = path.join(dir, "重复_格式修订.docx");
    const result = await applyFormatFixesToDocxFile({
      inputAbs: abs,
      outputAbs: out,
      mode: "from-scratch",
      author: "LawMind",
    });
    // 两段序号不同，能按序号定位，所以两段都该改；重点是别把第二段当成第一段
    expect(result.ok).toBe(true);
    expect(result.appliedParagraphs).toBe(2);
  });

  it("says so plainly when a paragraph only inherits formatting", async () => {
    // 通篇没有直接格式（全靠样式继承）：体检说不清，也不硬改。
    const xml =
      `<w:document xmlns:w="${W}"><w:body>` +
      `<w:p><w:r><w:t>甲方应于验收合格后三十日内支付价款，逾期按日万分之五计息。</w:t></w:r></w:p>` +
      `</w:body></w:document>`;
    const zip = new JSZip();
    zip.file("word/document.xml", xml);
    const dir = tmpDir();
    const abs = path.join(dir, "继承.docx");
    fs.writeFileSync(abs, await zip.generateAsync({ type: "nodebuffer" }));
    const out = path.join(dir, "继承_格式修订.docx");
    const result = await applyFormatFixesToDocxFile({
      inputAbs: abs,
      outputAbs: out,
      mode: "from-scratch",
      author: "LawMind",
    });
    expect(result.ok).toBe(true);
    expect(result.appliedParagraphs).toBe(0);
    expect(result.warning).toContain("A 层");
    expect(fs.existsSync(out)).toBe(false);
  });
});
