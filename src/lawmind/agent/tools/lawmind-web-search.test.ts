import { afterEach, describe, expect, it, vi } from "vitest";
import { lawMindBraveWebSearch, resolveLawMindWebSearchApiKey } from "./lawmind-web-search.js";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("lawmind-web-search", () => {
  it("resolveLawMindWebSearchApiKey prefers LAWMIND_WEB_SEARCH_API_KEY", () => {
    vi.stubEnv("LAWMIND_WEB_SEARCH_API_KEY", "a");
    vi.stubEnv("BRAVE_API_KEY", "b");
    expect(resolveLawMindWebSearchApiKey()).toBe("a");
  });

  it("resolveLawMindWebSearchApiKey falls back to BRAVE_API_KEY", () => {
    vi.stubEnv("BRAVE_API_KEY", "bkey");
    expect(resolveLawMindWebSearchApiKey()).toBe("bkey");
  });

  it("lawMindBraveWebSearch parses brave response", async () => {
    vi.stubEnv("LAWMIND_WEB_SEARCH_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          web: {
            results: [{ title: "T", url: "https://example.com", description: "D" }],
          },
        }),
      })) as unknown as typeof fetch,
    );

    const rows = await lawMindBraveWebSearch("q", 3);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toBe("T");
  });
});
