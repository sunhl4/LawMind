import { describe, expect, it } from "vitest";
import {
  DEMO_CORPUS_RISK_FLAG,
  mapHitsToRetrievalResult,
} from "./authority-hits.js";

describe("mapHitsToRetrievalResult", () => {
  it("watermarks demo hits with riskFlag + source/claim demo tags", () => {
    const r = mapHitsToRetrievalResult([
      {
        id: "sample-1",
        title: "演示法条",
        kind: "statute",
        citation: "《演示法》第1条",
        excerpt: "演示摘录不得当作已核实法条",
        demo: true,
      },
    ]);
    expect(r.riskFlags).toContain(DEMO_CORPUS_RISK_FLAG);
    expect(r.sources[0]?.demo).toBe(true);
    expect(r.claims[0]?.demo).toBe(true);
    expect(r.claims[0]?.confidence).toBeLessThan(0.7);
    expect(r.missingItems).toEqual([]);
  });

  it("does not watermark non-demo commercial-style hits", () => {
    const r = mapHitsToRetrievalResult([
      {
        id: "live-1",
        title: "正式命中",
        kind: "statute",
        excerpt: "正式摘录",
        demo: false,
      },
    ]);
    expect(r.riskFlags).not.toContain(DEMO_CORPUS_RISK_FLAG);
    expect(r.sources[0]?.demo).toBeUndefined();
    expect(r.claims[0]?.demo).toBeUndefined();
  });
});
