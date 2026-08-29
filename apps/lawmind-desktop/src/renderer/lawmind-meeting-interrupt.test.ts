import { describe, expect, it } from "vitest";
import {
  deliberationStateAfterModelError,
  isAbortedMeetingReply,
} from "./lawmind-meeting-interrupt";

describe("isAbortedMeetingReply", () => {
  it("matches stop copy from turn-orchestrator", () => {
    expect(isAbortedMeetingReply("已停止生成。")).toBe(true);
    expect(isAbortedMeetingReply("已停止生成")).toBe(true);
    expect(isAbortedMeetingReply("  已停止生成。  ")).toBe(true);
  });

  it("rejects normal replies", () => {
    expect(isAbortedMeetingReply("结论如下…")).toBe(false);
    expect(isAbortedMeetingReply("")).toBe(false);
    expect(isAbortedMeetingReply(null)).toBe(false);
  });
});

describe("deliberationStateAfterModelError", () => {
  it("exits running loop into paused non-busy so lawyer can end", () => {
    const s = deliberationStateAfterModelError();
    expect(s.phase).toBe("paused");
    expect(s.busy).toBe(false);
    expect(s.statusLabel).toContain("出错已暂停");
  });
});
