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
});
