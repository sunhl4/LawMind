import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { addCustomModel, setRetrievalModelId } from "../../models/custom-store.js";
import {
  lawMindBraveWebSearch,
  pickWebSearchModel,
  resolveLawMindWebSearchApiKey,
  resolvePublicWebSearchBackend,
} from "./lawmind-web-search.js";

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

  it("prefers the configured DeepSeek chat model over Brave", () => {
    vi.stubEnv("LAWMIND_AGENT_API_KEY", "sk-chat");
    vi.stubEnv("LAWMIND_AGENT_BASE_URL", "https://api.deepseek.com/v1");
    vi.stubEnv("LAWMIND_AGENT_MODEL", "deepseek-flash");
    vi.stubEnv("LAWMIND_WEB_SEARCH_API_KEY", "brave-should-not-win");
    expect(resolvePublicWebSearchBackend()).toMatchObject({
      kind: "native",
      nativeKind: "deepseek-responses",
    });
  });

  it("falls back to Brave when the chat model has no vendor web search", () => {
    vi.stubEnv("LAWMIND_AGENT_API_KEY", "sk-chat");
    vi.stubEnv("LAWMIND_AGENT_BASE_URL", "https://api.openai.com/v1");
    vi.stubEnv("LAWMIND_AGENT_MODEL", "gpt-4o-mini");
    vi.stubEnv("LAWMIND_WEB_SEARCH_API_KEY", "brave-key");
    expect(resolvePublicWebSearchBackend().kind).toBe("brave");
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

describe("pickWebSearchModel", () => {
  const chat = {
    baseUrl: "https://api.deepseek.com/v1",
    apiKey: "sk-chat",
    model: "deepseek-flash",
  };

  function tmpRoot(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-web-pick-"));
  }

  it("shared mode keeps the chat model even if a legal model has vendor search", () => {
    vi.stubEnv("LAWMIND_RETRIEVAL_MODE", "single");
    const root = tmpRoot();
    const row = addCustomModel(root, {
      label: "通义垂类",
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      model: "qwen-plus",
      apiKey: "sk-legal",
    });
    setRetrievalModelId(root, row.id);
    expect(pickWebSearchModel(chat, root)?.apiKey).toBe("sk-chat");
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("dual mode falls back to chat when the legal model has no vendor web search", () => {
    vi.stubEnv("LAWMIND_RETRIEVAL_MODE", "dual");
    const root = tmpRoot();
    const row = addCustomModel(root, {
      label: "ChatLaw",
      baseUrl: "https://legal.example/v1",
      model: "chatlaw",
      apiKey: "sk-legal",
    });
    setRetrievalModelId(root, row.id);
    expect(pickWebSearchModel(chat, root)).toMatchObject({
      apiKey: "sk-chat",
      model: "deepseek-flash",
    });
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("dual mode uses the legal model when it has vendor web search", () => {
    vi.stubEnv("LAWMIND_RETRIEVAL_MODE", "dual");
    const root = tmpRoot();
    const row = addCustomModel(root, {
      label: "通义检索",
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      model: "qwen-plus",
      apiKey: "sk-legal",
    });
    setRetrievalModelId(root, row.id);
    expect(pickWebSearchModel(chat, root)).toMatchObject({
      apiKey: "sk-legal",
      model: "qwen-plus",
    });
    fs.rmSync(root, { recursive: true, force: true });
  });
});
