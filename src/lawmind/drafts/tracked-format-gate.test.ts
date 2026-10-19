import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { afterEach, describe, expect, it } from "vitest";
import {
  findTrackedFormatMismatches,
  injectRPrIntoRun,
  qaTrackedDocxFormat,
  repairTrackedDocxFormat,
  repairTrackedRunFormatInXml,
  signatureOfRPr,
  signaturesEqual,
} from "./tracked-format-gate.js";

const dirs: string[] = [];

async function writeDocx(documentXml: string): Promise<string> {
  const dir = fsSync.mkdtempSync(path.join(os.tmpdir(), "lm-fmtqa-"));
  dirs.push(dir);
  const zip = new JSZip();
  zip.file("word/document.xml", documentXml);
  const file = path.join(dir, "out.docx");
  await fs.writeFile(file, await zip.generateAsync({ type: "nodebuffer" }));
  return file;
}

function doc(body: string): string {
  return `<?xml version="1.0"?><w:document xmlns:w="x"><w:body>${body}</w:body></w:document>`;
}

const RPR =
  `<w:rPr><w:rFonts w:ascii="SimSun" w:eastAsia="SimSun" w:hAnsi="SimSun"/>` +
  `<w:sz w:val="21"/><w:szCs w:val="21"/></w:rPr>`;

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

describe("signatureOfRPr", () => {
  it("treats matching font/size as equal regardless of attr order", () => {
    const a = signatureOfRPr(
      `<w:rPr><w:sz w:val="21"/><w:rFonts w:eastAsia="SimSun" w:ascii="SimSun"/></w:rPr>`,
    );
    const b = signatureOfRPr(
      `<w:rPr><w:rFonts w:ascii="SimSun" w:eastAsia="SimSun"/><w:sz w:val="21"/></w:rPr>`,
    );
    expect(signaturesEqual(a, b)).toBe(true);
  });
});

describe("injectRPrIntoRun", () => {
  it("inserts when missing and replaces when present", () => {
    expect(injectRPrIntoRun(`<w:r><w:t>甲</w:t></w:r>`, RPR)).toContain('<w:sz w:val="21"/>');
    expect(injectRPrIntoRun(`<w:r><w:rPr><w:b/></w:rPr><w:t>甲</w:t></w:r>`, RPR)).not.toContain(
      "<w:b/>",
    );
  });
});

describe("repairTrackedRunFormatInXml", () => {
  it("copies neighbor rPr onto bare w:ins / w:del runs", () => {
    const xml = doc(
      `<w:p>` +
        `<w:r>${RPR}<w:t>甲方应于</w:t></w:r>` +
        `<w:del w:id="1" w:author="L"><w:r><w:delText>十</w:delText></w:r></w:del>` +
        `<w:ins w:id="2" w:author="L"><w:r><w:t>五</w:t></w:r></w:ins>` +
        `<w:r>${RPR}<w:t>日内付款。</w:t></w:r>` +
        `</w:p>`,
    );
    expect(findTrackedFormatMismatches(xml).length).toBeGreaterThan(0);
    const repaired = repairTrackedRunFormatInXml(xml);
    expect(repaired.repaired).toBeGreaterThanOrEqual(2);
    expect(repaired.unresolved).toEqual([]);
    expect(findTrackedFormatMismatches(repaired.xml)).toEqual([]);
    expect(repaired.xml).toMatch(/<w:ins[\s\S]*?<w:rPr>[\s\S]*?w:val="21"/);
    expect(repaired.xml).toMatch(/<w:del[\s\S]*?<w:rPr>[\s\S]*?w:val="21"/);
  });

  it("prefers the paired deletion rPr for an insert", () => {
    const delRPr = `<w:rPr><w:rFonts w:ascii="KaiTi" w:eastAsia="KaiTi"/><w:sz w:val="24"/></w:rPr>`;
    const xml = doc(
      `<w:p>` +
        `<w:r>${RPR}<w:t>前</w:t></w:r>` +
        `<w:del w:id="1"><w:r>${delRPr}<w:delText>旧</w:delText></w:r></w:del>` +
        `<w:ins w:id="2"><w:r><w:t>新</w:t></w:r></w:ins>` +
        `</w:p>`,
    );
    const repaired = repairTrackedRunFormatInXml(xml);
    expect(repaired.xml).toContain('w:ascii="KaiTi"');
    expect(findTrackedFormatMismatches(repaired.xml)).toEqual([]);
  });

  it("allows bare revisions when neighbors also have no direct props", () => {
    const xml = doc(
      `<w:p>` +
        `<w:r><w:t>甲方应于</w:t></w:r>` +
        `<w:del w:id="1"><w:r><w:delText>十</w:delText></w:r></w:del>` +
        `<w:ins w:id="2"><w:r><w:t>五</w:t></w:r></w:ins>` +
        `<w:r><w:t>日内付款。</w:t></w:r>` +
        `</w:p>`,
    );
    expect(findTrackedFormatMismatches(xml)).toEqual([]);
    expect(repairTrackedRunFormatInXml(xml).repaired).toBe(0);
  });

  it("does not borrow rPr from an earlier unrelated revision cluster", () => {
    const kaiTi = `<w:rPr><w:rFonts w:ascii="KaiTi" w:eastAsia="KaiTi"/><w:sz w:val="24"/></w:rPr>`;
    const simSun = RPR;
    // Cluster A (KaiTi) then bare cluster B with only SimSun plain runs around it.
    // Middle has no plain run between clusters — old donor walk would bleed KaiTi into B.
    const xml = doc(
      `<w:p>` +
        `<w:r>${kaiTi}<w:t>标题</w:t></w:r>` +
        `<w:del w:id="1"><w:r>${kaiTi}<w:delText>旧题</w:delText></w:r></w:del>` +
        `<w:ins w:id="2"><w:r>${kaiTi}<w:t>新题</w:t></w:r></w:ins>` +
        `<w:del w:id="3"><w:r><w:delText>十</w:delText></w:r></w:del>` +
        `<w:ins w:id="4"><w:r><w:t>五</w:t></w:r></w:ins>` +
        `<w:r>${simSun}<w:t>日内付款。</w:t></w:r>` +
        `</w:p>`,
    );
    const repaired = repairTrackedRunFormatInXml(xml);
    expect(repaired.repaired).toBeGreaterThanOrEqual(1);
    // Second cluster must take SimSun from the trailing plain run, not KaiTi from cluster A.
    const secondIns = repaired.xml.match(/<w:ins w:id="4"[\s\S]*?<\/w:ins>/)?.[0];
    expect(secondIns).toBeTruthy();
    expect(secondIns).toContain('w:ascii="SimSun"');
    expect(secondIns).toContain('w:val="21"');
    expect(secondIns).not.toContain("KaiTi");
    expect(findTrackedFormatMismatches(repaired.xml)).toEqual([]);
  });
});

