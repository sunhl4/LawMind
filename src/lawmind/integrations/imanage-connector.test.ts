import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listImanageDocuments } from "./imanage-connector.js";

describe("imanage-connector", () => {
  const prev = process.env.LAWMIND_IMANAGE_FIXTURE;
  const dirs: string[] = [];

  afterEach(() => {
    process.env.LAWMIND_IMANAGE_FIXTURE = prev;
    for (const d of dirs.splice(0)) {
      fs.rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  it("returns fixture documents when LAWMIND_IMANAGE_FIXTURE=1", () => {
    process.env.LAWMIND_IMANAGE_FIXTURE = "1";
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-imanage-"));
    dirs.push(ws);
    fs.mkdirSync(path.join(ws, "cases", "matter-1"), { recursive: true });
    const docs = listImanageDocuments(ws, "matter-1", {
      enabled: true,
      baseUrl: "https://example",
    });
    expect(Array.isArray(docs)).toBe(true);
    if (Array.isArray(docs)) {
      expect(docs.length).toBeGreaterThan(0);
      expect(docs[0]?.source).toBe("imanage");
    }
  });
});
