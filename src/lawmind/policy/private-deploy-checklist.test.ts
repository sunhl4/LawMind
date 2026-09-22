import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runPrivateDeployChecklist } from "./private-deploy-checklist.js";

describe("private-deploy-checklist", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it("marks private_deploy applicable and counts policy", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-pd-"));
    dirs.push(ws);
    fs.writeFileSync(
      path.join(ws, "lawmind.policy.json"),
      JSON.stringify({
        schemaVersion: 1,
        edition: "private_deploy",
        networkAllowlist: ["https://api.example.com"],
      }),
      "utf8",
    );
    const r = runPrivateDeployChecklist(ws);
    expect(r.applicable).toBe(true);
    expect(r.items.find((i) => i.id === "edition_private")?.ok).toBe(true);
    expect(r.items.find((i) => i.id === "network_allowlist")?.ok).toBe(true);
    expect(r.passCount).toBeGreaterThanOrEqual(4);
  });
});
