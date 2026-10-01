import fs from "node:fs";
import os from "node:os";
import path from "node:path";
/**
 * Contract checks for docs/LAWMIND-SINGLE-PARENT-AGENT.md (D1–D8).
 * Fail here when product decisions regress.
 */
import { describe, expect, it } from "vitest";
import { assertCanCreateAssistant, SOLO_ROSTER_FULL_MESSAGE } from "../assistants/roster.js";
import { buildSubagentMemoryPack } from "../core/work-style-pack.js";
import { findRelevantMemoriesForTurn } from "../memory/relevant-recall.js";
import { findSimilarCaseMemories } from "../memory/similar-case-recall.js";
import { EDITION_FEATURES, soloEditionFeatures } from "../policy/edition-features.js";

describe("single-parent-agent contract (LAWMIND-SINGLE-PARENT-AGENT)", () => {
  it("D1: Solo edition disables multi-assistant roster packaging", () => {
    expect(soloEditionFeatures().multiAssistantRoster).toBe(false);
    expect(EDITION_FEATURES.multiAssistantRoster.firm).toBe(true);
  });

  it("D1/API: Solo cannot create a second assistant", () => {
    expect(() => assertCanCreateAssistant(1, false)).toThrow(SOLO_ROSTER_FULL_MESSAGE);
  });

  it("D2/L2: subagent memory pack is work-style, not a hired persona", () => {
    const review = buildSubagentMemoryPack({ subagentRole: "review", deliveryHint: "合同审查" });
    expect(review).toContain("本轮工作方式");
    expect(review).toContain("独立审查");
    const explore = buildSubagentMemoryPack({ subagentRole: "explore" });
    expect(explore).toContain("只探查");
  });

  it("D6: zero-score relevant recall injects nothing", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-spa-zero-"));
    try {
      fs.mkdirSync(path.join(ws, "memory", "topics"), { recursive: true });
      fs.writeFileSync(path.join(ws, "MEMORY.md"), "- [x](memory/topics/x.md) — 无关\n", "utf8");
      fs.writeFileSync(path.join(ws, "memory/topics/x.md"), "# 天气\n", "utf8");
      const hits = await findRelevantMemoriesForTurn({
        workspaceDir: ws,
        query: "zzzzqqqqnonsense",
        alreadySurfaced: new Set(),
        recentToolNames: [],
      });
      expect(hits).toEqual([]);
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it("D6: similar-case recall is gated without allowCrossMatter / env", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-spa-sim-"));
    const prev = process.env.LAWMIND_ALLOW_CROSS_MATTER_SEARCH;
    delete process.env.LAWMIND_ALLOW_CROSS_MATTER_SEARCH;
    try {
      fs.mkdirSync(path.join(ws, "cases", "a"), { recursive: true });
      fs.mkdirSync(path.join(ws, "cases", "b"), { recursive: true });
      fs.writeFileSync(path.join(ws, "cases", "a", "CASE.md"), "## 争点\n- 股权对赌\n", "utf8");
      fs.writeFileSync(path.join(ws, "cases", "b", "CASE.md"), "## 争点\n- 租赁\n", "utf8");
      const blocked = await findSimilarCaseMemories({
        workspaceDir: ws,
        instruction: "股权对赌",
        currentMatterId: "b",
      });
      expect(blocked).toEqual([]);
    } finally {
      if (prev === undefined) {
        delete process.env.LAWMIND_ALLOW_CROSS_MATTER_SEARCH;
      } else {
        process.env.LAWMIND_ALLOW_CROSS_MATTER_SEARCH = prev;
      }
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });
});
