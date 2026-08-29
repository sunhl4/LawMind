import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { summarizeToolResultForHistory } from "./tool-result-history.js";
import { shouldSpillToolResult } from "./tool-result-spill.js";

describe("tool-result-spill", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    dirs.length = 0;
  });

  it("spills research/mail/read and skips write/render/send", () => {
    expect(shouldSpillToolResult("research_task")).toBe(true);
    expect(shouldSpillToolResult("list_mail_inbox")).toBe(true);
    expect(shouldSpillToolResult("read_project_file")).toBe(true);
    expect(shouldSpillToolResult("analyze_document")).toBe(true);
    expect(shouldSpillToolResult("compare_documents")).toBe(true);
    expect(shouldSpillToolResult("write_document")).toBe(false);
    expect(shouldSpillToolResult("apply_surgical_edits")).toBe(false);
    expect(shouldSpillToolResult("render_document")).toBe(false);
    expect(shouldSpillToolResult("send_email")).toBe(false);
  });

  it("writes a session-scoped spill and attaches the path on truncate", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-spill-"));
    dirs.push(ws);
    const huge = { ok: true, text: "z".repeat(40_000) };
    const slim = summarizeToolResultForHistory(huge, {
      maxChars: 2_000,
      spill: {
        workspaceDir: ws,
        sessionId: "s1",
        callId: "call/1",
        toolName: "research_task",
      },
    }) as { truncated?: boolean; spillPath?: string; message?: string };
    expect(slim.truncated).toBe(true);
    expect(slim.spillPath).toBe("sessions/s1.spills/call_1.json");
    expect(slim.message).toContain("sessions/s1.spills/call_1.json");
    const abs = path.join(ws, slim.spillPath!);
    expect(fs.existsSync(abs)).toBe(true);
    const saved = JSON.parse(fs.readFileSync(abs, "utf8")) as { result: { text: string } };
    expect(saved.result.text.length).toBe(40_000);
  });
});
