import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadWorkspaceDeliverableSpecs, parseDeliverableSpec } from "./workspace-loader.js";

let workspaceDir: string;
let deliverablesDir: string;

beforeEach(() => {
  workspaceDir = mkdtempSync(path.join(tmpdir(), "lawmind-spec-"));
  deliverablesDir = path.join(workspaceDir, "lawmind", "deliverables");
});

afterEach(() => {
  if (workspaceDir) {
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});

function writeJson(name: string, body: unknown): string {
  mkdirSync(deliverablesDir, { recursive: true });
  const full = path.join(deliverablesDir, name);
  writeFileSync(full, JSON.stringify(body, null, 2), "utf-8");
  return full;
}

describe("deliverables/workspace-loader", () => {
  it("returns empty result when directory is missing", () => {
    const result = loadWorkspaceDeliverableSpecs(workspaceDir);
    expect(result.specs).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it("loads a valid custom spec with sensible defaults", () => {
    writeJson("employment.json", {
      type: "contract.employment",
      displayName: "劳动合同",
      description: "全职劳动合同正本",
      defaultTemplateId: "contract-employment-default",
      requiredSections: [
        {
          headingKeywords: ["主体", "用人单位", "劳动者"],
          purpose: "合同双方",
          severity: "blocker",
        },
        {
          headingKeywords: ["岗位", "职责"],
          purpose: "工作内容",
          severity: "warning",
        },
      ],
      acceptanceCriteria: ["输出可签署的完整正文"],
      defaultClarificationQuestions: [
        { key: "salary", question: "请补充薪资构成", reason: "劳动合同核心条款" },
      ],
    });

    const result = loadWorkspaceDeliverableSpecs(workspaceDir);
    expect(result.warnings).toEqual([]);
    expect(result.specs).toHaveLength(1);
    const spec = result.specs[0];
    expect(spec.type).toBe("contract.employment");
    expect(spec.defaultOutput).toBe("docx");
    expect(spec.defaultRiskLevel).toBe("medium");
    expect(spec.requiredSections).toHaveLength(2);
    expect(spec.placeholderRule.mustResolveBeforeRender).toBe(false);
    expect(spec.placeholderRule.pattern?.flags ?? "").toContain("g");
    expect(spec.defaultClarificationQuestions[0]?.question).toBe("请补充薪资构成");
  });

  it("rejects built-in type override unless overrideBuiltin=true", () => {
    writeJson("override-attempt.json", {
      type: "contract.general",
      displayName: "私改商务合同",
      description: "未授权覆盖",
      defaultTemplateId: "x",
      requiredSections: [{ headingKeywords: ["主体"], purpose: "签约主体", severity: "blocker" }],
    });
    const result = loadWorkspaceDeliverableSpecs(workspaceDir);
    expect(result.specs).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]?.message).toContain("内置类型");
  });

  it("allows built-in override when overrideBuiltin=true", () => {
    writeJson("override-allowed.json", {
      type: "contract.general",
      displayName: "事务所版商务合同",
      description: "事务所定制",
      defaultTemplateId: "contract-general-firm",
      overrideBuiltin: true,
      requiredSections: [
        { headingKeywords: ["主体", "甲方", "乙方"], purpose: "签约主体", severity: "blocker" },
      ],
      acceptanceCriteria: ["必须含数据保护条款"],
    });
    const result = loadWorkspaceDeliverableSpecs(workspaceDir);
    expect(result.warnings).toEqual([]);
    expect(result.specs).toHaveLength(1);
    expect(result.specs[0]?.displayName).toBe("事务所版商务合同");
  });

  it("collects warnings for malformed JSON without aborting siblings", () => {
    mkdirSync(deliverablesDir, { recursive: true });
    writeFileSync(path.join(deliverablesDir, "broken.json"), "{ not valid json", "utf-8");
    writeJson("good.json", {
      type: "contract.licensing",
      displayName: "许可合同",
      description: "IP 许可",
      defaultTemplateId: "contract-licensing",
      requiredSections: [
        { headingKeywords: ["许可", "标的"], purpose: "许可标的", severity: "blocker" },
      ],
    });
    const result = loadWorkspaceDeliverableSpecs(workspaceDir);
    expect(result.specs).toHaveLength(1);
    expect(result.specs[0]?.type).toBe("contract.licensing");
    expect(result.warnings.some((w) => w.file.endsWith("broken.json"))).toBe(true);
  });

  it("rejects spec missing required fields", () => {
    writeJson("bad.json", {
      // missing type
      displayName: "缺 type",
      description: "无效",
      defaultTemplateId: "x",
      requiredSections: [{ headingKeywords: ["主体"], purpose: "p", severity: "blocker" }],
    });
    const result = loadWorkspaceDeliverableSpecs(workspaceDir);
    expect(result.specs).toHaveLength(0);
    expect(result.warnings[0]?.message).toContain("type");
  });

  it("dedupes duplicate types within the same workspace", () => {
    writeJson("a.json", {
      type: "contract.x",
      displayName: "X 合同 A",
      description: "first",
      defaultTemplateId: "x",
      requiredSections: [{ headingKeywords: ["主体"], purpose: "p", severity: "blocker" }],
    });
    writeJson("b.json", {
      type: "contract.x",
      displayName: "X 合同 B",
      description: "duplicate",
      defaultTemplateId: "x",
      requiredSections: [{ headingKeywords: ["主体"], purpose: "p", severity: "blocker" }],
    });
    const result = loadWorkspaceDeliverableSpecs(workspaceDir);
    expect(result.specs).toHaveLength(1);
    expect(result.specs[0]?.displayName).toBe("X 合同 A");
    expect(result.warnings.some((w) => w.message.includes("已被其它文件注册"))).toBe(true);
  });

  it("parseDeliverableSpec returns string error for invalid severity", () => {
    const out = parseDeliverableSpec({
      type: "contract.x",
      displayName: "X",
      description: "x",
      defaultTemplateId: "x",
      requiredSections: [{ headingKeywords: ["主体"], purpose: "p", severity: "fatal" }],
    });
    expect(typeof out).toBe("string");
    expect(out as string).toContain("severity");
  });
});
