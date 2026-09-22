import { describe, expect, it } from "vitest";
import {
  deliverableNeedsExportLint,
  runExportLintGate,
  runExportLintGateForDraft,
} from "./export-lint-gate.js";
import { extractCitedStatuteTitles, fetchLiveCitationHits } from "./live-citation-hits.js";

describe("deliverableNeedsExportLint", () => {
  it("gates outbound deliverable types only", () => {
    expect(deliverableNeedsExportLint("memo.opinion")).toBe(true);
    expect(deliverableNeedsExportLint("memo.research")).toBe(true);
    expect(deliverableNeedsExportLint("contract.review")).toBe(true);
    expect(deliverableNeedsExportLint("letter.demand")).toBe(true);
    expect(deliverableNeedsExportLint("litigation.complaint")).toBe(true);
    expect(deliverableNeedsExportLint("memo.internal")).toBe(false);
    expect(deliverableNeedsExportLint("report.general")).toBe(false);
    expect(deliverableNeedsExportLint("ppt.training")).toBe(false);
    expect(deliverableNeedsExportLint("document.general")).toBe(false);
    expect(deliverableNeedsExportLint("contract.general")).toBe(false);
    expect(deliverableNeedsExportLint(undefined)).toBe(false);
  });
});

describe("runExportLintGate", () => {
  it("passes clean text", () => {
    const gate = runExportLintGate({
      text: "房屋租赁合同审查意见。租赁期限 5 年，租金按月支付，双方权利义务明确。",
      deliverableType: "contract.review",
    });
    expect(gate.ok).toBe(true);
    expect(gate.blockerRuleIds).toEqual([]);
  });

  it("blocks mechanical residual blockers with a narrowed retry hint", () => {
    const gate = runExportLintGate({
      text: "房屋租赁合同。租赁期限 25 年，租金按月支付。双方按约履行各自义务。",
      deliverableType: "contract.review",
    });
    expect(gate.ok).toBe(false);
    expect(gate.blockerRuleIds).toContain("lease.term_cap");
    expect(gate.error).toContain("lease.term_cap");
    expect(gate.error).toContain("收窄");
  });

  it("never blocks on judgment-class findings (statutory cap is lawyer decision)", () => {
    const gate = runExportLintGate({
      text: "供货合同审查意见。定金为本合同标的额的 30%，其余条款按约定履行，风险总体可控。",
      deliverableType: "contract.review",
    });
    expect(gate.ok).toBe(true);
    expect(gate.lintReport.findings.some((f) => f.ruleId === "statutory.deposit_cap")).toBe(true);
  });

  it("passes live citation hits into the lint report (repealed statute flagged)", () => {
    const gate = runExportLintGate({
      text: "根据《中华人民共和国合同法》第 107 条，违约方应承担继续履行责任，本意见供参考。",
      deliverableType: "memo.opinion",
      citationHits: [{ title: "中华人民共和国合同法", status: "已废止" }],
    });
    expect(
      gate.lintReport.findings.some(
        (f) =>
          (f.ruleId === "citation.known_repealed" || f.ruleId === "citation.repealed_nearby") &&
          f.severity === "warning",
      ),
    ).toBe(true);
    // 引用效力是 warning 软标，不拦截导出。
    expect(gate.ok).toBe(true);
  });

  it("gates a draft-shaped object via runExportLintGateForDraft", () => {
    const gate = runExportLintGateForDraft({
      deliverableType: "litigation.complaint",
      draft: {
        title: "民事起诉状",
        sections: [{ heading: "诉讼请求", body: "请求判令被告支付房屋租赁合同项下欠款。" }],
      },
    });
    expect(gate.ok).toBe(true);
  });
});

describe("live-citation-hits", () => {
  it("extracts unique cited statute titles with a cap", () => {
    const titles = extractCitedStatuteTitles(
      "依据《民法典》第 500 条与《民法典》第 501 条，并参照《民事诉讼法》第 64 条。",
    );
    expect(titles).toEqual(["民法典", "民事诉讼法"]);
  });

  it("returns [] when NPC live lookup is disabled", async () => {
    const hits = await fetchLiveCitationHits("根据《合同法》第 107 条。", { enabled: false });
    expect(hits).toEqual([]);
  });

  it("maps NPC excerpt status into citation hits and tolerates per-title failure", async () => {
    const hits = await fetchLiveCitationHits("根据《合同法》第 107 条与《民法典》第 577 条。", {
      enabled: true,
      searchImpl: async (opts: { query: string }) => {
        if (opts.query === "合同法") {
          return {
            hits: [
              {
                id: "npc-flk:1",
                title: "中华人民共和国合同法",
                kind: "statute" as const,
                excerpt: "法律 · 全国人民代表大会 · 已废止/失效",
              },
            ],
          };
        }
        return { hits: [], error: "http_500" };
      },
    });
    expect(hits).toEqual([{ title: "中华人民共和国合同法", status: "已废止" }]);
  });
});
