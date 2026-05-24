import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  addCustomModel,
  clearVerification,
  listVerifications,
  readModelsStore,
  recordVerification,
  removeCustomModel,
  setDraftWithModelEnabled,
} from "./custom-store.js";

describe("lawmind custom-store", () => {
  let lawMindRoot = "";

  afterEach(() => {
    if (lawMindRoot && fs.existsSync(lawMindRoot)) {
      fs.rmSync(lawMindRoot, { recursive: true, force: true });
    }
    lawMindRoot = "";
  });

  it("returns an empty v2 store when models.json is absent", () => {
    lawMindRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-store-"));
    const store = readModelsStore(lawMindRoot);
    expect(store.schemaVersion).toBe(2);
    expect(store.customModels).toEqual([]);
    expect(store.verifications).toEqual({});
  });

  it("migrates v1 models.json transparently", () => {
    lawMindRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-store-"));
    const v1 = {
      schemaVersion: 1,
      defaultModelId: "builtin:qwen-plus",
      customModels: [
        {
          id: "custom:abc",
          kind: "custom",
          label: "Mine",
          baseUrl: "https://api.openai.com/v1",
          model: "gpt-4o",
          apiKey: "",
          createdAt: "2024-01-01T00:00:00.000Z",
          updatedAt: "2024-01-01T00:00:00.000Z",
        },
      ],
    };
    fs.writeFileSync(path.join(lawMindRoot, "models.json"), JSON.stringify(v1), "utf8");
    const store = readModelsStore(lawMindRoot);
    expect(store.schemaVersion).toBe(2);
    expect(store.defaultModelId).toBe("builtin:qwen-plus");
    expect(store.customModels[0].id).toBe("custom:abc");
    expect(store.verifications).toEqual({});
  });

  it("records and clears verifications", () => {
    lawMindRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-store-"));
    const ts = "2024-04-12T08:00:00.000Z";
    recordVerification(lawMindRoot, "builtin:qwen-plus", {
      latencyMs: 320,
      model: "qwen-plus",
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      verifiedAt: ts,
    });
    expect(listVerifications(lawMindRoot)["builtin:qwen-plus"].latencyMs).toBe(320);
    expect(listVerifications(lawMindRoot)["builtin:qwen-plus"].verifiedAt).toBe(ts);
    expect(clearVerification(lawMindRoot, "builtin:qwen-plus")).toBe(true);
    expect(listVerifications(lawMindRoot)).toEqual({});
    expect(clearVerification(lawMindRoot, "builtin:qwen-plus")).toBe(false);
  });

  it("removeCustomModel also drops the verification record", () => {
    lawMindRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-store-"));
    const row = addCustomModel(lawMindRoot, {
      label: "My GPT",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o",
      apiKey: "sk-test",
    });
    recordVerification(lawMindRoot, row.id, {
      latencyMs: 100,
      model: "gpt-4o",
      baseUrl: "https://api.openai.com/v1",
    });
    expect(listVerifications(lawMindRoot)[row.id]).toBeDefined();
    expect(removeCustomModel(lawMindRoot, row.id)).toBe(true);
    expect(listVerifications(lawMindRoot)[row.id]).toBeUndefined();
  });

  it("allows keyless custom rows when allowKeylessIfKeychain is true", () => {
    lawMindRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-store-"));
    const row = addCustomModel(lawMindRoot, {
      label: "Keychain Bound",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o",
      apiKey: "",
      allowKeylessIfKeychain: true,
    });
    expect(row.apiKey).toBe("");
    const store = readModelsStore(lawMindRoot);
    expect(store.customModels).toHaveLength(1);
  });

  it("rejects keyless custom rows otherwise", () => {
    lawMindRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-store-"));
    expect(() =>
      addCustomModel(lawMindRoot, {
        label: "Bad",
        baseUrl: "https://x",
        model: "y",
        apiKey: "",
      }),
    ).toThrow(/custom_model_fields_required/);
  });

  it("persists draft-with-model preference", () => {
    lawMindRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-store-"));
    expect(readModelsStore(lawMindRoot).draftWithModelEnabled).toBeUndefined();
    setDraftWithModelEnabled(lawMindRoot, true);
    expect(readModelsStore(lawMindRoot).draftWithModelEnabled).toBe(true);
    setDraftWithModelEnabled(lawMindRoot, false);
    expect(readModelsStore(lawMindRoot).draftWithModelEnabled).toBeUndefined();
  });
});
