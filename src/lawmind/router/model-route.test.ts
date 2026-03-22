/**
 * Model router tests (fetch mocked).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { routeAsync } from "./index.js";

describe("routeAsync model router", () => {
  const prev = { ...process.env };

  beforeEach(() => {
    const mockFetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                kind: "research.legal",
                summary: "检索民法典违约责任条款",
                riskLevel: "medium",
                models: ["legal"],
                requiresConfirmation: false,
                output: "markdown",
              }),
            },
          },
        ],
      }),
    }));
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    process.env = { ...prev };
    vi.unstubAllGlobals();
  });

  it("uses keyword route when LAWMIND_ROUTER_MODE is not model", async () => {
    delete process.env.LAWMIND_ROUTER_MODE;
    const intent = await routeAsync({ instruction: "写一封催款律师函" });
    expect(intent.kind).toBe("draft.word");
    expect(fetch).toBeDefined();
    expect(vi.mocked(fetch).mock.calls.length).toBe(0);
  });

  it("calls LLM when LAWMIND_ROUTER_MODE=model and credentials exist", async () => {
    process.env.LAWMIND_ROUTER_MODE = "model";
    process.env.LAWMIND_AGENT_BASE_URL = "https://example.com/v1";
    process.env.LAWMIND_AGENT_API_KEY = "sk-test";
    process.env.LAWMIND_AGENT_MODEL = "qwen-plus";

    const intent = await routeAsync({ instruction: "查一下违约责任" });
    expect(intent.kind).toBe("research.legal");
    expect(intent.summary).toContain("检索");
    expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThanOrEqual(1);
  });
});
