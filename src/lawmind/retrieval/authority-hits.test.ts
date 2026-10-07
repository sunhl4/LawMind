import { describe, expect, it } from "vitest";
import {
  DEMO_CORPUS_RISK_FLAG,
  mapHitsToRetrievalResult,
  pinFromCitedText,
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
    expect(r.claims[0]?.pin).toEqual({ article: "第1条" });
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
    expect(r.claims[0]?.pin).toBeUndefined();
  });

  it("ranks a pinned live hit ahead of a leading block of demo hits", () => {
    const demos = Array.from({ length: 20 }, (_, index) => ({
      id: `demo-${index}`,
      title: `演示${index}`,
      excerpt: "演示摘录",
      demo: true as const,
    }));
    const r = mapHitsToRetrievalResult([
      ...demos,
      {
        id: "live-47",
        title: "中华人民共和国劳动合同法",
        kind: "statute",
        citation: "《劳动合同法》第四十七条",
        excerpt: "经济补偿按劳动者在本单位工作的年限计算",
        demo: false,
      },
    ]);
    expect(r.sources[0]?.id).toBe("live-47");
    expect(r.sources).toHaveLength(20);
    expect(r.sources.some((source) => source.id === "demo-19")).toBe(false);
    expect(r.riskFlags).toContain(DEMO_CORPUS_RISK_FLAG);
  });

  it("copies an article or page that the citation already states", () => {
    expect(pinFromCitedText("《民法典》第五百七十七条", "当事人一方不履行合同义务")).toEqual({
      article: "第五百七十七条",
    });
    expect(pinFromCitedText(undefined, "见第12页")).toEqual({ page: "第12页" });
    expect(pinFromCitedText("无条号", "只有摘录")).toBeUndefined();
  });
});
