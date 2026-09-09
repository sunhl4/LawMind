import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runClauseLint } from "./lint.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => readFileSync(path.join(__dirname, "fixtures", name), "utf-8");

describe("runClauseLint", () => {
  it("flags undefined article references", () => {
    const findings = runClauseLint(fixture("with-undefined-ref.txt"));
    const hit = findings.find((f) => f.ruleId === "clause.undefined_article_ref");
    expect(hit).toBeDefined();
    expect(hit?.message).toContain("第 5 条");
    expect(hit?.level).toBe("warning");
  });

  it("flags an undefined quoted term", () => {
    const text = "第一条 标的物\n甲方使用「未定义术语」进行说明。\n第二条 争议解决\n提交法院。";
    const findings = runClauseLint(text);
    const hit = findings.find((f) => f.ruleId === "clause.undefined_term");
    expect(hit).toBeDefined();
    expect(hit?.message).toContain("未定义术语");
  });

  it("info when obligations exist but no liability clause", () => {
    const findings = runClauseLint(fixture("obligations-only.txt"));
    const hit = findings.find((f) => f.ruleId === "clause.obligation_without_liability");
    expect(hit).toBeDefined();
    expect(hit?.level).toBe("info");
  });

  it("warns when a dispute clause is missing", () => {
    const findings = runClauseLint(fixture("obligations-only.txt"));
    const hit = findings.find((f) => f.ruleId === "clause.dispute_missing");
    expect(hit).toBeDefined();
    expect(hit?.level).toBe("warning");
  });

  it("passes a well-structured NDA", () => {
    const findings = runClauseLint(fixture("nda-simple.txt"));
    expect(findings.find((f) => f.ruleId === "clause.undefined_article_ref")).toBeUndefined();
    expect(findings.find((f) => f.ruleId === "clause.undefined_term")).toBeUndefined();
    expect(findings.find((f) => f.ruleId === "clause.dispute_missing")).toBeUndefined();
  });
});
