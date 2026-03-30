import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ArtifactDraft } from "../types.js";
import {
  listBuiltInTemplates,
  registerUploadedTemplate,
  resolveTemplateForDraft,
  setUploadedTemplateEnabled,
} from "./index.js";

function buildDraft(overrides: Partial<ArtifactDraft> = {}): ArtifactDraft {
  return {
    taskId: "task-template-test",
    title: "Template Test Draft",
    output: "docx",
    templateId: "word/legal-memo-default",
    summary: "summary",
    sections: [{ heading: "h1", body: "b1", citations: ["s1"] }],
    reviewNotes: [],
    reviewStatus: "approved",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("template registry", () => {
  let workspaceDir: string;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "lawmind-template-registry-"));
  });

  afterEach(async () => {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  it("exposes built-in templates with category and resolves built-in IDs", async () => {
    const builtIn = listBuiltInTemplates();
    expect(builtIn.some((t) => t.id === "word/legal-memo-default")).toBe(true);
    const memo = builtIn.find((t) => t.id === "word/legal-memo-default");
    expect(memo?.category).toBe("internal");
    const contract = builtIn.find((t) => t.id === "word/contract-default");
    expect(contract?.category).toBe("contracts");

    const resolved = await resolveTemplateForDraft({
      workspaceDir,
      draft: buildDraft({ templateId: "word/contract-default" }),
    });
    expect(resolved.source).toBe("built-in");
    expect(resolved.variant).toBe("contractReview");
  });

  it("registers uploaded template and resolves to uploaded source", async () => {
    const sourcePath = path.join(workspaceDir, "firm-template.docx");
    await fs.writeFile(sourcePath, "fake-docx-content", "utf8");
    const uploaded = await registerUploadedTemplate({
      workspaceDir,
      id: "upload/firm-brief",
      format: "docx",
      label: "Firm Brief",
      sourcePath,
      placeholderMap: {
        case_title: "title",
        case_summary: "summary",
      },
    });

    expect(uploaded.version).toBe(1);
    const resolved = await resolveTemplateForDraft({
      workspaceDir,
      draft: buildDraft({ templateId: uploaded.id }),
    });
    expect(resolved.source).toBe("uploaded");
    expect(resolved.uploaded?.placeholderMap.case_title).toBe("title");
  });

  it("falls back to built-in when uploaded template is disabled or missing", async () => {
    const sourcePath = path.join(workspaceDir, "firm-template.docx");
    await fs.writeFile(sourcePath, "fake-docx-content", "utf8");
    const uploaded = await registerUploadedTemplate({
      workspaceDir,
      id: "upload/fallback-template",
      format: "docx",
      label: "Fallback Template",
      sourcePath,
    });

    await setUploadedTemplateEnabled({
      workspaceDir,
      id: uploaded.id,
      enabled: false,
    });
    const disabledResolved = await resolveTemplateForDraft({
      workspaceDir,
      draft: buildDraft({ templateId: uploaded.id }),
    });
    expect(disabledResolved.source).toBe("fallback");
    expect(disabledResolved.fallbackReason).toContain("disabled");

    await setUploadedTemplateEnabled({
      workspaceDir,
      id: uploaded.id,
      enabled: true,
    });
    await fs.rm(sourcePath, { force: true });
    const missingResolved = await resolveTemplateForDraft({
      workspaceDir,
      draft: buildDraft({ templateId: uploaded.id }),
    });
    expect(missingResolved.source).toBe("fallback");
    expect(missingResolved.fallbackReason).toContain("missing");
  });
});
