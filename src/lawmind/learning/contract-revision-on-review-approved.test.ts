import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { persistDraft } from "../drafts/index.js";
import { listMemorySuggestions } from "../memory/adoption-service.js";
import type { ArtifactDraft } from "../types.js";
import { applyContractRevisionAccumulationAfterApprovedReview } from "./contract-revision-on-review-approved.js";

describe("applyContractRevisionAccumulationAfterApprovedReview", () => {
  let workspaceDir: string;
  let initialRel: string;
  let revisedRel: string;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "lm-cr-approve-"));
    await fs.mkdir(path.join(workspaceDir, "audit"), { recursive: true });
    await fs.mkdir(path.join(workspaceDir, "files"), { recursive: true });
    initialRel = "files/initial.docx";
    revisedRel = "files/revised.docx";
    await fs.writeFile(path.join(workspaceDir, initialRel), "initial-bytes");
    await fs.writeFile(path.join(workspaceDir, revisedRel), "revised-bytes");
  });

  afterEach(async () => {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  function baseDraft(over: Partial<ArtifactDraft> = {}): ArtifactDraft {
    return {
      taskId: "task-cr-1",
      matterId: "matter-1",
      title: "供应商协议修订",
      summary: "修订摘要",
      sections: [{ heading: "正文", body: "条款", citations: [] }],
      reviewNotes: [],
      output: "docx",
      templateId: "word/contract-default",
      reviewStatus: "approved",
      createdAt: new Date().toISOString(),
      contractRevisionCapture: {
        initialRelativePath: initialRel,
        revisedRelativePath: revisedRel,
        keyModifications: ["争议解决须写明仲裁地", "付款周期改为月结"],
      },
      ...over,
    };
  }

  it("finalizes pack and queues pending adoption without silent profile write", async () => {
    const draft = baseDraft();
    persistDraft(workspaceDir, draft);

    const {
      revisionId,
      warning,
      draft: next,
    } = await applyContractRevisionAccumulationAfterApprovedReview(
      workspaceDir,
      draft,
      "律师审核备注：加强争议解决",
    );

    expect(warning).toBeUndefined();
    expect(revisionId).toBeTruthy();
    expect(next.contractRevisionAccumulatedId).toBe(revisionId);
    expect(next.contractRevisionCapture).toBeUndefined();

    const profilePath = path.join(workspaceDir, "LAWYER_PROFILE.md");
    const profileExists = await fs
      .access(profilePath)
      .then(() => true)
      .catch(() => false);
    expect(profileExists).toBe(false);

    const suggestions = await listMemorySuggestions(workspaceDir);
    const pending = suggestions.filter((s) => s.state === "pending");
    expect(pending.length).toBeGreaterThan(0);
    expect(pending.every((s) => s.kind === "lawyer.profile_learning")).toBe(true);
    expect(pending.some((s) => (s.note ?? s.payload).includes("仲裁地"))).toBe(true);
  });

  it("is idempotent when already accumulated", async () => {
    const draft = baseDraft({ contractRevisionAccumulatedId: "rev-existing" });
    const again = await applyContractRevisionAccumulationAfterApprovedReview(
      workspaceDir,
      draft,
      "note",
    );
    expect(again.revisionId).toBeUndefined();
    expect(await listMemorySuggestions(workspaceDir)).toHaveLength(0);
  });
});
