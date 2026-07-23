import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyMemoryAdoptionWrite } from "./adoption-apply.js";
import { suggestMemoryAdoption } from "./adoption-service.js";
import { ensureLawyerProfileSkeleton } from "./lawyer-profile-learning.js";

describe("applyMemoryAdoptionWrite", () => {
  let ws: string;

  afterEach(() => {
    if (ws) {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it("writes case.progress to session-summary.md and CASE progress", async () => {
    ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-adopt-apply-"));
    fs.mkdirSync(path.join(ws, "audit"), { recursive: true });
    const rec = await suggestMemoryAdoption(
      ws,
      path.join(ws, "audit"),
      {
        scope: "matter",
        kind: "case.progress",
        targetId: "matter-a",
        payload: "### 对话压缩沉淀（2026-07-22）\n\n律师：本案管辖条款需单独列出。\n助手：已记录。",
        origin: "agent",
      },
      { autoAdopt: false },
    );
    const out = await applyMemoryAdoptionWrite(ws, rec);
    expect(out.written.some((p) => p.includes("session-summary.md"))).toBe(true);
    const summary = fs.readFileSync(
      path.join(ws, "cases", "matter-a", "session-summary.md"),
      "utf8",
    );
    expect(summary).toContain("管辖条款");
    const caseMd = fs.readFileSync(path.join(ws, "cases", "matter-a", "CASE.md"), "utf8");
    expect(caseMd).toContain("工作进展记录");
  });

  it("writes lawyer.profile_learning into LAWYER_PROFILE.md", async () => {
    ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-adopt-lawyer-"));
    fs.mkdirSync(path.join(ws, "audit"), { recursive: true });
    await ensureLawyerProfileSkeleton(ws);
    const rec = await suggestMemoryAdoption(
      ws,
      path.join(ws, "audit"),
      {
        scope: "lawyer",
        kind: "lawyer.profile_learning",
        targetId: "lawyer",
        payload: "对话压缩沉淀：以后请用正式书面语气。",
        origin: "agent",
      },
      { autoAdopt: false },
    );
    await applyMemoryAdoptionWrite(ws, rec);
    const profile = fs.readFileSync(path.join(ws, "LAWYER_PROFILE.md"), "utf8");
    expect(profile).toContain("正式书面语气");
  });
});
