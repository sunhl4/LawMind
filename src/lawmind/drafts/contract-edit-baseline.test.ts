import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { afterEach, describe, expect, it } from "vitest";
import type { ArtifactDraft } from "../types.js";
import {
  collectContractBaselineCandidates,
  enrichDraftWithContractEditBaseline,
  extractDocxRelativePathsFromText,
  normalizeWorkspaceRelativePath,
  resolveExistingDocxRelativePath,
  shouldSeedSectionsFromBaseline,
  stampContractEditBaselineIfNeeded,
} from "./contract-edit-baseline.js";

const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

function minimalDraft(overrides: Partial<ArtifactDraft> = {}): ArtifactDraft {
  return {
    taskId: "t-contract-1",
    title: "服务合同",
    output: "docx",
    templateId: "word/contract-default",
    deliverableType: "contract.general",
    summary: "审查 uploads/a.docx",
    sections: [{ heading: "正文", body: "待填" }],
    reviewNotes: [],
    reviewStatus: "pending",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

async function writeMinimalDocx(abs: string, paragraphs: string[]): Promise<void> {
  const zip = new JSZip();
  const body = paragraphs.map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join("");
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:body>${body}</w:body></w:document>`,
  );
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8"?>` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
      `</Types>`,
  );
  const buf = await zip.generateAsync({ type: "nodebuffer" });
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, buf);
}

