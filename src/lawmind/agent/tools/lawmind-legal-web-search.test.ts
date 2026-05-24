import { describe, expect, it, vi } from "vitest";
import {
  buildStatuteWebSearchQueries,
  lawMindStatuteWebSearch,
} from "./lawmind-legal-web-search.js";
import * as web from "./lawmind-web-search.js";

describe("lawmind-legal-web-search", () => {
  it("buildStatuteWebSearchQueries adds statute-oriented site queries", () => {
    const qs = buildStatuteWebSearchQueries("民法典 第1043条");
    expect(qs.length).toBeGreaterThanOrEqual(2);
    expect(qs.some((q) => q.includes("site:npc.gov.cn"))).toBe(true);
    expect(qs.some((q) => q.includes("民法典"))).toBe(true);
  });

  it("lawMindStatuteWebSearch prefers official hosts in sort order", async () => {
    vi.stubEnv("LAWMIND_WEB_SEARCH_API_KEY", "test");
    const spy = vi.spyOn(web, "lawMindBraveWebSearch").mockImplementation(async (q) => {
      if (q.includes("npc.gov.cn")) {
        return [
          {
            title: "全国人大",
            url: "https://www.npc.gov.cn/foo",
            description: "official",
          },
        ];
      }
      return [
        {
          title: "博客",
          url: "https://example.com/bar",
          description: "blog",
        },
      ];
    });
    const rows = await lawMindStatuteWebSearch("劳动合同法", 3);
    expect(rows[0]?.sourceTier).toBe("official");
    expect(rows[0]?.url).toContain("npc.gov.cn");
    spy.mockRestore();
    vi.unstubAllEnvs();
  });
});
