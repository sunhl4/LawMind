import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  fitParentAdmission,
  loadSidecarResume,
  PARENT_ADMISSION_EXHAUSTED,
  PARENT_ADMISSION_NOTE,
  saveSidecarResume,
} from "./sidecar-resume.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("sidecar resume admission", () => {
  it("keeps the last reply whole and says so", () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-sidecar-"));
    dirs.push(workspaceDir);
    const last = `完整答复${"甲".repeat(20_000)}`;
    const earlier = `更早步骤${"乙".repeat(5_000)}`;
    const saved = saveSidecarResume(workspaceDir, {
      id: "w0123456789abcdef",
      sessionId: "session-1",
      section: "解除",
      role: "review",
      messages: [
        { role: "user", content: earlier },
        { role: "assistant", content: last },
      ],
      updatedAt: "2026-09-27T00:00:00.000Z",
    });
    expect(saved?.messages[1]?.content).toBe(last);
    expect(saved?.messages[0]?.content.endsWith("…")).toBe(true);
    expect(saved?.messages[0]?.content.length).toBeLessThan(earlier.length);
    const loaded = loadSidecarResume(workspaceDir, "session-1", "w0123456789abcdef");
    expect(loaded?.messages[1]?.content).toBe(last);
    expect(PARENT_ADMISSION_NOTE).not.toContain("全文");
    expect(PARENT_ADMISSION_EXHAUSTED).toContain("最后一条答复");
    expect(fitParentAdmission(last, 0)).toBe(PARENT_ADMISSION_EXHAUSTED);
    expect(fitParentAdmission(last, 80)).toContain("resume_id");
    expect(fitParentAdmission(last, 80)).not.toContain("全文");
  });
});
