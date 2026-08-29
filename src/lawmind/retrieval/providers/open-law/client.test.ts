import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { openLawRetrieve, resolveOpenLawMode } from "./client.js";

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

describe("openLawRetrieve", () => {
  it("defaults to local mode and returns sample hits with 演示语料 watermark", async () => {
    expect(resolveOpenLawMode({ mode: "" })).toBe("local");
    const { result, source } = await openLawRetrieve({ query: "个人信息 同意" });
    expect(source).toBe("local");
    expect(result.sources.length).toBeGreaterThan(0);
    expect(result.claims.every((c) => c.sourceIds.length > 0)).toBe(true);
    expect(result.riskFlags.some((f) => f.includes("演示语料"))).toBe(true);
    expect(result.sources.every((s) => s.demo === true)).toBe(true);
    expect(result.claims.every((c) => c.demo === true)).toBe(true);
    expect(result.sources[0]?.provider).toBe("open-law.local");
  });

  it("npc_flk without flag returns explicit missing", async () => {
    const prev = process.env.LAWMIND_OPEN_LAW_NPC;
    delete process.env.LAWMIND_OPEN_LAW_NPC;
    try {
      const { result } = await openLawRetrieve({
        query: "民法典",
        mode: "npc_flk",
      });
      expect(result.sources).toEqual([]);
      expect(result.missingItems.some((m) => m.includes("OPEN_LAW_NPC"))).toBe(true);
    } finally {
      if (prev !== undefined) {
        process.env.LAWMIND_OPEN_LAW_NPC = prev;
      }
    }
  });

  it("npc_flk maps live fixture when enabled", async () => {
    const prev = process.env.LAWMIND_OPEN_LAW_NPC;
    process.env.LAWMIND_OPEN_LAW_NPC = "1";
    const fixture = fs.readFileSync(path.join(fixtures, "npc-flk-list.json"), "utf8");
    try {
      const fetchImpl = vi.fn(
        async () =>
          new Response(fixture, {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      );
      const { result, source } = await openLawRetrieve({
        query: "民法典",
        mode: "npc_flk",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      expect(source).toBe("npc_flk");
      expect(result.sources[0]?.title).toContain("民法典");
      expect(result.sources[0]?.provider).toBe("open-law.npc_flk");
      expect(result.sources[0]?.demo).not.toBe(true);
    } finally {
      if (prev === undefined) {
        delete process.env.LAWMIND_OPEN_LAW_NPC;
      } else {
        process.env.LAWMIND_OPEN_LAW_NPC = prev;
      }
    }
  });

  it("caseopen maps fixture through openLawRetrieve", async () => {
    const prev = process.env.LAWMIND_OPEN_LAW_CASEOPEN;
    process.env.LAWMIND_OPEN_LAW_CASEOPEN = "1";
    const fixture = fs.readFileSync(path.join(fixtures, "caseopen-search.json"), "utf8");
    try {
      const fetchImpl = vi.fn(
        async () =>
          new Response(fixture, {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      );
      const { result, source } = await openLawRetrieve({
        query: "买卖合同",
        mode: "caseopen",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      expect(source).toBe("caseopen");
      expect(result.sources[0]?.kind).toBe("case");
      expect(result.sources[0]?.provider).toBe("open-law.caseopen");
    } finally {
      if (prev === undefined) {
        delete process.env.LAWMIND_OPEN_LAW_CASEOPEN;
      } else {
        process.env.LAWMIND_OPEN_LAW_CASEOPEN = prev;
      }
    }
  });

  it("resolves caseopen mode aliases", () => {
    expect(resolveOpenLawMode({ mode: "cncases" })).toBe("caseopen");
    expect(resolveOpenLawMode({ mode: "hybrid" })).toBe("hybrid");
  });

  it("resolves foreign live mode aliases including retired CAP → CourtListener", () => {
    expect(resolveOpenLawMode({ mode: "cl" })).toBe("courtlistener");
    expect(resolveOpenLawMode({ mode: "harvard_cap" })).toBe("courtlistener");
    expect(resolveOpenLawMode({ mode: "cellar" })).toBe("eurlex");
    expect(resolveOpenLawMode({ mode: "jp" })).toBe("egov_jp");
  });

  it("hybrid tries CourtListener after local miss when enabled", async () => {
    const prevMode = process.env.LAWMIND_OPEN_LAW_MODE;
    const prevCl = process.env.LAWMIND_OPEN_LAW_COURTLISTENER;
    const prevNpc = process.env.LAWMIND_OPEN_LAW_NPC;
    const prevCase = process.env.LAWMIND_OPEN_LAW_CASEOPEN;
    process.env.LAWMIND_OPEN_LAW_MODE = "hybrid";
    process.env.LAWMIND_OPEN_LAW_COURTLISTENER = "1";
    delete process.env.LAWMIND_OPEN_LAW_NPC;
    delete process.env.LAWMIND_OPEN_LAW_CASEOPEN;
    const fixture = fs.readFileSync(path.join(fixtures, "courtlistener-search.json"), "utf8");
    try {
      const fetchImpl = vi.fn(
        async () =>
          new Response(fixture, {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      );
      const { result, source } = await openLawRetrieve({
        query: "qualified immunity",
        mode: "hybrid",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      expect(source).toBe("courtlistener");
      expect(result.sources[0]?.title).toMatch(/Miranda/);
      expect(fetchImpl).toHaveBeenCalled();
    } finally {
      if (prevMode === undefined) {
        delete process.env.LAWMIND_OPEN_LAW_MODE;
      } else {
        process.env.LAWMIND_OPEN_LAW_MODE = prevMode;
      }
      if (prevCl === undefined) {
        delete process.env.LAWMIND_OPEN_LAW_COURTLISTENER;
      } else {
        process.env.LAWMIND_OPEN_LAW_COURTLISTENER = prevCl;
      }
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
    }
  });

  it("courtlistener maps fixture through openLawRetrieve", async () => {
    const prev = process.env.LAWMIND_OPEN_LAW_COURTLISTENER;
    process.env.LAWMIND_OPEN_LAW_COURTLISTENER = "1";
    const fixture = fs.readFileSync(path.join(fixtures, "courtlistener-search.json"), "utf8");
    try {
      const fetchImpl = vi.fn(
        async () =>
          new Response(fixture, {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      );
      const { result, source } = await openLawRetrieve({
        query: "Miranda",
        mode: "courtlistener",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      expect(source).toBe("courtlistener");
      expect(result.sources[0]?.kind).toBe("case");
      expect(result.sources[0]?.provider).toBe("open-law.courtlistener");
    } finally {
      if (prev === undefined) {
        delete process.env.LAWMIND_OPEN_LAW_COURTLISTENER;
      } else {
        process.env.LAWMIND_OPEN_LAW_COURTLISTENER = prev;
      }
    }
  });
});
