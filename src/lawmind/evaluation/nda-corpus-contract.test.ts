/**
 * In-repo NDA corpus contract (10 confidentiality agreements).
 * Not a panrui/copilot binary comparison — that still needs their harness and real DOCX.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { inferClosedContractType } from "../contracts/closed-contract-type.js";
import { explainSurgicalSpanViolation } from "../drafts/surgical-span-gate.js";
import { buildDraft } from "../reasoning/keyword-draft.js";
import { route } from "../router/index.js";
import { bindLawyerCapability } from "../skills/lawyer-capabilities.js";
import type { ResearchBundle } from "../types.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const ndaDir = path.join(repoRoot, "fixtures/lawmind-review-matrix-nda10/docs");

function emptyBundle(taskId: string): ResearchBundle {
  return {
    taskId,
    query: "",
    claims: [],
    sources: [],
    riskFlags: [],
    missingItems: [],
    requiresReview: false,
    completedAt: new Date().toISOString(),
  };
}

describe("nda corpus contract", () => {
  it("routes the 10 NDA fixtures to opinion review, IP type, and wording scaffold", () => {
    const files = fs.readdirSync(ndaDir).filter((name) => /^nda-\d+\.md$/.test(name));
    expect(files.length).toBe(10);
    for (const name of files) {
      const body = fs.readFileSync(path.join(ndaDir, name), "utf8");
      const instruction = `请审查这份保密协议\n${body}`;
      expect(inferClosedContractType(instruction).id).toBe("ip");
      const bound = bindLawyerCapability({ instruction });
      expect(bound?.id).toBe("contract.review");
      expect(bound?.pipeline).not.toBe("tracked_redline");
      const intent = route({ instruction });
      expect(intent.deliverableType).toBe("contract.review");
      const draft = buildDraft({ intent, bundle: emptyBundle(intent.taskId) });
      expect(draft.sections.map((s) => s.body).join("\n")).toContain("推荐措辞");
      expect(draft.sections.map((s) => s.heading).join(" ")).toContain("来源边界");
    }
  });

  it("keeps surgical span-local edits on a typical NDA jurisdiction swap", () => {
    expect(explainSurgicalSpanViolation("上海仲裁委员会", "北京仲裁委员会")).toBeUndefined();
    expect(
      explainSurgicalSpanViolation(
        "适用中华人民共和国法律，争议提交上海仲裁委员会。",
        "适用中华人民共和国法律，争议提交北京仲裁委员会。",
      ),
    ).toMatch(/跨度硬门禁/);
  });
});
