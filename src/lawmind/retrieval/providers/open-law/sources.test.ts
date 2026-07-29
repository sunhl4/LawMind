import { describe, expect, it } from "vitest";
import { listOpenLawSourceStatuses, summarizeOpenLawSources } from "./sources.js";

describe("open-law/sources", () => {
  it("reports bundled sample ready by default", () => {
    const prevNpc = process.env.LAWMIND_OPEN_LAW_NPC;
    const prevCase = process.env.LAWMIND_OPEN_LAW_CASEOPEN;
    const prevCorpus = process.env.LAWMIND_OPEN_LAW_CORPUS;
    delete process.env.LAWMIND_OPEN_LAW_NPC;
    delete process.env.LAWMIND_OPEN_LAW_CASEOPEN;
    delete process.env.LAWMIND_OPEN_LAW_CORPUS;
    try {
      const sources = listOpenLawSourceStatuses();
      expect(sources.find((s) => s.id === "local_sample")?.ready).toBe(true);
      expect(sources.find((s) => s.id === "npc_flk")?.ready).toBe(false);
      expect(sources.find((s) => s.id === "caseopen")?.ready).toBe(false);
      const summary = summarizeOpenLawSources();
      expect(summary.readyIds).toContain("local_sample");
      expect(summary.message).toMatch(/内置演示/);
    } finally {
      if (prevNpc === undefined) {
        delete process.env.LAWMIND_OPEN_LAW_NPC;
      } else {
        process.env.LAWMIND_OPEN_LAW_NPC = prevNpc;
      }
      if (prevCase === undefined) {
        delete process.env.LAWMIND_OPEN_LAW_CASEOPEN;
      } else {
        process.env.LAWMIND_OPEN_LAW_CASEOPEN = prevCase;
      }
      if (prevCorpus === undefined) {
        delete process.env.LAWMIND_OPEN_LAW_CORPUS;
      } else {
        process.env.LAWMIND_OPEN_LAW_CORPUS = prevCorpus;
      }
    }
  });

  it("marks npc_flk ready when flag set", () => {
    const prev = process.env.LAWMIND_OPEN_LAW_NPC;
    process.env.LAWMIND_OPEN_LAW_NPC = "1";
    try {
      const npc = listOpenLawSourceStatuses().find((s) => s.id === "npc_flk");
      expect(npc?.ready).toBe(true);
      expect(npc?.detail).toMatch(/law-search|flk\.npc/);
    } finally {
      if (prev === undefined) {
        delete process.env.LAWMIND_OPEN_LAW_NPC;
      } else {
        process.env.LAWMIND_OPEN_LAW_NPC = prev;
      }
    }
  });
});
