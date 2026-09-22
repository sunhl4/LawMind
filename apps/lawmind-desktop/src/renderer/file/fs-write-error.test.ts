import { describe, expect, it } from "vitest";
import { describeFsWriteFailure, fsWriteFailureKind } from "./fs-write-error";

/**
 * 判定必须建立在 code 上：引擎改一句提示语不应该让「只读位置」这类分支失效。
 */
describe("fs-write-error", () => {
  it("classifies by code, not by copy", () => {
    // 故意给一句完全不同的文案：分类结果不能受影响。
    expect(fsWriteFailureKind({ code: "root_not_writable", error: "随便什么话" })).toBe(
      "root_not_writable",
    );
    expect(fsWriteFailureKind({ code: "protected_workspace_path" })).toBe(
      "protected_workspace_path",
    );
    expect(fsWriteFailureKind({ error: "文件已被外部修改" })).toBe("unknown");
  });

  it("treats conflict as its own kind", () => {
    expect(fsWriteFailureKind({ conflict: true, code: "root_not_writable" })).toBe("conflict");
  });

  it("prefers the engine's wording and only falls back when it is missing", () => {
    expect(describeFsWriteFailure({ code: "root_not_writable", error: "引擎原文" })).toBe(
      "引擎原文",
    );
    expect(describeFsWriteFailure({ code: "root_not_writable" })).toMatch(/只读/);
    expect(describeFsWriteFailure({ conflict: true, error: "引擎原文" })).toMatch(/外部修改/);
    expect(describeFsWriteFailure(undefined)).toBe("保存失败");
  });
});