describe("contract-edit-baseline", () => {
  it("rejects prefix-escape workspace paths", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-baseline-fence-"));
    dirs.push(ws);
    expect(normalizeWorkspaceRelativePath(ws, `${ws}-evil/secret.docx`)).toBeUndefined();
    expect(normalizeWorkspaceRelativePath(ws, "../outside.docx")).toBeUndefined();
    expect(normalizeWorkspaceRelativePath(ws, "uploads/ok.docx")).toBe("uploads/ok.docx");
  });

  it("extracts docx paths from instruction text", () => {
    const paths = extractDocxRelativePathsFromText(
      "请审查 `uploads/foo.docx` 与 cases/m1/bar.docx 的条款。",
    );
    expect(paths).toContain("uploads/foo.docx");
    expect(paths).toContain("cases/m1/bar.docx");
  });

  it("extracts a project-pinned filename from the file-page prefix", () => {
    const paths = extractDocxRelativePathsFromText(
      "【用户在 LawMind 文件页】\n- [项目 · 路径引用] `泰国医疗人工智能战略合作框架协.docx`\n修改合同",
    );
    expect(paths).toContain("泰国医疗人工智能战略合作框架协.docx");
  });

  it("stamps a project-dir Word baseline", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-baseline-ws-"));
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "lm-baseline-proj-"));
    dirs.push(ws, project);
    const leaf = "泰国医疗人工智能战略合作框架协.docx";
    await writeMinimalDocx(path.join(project, leaf), ["甲方应付款。"]);
    const stamped = stampContractEditBaselineIfNeeded({
      workspaceDir: ws,
      projectDir: project,
      draft: minimalDraft({ summary: "修改合同" }),
      instruction: `【用户在 LawMind 文件页】\n- [项目 · 路径引用] \`${leaf}\`\n修改合同`,
    });
    expect(stamped.contractEdit?.baselineRelativePath).toBe(leaf);
    expect(stamped.contractEdit?.baselineRoot).toBe("project");
  });

  it("extracts Unicode matter paths from free text", () => {
    const paths = extractDocxRelativePathsFromText(
      "基线在 cases/临时讨论/服务合同.doc 与 uploads/甲方协议.docx",
    );
    expect(paths).toContain("cases/临时讨论/服务合同.doc");
    expect(paths).toContain("uploads/甲方协议.docx");
  });

  it("stamps contractEdit from a compose Word pin without a path in the instruction", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-baseline-pin-"));
    dirs.push(ws);
    const rel = "uploads/pin-buy.docx";
    await writeMinimalDocx(path.join(ws, rel), ["甲方应付款。"]);
    const pin = {
      pinKind: "file" as const,
      root: "workspace" as const,
      relPath: rel,
      kind: "file" as const,
    };
    expect(collectContractBaselineCandidates({ draft: minimalDraft(), pins: [pin] })).toContain(
      rel,
    );
    const stamped = stampContractEditBaselineIfNeeded({
      workspaceDir: ws,
      draft: minimalDraft({
        deliverableType: "contract.review",
        title: "合同审查意见书",
        summary: "请审查这份采购合同",
      }),
      instruction: "请审查这份采购合同",
      pins: [pin],
    });
    expect(stamped.contractEdit?.baselineRelativePath).toBe(rel);
  });

  it("stamps contractEdit when candidate docx exists under workspace", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-baseline-"));
    dirs.push(ws);
    const rel = "uploads/svc.docx";
    await writeMinimalDocx(path.join(ws, rel), ["甲方应付款。", "乙方交付。"]);
    const stamped = stampContractEditBaselineIfNeeded({
      workspaceDir: ws,
      draft: minimalDraft(),
      instruction: `审查 \`${rel}\``,
    });
    expect(stamped.contractEdit?.baselineRelativePath).toBe(rel);
    expect(stamped.contractEdit?.mode).toBe("surgical");
    expect(resolveExistingDocxRelativePath(ws, rel)).toBe(rel);
  });

  it("seeds paragraph sections from baseline docx for thin body drafts", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-baseline-"));
    dirs.push(ws);
    const rel = "uploads/body.docx";
    await writeMinimalDocx(path.join(ws, rel), ["第一段内容。", "第二段内容。"]);
    const draft = minimalDraft({
      sections: [{ heading: "正文", body: "短" }],
    });
    expect(shouldSeedSectionsFromBaseline(draft)).toBe(true);
    const { draft: enriched, warnings } = await enrichDraftWithContractEditBaseline({
      workspaceDir: ws,
      draft,
      extraPaths: [rel],
      seedSections: true,
    });
    expect(warnings).toEqual([]);
    expect(enriched.contractEdit?.baselineRelativePath).toBe(rel);
    expect(enriched.sections.length).toBeGreaterThanOrEqual(2);
    expect(enriched.sections.some((s) => s.body.includes("第一段"))).toBe(true);
    const seeded = enriched.sections.find((s) => s.body.includes("第一段"));
    expect(seeded?.provenance?.events.some((e) => e.type === "upload")).toBe(true);
    expect(seeded?.provenance?.events[0]?.comment).toBe("body");
  });

  it("does not overwrite substantial opinion sections when seeding soft", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-baseline-"));
    dirs.push(ws);
    const rel = "uploads/op.docx";
    await writeMinimalDocx(path.join(ws, rel), ["原合同段。"]);
    const longBody = "甲".repeat(80);
    const draft = minimalDraft({
      deliverableType: "contract.review",
      title: "合同审查意见书",
      sections: [
        { heading: "审查结论", body: longBody },
        { heading: "风险提示", body: longBody },
      ],
    });
    const { draft: enriched } = await enrichDraftWithContractEditBaseline({
      workspaceDir: ws,
      draft,
      extraPaths: [rel],
      seedSections: undefined,
    });
    expect(enriched.contractEdit?.baselineRelativePath).toBe(rel);
    expect(enriched.sections[0]?.heading).toBe("审查结论");
    expect(enriched.sections[0]?.body).toBe(longBody);
  });

  it("surfaces warning when forced seed baseline file is missing", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-baseline-"));
    dirs.push(ws);
    const draft = minimalDraft({
      contractEdit: { baselineRelativePath: "uploads/missing.docx", mode: "surgical" },
      sections: [{ heading: "正文", body: "短" }],
    });
    const { draft: enriched, warnings } = await enrichDraftWithContractEditBaseline({
      workspaceDir: ws,
      draft,
      seedSections: true,
    });
    expect(enriched.sections[0]?.body).toBe("短");
    expect(warnings.some((w) => w.includes("不存在"))).toBe(true);
  });
});
