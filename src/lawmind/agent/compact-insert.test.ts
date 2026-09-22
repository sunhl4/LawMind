import { describe, expect, it } from "vitest";
import {
  findLastRealUserIndex,
  insertBeforeLastUserMessage,
  isCompactSyntheticUserMessage,
} from "./compact-insert.js";
import { COMPACT_REINJECTION_MARKER } from "./compact-reinjection.js";
import type { AgentMessage } from "./types.js";

function msg(role: AgentMessage["role"], content: string): AgentMessage {
  return { role, content, timestamp: "t" };
}

describe("compact-insert", () => {
  it("skips synthetic compact notes when finding the last real user", () => {
    expect(isCompactSyntheticUserMessage(`## ${COMPACT_REINJECTION_MARKER}`)).toBe(true);
    expect(isCompactSyntheticUserMessage("【压缩前对话蒸馏】丢弃 3 条")).toBe(true);
    expect(isCompactSyntheticUserMessage("请继续改违约责任")).toBe(false);

    const history = [
      msg("system", "sys"),
      msg("user", "【压缩前对话蒸馏】旧摘要"),
      msg("user", "请审查合同"),
    ];
    expect(findLastRealUserIndex(history)).toBe(2);
  });

  it("inserts immediately before the last real user", () => {
    const history = [
      msg("system", "sys"),
      msg("user", "旧问"),
      msg("assistant", "旧答"),
      msg("user", "请继续"),
    ];
    const next = insertBeforeLastUserMessage(history, [msg("user", "【压缩前对话蒸馏】要点")]);
    expect(next.map((m) => m.content)).toEqual([
      "sys",
      "旧问",
      "旧答",
      "【压缩前对话蒸馏】要点",
      "请继续",
    ]);
  });

  it("appends when there is no real user yet", () => {
    const history = [msg("system", "sys")];
    const next = insertBeforeLastUserMessage(history, [msg("user", "【压缩后上下文锚点】")]);
    expect(next[next.length - 1]?.content).toContain("压缩后上下文锚点");
  });
});
