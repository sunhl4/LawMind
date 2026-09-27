/**
 * Retrieval layer — workspace adapter behavior (memory-aware).
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MemoryContext } from "../memory/index.js";
import type { TaskIntent } from "../types.js";
import { articleOrdinal, claimArticleGrounded, createWorkspaceAdapter, retrieve } from "./index.js";

function baseIntent(over: Partial<TaskIntent> = {}): TaskIntent {
  const now = new Date().toISOString();
  return {
    taskId: "t-ws-1",
    kind: "research.general",
    output: "markdown",
    instruction: "test",
    summary: "test summary",
    riskLevel: "low",
    models: ["general"],
    requiresConfirmation: false,
    createdAt: now,
    ...over,
  };
}

function memoryShell(over: Partial<MemoryContext>): MemoryContext {
  return {
    general: "",
    profile: "",
    firmProfile: "",
    caseMemory: "",
    matterStrategy: "",
    todayLog: "",
    yesterdayLog: "",
    clausePlaybook: "",
    courtAndOpponentProfile: "",
    clientProfile: "",
    ...over,
  };
}

describe("createWorkspaceAdapter", () => {
  let workspaceDir: string;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "lawmind-ret-"));
  });

  afterEach(async () => {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  it("adds a workspace source for client profile when memory.clientProfile is non-empty", async () => {
    const clients = path.join(workspaceDir, "clients", "c9");
    await fs.mkdir(clients, { recursive: true });
    await fs.writeFile(path.join(clients, "CLIENT_PROFILE.md"), "c9 profile", "utf8");

    const adapter = createWorkspaceAdapter(workspaceDir);
    const r = await adapter.retrieve({
      intent: baseIntent(),
      memory: memoryShell({
        clientProfile: "c9 profile",
        clientProfileClientId: "c9",
      }),
    });

    const cp = r.sources.find((s) => s.title.startsWith("客户画像："));
    expect(cp).toBeDefined();
    expect(cp?.kind).toBe("workspace");
    expect(cp?.url).toBe(path.join(workspaceDir, "clients", "c9", "CLIENT_PROFILE.md"));
    expect(cp?.citation).toBe("c9 profile");
  });

  it("puts a short CASE.md excerpt on the memo citation", async () => {
    const matterId = "m-1";
    const caseDir = path.join(workspaceDir, "cases", matterId);
    await fs.mkdir(caseDir, { recursive: true });
    await fs.writeFile(
      path.join(caseDir, "CASE.md"),
      "# 案情\n\n买方逾期付款三十日。\n标的额已书面确认。\n",
      "utf8",
    );
    const adapter = createWorkspaceAdapter(workspaceDir);
    const r = await adapter.retrieve({
      intent: { ...baseIntent(), matterId },
      memory: memoryShell({}),
    });
    const memo = r.sources.find((s) => s.kind === "memo");
    expect(memo?.citation).toBe("买方逾期付款三十日。 标的额已书面确认。");
    expect(r.claims).toEqual([]);
  });

  it("uses root CLIENT_PROFILE path when no clientProfileClientId", async () => {
    await fs.writeFile(path.join(workspaceDir, "CLIENT_PROFILE.md"), "root", "utf8");
    const adapter = createWorkspaceAdapter(workspaceDir);
    const r = await adapter.retrieve({
      intent: baseIntent(),
      memory: memoryShell({ clientProfile: "root" }),
    });
    const cp = r.sources.find((s) => s.title.includes("工作区根目录"));
    expect(cp?.url).toBe(path.join(workspaceDir, "CLIENT_PROFILE.md"));
  });
});

describe("retrieve", () => {
  const statute = {
    id: "s1",
    title: "中华人民共和国民法典",
    kind: "statute" as const,
    citation: "《中华人民共和国民法典》第五百七十七条",
  };

  it("does not let a model-written source pin an article, but still accepts a demo corpus hit", () => {
    const claim = {
      text: "《中华人民共和国民法典》第五百七十七条。",
      sourceIds: ["s1"],
      confidence: 0.9,
      model: "legal" as const,
    };
    expect(claimArticleGrounded(claim, [{ ...statute, provider: "model-legal" }])).toBe(false);
    expect(claimArticleGrounded(claim, [{ ...statute, demo: true }])).toBe(true);
  });

  it("drops a claim whose article number is not on the cited source", async () => {
    const bundle = await retrieve({
      intent: baseIntent(),
      memory: memoryShell({}),
      adapters: [
        {
          name: "stub",
          supports: () => true,
          async retrieve() {
            return {
              sources: [statute],
              claims: [
                {
                  text: "根据《民法典》第五百八十五条，违约金可以调整。",
                  sourceIds: ["s1"],
                  confidence: 0.8,
                  model: "legal" as const,
                },
              ],
              riskFlags: [],
              missingItems: [],
            };
          },
        },
      ],
    });
    expect(bundle.claims).toEqual([]);
    expect(bundle.riskFlags.some((flag) => flag.includes("条号"))).toBe(true);
    expect(bundle.requiresReview).toBe(true);
  });

  it("keeps a claim when every written article appears on the cited source", async () => {
    const bundle = await retrieve({
      intent: baseIntent(),
      memory: memoryShell({}),
      adapters: [
        {
          name: "stub",
          supports: () => true,
          async retrieve() {
            return {
              sources: [statute],
              claims: [
                {
                  text: "《中华人民共和国民法典》第五百七十七条约定违约责任。",
                  sourceIds: ["s1"],
                  confidence: 0.9,
                  model: "legal" as const,
                },
              ],
              riskFlags: [],
              missingItems: [],
            };
          },
        },
      ],
    });
    expect(bundle.claims).toHaveLength(1);
    expect(claimArticleGrounded(bundle.claims[0], bundle.sources)).toBe(true);
  });

  it("drops a claim whose pin names an article the cited source does not contain", async () => {
    const bundle = await retrieve({
      intent: baseIntent(),
      memory: memoryShell({}),
      adapters: [
        {
          name: "stub",
          supports: () => true,
          async retrieve() {
            return {
              sources: [statute],
              claims: [
                {
                  text: "违约责任依约定承担。",
                  sourceIds: ["s1"],
                  confidence: 0.9,
                  model: "legal" as const,
                  pin: { article: "第五百条" },
                },
              ],
              riskFlags: [],
              missingItems: [],
            };
          },
        },
      ],
    });
    expect(bundle.claims).toEqual([]);
    expect(bundle.riskFlags.some((flag) => flag.includes("条号"))).toBe(true);
  });

  it("keeps the non-demo copy when two adapters share a source id", async () => {
    const bundle = await retrieve({
      intent: baseIntent(),
      memory: memoryShell({}),
      adapters: [
        {
          name: "sample",
          supports: () => true,
          async retrieve() {
            return {
              sources: [{ ...statute, demo: true, citation: "演示" }],
              claims: [],
              riskFlags: [],
              missingItems: [],
            };
          },
        },
        {
          name: "live",
          supports: () => true,
          async retrieve() {
            return {
              sources: [
                {
                  ...statute,
                  demo: false,
                  citation: statute.citation,
                  provider: "open-law.npc_flk",
                },
              ],
              claims: [],
              riskFlags: [],
              missingItems: [],
            };
          },
        },
      ],
    });
    expect(bundle.sources).toHaveLength(1);
    expect(bundle.sources[0]?.demo).toBe(false);
    expect(bundle.sources[0]?.provider).toBe("open-law.npc_flk");
  });

  it("treats 第577条 and 第五百七十七条 as the same article, not 第五条 and 第五十条", async () => {
    expect(articleOrdinal("第五百七十七条")).toBe(577);
    expect(articleOrdinal("第577条")).toBe(577);
    expect(articleOrdinal("第五条")).toBe(5);
    expect(articleOrdinal("第五十条")).toBe(50);
    const bundle = await retrieve({
      intent: baseIntent(),
      memory: memoryShell({}),
      adapters: [
        {
          name: "stub",
          supports: () => true,
          async retrieve() {
            return {
              sources: [
                { ...statute, citation: "《民法典》第577条", excerpt: "当事人一方不履行合同义务" },
              ],
              claims: [
                {
                  text: "《民法典》第五百七十七条约定违约责任。",
                  sourceIds: ["s1"],
                  confidence: 0.9,
                  model: "legal" as const,
                },
                {
                  text: "应适用《民法典》第五十条。",
                  sourceIds: ["s1"],
                  confidence: 0.4,
                  model: "legal" as const,
                },
              ],
              riskFlags: [],
              missingItems: [],
            };
          },
        },
      ],
    });
    expect(bundle.claims.map((claim) => claim.text)).toEqual([
      "《民法典》第五百七十七条约定违约责任。",
    ]);
  });
});
