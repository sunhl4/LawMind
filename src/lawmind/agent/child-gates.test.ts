import { describe, expect, it } from "vitest";
import {
  inheritChildGates,
  intersectAllowedToolNames,
  parentGatesFromContext,
  restrictPermissionMode,
} from "./child-gates.js";

describe("child-gates", () => {
  it("restrictPermissionMode never loosens the parent", () => {
    expect(restrictPermissionMode("readonly", "standard")).toBe("readonly");
    expect(restrictPermissionMode("research", "strict")).toBe("research");
    expect(restrictPermissionMode("strict", "standard")).toBe("strict");
    expect(restrictPermissionMode("standard", "strict")).toBe("strict");
  });

  it("intersectAllowedToolNames does not widen the parent list", () => {
    expect(
      intersectAllowedToolNames(["analyze_document"], ["analyze_document", "write_document"]),
    ).toEqual(["analyze_document"]);
    expect(intersectAllowedToolNames(["analyze_document"], undefined)).toEqual([
      "analyze_document",
    ]);
    expect(intersectAllowedToolNames(undefined, ["write_document"])).toEqual(["write_document"]);
  });

  it("inheritChildGates copies matterId and forces parent sandbox on", () => {
    const gates = inheritChildGates({
      parent: parentGatesFromContext({
        permissionMode: "readonly",
        matterId: "m-parent",
        allowedToolNames: ["analyze_document"],
        toolSandboxEnabled: true,
      }),
      childPermissionMode: "standard",
      childAllowedToolNames: ["analyze_document", "write_document"],
      childToolSandboxEnabled: false,
    });
    expect(gates.permissionMode).toBe("readonly");
    expect(gates.matterId).toBe("m-parent");
    expect(gates.allowedToolNames).toEqual(["analyze_document"]);
    expect(gates.toolSandboxEnabled).toBe(true);
  });
});
