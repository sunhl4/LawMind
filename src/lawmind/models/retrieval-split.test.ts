import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { addCustomModel, setRetrievalModelId } from "./custom-store.js";
import { retrievalModeIsDual, resolveLegalRetrievalModelFromStore } from "./retrieval-split.js";

describe("retrieval-split", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("treats unset and single as shared, dual as split", () => {
    expect(retrievalModeIsDual("single")).toBe(false);
    expect(retrievalModeIsDual(undefined)).toBe(false);
    expect(retrievalModeIsDual("dual")).toBe(true);
    vi.stubEnv("LAWMIND_RETRIEVAL_MODE", "dual");
    expect(retrievalModeIsDual()).toBe(true);
  });

  it("resolves a stored retrieval model with key", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-retr-split-"));
    const row = addCustomModel(root, {
      label: "垂类",
      baseUrl: "https://legal.example/v1",
      model: "chatlaw",
      apiKey: "sk-legal",
    });
    setRetrievalModelId(root, row.id);
    const resolved = resolveLegalRetrievalModelFromStore(root);
    expect(resolved?.catalogId).toBe(row.id);
    expect(resolved?.model).toBe("chatlaw");
    expect(resolved?.apiKey).toBe("sk-legal");
    fs.rmSync(root, { recursive: true, force: true });
  });
});
