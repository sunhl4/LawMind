import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  normalizeContractBatchRelativeDir,
  readDeskSettings,
  writeDeskSettings,
} from "./desk-settings.js";

describe("desk-settings", () => {
  const tmp: string[] = [];
  afterEach(async () => {
    for (const d of tmp) {
      await fs.rm(d, { recursive: true, force: true });
    }
    tmp.length = 0;
  });

  it("normalizeContractBatchRelativeDir rejects unsafe paths", () => {
    expect(() => normalizeContractBatchRelativeDir("../x")).toThrow("invalid_contract_batch_dir");
    expect(normalizeContractBatchRelativeDir("  office/contracts  ")).toBe("office/contracts");
  });

  it("read/write roundtrip", async () => {
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), "lm-desk-"));
    tmp.push(ws);
    expect((await readDeskSettings(ws)).contractBatchRelativeDir).toBeUndefined();
    await writeDeskSettings(ws, { contractBatchRelativeDir: "batch/inbox" });
    const r = await readDeskSettings(ws);
    expect(r.contractBatchRelativeDir).toBe("batch/inbox");
    await writeDeskSettings(ws, { contractBatchRelativeDir: "" });
    expect((await readDeskSettings(ws)).contractBatchRelativeDir).toBeUndefined();
  });
});
