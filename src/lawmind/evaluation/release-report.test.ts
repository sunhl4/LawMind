import { describe, expect, it } from "vitest";
import { BUILTIN_BENCHMARK_TASKS } from "./benchmark.js";
import { buildReleaseReadinessReportMarkdown } from "./release-report.js";

describe("release readiness report", () => {
  it("combines golden journeys, replay fixtures, benchmark status, and commands", () => {
    const report = buildReleaseReadinessReportMarkdown({
      benchmarkTasks: BUILTIN_BENCHMARK_TASKS,
      benchmarkResults: [
        {
          benchmarkId: "bm-contract-review-001",
          runId: "run-1",
          ranAt: "2026-01-01T00:00:00.000Z",
          taskCompleted: true,
          kindMatched: true,
          keywordHitRate: 1,
          riskLevelMatched: true,
          reviewGateMatched: true,
          sourceCount: 2,
          claimCount: 2,
          latencyMs: 10,
          score: 0.9,
        },
      ],
    });
    expect(report).toContain("LawMind Release Readiness Report");
    expect(report).toContain("Golden journeys: 3");
    expect(report).toContain("Replay fixtures (synthetic regression, non-engine): 12");
    expect(report).toContain("Legal lint rules:");
    expect(report).toContain("Shadow fixtures");
    expect(report).toContain("Benchmark gate: pass");
    expect(report).toContain("pnpm lawmind:verify");
    expect(report).toContain("pnpm lawmind:compiler-gate");
  });

  it("renders the true-manuscript gate section when supplied", () => {
    const report = buildReleaseReadinessReportMarkdown({
      trueManuscript: {
        reportLine:
          "RUN: 3 file(s) · 3 sidecar baseline(s) → /repo/fixtures/lawmind-true-manuscript",
        detail: ["OK: nda.docx (1200 chars)", "OK baseline [contract]: nda.docx"],
      },
    });
    expect(report).toContain("## True Manuscript Gate");
    expect(report).toContain("RUN: 3 file(s)");
    expect(report).toContain("- OK baseline [contract]: nda.docx");
  });

  it("notes the gate honestly when not evaluated", () => {
    const report = buildReleaseReadinessReportMarkdown({});
    expect(report).toContain("## True Manuscript Gate");
    expect(report).toContain("not evaluated");
  });

  it("renders the release artifacts section when supplied", () => {
    const report = buildReleaseReadinessReportMarkdown({
      releaseArtifacts: {
        lines: [
          "- 产物目录：/repo/apps/lawmind-desktop/release",
          "- 安装包：LawMind-0.2.1-mac-arm64.dmg",
          "- macOS 签名/公证：已签名并公证（签名校验通过；Developer ID；公证已装订）",
          "- 自动更新清单：latest-mac.yml",
        ],
      },
    });
    expect(report).toContain("## Release Artifacts (signing / notarization / auto-update)");
    expect(report).toContain("已签名并公证");
    expect(report).toContain("latest-mac.yml");
  });

  it("notes the artifacts section honestly when not evaluated", () => {
    const report = buildReleaseReadinessReportMarkdown({});
    expect(report).toContain("Release artifacts not evaluated in this report.");
  });

  /**
   * 交付北极星章节。
   *
   * 这一节的特殊之处：别处在核「东西齐不齐」，这里在核「**有没有用**」。
   * 所以两个方向都必须能如实出现在报告里——包括**没证据**和**在变差**。
   */
  it("renders the delivery north star section when supplied", () => {
    const report = buildReleaseReadinessReportMarkdown({
      northStar: {
        lines: [
          "- 一次通过：78.0%（样本 41）",
          "- 趋势（近 90 天，6 周样本足够）：一次通过 +12.0 个百分点，逃逸 -8.0 个百分点 → improving",
        ],
        proven: true,
      },
    });
    expect(report).toContain("## Delivery North Star (does it help the lawyer?)");
    expect(report).toContain("一次通过：78.0%");
    expect(report).toContain("→ improving");
  });

  it("carries a worsening trend verbatim（不粉饰）", () => {
    const report = buildReleaseReadinessReportMarkdown({
      northStar: { lines: ["- 趋势：…… → worsening"], proven: false },
    });
    expect(report).toContain("→ worsening");
  });

  it("notes the north star section honestly when not evaluated", () => {
    const report = buildReleaseReadinessReportMarkdown({});
    expect(report).toContain("## Delivery North Star");
    expect(report).toContain("North star not evaluated in this report.");
  });
});
