import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { persistDraft, readDraft } from "../../drafts/index.js";
import {
  applyDeliverableReviewStamp,
  createPlannedDeliverable,
  linkDraftToDeliverable,
  readDeliverable,
  syncDraftReviewStatusFromDeliverable,
  transitionDeliverable,
} from "./deliverable-service.js";
import { checkTaskDraftConsistency } from "../task-draft-consistency.js";

describe("application/services/deliverable-service", () => {
  let workspaceDir: string;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join("/tmp", "lawmind-deliverable-svc-"));
    await fs.mkdir(path.join(workspaceDir, "audit"), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(workspaceDir, { recursive: true, force: true }).catch(() => undefined);
  });

  it("creates planned deliverable and transitions to drafting", () => {
    const planned = createPlannedDeliverable(workspaceDir, {
      matterId: "m-del",
      deliverableId: "d-1",
      kind: "demand-letter",
    });
    expect(planned.status).toBe("planned");
    expect(readDeliverable(workspaceDir, "m-del", "d-1")?.deliverableId).toBe("d-1");

    const drafting = transitionDeliverable(workspaceDir, "m-del", "d-1", "drafting");
    expect(drafting?.status).toBe("drafting");
  });

  it("rejects invalid lifecycle skip", () => {
    createPlannedDeliverable(workspaceDir, {
      matterId: "m-del2",
      deliverableId: "d-2",
      kind: "legal-memo",
    });
    expect(() =>
      transitionDeliverable(workspaceDir, "m-del2", "d-2", "delivered"),
    ).toThrow(/invalid deliverable transition/);
  });

  it("applyDeliverableReviewStamp is SSOT: deliverable stamp then draft sync (no drift)", () => {
    const now = new Date().toISOString();
    createPlannedDeliverable(workspaceDir, {
      matterId: "m-stamp",
      deliverableId: "draft-stamp",
      kind: "legal-memo",
      taskId: "draft-stamp",
    });
    transitionDeliverable(workspaceDir, "m-stamp", "draft-stamp", "drafting");
    transitionDeliverable(workspaceDir, "m-stamp", "draft-stamp", "pending_review");
    persistDraft(workspaceDir, {
      taskId: "draft-stamp",
      title: "备忘",
      output: "docx",
      templateId: "builtin/memo",
      summary: "x",
      sections: [],
      reviewNotes: [],
      reviewStatus: "pending",
      matterId: "m-stamp",
      createdAt: now,
      updatedAt: now,
    });

    const stamped = applyDeliverableReviewStamp(workspaceDir, "m-stamp", "draft-stamp", {
      reviewStatus: "approved",
      status: "approved",
      reviewerId: "lawyer-1",
      approvedBy: "lawyer-1",
    });
    expect(stamped?.currentReviewStatus).toBe("approved");
    expect(stamped?.status).toBe("approved");
    expect(readDeliverable(workspaceDir, "m-stamp", "draft-stamp")?.currentReviewStatus).toBe(
      "approved",
    );

    const draft = readDraft(workspaceDir, "draft-stamp");
    expect(draft).toBeTruthy();
    syncDraftReviewStatusFromDeliverable(draft!, stamped!);
    persistDraft(workspaceDir, draft!);
    expect(readDraft(workspaceDir, "draft-stamp")?.reviewStatus).toBe("approved");

    const issues = checkTaskDraftConsistency(workspaceDir).filter(
      (i) => i.code === "deliverable_review_drift",
    );
    expect(issues).toEqual([]);
  });

  it("linkDraftToDeliverable merges existing deliverable record", () => {
    const now = new Date().toISOString();
    createPlannedDeliverable(workspaceDir, {
      matterId: "m-link",
      deliverableId: "d-link",
      kind: "legal-memo",
      taskId: "d-link",
    });
    transitionDeliverable(workspaceDir, "m-link", "d-link", "drafting");
    const draft = {
      taskId: "d-link",
      title: "链接测试",
      output: "docx" as const,
      templateId: "builtin/memo",
      summary: "x",
      sections: [],
      reviewNotes: [],
      reviewStatus: "pending" as const,
      matterId: "m-link",
      createdAt: now,
      updatedAt: now,
    };
    const linked = linkDraftToDeliverable(workspaceDir, draft);
    expect(linked?.deliverableId).toBe("d-link");
    expect(readDeliverable(workspaceDir, "m-link", "d-link")?.status).toBeTruthy();
  });

  it("linkDraftToDeliverable does not overwrite review stamp with draft pending", () => {
    const now = new Date().toISOString();
    createPlannedDeliverable(workspaceDir, {
      matterId: "m-lock",
      deliverableId: "d-lock",
      kind: "legal-memo",
      taskId: "d-lock",
    });
    transitionDeliverable(workspaceDir, "m-lock", "d-lock", "drafting");
    transitionDeliverable(workspaceDir, "m-lock", "d-lock", "pending_review");
    applyDeliverableReviewStamp(workspaceDir, "m-lock", "d-lock", {
      reviewStatus: "approved",
      status: "approved",
      reviewerId: "lawyer-1",
      approvedBy: "lawyer-1",
    });
    const draft = {
      taskId: "d-lock",
      title: "不应回写",
      output: "docx" as const,
      templateId: "builtin/memo",
      summary: "x",
      sections: [],
      reviewNotes: [],
      reviewStatus: "pending" as const,
      matterId: "m-lock",
      createdAt: now,
      updatedAt: now,
    };
    const linked = linkDraftToDeliverable(workspaceDir, draft);
    expect(linked?.currentReviewStatus).toBe("approved");
    expect(linked?.status).toBe("approved");
    expect(readDeliverable(workspaceDir, "m-lock", "d-lock")?.currentReviewStatus).toBe(
      "approved",
    );
  });

  it("transitions deliverable through review and delivery lifecycle", () => {
    createPlannedDeliverable(workspaceDir, {
      matterId: "m-life",
      deliverableId: "d-life",
      kind: "legal-memo",
    });
    transitionDeliverable(workspaceDir, "m-life", "d-life", "drafting");
    transitionDeliverable(workspaceDir, "m-life", "d-life", "pending_review", {
      reviewStatus: "pending",
    });
    const approved = transitionDeliverable(workspaceDir, "m-life", "d-life", "approved", {
      reviewStatus: "approved",
      approvedBy: "lawyer-1",
    });
    expect(approved?.status).toBe("approved");
    expect(approved?.approvedBy).toBe("lawyer-1");
    transitionDeliverable(workspaceDir, "m-life", "d-life", "rendered");
    const delivered = transitionDeliverable(workspaceDir, "m-life", "d-life", "delivered", {
      deliveredBy: "lawyer-1",
    });
    expect(delivered?.status).toBe("delivered");
    expect(delivered?.deliveredAt).toBeTruthy();
  });

  it("transitionDeliverable keeps existing review stamp over drifted draft status", () => {
    createPlannedDeliverable(workspaceDir, {
      matterId: "m-stamp-keep",
      deliverableId: "d-stamp-keep",
      kind: "legal-memo",
      taskId: "d-stamp-keep",
    });
    transitionDeliverable(workspaceDir, "m-stamp-keep", "d-stamp-keep", "drafting");
    transitionDeliverable(workspaceDir, "m-stamp-keep", "d-stamp-keep", "pending_review", {
      reviewStatus: "pending",
    });
    applyDeliverableReviewStamp(workspaceDir, "m-stamp-keep", "d-stamp-keep", {
      reviewStatus: "approved",
      status: "approved",
      approvedBy: "lawyer-1",
    });
    const rendered = transitionDeliverable(
      workspaceDir,
      "m-stamp-keep",
      "d-stamp-keep",
      "rendered",
      { reviewStatus: "pending" },
    );
    expect(rendered?.status).toBe("rendered");
    expect(rendered?.currentReviewStatus).toBe("approved");
    expect(
      readDeliverable(workspaceDir, "m-stamp-keep", "d-stamp-keep")?.currentReviewStatus,
    ).toBe("approved");
  });

  it("syncDraftReviewStatusFromDeliverable no-op without stamp", () => {
    createPlannedDeliverable(workspaceDir, {
      matterId: "m-nostamp",
      deliverableId: "d-nostamp",
      kind: "legal-memo",
    });
    const d = readDeliverable(workspaceDir, "m-nostamp", "d-nostamp");
    expect(d).toBeTruthy();
    const draft = {
      taskId: "d-nostamp",
      title: "x",
      output: "docx" as const,
      templateId: "t",
      summary: "s",
      sections: [],
      reviewNotes: [],
      reviewStatus: "pending" as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const unchanged = syncDraftReviewStatusFromDeliverable(draft, d!);
    expect(unchanged.reviewStatus).toBe("pending");
  });
});
