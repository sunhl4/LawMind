import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  appendTranscriptLines,
  delegationTranscriptPath,
  loadTranscriptForResume,
} from "./index.js";

describe("session-transcript delegation", () => {
  it("writes delegation transcript under sessions/delegations", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-tr-"));
    const delegationId = "del-1";
    appendTranscriptLines(
      ws,
      "sess-delegate",
      [
        {
          role: "user",
          content: "请审查合同",
          timestamp: new Date().toISOString(),
        },
      ],
      { delegationId },
    );
    const fp = delegationTranscriptPath(ws, delegationId);
    expect(fs.existsSync(fp)).toBe(true);
    const loaded = loadTranscriptForResume(ws, "sess-delegate");
    expect(loaded).toHaveLength(0);
    const raw = fs.readFileSync(fp, "utf8");
    expect(raw).toContain("请审查合同");
  });
});
