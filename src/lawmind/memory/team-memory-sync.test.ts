import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inspectWorkspacePolicyFile } from "../policy/workspace-policy.js";
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

  it("policy key teamMemorySync is rejected by the commercial contract (不再生效)", () => {
    const ws = tmpWs();
    dirs.push(ws);
    writePolicy(ws, {
      edition: "firm",
      teamMemorySync: { enabled: true, endpoint: "https://example.com/sync" },
    });
    // 策略合同只留 IT 硬边界：teamMemorySync 被拒绝并说明原因。
    const inspection = inspectWorkspacePolicyFile(ws);
    const rejected = inspection.rejected.find((r) => r.key === "teamMemorySync");
    expect(rejected).toBeDefined();
    expect(rejected?.reason).toContain("团队记忆同步");
    // 被拒绝的键不静默生效：即使 firm + enabled + endpoint 全写上，门也不开。
    const gate = evaluateTeamMemorySyncGate(ws);
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toBe("team_memory_sync_disabled");
  });

  it("gates off on solo too (键被拒绝后无所谓 edition)", () => {
    const ws = tmpWs();
    dirs.push(ws);
    writePolicy(ws, {
      edition: "solo",
      teamMemorySync: { enabled: true, endpoint: "https://example.com/sync" },
    });
    const gate = evaluateTeamMemorySyncGate(ws);
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toBe("team_memory_sync_disabled");
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

  it("planTeamMemoryUpload stays on the no-upload path while the gate is off", () => {
    const ws = tmpWs();
    dirs.push(ws);
    writePolicy(ws, {
      edition: "firm",
      teamMemorySync: { enabled: true, endpoint: "https://example.com/sync" },
    });
    fs.writeFileSync(path.join(ws, "MEMORY.md"), "# safe memory\n", "utf8");
    // 门控的开通道已随策略键一起移除：plan 不扫描、不带 endpoint。
    const plan = planTeamMemoryUpload(ws, ["MEMORY.md"]);
    expect(plan.gate.allowed).toBe(false);
    expect(plan.scan.scannedFiles).toBe(0);
    expect(plan.endpoint).toBeUndefined();
  });
});
