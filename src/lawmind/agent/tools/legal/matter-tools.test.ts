import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readCaseFile } from "./matter-tools.js";

describe("read_case_file", () => {
  it("returns a default window instead of the full file", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-case-read-"));
    const matterId = "matter-window";
    fs.mkdirSync(path.join(ws, "cases", matterId), { recursive: true });
    const body = "案情".repeat(6000);
    fs.writeFileSync(path.join(ws, "cases", matterId, "CASE.md"), body, "utf8");
    const result = await readCaseFile.execute(
      { matter_id: matterId },
      { workspaceDir: ws, sessionId: "s", actorId: "t", matterId },
    );
    expect(result.ok).toBe(true);
    const data = result.data as { content: string; hasMore: boolean; totalChars: number };
    expect(data.totalChars).toBe(body.length);
    expect(data.content.length).toBeLessThan(body.length);
    expect(data.hasMore).toBe(true);
  });
});
