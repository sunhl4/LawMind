import { describe, expect, it } from "vitest";
import { matchSkillsForTriage } from "./skill-match.js";
import type { SkillMeta } from "./skill-runtime.js";

function skill(partial: Partial<SkillMeta> & { id: string }): SkillMeta {
  return {
    name: partial.id,
    version: "1",
    description: "合同审查清单",
    enabled: true,
    signatureOk: true,
    dir: "/tmp",
    workflowIds: ["cn-contract-review"],
    tags: ["contract"],
    ...partial,
  };
}

describe("matchSkillsForTriage", () => {
  it("matches by recommendedWorkflowId", () => {
    const hits = matchSkillsForTriage(
      [
        skill({ id: "a" }),
        skill({ id: "b", enabled: false }),
        skill({ id: "c", workflowIds: ["other"], tags: ["misc"], description: "无关技能" }),
      ],
      { recommendedWorkflowId: "cn-contract-review", text: "请走 cn-contract-review 剧本" },
    );
    expect(hits.map((h) => h.id)).toEqual(["a"]);
  });
});
