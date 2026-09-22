import { afterEach, describe, expect, it, vi } from "vitest";
import {
  caseLawDegradedNote,
  caseLawProbeFresh,
  isCaseopenAutoReady,
  probeCaseLawSources,
  resetCaseLawProbeCache,
  resolveCaseLawReadiness,
} from "./case-law-readiness.js";

const CASEOPEN_FLAG = "LAWMIND_OPEN_LAW_CASEOPEN";
const CASEOPEN_EP = "LAWMIND_OPEN_LAW_CASEOPEN_ENDPOINT";

function withEnv(vars: Record<string, string | undefined>): () => void {
  const prev = new Map<string, string | undefined>();
  for (const [k, v] of Object.entries(vars)) {
    prev.set(k, process.env[k]);
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }
  return () => {
    for (const [k, v] of prev) {
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
  };
}

afterEach(() => {
  resetCaseLawProbeCache();
});

describe("resolveCaseLawReadiness", () => {
  it("reports not-ready with an actionable hint when nothing is configured", () => {
    const restore = withEnv({ [CASEOPEN_FLAG]: undefined, [CASEOPEN_EP]: undefined });
    try {
      resetCaseLawProbeCache();
      const r = resolveCaseLawReadiness();
      expect(r.ready).toBe(false);
      expect(r.readyIds).toEqual([]);
      expect(r.setupHint).toContain("未接类案库");
      // 指引必须给出真实路径，且明说不编造。
      expect(r.setupHint).toContain("cncases");
      expect(r.setupHint).toContain("不会编造");
      expect(r.note).toContain("未接类案库");
    } finally {
      restore();
    }
  });

  it("marks caseopen ready when the flag is explicitly on", () => {
    const restore = withEnv({ [CASEOPEN_FLAG]: "1" });
    try {
      const r = resolveCaseLawReadiness();
      expect(r.ready).toBe(true);
      expect(r.readyIds).toContain("caseopen");
      expect(r.sources.find((s) => s.id === "caseopen")?.automatic).toBe(false);
    } finally {
      restore();
    }
  });

  it("does not treat a stale probe as ready forever", () => {
    const restore = withEnv({ [CASEOPEN_FLAG]: undefined });
    try {
      resetCaseLawProbeCache();
      // Fresh cache window is bounded; before any probe there is no cache at all.
      expect(caseLawProbeFresh()).toBe(false);
      expect(isCaseopenAutoReady()).toBe(false);
    } finally {
      restore();
    }
  });
});

describe("probeCaseLawSources", () => {
  it("auto-detects a reachable local index and enables caseopen", async () => {
    const restore = withEnv({
      [CASEOPEN_FLAG]: undefined,
      [CASEOPEN_EP]: "http://127.0.0.1:8081/api/search",
    });
    try {
      resetCaseLawProbeCache();
      const fetchImpl = vi.fn(
        async () =>
          new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
      ) as unknown as typeof fetch;
      const r = await probeCaseLawSources({ fetchImpl });
      expect(r.ready).toBe(true);
      expect(r.sources.find((s) => s.id === "caseopen")?.automatic).toBe(true);
      expect(caseLawProbeFresh()).toBe(true);
    } finally {
      restore();
    }
  });

  it("stays not-ready when the local index refuses the connection", async () => {
    const restore = withEnv({
      [CASEOPEN_FLAG]: undefined,
      [CASEOPEN_EP]: "http://127.0.0.1:8081/api/search",
    });
    try {
      resetCaseLawProbeCache();
      const fetchImpl = vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }) as unknown as typeof fetch;
      const r = await probeCaseLawSources({ fetchImpl });
      expect(r.ready).toBe(false);
      expect(r.setupHint).toBeTruthy();
    } finally {
      restore();
    }
  });

  it("rejects an HTML challenge page as 'not a usable index'", async () => {
    const restore = withEnv({
      [CASEOPEN_FLAG]: undefined,
      [CASEOPEN_EP]: "http://127.0.0.1:8081/api/search",
    });
    try {
      resetCaseLawProbeCache();
      const fetchImpl = vi.fn(
        async () =>
          new Response("<html>cloudflare</html>", {
            status: 200,
            headers: { "content-type": "text/html; charset=utf-8" },
          }),
      ) as unknown as typeof fetch;
      const r = await probeCaseLawSources({ fetchImpl });
      expect(r.ready).toBe(false);
    } finally {
      restore();
    }
  });

  it("never probes a public endpoint on its own", async () => {
    const restore = withEnv({
      [CASEOPEN_FLAG]: undefined,
      [CASEOPEN_EP]: "https://example.com/api/search",
    });
    try {
      resetCaseLawProbeCache();
      const fetchImpl = vi.fn() as unknown as typeof fetch;
      await probeCaseLawSources({ fetchImpl });
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });
});

describe("caseLawDegradedNote", () => {
  it("explains the gap for case search but never for statute search", () => {
    const restore = withEnv({ [CASEOPEN_FLAG]: undefined, [CASEOPEN_EP]: undefined });
    try {
      resetCaseLawProbeCache();
      expect(caseLawDegradedNote("case")).toContain("未接类案库");
      expect(caseLawDegradedNote("law")).toBe("");
    } finally {
      restore();
    }
  });

  it("is empty once a case source is ready", () => {
    const restore = withEnv({ [CASEOPEN_FLAG]: "1" });
    try {
      expect(caseLawDegradedNote("case")).toBe("");
    } finally {
      restore();
    }
  });
});
