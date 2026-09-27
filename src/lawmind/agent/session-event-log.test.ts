import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resetLiveTurnProgressStore } from "./live-turn-progress.js";
import {
  appendSessionEvent,
  getLiveTurnProgressOrReplay,
  readSessionEvents,
  readSessionEventsForReplay,
  SESSION_EVENT_REPLAY_TAIL_BYTES,
  sessionEventsPath,
  shouldPersistSessionEvent,
} from "./session-event-log.js";

describe("session-event-log", () => {
  const dirs: string[] = [];
  afterEach(() => {
    resetLiveTurnProgressStore();
    for (const dir of dirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    dirs.length = 0;
  });

  it("skips token deltas and appends structural events", () => {
    expect(shouldPersistSessionEvent({ type: "delta", roundIndex: 1, text: "x" })).toBe(false);
    expect(shouldPersistSessionEvent({ type: "turn_begin" })).toBe(true);

    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-elog-"));
    dirs.push(ws);
    appendSessionEvent(ws, "sid", { type: "turn_begin" }, { turnId: "t1" });
    appendSessionEvent(
      ws,
      "sid",
      { type: "delta", roundIndex: 1, text: "hello" },
      { turnId: "t1" },
    );
    appendSessionEvent(
      ws,
      "sid",
      {
        type: "tool_call_start",
        roundIndex: 1,
        toolCallId: "tc1",
        toolName: "list_mail_inbox",
        args: { matter_id: "m1" },
      },
      { turnId: "t1" },
    );
    appendSessionEvent(
      ws,
      "sid",
      {
        type: "tool_call_end",
        roundIndex: 1,
        toolCallId: "tc1",
        toolName: "list_mail_inbox",
        ok: true,
      },
      { turnId: "t1" },
    );
    const rows = readSessionEvents(ws, "sid");
    expect(rows.map((r) => r.event.type)).toEqual([
      "turn_begin",
      "tool_call_start",
      "tool_call_end",
    ]);
  });

  it("replays last turn into live-turn when memory is empty", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-elog-replay-"));
    dirs.push(ws);
    appendSessionEvent(ws, "sid", { type: "turn_begin" });
    appendSessionEvent(ws, "sid", { type: "round_start", roundIndex: 1 });
    appendSessionEvent(ws, "sid", {
      type: "tool_call_start",
      roundIndex: 1,
      toolCallId: "tc1",
      toolName: "write_document",
      args: { path: "a.md" },
    });
    appendSessionEvent(ws, "sid", {
      type: "tool_call_end",
      roundIndex: 1,
      toolCallId: "tc1",
      toolName: "write_document",
      ok: true,
      resultPreview: "已写入 a.md",
    });
    appendSessionEvent(ws, "sid", { type: "final", status: "completed", reply: "ok" });

    const progress = getLiveTurnProgressOrReplay(ws, "sid");
    expect(progress?.sessionId).toBe("sid");
    expect(progress?.status).toBe("completed");
    expect(progress?.steps.some((s) => s.kind === "tool" && s.label.includes("审定文书"))).toBe(
      true,
    );
  });

  it("drops a torn tail before the next append so both records stay readable", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-elog-torn-"));
    dirs.push(ws);
    appendSessionEvent(ws, "sid", { type: "turn_begin" }, { turnId: "t1" });
    const filePath = sessionEventsPath(ws, "sid");
    fs.appendFileSync(filePath, '{"t":"2026-01-01T00:00:00.000Z","event":{"type":"rou');
    appendSessionEvent(ws, "sid", { type: "round_start", roundIndex: 1 }, { turnId: "t1" });
    expect(readSessionEvents(ws, "sid").map((r) => r.event.type)).toEqual([
      "turn_begin",
      "round_start",
    ]);
  });

  it("keeps earlier records when the torn tail exceeds the repair window", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-elog-giant-"));
    dirs.push(ws);
    appendSessionEvent(ws, "sid", { type: "turn_begin" }, { turnId: "t1" });
    const filePath = sessionEventsPath(ws, "sid");
    // 撕尾是一条超过 1MB 修复窗口的巨行：窗口内找不到换行，修复必须放弃而不是清空整档。
    fs.appendFileSync(
      filePath,
      `{"t":"2026-01-01T00:00:00.000Z","pad":"${"x".repeat(1024 * 1024 + 10)}`,
    );
    appendSessionEvent(ws, "sid", { type: "round_start", roundIndex: 1 }, { turnId: "t1" });
    const types = readSessionEvents(ws, "sid").map((r) => r.event.type);
    expect(types).toContain("turn_begin");
  });

  it("replays from the tail when the log is larger than one read", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-elog-tail-"));
    dirs.push(ws);
    const filePath = sessionEventsPath(ws, "sid");
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const filler = `${JSON.stringify({
      t: "2026-01-01T00:00:00.000Z",
      event: { type: "turn_begin" },
    })}\n`;
    const chunks = Math.ceil((SESSION_EVENT_REPLAY_TAIL_BYTES + filler.length) / filler.length);
    fs.writeFileSync(filePath, filler.repeat(chunks));
    appendSessionEvent(ws, "sid", { type: "turn_begin" }, { turnId: "latest" });
    appendSessionEvent(ws, "sid", { type: "final", status: "completed", reply: "tail" });
    const replayed = readSessionEventsForReplay(ws, "sid");
    expect(replayed.at(-1)?.event).toMatchObject({ type: "final", reply: "tail" });
    expect(replayed.length).toBeLessThan(chunks);
    const progress = getLiveTurnProgressOrReplay(ws, "sid");
    expect(progress?.status).toBe("completed");
  });
});
