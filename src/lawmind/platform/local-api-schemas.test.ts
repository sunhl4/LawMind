import { describe, expect, it } from "vitest";
import {
  approvalResolvePostSchema,
  assistantUpsertSchema,
  chatResumeRequestSchema,
  draftContentPatchBodySchema,
  draftReviewPostSchema,
  memoryAdoptionSuggestSchema,
  matterCaseNoteRequestSchema,
  sessionCreatePostSchema,
  sourceAnnotationPostSchema,
  templateEnabledPostSchema,
  workflowRunRequestSchema,
} from "./local-api-schemas.js";

describe("local-api-schemas", () => {
  it("parses workflow-run body", () => {
    const parsed = workflowRunRequestSchema.safeParse({
      templateId: " demo ",
      async: true,
      idempotencyKey: "k1",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.templateId).toBe("demo");
      expect(parsed.data.async).toBe(true);
    }
  });

  it("rejects workflow-run without templateId", () => {
    expect(workflowRunRequestSchema.safeParse({ async: true }).success).toBe(false);
  });

  it("parses chat resume body", () => {
    const parsed = chatResumeRequestSchema.safeParse({
      sessionId: "s1",
      actionId: "a1",
      decision: "approve",
    });
    expect(parsed.success).toBe(true);
  });

  it("parses matter case note body", () => {
    const parsed = matterCaseNoteRequestSchema.safeParse({
      matterId: "matter-1",
      section: "risk",
      note: "note text",
    });
    expect(parsed.success).toBe(true);
  });

  it("parses session create body", () => {
    expect(sessionCreatePostSchema.safeParse({ assistantId: "a1", title: "  hi " }).success).toBe(
      true,
    );
  });

  it("parses template enabled body", () => {
    expect(templateEnabledPostSchema.safeParse({ id: "upload/x", enabled: false }).success).toBe(
      true,
    );
  });

  it("parses approval resolve body", () => {
    expect(
      approvalResolvePostSchema.safeParse({
        matterId: "matter-1",
        approvalId: "ap-1",
        status: "approved",
      }).success,
    ).toBe(true);
  });

  it("parses draft review body", () => {
    expect(draftReviewPostSchema.safeParse({ status: "approved", note: "ok" }).success).toBe(true);
  });

  it("parses draft content patch body", () => {
    expect(
      draftContentPatchBodySchema.safeParse({
        title: "Title",
        sections: [{ heading: "H1", body: "text" }],
      }).success,
    ).toBe(true);
  });

  it("parses assistant upsert body", () => {
    expect(
      assistantUpsertSchema.safeParse({ displayName: "协办", orgRole: "member" }).success,
    ).toBe(true);
  });

  it("parses memory adoption suggest body", () => {
    expect(
      memoryAdoptionSuggestSchema.safeParse({
        scope: "matter",
        kind: "case_note",
        payload: "note",
      }).success,
    ).toBe(true);
  });

  it("parses source annotation body", () => {
    expect(
      sourceAnnotationPostSchema.safeParse({
        comment: "anchor",
        createLearning: true,
      }).success,
    ).toBe(true);
  });
});
