import { describe, expect, it } from "vitest";
import {
  deriveRoleIdFromPresetKey,
  getRoleById,
  listRoles,
  roleAllowsDeliverable,
  taskRiskExceedsRoleCeiling,
} from "./role.js";

describe("core/role", () => {
  it("listRoles returns 6 built-in roles with required fields", () => {
    const roles = listRoles();
    expect(roles.length).toBeGreaterThanOrEqual(6);
    for (const r of roles) {
      expect(typeof r.roleId).toBe("string");
      expect(r.roleId.length).toBeGreaterThan(0);
      expect(typeof r.displayName).toBe("string");
      expect(typeof r.mission).toBe("string");
      expect(Array.isArray(r.allowedDeliverableTypes)).toBe(true);
      expect(r.allowedDeliverableTypes.length).toBeGreaterThan(0);
      expect(Array.isArray(r.memoryScope)).toBe(true);
      expect(["low", "medium", "high"]).toContain(r.riskCeiling);
      expect(Array.isArray(r.reviewChecklist)).toBe(true);
    }
  });

  it("getRoleById returns role by id and undefined for missing", () => {
    const someRole = listRoles()[0];
    expect(getRoleById(someRole.roleId)?.roleId).toBe(someRole.roleId);
    expect(getRoleById("__missing__")).toBeUndefined();
    expect(getRoleById(undefined)).toBeUndefined();
    expect(getRoleById("  ")).toBeUndefined();
  });

  it("deriveRoleIdFromPresetKey echoes existing preset id", () => {
    const someRole = listRoles()[0];
    expect(deriveRoleIdFromPresetKey(someRole.roleId)).toBe(someRole.roleId);
    expect(deriveRoleIdFromPresetKey("__missing__")).toBeUndefined();
    expect(deriveRoleIdFromPresetKey(undefined)).toBeUndefined();
  });

  it("taskRiskExceedsRoleCeiling respects risk order", () => {
    const lowRole = listRoles().find((r) => r.riskCeiling === "low");
    if (lowRole) {
      expect(taskRiskExceedsRoleCeiling("low", lowRole)).toBe(false);
      expect(taskRiskExceedsRoleCeiling("medium", lowRole)).toBe(true);
      expect(taskRiskExceedsRoleCeiling("high", lowRole)).toBe(true);
    }
    expect(taskRiskExceedsRoleCeiling("high", undefined)).toBe(false);
  });

  it("roleAllowsDeliverable reflects allowedDeliverableTypes", () => {
    const role = listRoles()[0];
    expect(roleAllowsDeliverable(role, role.allowedDeliverableTypes[0])).toBe(true);
    // role with missing kind should reject
    const otherKinds = (
      [
        "legal-memo",
        "contract-review",
        "demand-letter",
        "litigation-outline",
        "client-brief",
        "evidence-timeline",
        "general-document",
      ] as const
    ).filter((k) => !role.allowedDeliverableTypes.includes(k));
    if (otherKinds.length > 0) {
      expect(roleAllowsDeliverable(role, otherKinds[0])).toBe(false);
    }
    expect(roleAllowsDeliverable(undefined, "legal-memo")).toBe(true);
  });
});
