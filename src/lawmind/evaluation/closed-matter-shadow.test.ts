import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadWorkspaceEngineShadowFixtures,
  loadWorkspaceShadowFixtures,
  runWorkspaceEngineShadowReplay,
  runWorkspaceShadowReplay,
} from "./closed-matter-shadow.js";

const dirs: string[] = [];

beforeEach(() => {
  // 回放测试离线确定：屏蔽真模型/检索 env。
  for (const key of [
    "LAWMIND_SHADOW_REAL_MODEL",
    "LAWMIND_AGENT_BASE_URL",
    "LAWMIND_AGENT_API_KEY",
    "LAWMIND_AGENT_MODEL",
    "LAWMIND_QWEN_BASE_URL",
    "LAWMIND_QWEN_API_KEY",
    "LAWMIND_QWEN_MODEL",
    "QWEN_BASE_URL",
    "QWEN_API_KEY",
    "QWEN_MODEL",
  ]) {
    vi.stubEnv(key, "");
  }
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of dirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  dirs.length = 0;
});

describe("closed-matter shadow", () => {
  it("falls back to synthetic fixtures when the workspace has none", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-sh-"));
    dirs.push(ws);
    expect(loadWorkspaceShadowFixtures(ws)).toEqual([]);
    const report = runWorkspaceShadowReplay(ws);
    expect(report.summary.cases).toBeGreaterThanOrEqual(3);
  });

  it("merges a dropped workspace fixture", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-sh-x-"));
    dirs.push(ws);
    fs.mkdirSync(path.join(ws, "lawmind", "shadow"), { recursive: true });
    fs.writeFileSync(
      path.join(ws, "lawmind", "shadow", "matter-1.json"),
      JSON.stringify({
        id: "ws-closed-1",
        instruction: "审查保密",
        lawyerFinalText: "保密三年。",
        engineDraftText: "保密三年。",
      }),
    );
    const extras = loadWorkspaceShadowFixtures(ws);
    expect(extras).toHaveLength(1);
    expect(runWorkspaceShadowReplay(ws).results.some((r) => r.id === "ws-closed-1")).toBe(true);
  });

  it("routes dropped closed matters through the same engine-scripted-model path", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-sh-e-"));
    dirs.push(ws);
    fs.mkdirSync(path.join(ws, "lawmind", "shadow"), { recursive: true });
    fs.writeFileSync(
      path.join(ws, "lawmind", "shadow", "matter-1.json"),
      JSON.stringify({
        id: "ws-closed-engine",
        instruction: "请审查买卖合同定金条款。",
        lawyerFinalText: "第一条 定金为本合同标的额的百分之十。",
        engineDraftText: "第一条 定金为本合同标的额的 30%。",
        plantedDefectRuleIds: ["statutory.deposit_cap"],
      }),
    );
    // 投放的 engineDraftText 自动转为默认 cassette（模型脚本）。
    const fixtures = loadWorkspaceEngineShadowFixtures(ws);
    expect(fixtures).toHaveLength(1);
    expect(fixtures[0]?.modelScript?.map((s) => s.tool)).toEqual([
      "draft_document",
      "update_draft",
    ]);

    const report = await runWorkspaceEngineShadowReplay(ws);
    expect(report.summary.draftSource).toBe("engine-scripted-model");
    const row = report.results.find((r) => r.id === "ws-closed-engine");
    expect(row?.status).toBe("ok");
    expect(row?.toolsCalled).toContain("draft_document");
    expect(row?.toolsCalled).toContain("update_draft");
    expect(row?.plantedDefectRecall).toBe(1);
    expect(row?.engineDraftText).toContain("30%");
  }, 60_000);

  it("marks drops without draft text or script as no-script (real-model mode only)", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-sh-n-"));
    dirs.push(ws);
    fs.mkdirSync(path.join(ws, "lawmind", "shadow"), { recursive: true });
    fs.writeFileSync(
      path.join(ws, "lawmind", "shadow", "matter-2.json"),
      JSON.stringify({
        id: "ws-closed-no-draft",
        instruction: "请审查租赁合同。",
        lawyerFinalText: "房屋租赁合同。租期一年。",
      }),
    );
    const report = await runWorkspaceEngineShadowReplay(ws);
    expect(report.results[0]?.status).toBe("no-script");
    expect(report.summary.skipped).toBe(1);
  }, 30_000);
});
