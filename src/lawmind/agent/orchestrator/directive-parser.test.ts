/**
 * Directive parser — heuristic + workflow build.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildWorkflowFromDirective,
  parseAndBuildWorkflow,
  parseDirectiveHeuristic,
  parseDirectiveWithModel,
} from "./directive-parser.js";

const dirs: string[] = [];

function tmpWorkspace(): string {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-directive-"));
  dirs.push(ws);
  const now = new Date().toISOString();
  fs.writeFileSync(
    path.join(ws, "assistants.json"),
    JSON.stringify(
      [
        {
          assistantId: "asst_contract",
          displayName: "合同审查助手",
          introduction: "审合同",
          roleId: "contract-reviewer",
          presetKey: "contract",
          createdAt: now,
          updatedAt: now,
        },
        {
          assistantId: "asst_litigation",
          displayName: "诉讼策略助手",
          introduction: "诉讼",
          roleId: "litigation",
          presetKey: "litigation",
          createdAt: now,
          updatedAt: now,
        },
      ],
      null,
      2,
    ),
    "utf8",
  );
  return ws;
}

afterEach(() => {
  for (const d of dirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

describe("directive-parser", () => {
  it("parseDirectiveHeuristic sequential pattern", () => {
    const ws = tmpWorkspace();
    const parsed = parseDirectiveHeuristic(
      "让合同审查助手检查这份合同，然后让诉讼策略助手评估风险",
      ws,
    );
    expect(parsed?.steps).toHaveLength(2);
    expect(parsed?.steps[1]?.dependsOnHints.length).toBeGreaterThan(0);
  });

  it("parseDirectiveHeuristic parallel pattern", () => {
    const ws = tmpWorkspace();
    const parsed = parseDirectiveHeuristic("让合同审查助手审条款，同时让诉讼策略助手查判例", ws);
    expect(parsed?.steps).toHaveLength(2);
    expect(parsed?.steps[0]?.dependsOnHints).toEqual([]);
    expect(parsed?.steps[1]?.dependsOnHints).toEqual([]);
  });

  it("parseDirectiveHeuristic single delegation", () => {
    const ws = tmpWorkspace();
    const parsed = parseDirectiveHeuristic("请合同审查助手完成初审", ws);
    expect(parsed?.steps).toHaveLength(1);
    expect(parsed?.steps[0]?.task).toContain("初审");
  });

  it("parseDirectiveHeuristic returns undefined for unparseable text", () => {
    const ws = tmpWorkspace();
    expect(parseDirectiveHeuristic("随便一句话", ws)).toBeUndefined();
  });

  it("buildWorkflowFromDirective resolves assignee hints", () => {
    const ws = tmpWorkspace();
    const parsed = parseDirectiveHeuristic("请合同审查助手完成初审", ws);
    expect(parsed).toBeTruthy();
    const wf = buildWorkflowFromDirective(parsed!, ws, "lawyer:test");
    expect(wf.steps).toHaveLength(1);
    expect(wf.steps[0]?.assignee).toBe("asst_contract");
    expect(wf.status).toBe("draft");
    expect(wf.createdBy).toBe("lawyer:test");
  });

  it("parseDirectiveWithModel returns parsed JSON from model", async () => {
    const ws = tmpWorkspace();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  name: "测试流",
                  description: "desc",
                  steps: [{ assigneeHint: "asst_contract", task: "审合同", dependsOnHints: [] }],
                }),
              },
            },
          ],
        }),
      ),
    );
    const parsed = await parseDirectiveWithModel(
      "审合同",
      {
        model: "test-model",
        apiKey: "k",
        baseUrl: "https://api.example/v1",
        temperature: 0.2,
        maxTokens: 1024,
        contextTokens: 8192,
      },
      ws,
    );
    expect(parsed?.name).toBe("测试流");
    expect(parsed?.steps).toHaveLength(1);
    vi.unstubAllGlobals();
  });

  it("parseDirectiveWithModel returns undefined on HTTP error", async () => {
    const ws = tmpWorkspace();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("err", { status: 500 })),
    );
    const parsed = await parseDirectiveWithModel(
      "x",
      {
        model: "m",
        apiKey: "k",
        baseUrl: "https://api.example/v1",
      },
      ws,
    );
    expect(parsed).toBeUndefined();
    vi.unstubAllGlobals();
  });

  it("parseAndBuildWorkflow falls back to heuristic", async () => {
    const ws = tmpWorkspace();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("err", { status: 500 })),
    );
    const wf = await parseAndBuildWorkflow({
      directive: "请合同审查助手完成初审",
      baseConfig: {
        workspaceDir: ws,
        model: { model: "m", apiKey: "k", baseUrl: "https://api.example/v1" },
      },
      createdBy: "lawyer:a",
    });
    expect(wf?.steps.length).toBe(1);
    vi.unstubAllGlobals();
  });
});
