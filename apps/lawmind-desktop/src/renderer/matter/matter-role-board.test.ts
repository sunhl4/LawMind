import { describe, expect, it } from "vitest";
import { buildRoleAssignmentRows } from "./matter-role-board.js";

describe("buildRoleAssignmentRows", () => {
  const roles = [
    {
      roleId: "contract_review",
      displayName: "合同审查",
      riskCeiling: "medium" as const,
    },
    {
      roleId: "general_litigation",
      displayName: "诉讼助理",
      riskCeiling: "high" as const,
    },
  ];

  const assistants = [
    {
      assistantId: "asst_contract",
      displayName: "合同小助手",
      roleId: "contract_review",
    },
    {
      assistantId: "asst_lit",
      displayName: "争议专员",
      presetKey: "general_litigation",
      customRoleTitle: "主办诉讼",
    },
  ];

  it("returns empty when roster is missing or empty", () => {
    expect(
      buildRoleAssignmentRows({
        roster: null,
        assistants,
        roles,
      }),
    ).toEqual([]);
    expect(
      buildRoleAssignmentRows({
        roster: { participantAssistantIds: [] },
        assistants,
        roles,
      }),
    ).toEqual([]);
  });

  it("maps roster participants to display names, roles, and risk ceilings", () => {
    const rows = buildRoleAssignmentRows({
      roster: {
        participantAssistantIds: ["asst_contract", "asst_lit", "asst_unknown"],
        synthesizerAssistantId: "asst_contract",
      },
      assistants,
      roles,
      pendingApprovals: [
        { status: "pending", requestedBy: "asst_contract" },
        { status: "pending", requestedBy: "asst_contract" },
        { status: "approved", requestedBy: "asst_contract" },
        { status: "pending", targetRole: "general_litigation" },
      ],
    });

    expect(rows).toEqual([
      {
        assistantId: "asst_contract",
        displayName: "合同小助手",
        roleId: "contract_review",
        roleDisplayName: "合同审查",
        riskCeiling: "medium",
        pendingApprovalCount: 2,
      },
      {
        assistantId: "asst_lit",
        displayName: "争议专员",
        roleId: "general_litigation",
        roleDisplayName: "主办诉讼",
        riskCeiling: "high",
        pendingApprovalCount: 1,
      },
      {
        assistantId: "asst_unknown",
        displayName: "asst_unknown",
        roleId: undefined,
        roleDisplayName: undefined,
        riskCeiling: undefined,
        pendingApprovalCount: 0,
      },
    ]);
  });

  it("dedupes participant ids", () => {
    const rows = buildRoleAssignmentRows({
      roster: { participantAssistantIds: ["asst_contract", " asst_contract "] },
      assistants,
      roles,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.assistantId).toBe("asst_contract");
  });
});
