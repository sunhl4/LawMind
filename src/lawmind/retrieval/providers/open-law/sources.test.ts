import { describe, expect, it } from "vitest";
import { listOpenLawSourceStatuses, summarizeOpenLawSources } from "./sources.js";

describe("open-law/sources", () => {
  it("reports bundled sample ready by default", () => {
    const prevNpc = process.env.LAWMIND_OPEN_LAW_NPC;
    const prevCase = process.env.LAWMIND_OPEN_LAW_CASEOPEN;
    const prevCorpus = process.env.LAWMIND_OPEN_LAW_CORPUS;
    const prevCl = process.env.LAWMIND_OPEN_LAW_COURTLISTENER;
    const prevEu = process.env.LAWMIND_OPEN_LAW_EURLEX;
    const prevJp = process.env.LAWMIND_OPEN_LAW_EGOV_JP;
    delete process.env.LAWMIND_OPEN_LAW_NPC;
    delete process.env.LAWMIND_OPEN_LAW_CASEOPEN;
    delete process.env.LAWMIND_OPEN_LAW_CORPUS;
    delete process.env.LAWMIND_OPEN_LAW_COURTLISTENER;
    delete process.env.LAWMIND_OPEN_LAW_EURLEX;
    delete process.env.LAWMIND_OPEN_LAW_EGOV_JP;
    try {
      const sources = listOpenLawSourceStatuses();
      expect(sources.find((s) => s.id === "local_sample")?.ready).toBe(true);
      expect(sources.find((s) => s.id === "npc_flk")?.ready).toBe(false);
      expect(sources.find((s) => s.id === "caseopen")?.ready).toBe(false);
      expect(sources.find((s) => s.id === "courtlistener")?.ready).toBe(false);
      expect(sources.find((s) => s.id === "harvard_cap")?.access).toBe("retired_via_peer");
      expect(sources.find((s) => s.id === "eurlex")?.ready).toBe(false);
      expect(sources.find((s) => s.id === "egov_jp")?.ready).toBe(false);
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
      if (prevCl === undefined) {
        delete process.env.LAWMIND_OPEN_LAW_COURTLISTENER;
      } else {
        process.env.LAWMIND_OPEN_LAW_COURTLISTENER = prevCl;
      }
      if (prevEu === undefined) {
        delete process.env.LAWMIND_OPEN_LAW_EURLEX;
      } else {
        process.env.LAWMIND_OPEN_LAW_EURLEX = prevEu;
      }
      if (prevJp === undefined) {
        delete process.env.LAWMIND_OPEN_LAW_EGOV_JP;
      } else {
        process.env.LAWMIND_OPEN_LAW_EGOV_JP = prevJp;
      }
    }
  });

  it("marks harvard_cap ready only via CourtListener, not a live CAP API", () => {
    const prev = process.env.LAWMIND_OPEN_LAW_COURTLISTENER;
    process.env.LAWMIND_OPEN_LAW_COURTLISTENER = "1";
    try {
      const sources = listOpenLawSourceStatuses();
      expect(sources.find((s) => s.id === "courtlistener")?.ready).toBe(true);
      const cap = sources.find((s) => s.id === "harvard_cap");
      expect(cap?.ready).toBe(true);
      expect(cap?.access).toBe("retired_via_peer");
      expect(cap?.detail).toMatch(/CourtListener/);
    } finally {
      if (prev === undefined) {
        delete process.env.LAWMIND_OPEN_LAW_COURTLISTENER;
      } else {
        process.env.LAWMIND_OPEN_LAW_COURTLISTENER = prev;
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
