import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { addCustomModel, setDefaultModelId } from "./custom-store.js";
import {
  effectiveRouterMode,
  isModelRouterEnabled,
  resolveRouterLlmConfig,
} from "./router-reasoning.js";

describe("router-reasoning", () => {
  let lawMindRoot = "";
  const prev = { ...process.env };

  afterEach(() => {
    process.env = { ...prev };
    if (lawMindRoot && fs.existsSync(lawMindRoot)) {
      fs.rmSync(lawMindRoot, { recursive: true, force: true });
    }
    lawMindRoot = "";
  });

  function clearAgentEnv(): void {
    delete process.env.LAWMIND_ROUTER_MODE;
    delete process.env.LAWMIND_ROUTER_BASE_URL;
    delete process.env.LAWMIND_ROUTER_API_KEY;
    delete process.env.LAWMIND_ROUTER_MODEL;
    delete process.env.LAWMIND_AGENT_BASE_URL;
    delete process.env.LAWMIND_AGENT_API_KEY;
    delete process.env.LAWMIND_AGENT_MODEL;
    delete process.env.QWEN_BASE_URL;
    delete process.env.QWEN_API_KEY;
    delete process.env.QWEN_MODEL;
  }

  it("stays keyword when LAWMIND_ROUTER_MODE=keyword even with creds", () => {
    clearAgentEnv();
    process.env.LAWMIND_ROUTER_MODE = "keyword";
    process.env.LAWMIND_AGENT_BASE_URL = "https://example.com/v1";
    process.env.LAWMIND_AGENT_API_KEY = "sk-test";
    process.env.LAWMIND_AGENT_MODEL = "qwen-plus";
    expect(isModelRouterEnabled()).toBe(false);
    expect(resolveRouterLlmConfig()).toBeNull();
    expect(effectiveRouterMode()).toBe("keyword");
  });

  it("enables model route when mode is unset and env creds exist", () => {
    clearAgentEnv();
    process.env.LAWMIND_AGENT_BASE_URL = "https://example.com/v1";
    process.env.LAWMIND_AGENT_API_KEY = "sk-test";
    process.env.LAWMIND_AGENT_MODEL = "qwen-plus";
    expect(isModelRouterEnabled()).toBe(true);
    expect(resolveRouterLlmConfig()?.model).toBe("qwen-plus");
    expect(effectiveRouterMode()).toBe("model");
  });

  it("stays keyword when mode is unset and no credentials exist", () => {
    clearAgentEnv();
    expect(isModelRouterEnabled()).toBe(false);
    expect(effectiveRouterMode()).toBe("keyword");
  });

  it("uses desktop models.json when env router creds are absent", () => {
    clearAgentEnv();
    lawMindRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-router-"));
    const row = addCustomModel(lawMindRoot, {
      label: "desk",
      baseUrl: "https://desk.example.com/v1",
      model: "desk-router",
      apiKey: "sk-desk",
    });
    setDefaultModelId(lawMindRoot, row.id);
    expect(isModelRouterEnabled()).toBe(false);
    expect(isModelRouterEnabled(lawMindRoot)).toBe(true);
    const cfg = resolveRouterLlmConfig(lawMindRoot);
    expect(cfg?.baseUrl).toBe("https://desk.example.com/v1");
    expect(cfg?.model).toBe("desk-router");
    expect(cfg?.apiKey).toBe("sk-desk");
  });
});
