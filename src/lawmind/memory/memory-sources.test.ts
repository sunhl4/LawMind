import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildAgentMemorySourceReport, toEngineClientMemorySnapshot } from "./memory-sources.js";

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

  it("toEngineClientMemorySnapshot passes client fields through", () => {
    const s = toEngineClientMemorySnapshot({ clientProfile: "a", clientProfileClientId: "x" });
    expect(s.clientProfile).toBe("a");
    expect(s.clientProfileClientId).toBe("x");
  });

  it("marks activeForEngine on client row when engineMemory matches clients/matter", async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "lm-mem-eng-"));
    await fs.writeFile(path.join(tmp, "MEMORY.md"), "x", "utf8");
    const mid = "case-a";
    const cdir = path.join(tmp, "clients", mid);
    await fs.mkdir(cdir, { recursive: true });
    await fs.writeFile(path.join(cdir, "CLIENT_PROFILE.md"), "client text here", "utf8");
    const rows = await buildAgentMemorySourceReport(tmp, {
      matterId: mid,
      engineMemory: { clientProfile: "client text here", clientProfileClientId: mid },
    });
    const matterRow = rows.find((r) => r.id === "client_profile_matter");
    expect(matterRow?.activeForEngine).toBe(true);
    const rootRow = rows.find((r) => r.id === "client_profile_root");
    expect(rootRow?.activeForEngine).toBe(false);
  });
});
