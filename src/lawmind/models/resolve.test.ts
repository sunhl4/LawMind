import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { addCustomModel, readModelsStore } from "./custom-store.js";
import {
  ENV_CURRENT_MODEL_ID,
  buildModelCatalog,
  isAnyModelConfigured,
  resolveAgentModelById,
  resolveDefaultModelId,
  resolveModelIdentityForPrompt,
} from "./resolve.js";

describe("lawmind models resolve", () => {
  let lawMindRoot = "";

  afterEach(() => {
    if (lawMindRoot && fs.existsSync(lawMindRoot)) {
      fs.rmSync(lawMindRoot, { recursive: true, force: true });
    }
    delete process.env.LAWMIND_AGENT_API_KEY;
    delete process.env.LAWMIND_AGENT_MODEL;
    delete process.env.LAWMIND_AGENT_BASE_URL;
    delete process.env.LAWMIND_QWEN_API_KEY;
    delete process.env.LAWMIND_PLATFORM_PROVIDER_DASHSCOPE_API_KEY;
    delete process.env.LAWMIND_PLATFORM_PROXY_URL;
    delete process.env.LAWMIND_PLATFORM_ACCESS_TOKEN;
  });

  it("resolves builtin model with dashscope env key", () => {
    lawMindRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-models-"));
    process.env.LAWMIND_QWEN_API_KEY = "sk-test";
    const r = resolveAgentModelById(lawMindRoot, "builtin:qwen-plus");
    expect(r.error).toBeUndefined();
    expect(r.model?.model).toBe("qwen-plus");
    expect(r.model?.apiKey).toBe("sk-test");
  });

  it("resolveModelIdentityForPrompt returns labels without secrets", () => {
    lawMindRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-models-"));
    process.env.LAWMIND_QWEN_API_KEY = "sk-test";
    const r = resolveAgentModelById(lawMindRoot, "builtin:qwen-max");
    const id = resolveModelIdentityForPrompt(lawMindRoot, "builtin:qwen-max", r.model!);
    expect(id.catalogLabel).toContain("Max");
    expect(id.upstreamModel).toBe("qwen-max");
    expect(id.providerLabel).toContain("DashScope");
    expect(JSON.stringify(id)).not.toMatch(/sk-test/);
  });

  it("resolveModelIdentityForPrompt labels env:current with upstream model name", () => {
    lawMindRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-models-"));
    process.env.LAWMIND_AGENT_API_KEY = "sk-wizard";
    process.env.LAWMIND_AGENT_MODEL = "qwen3.6-plus";
    process.env.LAWMIND_AGENT_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
    const r = resolveAgentModelById(lawMindRoot, ENV_CURRENT_MODEL_ID);
    const id = resolveModelIdentityForPrompt(lawMindRoot, ENV_CURRENT_MODEL_ID, r.model!);
    expect(id.catalogLabel).toContain("qwen3.6-plus");
    expect(id.upstreamModel).toBe("qwen3.6-plus");
  });

  it("resolves custom model with stored key", () => {
    lawMindRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-models-"));
    const row = addCustomModel(lawMindRoot, {
      label: "My GPT",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o",
      apiKey: "sk-custom",
    });
    const r = resolveAgentModelById(lawMindRoot, row.id);
    expect(r.model?.apiKey).toBe("sk-custom");
    expect(r.model?.model).toBe("gpt-4o");
  });

  it("catalog marks builtin configured when provider key exists", () => {
    lawMindRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-models-"));
    process.env.LAWMIND_PROVIDER_OPENAI_API_KEY = "sk-o";
    const cat = buildModelCatalog(lawMindRoot);
    const gpt = cat.models.find((m) => m.id === "builtin:gpt-4o");
    expect(gpt?.configured).toBe(true);
    expect(isAnyModelConfigured(lawMindRoot)).toBe(true);
  });

  it("resolves platform model with platform-only key (not exposed in catalog)", () => {
    lawMindRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-models-"));
    process.env.LAWMIND_PLATFORM_PROVIDER_DASHSCOPE_API_KEY = "sk-platform";
    const cat = buildModelCatalog(lawMindRoot);
    const row = cat.models.find((m) => m.id === "platform:qwen-plus");
    expect(row?.kind).toBe("platform");
    expect(row?.configured).toBe(true);
    expect(isAnyModelConfigured(lawMindRoot)).toBe(true);
    const r = resolveAgentModelById(lawMindRoot, "platform:qwen-plus");
    expect(r.model?.apiKey).toBe("sk-platform");
    expect(r.model?.model).toBe("qwen-plus");
  });

  it("exposes env:current when wizard model is not in builtin catalog", () => {
    lawMindRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-models-"));
    process.env.LAWMIND_AGENT_API_KEY = "sk-wizard";
    process.env.LAWMIND_AGENT_MODEL = "qwen3-32b-instruct";
    process.env.LAWMIND_AGENT_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
    const cat = buildModelCatalog(lawMindRoot);
    const envRow = cat.models.find((m) => m.id === ENV_CURRENT_MODEL_ID);
    expect(envRow?.configured).toBe(true);
    expect(envRow?.model).toBe("qwen3-32b-instruct");
    expect(resolveDefaultModelId(lawMindRoot)).toBe(ENV_CURRENT_MODEL_ID);
    const r = resolveAgentModelById(lawMindRoot, ENV_CURRENT_MODEL_ID);
    expect(r.model?.model).toBe("qwen3-32b-instruct");
  });

  it("uses defaultModelId from store", () => {
    lawMindRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-models-"));
    process.env.LAWMIND_QWEN_API_KEY = "sk-test";
    const store = readModelsStore(lawMindRoot);
    store.defaultModelId = "builtin:qwen-max";
    fs.mkdirSync(lawMindRoot, { recursive: true });
    fs.writeFileSync(
      path.join(lawMindRoot, "models.json"),
      `${JSON.stringify(store, null, 2)}\n`,
      "utf8",
    );
    expect(resolveDefaultModelId(lawMindRoot)).toBe("builtin:qwen-max");
  });
});
