import { describe, expect, it } from "vitest";
import {
  inheritChildGates,
  intersectAllowedToolNames,
  parentGatesFromContext,
  resolveChildToolCallBudget,
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

  it("resolveChildToolCallBudget caps the child at the parent's remaining shard", () => {
    // 父剩余 5、子配置 40 → 分片 5（只缩不扩）。
    expect(resolveChildToolCallBudget({ parentRemaining: 5, childConfigured: 40 })).toBe(5);
    // 父剩余 50、子配置 8 → 子自身更紧，保持 8。
    expect(resolveChildToolCallBudget({ parentRemaining: 50, childConfigured: 8 })).toBe(8);
    // 子未配置 → 直接给父剩余分片。
    expect(resolveChildToolCallBudget({ parentRemaining: 7 })).toBe(7);
    // 父预算见底 → 下限 1：子可文字回复，工具调用随即被 budget 中间件熔断。
    expect(resolveChildToolCallBudget({ parentRemaining: 0, childConfigured: 40 })).toBe(1);
    // 非委派上下文（无父剩余）→ 子配置不变。
    expect(resolveChildToolCallBudget({ childConfigured: 12 })).toBe(12);
    expect(resolveChildToolCallBudget({})).toBeUndefined();
  });

  it("inheritChildGates carries the parent's remaining budget snapshot", () => {
    const gates = inheritChildGates({
      parent: parentGatesFromContext({
        permissionMode: "standard",
        remainingToolCallBudget: 9,
      }),
      childPermissionMode: "standard",
    });
    expect(gates.remainingToolCallBudget).toBe(9);
    // 未带预算的父上下文不产生分片。
    const noBudget = inheritChildGates({
      parent: parentGatesFromContext({ permissionMode: "standard" }),
      childPermissionMode: "standard",
    });
    expect(noBudget.remainingToolCallBudget).toBeUndefined();
  });
});
