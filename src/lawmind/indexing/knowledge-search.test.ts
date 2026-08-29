import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { recallAtK } from "../memory/similar-case-recall.js";
import { rebuildWorkspaceSearchIndex } from "./fts-ingest.js";
import { getSearchIndexStatus } from "./fts-search.js";
import { searchPersonalKnowledge } from "./knowledge-search.js";

describe("searchPersonalKnowledge hybrid-lite", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const d of dirs.splice(0)) {
      fs.rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  function seedWorkspace(): string {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-knowledge-"));
    dirs.push(ws);
    fs.mkdirSync(path.join(ws, "cases", "matter-minor"), { recursive: true });
    fs.mkdirSync(path.join(ws, "cases", "matter-nda"), { recursive: true });
    fs.mkdirSync(path.join(ws, "memory"), { recursive: true });
    fs.mkdirSync(path.join(ws, "playbooks"), { recursive: true });
    fs.mkdirSync(path.join(ws, "golden"), { recursive: true });

    fs.writeFileSync(
      path.join(ws, "cases", "matter-minor", "CASE.md"),
      `# 未成年人保护纠纷\n\n## 核心争点\n\n- 是否适用未成年人保护法关于监护与学校责任的规定\n- 损害赔偿范围\n\n## 风险\n\n- 证据时效\n`,
      "utf8",
    );
    fs.writeFileSync(
      path.join(ws, "cases", "matter-nda", "CASE.md"),
      `# NDA 审查\n\n## 核心争点\n\n- 保密期限与竞业限制是否过宽\n\n## 风险\n\n- 违约金过高\n`,
      "utf8",
    );
    // Daily log mentions the statute only in passing — should not dominate top-3.
    fs.writeFileSync(
      path.join(ws, "memory", "2026-07-18.md"),
      `# 日志\n\n今天开了会。顺便看到有人聊未成年人保护法，没展开。其他：订会议室、报销机票。\n`,
      "utf8",
    );
    fs.writeFileSync(
      path.join(ws, "MEMORY.md"),
      `# 通用记忆\n\n- 偏好：先列争点再写意见\n`,
      "utf8",
    );
    fs.writeFileSync(
      path.join(ws, "playbooks", "CLAUSE_PLAYBOOK.md"),
      `# 条款手册\n\n## 未成年人相关条款\n\n涉及未成年人保护法时应核对监护同意与学校义务。\n`,
      "utf8",
    );
    fs.writeFileSync(
      path.join(ws, "golden", "g1.golden.json"),
      JSON.stringify({
        taskId: "g1",
        draft: {
          title: "未成年人保护意见书节选",
          deliverableType: "memo.legal",
          sections: [{ heading: "争点", body: "本案应适用未成年人保护法相关条款。" }],
        },
      }),
      "utf8",
    );
    fs.writeFileSync(
      path.join(ws, "golden", "golden.jsonl"),
      `${JSON.stringify({ taskId: "g1" })}\n`,
      "utf8",
    );
    return ws;
  }

  it("rebuild → search roundtrip indexes knowledge corpus", async () => {
    const ws = seedWorkspace();
    const rebuilt = await rebuildWorkspaceSearchIndex(ws);
    expect(rebuilt.knowledgeRows).toBeGreaterThan(0);
    const status = getSearchIndexStatus(ws);
    expect(status.schemaVersion).toBe(2);
    expect(status.knowledgeRows).toBeGreaterThan(0);

    const result = await searchPersonalKnowledge(ws, {
      q: "未成年人保护法",
      limit: 8,
      autoRebuild: false,
    });
    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.hits.some((h) => h.path.includes("CASE.md") || h.docKind === "playbook")).toBe(
      true,
    );
  });

  it("does not put unrelated daily log in top-3 for 未成年人保护法", async () => {
    const ws = seedWorkspace();
    await rebuildWorkspaceSearchIndex(ws);
    const result = await searchPersonalKnowledge(ws, {
      q: "未成年人保护法",
      limit: 8,
      autoRebuild: false,
    });
    const top3 = result.hits.slice(0, 3);
    expect(top3.length).toBeGreaterThan(0);
    expect(top3.every((h) => h.docKind !== "daily_log")).toBe(true);
    expect(top3.every((h) => !/memory\/\d{4}-\d{2}-\d{2}\.md/i.test(h.path))).toBe(true);
  });

  it("cross-matter issue recall@K prefers the matching CASE", async () => {
    const ws = seedWorkspace();
    await rebuildWorkspaceSearchIndex(ws);
    const result = await searchPersonalKnowledge(ws, {
      q: "保密期限 竞业限制",
      limit: 5,
      autoRebuild: false,
    });
    const rankedIds = result.hits.map((h) => {
      const m = /^cases\/([^/]+)\//.exec(h.path);
      return m?.[1] ?? h.path;
    });
    expect(recallAtK([{ expectedMatterId: "matter-nda", rankedIds }], 3)).toBe(1);
    expect(result.hits[0]?.path).toContain("matter-nda");
  });
});
