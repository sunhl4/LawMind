import { describe, expect, it } from "vitest";
import {
  detectNativeWebSearchKind,
  extractNativeWebHits,
  originWithoutV1,
} from "./native-web-search.js";

describe("native-web-search", () => {
  it("detects DeepSeek Flash on the official host", () => {
    expect(detectNativeWebSearchKind("https://api.deepseek.com/v1", "deepseek-flash")).toBe(
      "deepseek-responses",
    );
    expect(detectNativeWebSearchKind("https://api.deepseek.com", "deepseek-v4-flash")).toBe(
      "deepseek-responses",
    );
  });

  it("does not treat a random model on DeepSeek's default URL as native search", () => {
    expect(detectNativeWebSearchKind("https://api.deepseek.com/v1", "test-model")).toBeNull();
  });

  it("detects Qwen on DashScope", () => {
    expect(
      detectNativeWebSearchKind("https://dashscope.aliyuncs.com/compatible-mode/v1", "qwen-plus"),
    ).toBe("dashscope-enable-search");
  });

  it("strips /v1 for the Responses origin", () => {
    expect(originWithoutV1("https://api.deepseek.com/v1")).toBe("https://api.deepseek.com");
  });

  it("extracts url_citation annotations and ignores the model API host", () => {
    const hits = extractNativeWebHits(
      {
        output: [
          {
            type: "web_search_call",
            action: { type: "search", query: "2026 新说唱" },
          },
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: "公开报道见 [节目页](https://example.com/show)",
                annotations: [
                  {
                    type: "url_citation",
                    title: "节目页",
                    url: "https://example.com/show",
                  },
                ],
              },
            ],
          },
        ],
      },
      8,
    );
    expect(hits).toEqual([
      {
        title: "节目页",
        url: "https://example.com/show",
        description: "",
      },
    ]);
  });

  it("extracts DashScope search_info URLs", () => {
    const hits = extractNativeWebHits(
      {
        choices: [{ message: { content: "见检索结果" } }],
        search_info: {
          search_results: [{ title: "报道", url: "https://news.example.com/a", snippet: "摘要" }],
        },
      },
      5,
    );
    expect(hits[0]).toEqual({
      title: "报道",
      url: "https://news.example.com/a",
      description: "摘要",
    });
  });
});
