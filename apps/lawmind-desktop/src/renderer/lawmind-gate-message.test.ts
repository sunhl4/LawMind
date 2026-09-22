/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { formatLawyerGateChip, parseLawyerGateMessage } from "./lawmind-gate-message";

describe("lawmind-gate-message", () => {
  it("parses approve resume protocol", () => {
    const gate = parseLawyerGateMessage("【律师已批准】请继续完成「写回草稿」。");
    expect(gate).toEqual({ kind: "approved", toolLabel: "写回草稿" });
    expect(formatLawyerGateChip(gate!)).toBe("已批准继续 「写回草稿」");
  });

  it("parses edited approve", () => {
    const gate = parseLawyerGateMessage(
      "【律师已修改参数并批准】请继续完成「生成草稿」，使用律师确认后的参数。",
    );
    expect(gate?.kind).toBe("edited");
    expect(gate?.toolLabel).toBe("生成草稿");
  });

  it("returns null for normal user text", () => {
    expect(parseLawyerGateMessage("请帮我起草律师函")).toBeNull();
  });
});
