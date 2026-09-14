import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { addCustomModel, readModelsStore, recordVerification } from "./custom-store.js";
import {
  ENV_CURRENT_MODEL_ID,
  buildModelCatalog,
  isAnyModelConfigured,
  isResolvedModelVerified,
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
    delete process.env.LAWMIND_QWEN_BASE_URL;
    delete process.env.LAWMIND_DEEPSEEK_API_KEY;
    delete process.env.LAWMIND_DEEPSEEK_MODEL;
    delete process.env.LAWMIND_PROVIDER_DEEPSEEK_API_KEY;
    delete process.env.LAWMIND_PROVIDER_DASHSCOPE_API_KEY;
    delete process.env.LAWMIND_PROVIDER_OPENAI_API_KEY;
    delete process.env.LAWMIND_PLATFORM_PROVIDER_DASHSCOPE_API_KEY;
    delete process.env.LAWMIND_PLATFORM_PROVIDER_DEEPSEEK_API_KEY;
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

  it("marks only that vendor's platform rows configured in platform_key mode", () => {
    lawMindRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-models-"));
    process.env.LAWMIND_PLATFORM_PROVIDER_DASHSCOPE_API_KEY = "sk-platform";
    const cat = buildModelCatalog(lawMindRoot);
    expect(cat.platformMode).toBe("platform_key");
    expect(cat.models.find((m) => m.id === "platform:qwen-plus")?.configured).toBe(true);
    expect(cat.models.find((m) => m.id === "platform:deepseek-flash")?.configured).toBe(false);
    expect(cat.models.find((m) => m.id === "platform:gpt-4o-mini")?.configured).toBe(false);
    expect(resolveDefaultModelId(lawMindRoot)).toBe("platform:qwen-plus");
    const flash = resolveAgentModelById(lawMindRoot, "platform:deepseek-flash");
    expect(flash.error).toBe("missing_platform_api_key");
  });

  it("marks every platform row configured when the platform proxy is set", () => {
    lawMindRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-models-"));
    process.env.LAWMIND_PLATFORM_PROXY_URL = "https://platform.example/v1";
    process.env.LAWMIND_PLATFORM_ACCESS_TOKEN = "tok-platform";
    const cat = buildModelCatalog(lawMindRoot);
    expect(cat.platformMode).toBe("proxy");
    expect(cat.models.filter((m) => m.kind === "platform").every((m) => m.configured)).toBe(true);
    expect(resolveDefaultModelId(lawMindRoot)).toBe("platform:deepseek-flash");
  });

  it("does not light up DashScope builtins from leftover DeepSeek Qwen env copies", () => {
    lawMindRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-models-"));
    delete process.env.LAWMIND_PROVIDER_DASHSCOPE_API_KEY;
    process.env.LAWMIND_QWEN_API_KEY = "sk-leftover";
    process.env.LAWMIND_QWEN_BASE_URL = "https://api.deepseek.com/v1";
    const cat = buildModelCatalog(lawMindRoot);
    expect(cat.models.find((m) => m.id === "builtin:qwen-plus")?.configured).toBe(false);
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

  it("defaults to deepseek-flash when no model is configured", () => {
    lawMindRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-models-"));
    delete process.env.LAWMIND_DEEPSEEK_API_KEY;
    delete process.env.LAWMIND_PROVIDER_DEEPSEEK_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.LAWMIND_QWEN_API_KEY;
    delete process.env.LAWMIND_AGENT_API_KEY;
    delete process.env.LAWMIND_PROVIDER_DASHSCOPE_API_KEY;
    delete process.env.LAWMIND_PROVIDER_OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    expect(resolveDefaultModelId(lawMindRoot)).toBe("builtin:deepseek-flash");
  });

  it("prefers deepseek-flash when the DeepSeek provider key is set", () => {
    lawMindRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-models-"));
    process.env.LAWMIND_DEEPSEEK_API_KEY = "sk-deepseek";
    process.env.LAWMIND_QWEN_API_KEY = "sk-qwen";
    expect(resolveDefaultModelId(lawMindRoot)).toBe("builtin:deepseek-flash");
    const r = resolveAgentModelById(lawMindRoot);
    expect(r.resolvedModelId).toBe("builtin:deepseek-flash");
    expect(r.model?.model).toBe("deepseek-flash");
    expect(r.model?.apiKey).toBe("sk-deepseek");
  });

  it("resolves retired DeepSeek Flash aliases to deepseek-flash", () => {
    lawMindRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-models-"));
    process.env.LAWMIND_DEEPSEEK_API_KEY = "sk-deepseek";
    for (const alias of ["builtin:deepseek-v4-flash", "deepseek-v4-flash-vision-exp"] as const) {
      const r = resolveAgentModelById(lawMindRoot, alias);
      expect(r.error).toBeUndefined();
      expect(r.resolvedModelId).toBe("builtin:deepseek-flash");
      expect(r.model?.model).toBe("deepseek-flash");
    }
  });

  it("maps stored retired Flash default to deepseek-flash", () => {
    lawMindRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-models-"));
    process.env.LAWMIND_DEEPSEEK_API_KEY = "sk-deepseek";
    const store = readModelsStore(lawMindRoot);
    store.defaultModelId = "builtin:deepseek-v4-flash";
    fs.mkdirSync(lawMindRoot, { recursive: true });
    fs.writeFileSync(
      path.join(lawMindRoot, "models.json"),
      `${JSON.stringify(store, null, 2)}\n`,
      "utf8",
    );
    expect(resolveDefaultModelId(lawMindRoot)).toBe("builtin:deepseek-flash");
  });

  it("treats wizard LAWMIND_AGENT_* as configured even on a custom Base URL", () => {
    lawMindRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-models-"));
    process.env.LAWMIND_AGENT_API_KEY = "sk-wizard";
    process.env.LAWMIND_AGENT_MODEL = "my-gateway-model";
    process.env.LAWMIND_AGENT_BASE_URL = "https://gateway.example/v1";
    expect(isAnyModelConfigured(lawMindRoot)).toBe(true);
  });

  it("stamps builtin rows from an env:current verification of the same upstream model", () => {
    lawMindRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-models-"));
    process.env.LAWMIND_AGENT_API_KEY = "sk-wizard";
    process.env.LAWMIND_AGENT_MODEL = "deepseek-flash";
    process.env.LAWMIND_AGENT_BASE_URL = "https://api.deepseek.com/v1";
    recordVerification(lawMindRoot, ENV_CURRENT_MODEL_ID, {
      latencyMs: 33,
      model: "deepseek-flash",
      baseUrl: "https://api.deepseek.com/v1",
      verifiedAt: "2026-01-01T00:00:00.000Z",
    });
    const cat = buildModelCatalog(lawMindRoot);
    const flash = cat.models.find((m) => m.id === "builtin:deepseek-flash");
    expect(flash?.verifiedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(flash?.verifiedLatencyMs).toBe(33);
  });

  it("treats env:current store verification as resolved even without a catalog row", () => {
    lawMindRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-models-"));
    process.env.LAWMIND_AGENT_API_KEY = "sk-wizard";
    process.env.LAWMIND_AGENT_MODEL = "deepseek-flash";
    process.env.LAWMIND_AGENT_BASE_URL = "https://api.deepseek.com/v1";
    recordVerification(lawMindRoot, ENV_CURRENT_MODEL_ID, {
      latencyMs: 12,
      model: "other-gateway-model",
      baseUrl: "https://gateway.example/v1",
      verifiedAt: "2026-01-02T00:00:00.000Z",
    });
    expect(isResolvedModelVerified(lawMindRoot, ENV_CURRENT_MODEL_ID)).toBe(true);
  });

  it("uses the wizard DeepSeek key for builtin:deepseek-flash and not Qwen", () => {
    lawMindRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-models-"));
    process.env.LAWMIND_AGENT_API_KEY = "sk-wizard";
    process.env.LAWMIND_AGENT_BASE_URL = "https://api.deepseek.com/v1";
    process.env.LAWMIND_AGENT_MODEL = "deepseek-flash";
    const flash = resolveAgentModelById(lawMindRoot, "builtin:deepseek-flash");
    expect(flash.error).toBeUndefined();
    expect(flash.model?.apiKey).toBe("sk-wizard");
    expect(flash.model?.model).toBe("deepseek-flash");
    const cat = buildModelCatalog(lawMindRoot);
    expect(cat.models.find((m) => m.id === "builtin:deepseek-flash")?.configured).toBe(true);
    expect(cat.models.find((m) => m.id === "builtin:qwen-plus")?.configured).toBe(false);
    expect(cat.models.find((m) => m.id === ENV_CURRENT_MODEL_ID)).toBeUndefined();
    expect(resolveDefaultModelId(lawMindRoot)).toBe("builtin:deepseek-flash");
  });

  it("ignores an unconfigured stored default and falls through", () => {
    lawMindRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-models-"));
    process.env.LAWMIND_QWEN_API_KEY = "sk-qwen";
    const store = readModelsStore(lawMindRoot);
    store.defaultModelId = "builtin:deepseek-flash";
    fs.mkdirSync(lawMindRoot, { recursive: true });
    fs.writeFileSync(
      path.join(lawMindRoot, "models.json"),
      `${JSON.stringify(store, null, 2)}\n`,
      "utf8",
    );
    expect(resolveDefaultModelId(lawMindRoot)).toBe("builtin:qwen-plus");
  });
});
