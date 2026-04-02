import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readWorkspacePolicyFile, workspacePolicyPath } from "./workspace-policy.js";

describe("readWorkspacePolicyFile", () => {
  let dir: string;

  afterEach(() => {
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns null when file missing", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-pol-"));
    expect(readWorkspacePolicyFile(dir)).toBeNull();
  });

  it("parses valid policy", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-pol-"));
    const p = path.join(dir, "lawmind.policy.json");
    fs.writeFileSync(
      p,
      JSON.stringify({
        schemaVersion: 1,
        edition: "firm",
        benchmarkGateMinScore: 0.72,
      }),
      "utf8",
    );
    const pol = readWorkspacePolicyFile(dir);
    expect(pol?.edition).toBe("firm");
    expect(pol?.benchmarkGateMinScore).toBeCloseTo(0.72, 5);
  });

  it("returns null when schemaVersion missing", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-pol-"));
    fs.writeFileSync(path.join(dir, "lawmind.policy.json"), JSON.stringify({}), "utf8");
    expect(readWorkspacePolicyFile(dir)).toBeNull();
  });

  it("workspacePolicyPath resolves under workspace", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-pol-"));
    expect(workspacePolicyPath(dir)).toBe(path.join(path.resolve(dir), "lawmind.policy.json"));
  });
});
