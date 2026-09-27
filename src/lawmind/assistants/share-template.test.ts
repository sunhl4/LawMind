import { describe, expect, it } from "vitest";
import { exportAssistantShare } from "./share-template.js";
import type { AssistantProfile } from "./types.js";

function profile(over: Partial<AssistantProfile> = {}): AssistantProfile {
  return {
    assistantId: "a1",
    displayName: "续签助手",
    introduction: "盯到期",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    reportsToAssistantId: "someone-else",
    ...over,
  };
}

describe("assistant share template", () => {
  it("exports the role only, and strips query strings", () => {
    const reviewed = exportAssistantShare(
      profile({
        introduction: "材料见 https://files.firm.example/a?token=secret",
        jobBrief: { prohibitions: "外发前必须问我" },
      }),
      false,
    );
    expect(reviewed.ok).toBe(true);
    expect(reviewed.template?.introduction).toBe("材料见 https://files.firm.example/a");
    expect(JSON.stringify(reviewed.template)).not.toContain("someone-else");
    expect(JSON.stringify(reviewed.template)).not.toContain("token=");
  });

  it("blocks secrets even if the lawyer confirms", () => {
    const reviewed = exportAssistantShare(
      profile({ customRoleInstructions: "密钥 sk-abcdefghijklmnop" }),
      true,
    );
    expect(reviewed.ok).toBe(false);
    expect(reviewed.blockers[0]).toContain("密钥");
    expect(reviewed.template).toBeUndefined();
  });

  it("asks before exporting a phone number", () => {
    const blocked = exportAssistantShare(
      profile({ jobBrief: { sources: "联系 13800138000" } }),
      false,
    );
    expect(blocked.ok).toBe(false);
    expect(blocked.warnings[0]).toContain("电话");
    const allowed = exportAssistantShare(
      profile({ jobBrief: { sources: "联系 13800138000" } }),
      true,
    );
    expect(allowed.ok).toBe(true);
  });

  it("includes this assistant's routines and still blocks a secret in them", () => {
    const withRoutine = exportAssistantShare(profile(), false, [
      {
        title: "每天看续签",
        schedule: "daily",
        expectedResult: "一份到期清单",
      },
    ]);
    expect(withRoutine.template?.routines?.[0]?.title).toBe("每天看续签");
    const secret = exportAssistantShare(profile(), true, [
      { title: "坏的", schedule: "daily", expectedResult: "密钥 sk-abcdefghijklmnop" },
    ]);
    expect(secret.ok).toBe(false);
  });
});
