import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  claimPendingFollowup,
  peekPendingFollowup,
  queuePendingFollowup,
} from "./session-context-followup.js";

describe("session-context-followup", () => {
  it("queues and claims notes without mixing with empty peeks", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-followup-"));
    const sessionId = "s-follow";
    expect(peekPendingFollowup(ws, sessionId)).toEqual([]);
    const q1 = queuePendingFollowup(ws, sessionId, "下一轮请导出 Word");
    expect(q1.queued).toBe(1);
    expect(q1.pendingCount).toBe(1);
    queuePendingFollowup(ws, sessionId, "并附上审查意见");
    expect(peekPendingFollowup(ws, sessionId)).toHaveLength(2);
    const claimed = claimPendingFollowup(ws, sessionId);
    expect(claimed).toEqual(["下一轮请导出 Word", "并附上审查意见"]);
    expect(peekPendingFollowup(ws, sessionId)).toEqual([]);
    expect(claimPendingFollowup(ws, sessionId)).toEqual([]);
  });
});
