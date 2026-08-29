import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createReviewCampaign } from "./storage.js";

const FOUR_ROLES = [
  { id: "clause", label: "条款", weight: 1, timeoutMs: 1000, toolAllowlist: [], promptHint: "" },
  { id: "risk", label: "风险", weight: 1, timeoutMs: 1000, toolAllowlist: [], promptHint: "" },
  {
    id: "compliance",
    label: "合规",
    weight: 1,
    timeoutMs: 1000,
    toolAllowlist: [],
    promptHint: "",
  },
  {
    id: "citation_check",
    label: "引用",
    weight: 1,
    timeoutMs: 1000,
    toolAllowlist: [],
    promptHint: "",
  },
];

describe("review campaign parallel gate", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  function writePlaybook(ws: string): void {
    fs.mkdirSync(path.join(ws, "lawmind", "fleet-playbooks"), { recursive: true });
    fs.writeFileSync(
      path.join(ws, "lawmind", "fleet-playbooks", "par.json"),
      JSON.stringify({
        id: "par",
        label: "Parallel demo",
        version: 1,
        deliverableTypes: ["contract"],
        executionMode: "parallel",
        roles: FOUR_ROLES,
      }),
      "utf8",
    );
  }

  it("allows parallel on Solo when playbook prefers parallel (edition default on)", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-camp-par-"));
    dirs.push(ws);
    writePlaybook(ws);
    fs.writeFileSync(
      path.join(ws, "lawmind.policy.json"),
      JSON.stringify({ schemaVersion: 1, edition: "solo" }),
      "utf8",
    );
    const c = createReviewCampaign(ws, {
      playbookId: "par",
      sourceText: "定义条款与责任上限均具备。",
      preferParallel: true,
    });
    expect(c.executionModeUsed).toBe("parallel");
    expect(c.status).toBe("completed");
  });

  it("allows parallel on Firm edition", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-camp-firm-"));
    dirs.push(ws);
    writePlaybook(ws);
    fs.writeFileSync(
      path.join(ws, "lawmind.policy.json"),
      JSON.stringify({ schemaVersion: 1, edition: "firm" }),
      "utf8",
    );
    const c = createReviewCampaign(ws, {
      playbookId: "par",
      sourceText: "定义条款与责任上限均具备。",
      preferParallel: true,
    });
    expect(c.executionModeUsed).toBe("parallel");
  });
});
