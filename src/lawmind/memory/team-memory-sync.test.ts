import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  evaluateTeamMemorySyncGate,
  planTeamMemoryUpload,
  scanMemoryPathsForSecrets,
} from "./team-memory-sync.js";

function tmpWs(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lm-team-mem-"));
}

function writePolicy(dir: string, body: Record<string, unknown>): void {
  fs.writeFileSync(
    path.join(dir, "lawmind.policy.json"),
    JSON.stringify({ schemaVersion: 1, ...body }, null, 2),
    "utf8",
  );
}

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
  dirs.length = 0;
});

describe("team-memory-sync", () => {
  it("gates off by default", () => {
    const ws = tmpWs();
    dirs.push(ws);
    const gate = evaluateTeamMemorySyncGate(ws);
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toBe("team_memory_sync_disabled");
  });

  it("requires firm edition when enabled in policy", () => {
    const ws = tmpWs();
    dirs.push(ws);
    writePolicy(ws, {
      edition: "solo",
      teamMemorySync: { enabled: true, endpoint: "https://example.com/sync" },
    });
    const gate = evaluateTeamMemorySyncGate(ws);
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toBe("team_memory_sync_requires_firm_edition");
  });

  it("allows firm + enabled + endpoint", () => {
    const ws = tmpWs();
    dirs.push(ws);
    writePolicy(ws, {
      edition: "firm",
      teamMemorySync: { enabled: true, endpoint: "https://example.com/sync" },
    });
    const gate = evaluateTeamMemorySyncGate(ws);
    expect(gate.allowed).toBe(true);
  });

  it("scanMemoryPathsForSecrets blocks api key patterns", () => {
    const ws = tmpWs();
    dirs.push(ws);
    const rel = "MEMORY.md";
    fs.writeFileSync(path.join(ws, rel), "api_key=sk-test12345678901234567890\n", "utf8");
    const scan = scanMemoryPathsForSecrets(ws, [rel]);
    expect(scan.ok).toBe(false);
    expect(scan.blockedPaths).toContain(rel);
  });

  it("planTeamMemoryUpload returns scan when gate allows", () => {
    const ws = tmpWs();
    dirs.push(ws);
    writePolicy(ws, {
      edition: "firm",
      teamMemorySync: { enabled: true, endpoint: "https://example.com/sync" },
    });
    fs.writeFileSync(path.join(ws, "MEMORY.md"), "# safe memory\n", "utf8");
    const plan = planTeamMemoryUpload(ws, ["MEMORY.md"]);
    expect(plan.gate.allowed).toBe(true);
    expect(plan.scan.ok).toBe(true);
    expect(plan.endpoint).toBe("https://example.com/sync");
  });
});
