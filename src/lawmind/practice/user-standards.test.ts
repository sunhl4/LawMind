import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  loadUserStandards,
  matchUserStandards,
  proposeLearnedStandard,
  saveUserStandard,
  standardMatches,
} from "./user-standards.js";

describe("user-standards", () => {
  let workspaceDir: string;

  beforeEach(() => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-standards-"));
  });

  afterEach(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  });

  it("ships builtin contract review and matches a client-specific standard", async () => {
    const builtins = loadUserStandards(workspaceDir);
    expect(builtins.some((s) => s.id === "builtin-contract-review")).toBe(true);
    expect(builtins.some((s) => s.id === "builtin-litigation-intake")).toBe(true);
    expect(
      builtins
        .find((s) => s.id === "builtin-contract-review")
        ?.items.some((i) => i.tone === "never_accept"),
    ).toBe(false);
    await saveUserStandard(workspaceDir, {
      title: "某集团采购口径",
      kind: "contract_review",
      bindWhen: { clientIds: ["acme"], contractTypes: ["sale"] },
      items: [{ text: "永不接受仅对方所在地管辖", tone: "never_accept" }],
      source: "lawyer",
    });
    const hits = matchUserStandards(
      workspaceDir,
      { clientId: "acme", contractType: "sale" },
      "contract_review",
    );
    expect(hits.some((s) => s.title === "某集团采购口径")).toBe(true);
    const miss = matchUserStandards(
      workspaceDir,
      { clientId: "other", contractType: "lease" },
      "contract_review",
    );
    expect(miss.some((s) => s.title === "某集团采购口径")).toBe(false);
  });

  it("does not stack the China checklist onto the service fallback", () => {
    const generic = matchUserStandards(
      workspaceDir,
      { instruction: "审查这份合同", contractType: "service" },
      "contract_review",
    );
    expect(generic.some((s) => s.id === "builtin-contract-review")).toBe(true);
    expect(generic.some((s) => s.id === "builtin-cn-contract-checklist")).toBe(false);

    const sale = matchUserStandards(
      workspaceDir,
      { instruction: "审查采购合同", contractType: "sale" },
      "contract_review",
    );
    expect(sale.some((s) => s.id === "builtin-cn-contract-checklist")).toBe(true);

    const keyword = matchUserStandards(
      workspaceDir,
      { instruction: "按中国合同审查清单审顾问协议", contractType: "service" },
      "contract_review",
    );
    expect(keyword.some((s) => s.id === "builtin-cn-contract-checklist")).toBe(true);
  });

  it("learned candidates stay disabled until enabled", async () => {
    const learned = await proposeLearnedStandard(workspaceDir, {
      title: "从红线学到的管辖口径",
      items: [{ text: "改管辖到我所在地", tone: "must_rewrite" }],
    });
    expect(learned.enabled).toBe(false);
    expect(standardMatches(learned, { instruction: "审查合同" })).toBe(false);
  });
});
