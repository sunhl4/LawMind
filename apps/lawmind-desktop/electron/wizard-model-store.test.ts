import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  defaultModelIdForWizardModel,
  mergeWizardDefaultIntoStore,
  writeWizardDefaultModelId,
} from "./wizard-model-store.mjs";

describe("wizard-model-store", () => {
  let root = "";

  afterEach(() => {
    if (root && fs.existsSync(root)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
    root = "";
  });

  it("maps recommended names to builtin ids", () => {
    expect(defaultModelIdForWizardModel("deepseek-flash")).toBe("builtin:deepseek-flash");
    expect(defaultModelIdForWizardModel("qwen-plus")).toBe("builtin:qwen-plus");
    expect(defaultModelIdForWizardModel("my-custom-model")).toBe("env:current");
  });

  it("preserves schema-2 verifications when rewriting defaultModelId", () => {
    const merged = mergeWizardDefaultIntoStore(
      {
        schemaVersion: 2,
        customModels: [{ id: "custom:1", label: "x" }],
        verifications: {
          "builtin:deepseek-flash": {
            verifiedAt: "2026-01-01T00:00:00.000Z",
            latencyMs: 42,
            model: "deepseek-flash",
            baseUrl: "https://api.deepseek.com/v1",
          },
        },
      },
      "deepseek-flash",
    );
    expect(merged.schemaVersion).toBe(2);
    expect(merged.customModels).toHaveLength(1);
    expect(merged.verifications["builtin:deepseek-flash"]?.latencyMs).toBe(42);
    expect(merged.defaultModelId).toBe("builtin:deepseek-flash");
  });

  it("writes schema 2 without dropping existing verifications on disk", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-wizard-store-"));
    fs.writeFileSync(
      path.join(root, "models.json"),
      `${JSON.stringify(
        {
          schemaVersion: 2,
          customModels: [],
          verifications: {
            "builtin:qwen-plus": {
              verifiedAt: "2026-01-01T00:00:00.000Z",
              latencyMs: 10,
              model: "qwen-plus",
              baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
            },
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    writeWizardDefaultModelId(root, "qwen-plus");
    const raw = JSON.parse(fs.readFileSync(path.join(root, "models.json"), "utf8")) as {
      schemaVersion: number;
      verifications: Record<string, { latencyMs: number }>;
      defaultModelId: string;
    };
    expect(raw.schemaVersion).toBe(2);
    expect(raw.defaultModelId).toBe("builtin:qwen-plus");
    expect(raw.verifications["builtin:qwen-plus"]?.latencyMs).toBe(10);
  });
});
