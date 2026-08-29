import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { setDraftWithModelEnabled } from "./custom-store.js";
import { isDraftWithModelEffective, resolveDraftReasoningLlmConfig } from "./draft-reasoning.js";

describe("draft-reasoning", () => {
  let lawMindRoot = "";
  const prev = { ...process.env };

  afterEach(() => {
    process.env = { ...prev };
    if (lawMindRoot && fs.existsSync(lawMindRoot)) {
      fs.rmSync(lawMindRoot, { recursive: true, force: true });
    }
    lawMindRoot = "";
  });

  it("returns null when preference is off", () => {
    lawMindRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-draft-"));
    delete process.env.LAWMIND_REASONING_MODE;
    expect(resolveDraftReasoningLlmConfig(lawMindRoot)).toBeNull();
    expect(isDraftWithModelEffective(lawMindRoot)).toBe(false);
  });

  it("uses current agent model when preference is on", () => {
    lawMindRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-draft-"));
    setDraftWithModelEnabled(lawMindRoot, true);
    process.env.LAWMIND_AGENT_BASE_URL = "https://example.com/v1";
    process.env.LAWMIND_AGENT_API_KEY = "sk-test";
    process.env.LAWMIND_AGENT_MODEL = "qwen-plus";
    const cfg = resolveDraftReasoningLlmConfig(lawMindRoot);
    expect(cfg?.model).toBe("qwen-plus");
    expect(cfg?.apiKey).toBe("sk-test");
  });

  it("prefers explicit LAWMIND_REASONING_* over chat model", () => {
    lawMindRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-draft-"));
    setDraftWithModelEnabled(lawMindRoot, true);
    process.env.LAWMIND_AGENT_BASE_URL = "https://chat.example.com/v1";
    process.env.LAWMIND_AGENT_API_KEY = "sk-chat";
    process.env.LAWMIND_AGENT_MODEL = "chat-model";
    process.env.LAWMIND_REASONING_BASE_URL = "https://draft.example.com/v1";
    process.env.LAWMIND_REASONING_API_KEY = "sk-draft";
    process.env.LAWMIND_REASONING_MODEL = "draft-model";
    const cfg = resolveDraftReasoningLlmConfig(lawMindRoot);
    expect(cfg?.baseUrl).toBe("https://draft.example.com/v1");
    expect(cfg?.apiKey).toBe("sk-draft");
    expect(cfg?.model).toBe("draft-model");
  });
});
