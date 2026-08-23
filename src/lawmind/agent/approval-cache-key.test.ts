import { describe, expect, it } from "vitest";
import {
  ARGS_BOUND_APPROVAL_TOOLS,
  approvalArgsMatch,
  buildApprovalCacheKey,
  hashToolApprovalArgs,
  resolvePreApprovalInjection,
} from "./approval-cache-key.js";

describe("approval-cache-key", () => {
  it("hashes apply_surgical_edits by task + hunks, not commentary", () => {
    const a = hashToolApprovalArgs("apply_surgical_edits", {
      task_id: "t1",
      edits: [{ find: "甲方所在地人民法院", replace: "上海仲裁委员会", note: "n1" }],
      summary: "old",
      craft_check: { coverage: "ok" },
      __approved: true,
    });
    const b = hashToolApprovalArgs("apply_surgical_edits", {
      task_id: "t1",
      edits: [{ find: "甲方所在地人民法院", replace: "上海仲裁委员会" }],
      summary: "new commentary",
    });
    expect(a).toBe(b);
    expect(
      hashToolApprovalArgs("apply_surgical_edits", {
        task_id: "t1",
        edits: [{ find: "甲方所在地人民法院", replace: "北京仲裁委员会" }],
      }),
    ).not.toBe(a);
    expect(
      hashToolApprovalArgs("apply_surgical_edits", {
        task_id: "t2",
        edits: [{ find: "甲方所在地人民法院", replace: "上海仲裁委员会" }],
      }),
    ).not.toBe(a);
  });

  it("stableJson ignores key order for generic tools", () => {
    expect(hashToolApprovalArgs("render_tracked_draft", { path: "a", task_id: "t" })).toBe(
      hashToolApprovalArgs("render_tracked_draft", { task_id: "t", path: "a" }),
    );
  });

  it("buildApprovalCacheKey includes matterId", () => {
    const args = { edits: [{ find: "a", replace: "b" }] };
    expect(
      buildApprovalCacheKey({ toolName: "apply_surgical_edits", matterId: "m1", args }),
    ).toEqual({
      tool: "apply_surgical_edits",
      matterId: "m1",
      argsHash: hashToolApprovalArgs("apply_surgical_edits", args),
    });
  });

  it("template name-only does not approve apply_surgical_edits", () => {
    expect(ARGS_BOUND_APPROVAL_TOOLS.has("apply_surgical_edits")).toBe(true);
    expect(
      resolvePreApprovalInjection({
        toolName: "apply_surgical_edits",
        modelArgs: { edits: [{ find: "a", replace: "b" }] },
        preApproveToolNames: ["apply_surgical_edits"],
      }).inject,
    ).toBe(false);
  });

  it("template approves apply_surgical_edits only when hunks match", () => {
    const hunks = { task_id: "t1", edits: [{ find: "a", replace: "b" }] };
    expect(
      resolvePreApprovalInjection({
        toolName: "apply_surgical_edits",
        modelArgs: hunks,
        preApproveToolNames: ["apply_surgical_edits"],
        preApproveToolArgs: hunks,
      }).inject,
    ).toBe(true);
    expect(
      resolvePreApprovalInjection({
        toolName: "apply_surgical_edits",
        modelArgs: { task_id: "t1", edits: [{ find: "a", replace: "OTHER" }] },
        preApproveToolNames: ["apply_surgical_edits"],
        preApproveToolArgs: hunks,
      }).inject,
    ).toBe(false);
    expect(approvalArgsMatch("apply_surgical_edits", hunks, { ...hunks, summary: "x" })).toBe(true);
  });

  it("template still name-approves non-hunk tools", () => {
    expect(
      resolvePreApprovalInjection({
        toolName: "render_tracked_draft",
        modelArgs: {},
        preApproveToolNames: ["render_tracked_draft"],
      }).inject,
    ).toBe(true);
  });

  it("resume injects and merges lawyer args", () => {
    const r = resolvePreApprovalInjection({
      toolName: "apply_surgical_edits",
      modelArgs: { edits: [{ find: "model", replace: "x" }] },
      preApproveToolName: "apply_surgical_edits",
      preApproveToolArgs: { edits: [{ find: "lawyer", replace: "y" }] },
    });
    expect(r.inject).toBe(true);
    expect(r.mergedArgs).toEqual({ edits: [{ find: "lawyer", replace: "y" }] });
  });
});
