import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { checkDocumentFormat } from "./format-audit-tool.js";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const dirs: string[] = [];

function tmpWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-format-audit-"));
  dirs.push(dir);
  return dir;
}

type ParaSpec = { text: string; font?: string; halfPt?: number; line?: number; align?: string };

function para(spec: ParaSpec): string {
  const font = spec.font ? `<w:rFonts w:eastAsia="${spec.font}" w:ascii="${spec.font}"/>` : "";
  const size = spec.halfPt != null ? `<w:sz w:val="${spec.halfPt}"/>` : "";
  const rPr = font || size ? `<w:rPr>${font}${size}</w:rPr>` : "";
  const jc = spec.align ? `<w:jc w:val="${spec.align}"/>` : "";
  const spacing = spec.line != null ? `<w:spacing w:line="${spec.line}" w:lineRule="exact"/>` : "";
  return `<w:p><w:pPr>${jc}${spacing}</w:pPr><w:r>${rPr}<w:t>${spec.text}</w:t></w:r></w:p>`;
}

async function writeDocx(
  ws: string,
  rel: string,
  paragraphs: ParaSpec[],
  page?: { w: number; h: number; top?: number; right?: number; bottom?: number; left?: number },
): Promise<string> {
  const sect = page
    ? `<w:sectPr><w:pgSz w:w="${page.w}" w:h="${page.h}"/><w:pgMar w:top="${
        page.top ?? 1440
      }" w:right="${page.right ?? 1440}" w:bottom="${page.bottom ?? 1440}" w:left="${
        page.left ?? 1440
      }"/></w:sectPr>`
    : "";
  const xml = `<w:document xmlns:w="${W}"><w:body>${paragraphs.map(para).join("")}${sect}</w:body></w:document>`;
  const zip = new JSZip();
  zip.file("word/document.xml", xml);
  const abs = path.join(ws, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, await zip.generateAsync({ type: "nodebuffer" }));
  return abs;
}

const importedParas: ParaSpec[] = [
  { text: "本合同自双方签字之日起生效。", font: "SimSun", halfPt: 24, line: 360 },
  { text: "乙方应在收到货物后十日内完成验收。", font: "SimSun", halfPt: 24, line: 360 },
];

describe("check_document_format", () => {
  it("defaults to following the imported file and never imposes the GB template", async () => {
    const ws = tmpWorkspace();
    await writeDocx(ws, "材料/合同.docx", importedParas, { w: 12240, h: 15840 });
    const result = await checkDocumentFormat.execute(
      { file_path: "材料/合同.docx" },
      { workspaceDir: ws, sessionId: "s", actorId: "t" },
    );
    expect(result.ok).toBe(true);
    const data = result.data as {
      mode: string;
      standard: { id: string; provisional: boolean };
      counts: { error: number };
      profile: { fontFamily?: string };
      lawmindTextFormat: { source: string; fontFamily?: string; fontSizePt?: number };
      report: string;
      unchecked: string[];
    };
    expect(data.mode).toBe("imported");
    expect(data.standard.id).toBe("document-self");
    expect(data.standard.provisional).toBe(false);
    expect(data.counts.error).toBe(0);
    expect(data.profile.fontFamily).toBe("宋体");
    expect(data.lawmindTextFormat.source).toBe("document-self");
    expect(data.lawmindTextFormat.fontFamily).toBe("宋体");
    expect(data.lawmindTextFormat.fontSizePt).toBe(12);
    expect(data.report).toContain("跟随原文");
    expect(data.unchecked.join("")).toContain("保持原样");
  });

  it("reports GB gaps for a from-scratch draft and says what it did not check", async () => {
    const ws = tmpWorkspace();
    await writeDocx(ws, "drafts/通知.docx", [
      { text: "关于合同审查的通知", font: "SimSun", halfPt: 24, align: "center" },
      { text: "现将有关事项通知如下，请遵照执行。", font: "SimSun", halfPt: 24 },
    ]);
    const result = await checkDocumentFormat.execute(
      { file_path: "drafts/通知.docx", mode: "from-scratch" },
      { workspaceDir: ws, sessionId: "s", actorId: "t" },
    );
    expect(result.ok).toBe(true);
    const data = result.data as {
      ok: boolean;
      counts: { error: number };
      standard: { provisional: boolean; noticeZh: string };
      report: string;
      unchecked: string[];
    };
    expect(data.ok).toBe(false);
    expect(data.counts.error).toBeGreaterThan(0);
    expect(data.standard.provisional).toBe(true);
    expect(data.report).toContain("待律师确认");
    expect(data.unchecked.join("")).toContain("页码");
  });

  it("flags LawMind-written paragraphs that drift from the file's own format", async () => {
    const ws = tmpWorkspace();
    await writeDocx(ws, "材料/回稿.docx", [
      ...importedParas,
      { text: "甲方应于验收合格后三十日内支付价款。", font: "FangSong_GB2312", halfPt: 32 },
    ]);
    const result = await checkDocumentFormat.execute(
      { file_path: "材料/回稿.docx", mode: "imported", lawmind_paragraphs: [2] },
      { workspaceDir: ws, sessionId: "s", actorId: "t" },
    );
    expect(result.ok).toBe(true);
    const data = result.data as {
      findings: Array<{ code: string; paragraphIndex?: number; expected?: string }>;
      noteZh: string;
    };
    const drifted = data.findings.find((row) => row.code === "imported.font");
    expect(drifted?.paragraphIndex).toBe(2);
    expect(drifted?.expected).toBe("宋体");
    expect(data.noteZh).toContain("未改动文件");
  });

  it("refuses .doc and missing files instead of guessing", async () => {
    const ws = tmpWorkspace();
    const legacy = await checkDocumentFormat.execute(
      { file_path: "旧稿.doc" },
      { workspaceDir: ws, sessionId: "s", actorId: "t" },
    );
    expect(legacy.ok).toBe(false);
    expect(legacy.error).toContain(".docx");

    const missing = await checkDocumentFormat.execute(
      { file_path: "不存在.docx" },
      { workspaceDir: ws, sessionId: "s", actorId: "t" },
    );
    expect(missing.ok).toBe(false);
    expect(missing.error).toContain("找不到");
  });

  it("treats a renamed .doc as a bad docx, not as a format problem", async () => {
    const ws = tmpWorkspace();
    fs.writeFileSync(path.join(ws, "假.docx"), "not a zip");
    const result = await checkDocumentFormat.execute(
      { file_path: "假.docx" },
      { workspaceDir: ws, sessionId: "s", actorId: "t" },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("不是有效的 .docx");
  });
});
