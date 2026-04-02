import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildAgentMemorySourceReport } from "./memory-sources.js";

describe("buildAgentMemorySourceReport", () => {
  let tmp: string;

  afterEach(async () => {
    if (tmp) {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it("lists core layers and marks prompt injection flags", async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "lm-mem-"));
    await fs.writeFile(path.join(tmp, "MEMORY.md"), "gen", "utf8");
    await fs.writeFile(path.join(tmp, "LAWYER_PROFILE.md"), "lawyer", "utf8");

    const rows = await buildAgentMemorySourceReport(tmp, {});
    const ids = rows.map((r) => r.id);
    expect(ids).toContain("memory_md");
    expect(ids).toContain("lawyer_profile");

    const mem = rows.find((r) => r.id === "memory_md");
    expect(mem?.inAgentSystemPrompt).toBe(false);
    expect(mem?.exists).toBe(true);

    const lp = rows.find((r) => r.id === "lawyer_profile");
    expect(lp?.inAgentSystemPrompt).toBe(true);
    expect(lp?.charCount).toBe(6);
  });
});
