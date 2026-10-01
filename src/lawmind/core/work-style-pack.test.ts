import { describe, expect, it } from "vitest";
import {
  formatWorkStylePackBlock,
  buildSubagentMemoryPack,
  resolveWorkStylePack,
  workStyleFallbackMessage,
} from "./work-style-pack.js";

describe("work-style-pack", () => {
  it("resolves explicit roleId", () => {
    const pack = resolveWorkStylePack({ roleId: "contract_review" });
    expect(pack?.roleId).toBe("contract_review");
    expect(pack?.reviewChecklist.length).toBeGreaterThan(0);
  });

  it("infers contract_review from delivery hint", () => {
    const pack = resolveWorkStylePack({ deliveryHint: "contract.review", subagentRole: "draft" });
    expect(pack?.roleId).toBe("contract_review");
  });

  it("falls back to subagent default role", () => {
    expect(resolveWorkStylePack({ subagentRole: "review" })?.roleId).toBe("contract_review");
    expect(resolveWorkStylePack({ subagentRole: "explore" })?.roleId).toBe("general_default");
  });

  it("formats review pack without drafting-collusion coaching as primary", () => {
    const pack = resolveWorkStylePack({ roleId: "contract_review" })!;
    const block = formatWorkStylePackBlock(pack, { forSubagent: "review" });
    expect(block).toContain("本轮工作方式");
    expect(block).toContain("独立审查");
    expect(block).toContain("自检清单");
  });

  it("buildSubagentMemoryPack covers review and explore L2 packs", () => {
    expect(buildSubagentMemoryPack({ subagentRole: "review" })).toContain("独立审查");
    expect(buildSubagentMemoryPack({ subagentRole: "explore" })).toContain("只探查");
  });

  it("fallback message tells model not to ask lawyer to hire", () => {
    const pack = resolveWorkStylePack({ roleId: "compliance_research" })!;
    const msg = workStyleFallbackMessage(pack);
    expect(msg).toContain("不要要求律师新建助手");
    expect(msg).toContain("draft_worker");
  });
});
