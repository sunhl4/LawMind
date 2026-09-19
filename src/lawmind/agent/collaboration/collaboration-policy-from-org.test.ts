import { describe, expect, it } from "vitest";
import type { AssistantProfile } from "../../assistants/types.js";
import { buildCollaborationPolicyFromAssistants } from "./collaboration-policy-from-org.js";
import { validateDelegation } from "./delegation-registry.js";
import { DEFAULT_COLLABORATION_POLICY } from "./types.js";

function profile(
  partial: Pick<AssistantProfile, "assistantId"> &
    Partial<Pick<AssistantProfile, "reportsToAssistantId" | "peerReviewDefaultAssistantId">>,
): AssistantProfile {
  return {
    assistantId: partial.assistantId,
    displayName: partial.assistantId,
    introduction: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    reportsToAssistantId: partial.reportsToAssistantId,
    peerReviewDefaultAssistantId: partial.peerReviewDefaultAssistantId,
  };
}

describe("buildCollaborationPolicyFromAssistants", () => {
  it("keeps open graph when no org fields are set (Solo)", () => {
    const policy = buildCollaborationPolicyFromAssistants([
      profile({ assistantId: "a" }),
      profile({ assistantId: "b" }),
    ]);
    expect(policy.allowedPairs).toEqual([]);
    expect(
      validateDelegation({
        fromAssistantId: "a",
        toAssistantId: "b",
        depth: 0,
        policy,
      }),
    ).toBeUndefined();
  });

  it("fills reporting and peer-review pairs when org is declared", () => {
    const policy = buildCollaborationPolicyFromAssistants([
      profile({ assistantId: "lead" }),
      profile({ assistantId: "assoc", reportsToAssistantId: "lead" }),
      profile({
        assistantId: "reviewer",
        peerReviewDefaultAssistantId: "lead",
      }),
    ]);
    expect(policy.allowedPairs).toEqual(
      expect.arrayContaining(["assoc:lead", "lead:assoc", "reviewer:lead", "lead:reviewer"]),
    );
    expect(
      validateDelegation({
        fromAssistantId: "assoc",
        toAssistantId: "lead",
        depth: 0,
        policy,
      }),
    ).toBeUndefined();
    expect(
      validateDelegation({
        fromAssistantId: "assoc",
        toAssistantId: "reviewer",
        depth: 0,
        policy,
      }),
    ).toMatch(/not allowed/i);
  });

  it("preserves base depth/timeout defaults", () => {
    const policy = buildCollaborationPolicyFromAssistants([], DEFAULT_COLLABORATION_POLICY);
    expect(policy.maxDelegationDepth).toBe(DEFAULT_COLLABORATION_POLICY.maxDelegationDepth);
  });
});
