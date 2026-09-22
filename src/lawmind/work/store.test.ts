import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createLawyerWork,
  findLawyerWork,
  listLawyerWorks,
  mergeWorkStatus,
  upsertLawyerWork,
} from "./store.js";

const dirs: string[] = [];

function tmpWs(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-work-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  dirs.length = 0;
});

describe("LawyerWork store", () => {
  it("creates and lists works under lawmind/works", () => {
    const ws = tmpWs();
    const work = createLawyerWork(ws, {
      title: "审查供货合同",
      goal: "先对责任上限",
      source: "chat",
      sessionId: "sess-1",
    });
    expect(work.workId.startsWith("w_")).toBe(true);
    expect(fs.existsSync(path.join(ws, "lawmind", "works", `${work.workId}.json`))).toBe(true);
    expect(listLawyerWorks(ws)).toHaveLength(1);
    expect(findLawyerWork(ws, { sessionId: "sess-1" })?.workId).toBe(work.workId);
  });

  it("upserts the same session into one work and promotes status", () => {
    const ws = tmpWs();
    const first = upsertLawyerWork(ws, {
      sessionId: "s-a",
      title: "本件",
      goal: "审查合同",
      status: "running",
      source: "chat",
    });
    const second = upsertLawyerWork(ws, {
      sessionId: "s-a",
      taskId: "task-1",
      draftId: "task-1",
      status: "needs_signoff",
    });
    expect(second.workId).toBe(first.workId);
    expect(second.taskId).toBe("task-1");
    expect(second.status).toBe("needs_signoff");
    expect(listLawyerWorks(ws)).toHaveLength(1);
  });

  it("does not downgrade a terminal status", () => {
    expect(mergeWorkStatus("done", "running")).toBe("done");
    expect(mergeWorkStatus("running", "needs_signoff")).toBe("needs_signoff");
    expect(mergeWorkStatus("needs_signoff", "running")).toBe("needs_signoff");
  });
});
