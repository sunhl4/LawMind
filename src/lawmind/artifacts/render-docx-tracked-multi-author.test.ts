import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ArtifactDraft } from "../types.js";

const FIXTURE = fileURLToPath(
  new URL("../mail/fixtures/tracked-changes-5-authors.doc", import.meta.url),
);

/**
 * Export path uses the real converter (Word / LibreOffice). Unit tests must not
 * depend on a GUI app being installed, so the converter is stubbed with a
 * Word-produced-equivalent package. `convert-with-word.integration.test.ts`
 * covers the real thing.
 */
const convertStub = vi.hoisted(() => ({ ok: false }));
vi.mock("../mail/convert-to-docx.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../mail/convert-to-docx.js")>();
  return {
    ...actual,
    convertLegacyDocToDocx: vi.fn(async (_absIn: string, absOut: string) => {
      if (!convertStub.ok) {
        return { ok: false as const, error: "no converter in unit test" };
      }
      const zip = new JSZip();
      zip.file(
        "word/document.xml",
        `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>` +
          `<w:p><w:r><w:t>正文</w:t></w:r></w:p>` +
          `<w:p><w:del w:id="1" w:author="张律师" w:date="2026-10-17T09:30:00Z"><w:r><w:delText>删除甲甲</w:delText></w:r></w:del></w:p>` +
          `<w:p><w:ins w:id="2" w:author="李律师" w:date="2026-10-17T09:30:00Z"><w:r><w:t>插入乙乙</w:t></w:r></w:ins></w:p>` +
          `<w:p><w:del w:id="3" w:author="王律师" w:date="2026-10-17T09:30:00Z"><w:r><w:delText>删除丙丙</w:delText></w:r></w:del></w:p>` +
          `<w:p><w:ins w:id="4" w:author="赵律师" w:date="2026-10-17T09:30:00Z"><w:r><w:t>插入丁丁</w:t></w:r></w:ins></w:p>` +
          `<w:p><w:del w:id="5" w:author="陈律师" w:date="2026-10-17T09:30:00Z"><w:r><w:delText>删除戊戊</w:delText></w:r></w:del></w:p>` +
          `<w:sectPr/></w:body></w:document>`,
      );
      zip.file(
        "[Content_Types].xml",
        `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>`,
      );
      await fs.promises.mkdir(path.dirname(absOut), { recursive: true });
      await fs.promises.writeFile(absOut, await zip.generateAsync({ type: "nodebuffer" }));
      return { ok: true as const, tool: "msword" as const };
    }),
  };
});

const { renderDocxWithTrackedChanges } = await import("./render-docx-tracked.js");
const { readBinaryWordDocWithRevisions, extractTextWithRevisionsFromDocBytes } =
  await import("../mail/read-word-binary.js");

const dirs: string[] = [];

afterEach(() => {
  convertStub.ok = false;
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function draft(): ArtifactDraft {
  return {
    taskId: "t-five-authors",
    title: "五作者修订",
    output: "docx",
    templateId: "word/contract-default",
    deliverableType: "contract.general",
    summary: "",
    sections: [],
    reviewNotes: [],
    reviewStatus: "pending",
    createdAt: new Date().toISOString(),
  };
}

describe("legacy .doc reading", () => {
  it("keeps five authors' revisions separate", async () => {
    const source = await readBinaryWordDocWithRevisions(FIXTURE);
    expect(source.revisions.map((r) => r.author)).toEqual([
      "张律师",
      "李律师",
      "王律师",
      "赵律师",
      "陈律师",
    ]);
    expect(source.revisions.map((r) => r.kind)).toEqual(["del", "ins", "del", "ins", "del"]);
  });

  it("accepts inserted runs and drops deleted runs", () => {
    const result = extractTextWithRevisionsFromDocBytes(fs.readFileSync(FIXTURE));
    expect(result.acceptedText).toContain("插入乙乙");
    expect(result.acceptedText).not.toContain("删除甲甲");
  });
});

describe("legacy .doc export", () => {
  it("fails loudly when no converter is available instead of shipping a text stand-in", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-doc-noconv-"));
    dirs.push(ws);
    fs.copyFileSync(FIXTURE, path.join(ws, "施工合同.doc"));
    const d = draft();
    d.contractEdit = { baselineRelativePath: "施工合同.doc", mode: "surgical" };

    const result = await renderDocxWithTrackedChanges({
      draft: d,
      outputDir: path.join(ws, "out"),
      proposals: [],
      workspaceDir: ws,
      outputFileName: "施工合同.docx",
      requireContractBaseline: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("doc_needs_docx");
    }
  });

  it("carries the converter's revisions through to the deliverable", async () => {
    convertStub.ok = true;
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-doc-export-"));
    dirs.push(ws);
    fs.copyFileSync(FIXTURE, path.join(ws, "施工合同.doc"));
    const outDir = path.join(ws, "out");
    fs.mkdirSync(outDir, { recursive: true });
    const d = draft();
    d.contractEdit = { baselineRelativePath: "施工合同.doc", mode: "surgical" };

    const result = await renderDocxWithTrackedChanges({
      draft: d,
      outputDir: outDir,
      proposals: [],
      workspaceDir: ws,
      outputFileName: "施工合同.docx",
      requireContractBaseline: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok || !result.outputPath) {
      return;
    }
    const zip = await JSZip.loadAsync(fs.readFileSync(result.outputPath));
    const xml = (await zip.file("word/document.xml")?.async("string")) ?? "";
    expect(xml.match(/<w:del /g)?.length).toBe(3);
    expect(xml.match(/<w:ins /g)?.length).toBe(2);
    for (const name of ["张律师", "李律师", "王律师", "赵律师", "陈律师"]) {
      expect(xml).toContain(`w:author="${name}"`);
    }
    // 原 .doc 不能被改写。
    expect(fs.readFileSync(path.join(ws, "施工合同.doc")).equals(fs.readFileSync(FIXTURE))).toBe(
      true,
    );
  });
});