describe("repairTrackedDocxFormat / qaTrackedDocxFormat", () => {
  it("repairs on disk and then passes the hard gate", async () => {
    const file = await writeDocx(
      doc(
        `<w:p>` +
          `<w:r>${RPR}<w:t>无限</w:t></w:r>` +
          `<w:del w:id="1" w:author="LawMind"><w:r><w:delText>责任</w:delText></w:r></w:del>` +
          `<w:ins w:id="2" w:author="LawMind"><w:r><w:t>责任上限</w:t></w:r></w:ins>` +
          `</w:p>`,
      ),
    );
    expect((await qaTrackedDocxFormat(file)).ok).toBe(false);
    const repair = await repairTrackedDocxFormat(file);
    expect(repair.repaired).toBeGreaterThanOrEqual(2);
    const qa = await qaTrackedDocxFormat(file);
    expect(qa.ok).toBe(true);
    expect(qa.violations).toEqual([]);
  });
});

describe("visibility-affecting direct props (strike / vertAlign / highlight / vanish)", () => {
  const vertRPr = `<w:rPr><w:vertAlign w:val="superscript"/></w:rPr>`;

  it("flags a bare run next to a vertAlign donor even when nothing else differs", () => {
    const xml = doc(
      `<w:p>` +
        `<w:r>${vertRPr}<w:t>【注1】</w:t></w:r>` +
        `<w:ins w:id="2"><w:r><w:t>同案号</w:t></w:r></w:ins>` +
        `</w:p>`,
    );
    expect(findTrackedFormatMismatches(xml).length).toBe(1);
    const repaired = repairTrackedRunFormatInXml(xml);
    expect(findTrackedFormatMismatches(repaired.xml)).toEqual([]);
    expect(repaired.xml).toContain('w:vertAlign w:val="superscript"');
  });

  it("raises strike / highlight / vanish donors into the signature", () => {
    for (const tag of ["<w:strike/>", '<w:highlight w:val="yellow"/>', "<w:vanish/>"] as const) {
      const donor = `<w:rPr>${tag}</w:rPr>`;
      const xml = doc(
        `<w:p>` +
          `<w:r>${donor}<w:t>原文字</w:t></w:r>` +
          `<w:ins w:id="2"><w:r><w:t>新文字</w:t></w:r></w:ins>` +
          `</w:p>`,
      );
      expect(findTrackedFormatMismatches(xml), tag).toHaveLength(1);
      const repaired = repairTrackedRunFormatInXml(xml);
      expect(repaired.xml, tag).toContain(tag);
      expect(findTrackedFormatMismatches(repaired.xml), tag).toEqual([]);
    }
  });

  it("does not flag strike w:val=0 (explicit off) donors", () => {
    const donor = `<w:rPr><w:strike w:val="0" w:id="1"/></w:rPr>`;
    const xml = doc(
      `<w:p>` +
        `<w:r>${donor}<w:t>原文字</w:t></w:r>` +
        `<w:ins w:id="2"><w:r><w:t>新文字</w:t></w:r></w:ins>` +
        `</w:p>`,
    );
    // Only explicit-off strike: no direct props at all → bare revision inherits.
    expect(findTrackedFormatMismatches(xml)).toEqual([]);
  });
});
