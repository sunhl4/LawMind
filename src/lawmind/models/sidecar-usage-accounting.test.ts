/**
 * 旁路模型入口也记进同一本账：独立审稿员（guardian）、路由分类、旧引擎成稿。
 *
 * 这些调用每轮都会发生，却长期没有逐次行——于是「这轮到底花了多少」
 * 只能解释主循环那一半。这里用假端点跑真实记账路径，断言账本里有对应 purpose。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startCassetteModelServer } from "../agent/testkit/cassette-model-server.js";
import { cassetteAssistant } from "../agent/testkit/cassette-script.js";
import { defaultGuardianCaller } from "../guardian/run.js";
import { createModelUsageRecorder, type ModelUsageLedgerEntry } from "../models/model-usage.js";
import { buildDraftWithModel } from "../reasoning/model-draft.js";
import type { ResearchBundle, TaskIntent } from "../types.js";

function readLedger(ws: string): ModelUsageLedgerEntry[] {
  const file = path.join(ws, "model-usage", "ledger.jsonl");
  if (!fs.existsSync(file)) {
    return [];
  }
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as ModelUsageLedgerEntry);
}

const servers: Array<{ close: () => Promise<void> }> = [];
const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tmpWs(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-usage-sidecar-"));
  dirs.push(dir);
  return dir;
}

describe("sidecar model usage accounting", () => {
  it("records a guardian reviewer call with purpose=guardian", async () => {
    const ws = tmpWs();
    const server = await startCassetteModelServer();
    servers.push(server);
    server.enqueue(cassetteAssistant(JSON.stringify({ verdict: "pass", items: [], gaps: [] })));

    const draw = await defaultGuardianCaller(
      {
        provider: "openai-compatible",
        baseUrl: server.url,
        apiKey: "k",
        model: "reviewer-model",
        timeoutMs: 5_000,
        maxRetries: 0,
      },
      { system: "审", user: "查" },
      undefined,
      {
        onAttempt: createModelUsageRecorder(ws, {
          purpose: "guardian",
          model: "reviewer-model",
          provider: "openai-compatible",
        }),
      },
    );
    expect(draw.text).toContain("verdict");

    const rows = readLedger(ws).filter((row) => row.purpose === "guardian");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.failed).toBe(false);
    expect(rows[0]?.attempt).toBe(1);
  });

  it("records failed reviewer attempts instead of dropping them", async () => {
    const ws = tmpWs();
    const server = await startCassetteModelServer();
    servers.push(server);
    // 无排队回合 → 端点返回 400，记账仍须落一条失败行。
    await defaultGuardianCaller(
      {
        provider: "openai-compatible",
        baseUrl: server.url,
        apiKey: "k",
        model: "reviewer-model",
        timeoutMs: 5_000,
        maxRetries: 0,
      },
      { system: "审", user: "查" },
      undefined,
      {
        onAttempt: createModelUsageRecorder(ws, {
          purpose: "guardian",
          model: "reviewer-model",
        }),
      },
    ).catch(() => undefined);

    const rows = readLedger(ws).filter((row) => row.purpose === "guardian");
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0]?.failed).toBe(true);
  });

  it("records a model draft call with purpose=draft when workspaceDir is given", async () => {
    const ws = tmpWs();
    const server = await startCassetteModelServer();
    servers.push(server);
    server.enqueue(
      cassetteAssistant(
        JSON.stringify({
          title: "试用期解除回函",
          sections: [{ heading: "事实", body: "根据材料，试用期不符合录用条件。", citations: [] }],
        }),
      ),
    );
    const intent = {
      kind: "draft.word",
      instruction: "起草回函",
      summary: "试用期解除",
      taskId: "t1",
      matterId: "m1",
    } as TaskIntent;
    const bundle: ResearchBundle = {
      claims: [],
      sources: [],
      riskFlags: [],
      missingItems: [],
    };
    const draft = await buildDraftWithModel(
      { intent, bundle, workspaceDir: ws },
      { baseUrl: server.url, apiKey: "k", model: "draft-model" },
    );
    expect(draft?.sections.length).toBeGreaterThan(0);
    const rows = readLedger(ws).filter((row) => row.purpose === "draft");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ failed: false, matterId: "m1", model: "draft-model" });
  });
});
