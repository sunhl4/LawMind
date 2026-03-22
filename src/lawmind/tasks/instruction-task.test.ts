import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deriveInstructionTitle, persistAgentInstructionTask, readTaskRecord } from "./index.js";

describe("deriveInstructionTitle", () => {
  it("returns placeholder for empty", () => {
    expect(deriveInstructionTitle("   \n")).toBe("（空指令）");
  });

  it("returns short text unchanged", () => {
    expect(deriveInstructionTitle("起草租赁合同")).toBe("起草租赁合同");
  });

  it("truncates long single line with ellipsis", () => {
    const s = "a".repeat(80);
    const t = deriveInstructionTitle(s, 56);
    expect(t.endsWith("…")).toBe(true);
    expect(t.length).toBeLessThanOrEqual(56);
  });

  it("joins multiline into one line before truncate", () => {
    const t = deriveInstructionTitle("第一行\n\n第二行很长" + "x".repeat(100), 40);
    expect(t).toContain("第一行");
    expect(t.endsWith("…")).toBe(true);
  });
});

describe("persistAgentInstructionTask", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-task-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("writes agent.instruction task record", () => {
    const rec = persistAgentInstructionTask(dir, {
      taskId: "turn-uuid-1",
      instruction: "请审查附件合同",
      sessionId: "sess-1",
      matterId: "m-1",
      assistantId: "default",
    });
    expect(rec.kind).toBe("agent.instruction");
    expect(rec.status).toBe("completed");
    expect(rec.title).toBe("请审查附件合同");
    expect(rec.sessionId).toBe("sess-1");
    expect(rec.sourceTurnId).toBe("turn-uuid-1");

    const loaded = readTaskRecord(dir, "turn-uuid-1");
    expect(loaded?.summary).toBe("请审查附件合同");
  });
});
