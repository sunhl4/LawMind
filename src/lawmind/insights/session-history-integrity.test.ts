import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { appendTranscriptLines, transcriptPath } from "../adapters/session-transcript/index.js";
import {
  findOrphanToolResultIds,
  findUnpairedToolCallIds,
} from "../agent/session-tool-call-pairing.js";
import { createSession, loadSession, saveSession } from "../agent/session.js";
import type { AgentMessage, AgentSession } from "../agent/types.js";
import {
  repairSessionHistoryIntegrity,
  scanSessionHistoryIntegrity,
} from "./session-history-integrity.js";

function tmpDir(): string {
  const dir = path.join(
    process.cwd(),
    "tmp",
    `lawmind-integrity-test-${Date.now()}-${Math.random()}`,
  );
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function orphanResult(): AgentMessage {
  return {
    role: "tool",
    content: JSON.stringify({ ok: true }),
    timestamp: "t2",
    toolCallResponses: [{ toolCallId: "c-lost", name: "search_workspace", result: { ok: true } }],
  };
}

function danglingCall(): AgentMessage {
  return {
    role: "assistant",
    content: "",
    timestamp: "t3",
    toolCalls: [
      { id: "c-open-1", name: "search_statute", arguments: {} },
      { id: "c-open-2", name: "search_case_law", arguments: {} },
    ],
  };
}

/**
 * 中段损坏：尾部是一条普通 assistant，因此落盘兜底不会顺手修掉它 ——
 * 这正是旧版本压缩留下的、已经躺在磁盘上的历史形状。
 */
function corruptHistory(): AgentMessage[] {
  return [
    { role: "user", content: "先看材料", timestamp: "t1" },
    orphanResult(),
    danglingCall(),
    { role: "user", content: "换个问题", timestamp: "t4" },
    { role: "assistant", content: "好的。", timestamp: "t5" },
  ];
}

function seed(ws: string, history: AgentMessage[]): AgentSession {
  const session = createSession({ workspaceDir: ws, actorId: "lawyer" });
  session.conversationHistory.push(...history);
  saveSession(ws, session);
  return session;
}

describe("scanSessionHistoryIntegrity", () => {
  it("reports a clean workspace as ok", () => {
    const ws = tmpDir();
    const session = createSession({ workspaceDir: ws, actorId: "lawyer" });
    session.conversationHistory.push({ role: "user", content: "hi", timestamp: "t1" });
    saveSession(ws, session);

    const report = scanSessionHistoryIntegrity(ws);
    expect(report.ok).toBe(true);
    expect(report.corruptSessionCount).toBe(0);
    expect(report.scannedSessions).toBeGreaterThanOrEqual(1);
  });

  it("counts orphan results and dangling calls separately", () => {
    const ws = tmpDir();
    seed(ws, corruptHistory());

    const report = scanSessionHistoryIntegrity(ws);
    expect(report.ok).toBe(false);
    expect(report.corruptSessionCount).toBe(1);
    expect(report.orphanToolResultCount).toBe(1);
    expect(report.danglingToolCallCount).toBe(2);
    expect(report.issues[0]?.orphanToolResultIds).toEqual(["c-lost"]);
  });

  it("does not persist a half-batch tail in the first place", () => {
    const ws = tmpDir();
    // 尾部是未闭合的工具组：落盘时必须被补成占位，磁盘上不留半批。
    seed(ws, [orphanResult(), danglingCall()]);
    expect(scanSessionHistoryIntegrity(ws).ok).toBe(true);
  });

  it("respects the scan limit", () => {
    const ws = tmpDir();
    seed(ws, [orphanResult()]);
    const report = scanSessionHistoryIntegrity(ws, { maxSessions: 1 });
    expect(report.scannedSessions).toBe(1);
  });
});

describe("repairSessionHistoryIntegrity", () => {
  it("rewrites session.json and transcript.jsonl into a sendable shape", () => {
    const ws = tmpDir();
    const history = corruptHistory();
    const session = seed(ws, history);
    // 落盘一份坏 transcript（resume 路径会读它）。
    appendTranscriptLines(ws, session.sessionId, history);

    const result = repairSessionHistoryIntegrity(ws);
    expect(result.repairedSessionIds).toContain(session.sessionId);
    expect(result.repairedTranscriptIds).toContain(session.sessionId);

    const persisted = loadSession(ws, session.sessionId);
    expect(persisted).toBeTruthy();
    const repaired = persisted!.conversationHistory;
    expect(findOrphanToolResultIds(repaired)).toEqual([]);
    expect(findUnpairedToolCallIds(repaired)).toEqual([]);

    const transcript = fs.readFileSync(transcriptPath(ws, session.sessionId), "utf8");
    expect(transcript).not.toContain("c-lost");
    // 悬空调用被补成占位，resume 时同样可送出。
    expect(transcript).toContain("c-open-1");
    expect(transcript).toContain("已取消");

    // 幂等：再修一次不再报告改动。
    const second = repairSessionHistoryIntegrity(ws);
    expect(second.repairedSessionIds).toEqual([]);
    expect(second.repairedTranscriptIds).toEqual([]);
    expect(scanSessionHistoryIntegrity(ws).ok).toBe(true);
  });
});
