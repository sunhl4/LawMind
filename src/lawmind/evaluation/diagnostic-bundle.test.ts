import { describe, expect, it } from "vitest";
import {
  buildDiagnosticBundleFiles,
  isSafeBundleFileName,
  redactSecrets,
} from "./diagnostic-bundle.js";

describe("diagnostic bundle (redacted)", () => {
  it("redacts key-shaped fields whatever their nesting", () => {
    const out = redactSecrets({
      apiKey: "sk-live-123",
      deep: { nested: { mailSecretsKey: "abc", token: "t", ok: "keep-me" } },
      list: [{ authorization: "Bearer x", note: "keep" }],
      activationCode: "AAAA.BBBB",
      envFile: "/Users/x/.env.lawmind",
      privateKeyDerB64: "MC4CAQA",
    }) as Record<string, unknown>;
    expect(out.apiKey).toBe("[redacted]");
    expect(out.activationCode).toBe("[redacted]");
    expect(out.envFile).toBe("[redacted]");
    expect(out.privateKeyDerB64).toBe("[redacted]");
    const deep = ((out.deep as Record<string, unknown>).nested ?? {}) as Record<string, unknown>;
    expect(deep.mailSecretsKey).toBe("[redacted]");
    expect(deep.token).toBe("[redacted]");
    expect(deep.ok).toBe("keep-me");
    const list = out.list as Array<Record<string, unknown>>;
    expect(list[0]?.authorization).toBe("[redacted]");
    expect(list[0]?.note).toBe("keep");
  });

  it("never includes case text, drafts or materials", () => {
    const files = buildDiagnosticBundleFiles({
      workspaceDir: "/tmp/ws",
      health: { license: { status: "trial" } },
      metrics: { total: 3 },
      scorecard: { rows: [] },
      build: { platform: "darwin" },
    });
    const names = files.map((f) => f.name);
    expect(names).toEqual([
      "README.txt",
      "doctor.json",
      "metrics.json",
      "scorecard.json",
      "build.json",
    ]);
    for (const name of names) {
      expect(name).not.toMatch(/CASE|draft|material|session/i);
    }
    // README 明说包内不含什么（支持方与律师都看得到）。
    const readme = files.find((f) => f.name === "README.txt")?.content ?? "";
    expect(readme).toContain("不含");
    expect(readme).toContain("案件正文");
  });

  it("includes an audit summary only when provided", () => {
    const base = {
      workspaceDir: "/tmp/ws",
      health: {},
      metrics: {},
      scorecard: {},
      build: {},
    };
    expect(buildDiagnosticBundleFiles(base).some((f) => f.name === "audit-summary.md")).toBe(false);
    expect(
      buildDiagnosticBundleFiles({ ...base, auditSummaryMarkdown: "# 审计\n任务 3 条" }).some(
        (f) => f.name === "audit-summary.md",
      ),
    ).toBe(true);
  });

  it("files in the bundle pass the filename fence", () => {
    const files = buildDiagnosticBundleFiles({
      workspaceDir: "/tmp/ws",
      health: {},
      metrics: {},
      scorecard: {},
      build: {},
    });
    for (const file of files) {
      expect(isSafeBundleFileName(file.name)).toBe(true);
    }
    expect(isSafeBundleFileName("../escape.json")).toBe(false);
    expect(isSafeBundleFileName("sub/dir.json")).toBe(false);
    expect(isSafeBundleFileName("")).toBe(false);
  });

  it("doctor file keeps only the safe status facts (no paths, no endpoints)", () => {
    const files = buildDiagnosticBundleFiles({
      workspaceDir: "/tmp/ws",
      health: {
        license: { status: "trial", trialDaysLeft: 12, blocking: false },
        authority: { provider: "open", status: "sample-ready", configured: true },
      },
      metrics: {},
      scorecard: {},
      build: {},
    });
    const doctor = files.find((f) => f.name === "doctor.json")?.content ?? "";
    expect(doctor).toContain("sample-ready");
    expect(doctor).not.toContain("/Users");
  });
});
