import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { hiddenPolicyToolNames } from "../../../policy/analysis-scripts.js";
import { mergeWorkspacePolicyFile } from "../../../policy/workspace-policy.js";
import type { AgentContext } from "../../types.js";
import { resolveModelToolNames } from "../governance.js";
import { createLegalToolRegistry } from "../legal-tools.js";
import { runAnalysisScriptInVm } from "./analysis-sandbox.js";
import { runCompute, summarizeComputeForLawyer } from "./run-compute-tool.js";
import { writeXlsxWorkbook } from "./xlsx-workbook.js";

const dirs: string[] = [];

function tmpWs(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-compute-"));
  dirs.push(dir);
  return dir;
}

function ctx(workspaceDir: string): AgentContext {
  return { workspaceDir, sessionId: "s1", actorId: "test" };
}

afterEach(() => {
  for (const d of dirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

describe("run_compute", () => {
  it("runs inline JS, writes a table, persists a chart, and never echoes source", async () => {
    const ws = tmpWs();
    await writeXlsxWorkbook(path.join(ws, "src.xlsx"), [
      {
        name: "s",
        rows: [
          ["项", "额"],
          ["a", 10],
          ["b", 20],
        ],
      },
    ]);
    const source = `
const t = await readTable("src.xlsx");
const s = stats(t, "额");
const total = Math.round(s.sum);
await writeTable("out.xlsx", { headers: ["合计"], rows: [[total]] });
emitChart({ title: "费用", type: "bar", categories: ["合计"], series: [{ name: "额", values: [total] }] });
return total;
`;
    const result = await runCompute.execute({ source, purpose: "汇总费用并出图" }, ctx(ws));
    expect(result.ok).toBe(true);
    const data = result.data as {
      tables: Array<{ path: string }>;
      charts: Array<{ path: string; spec: { title: string } }>;
      value: number;
      lawyerSummary: string;
      hint: string;
      pack?: { taskId: string; draftPath: string; title: string };
    };
    expect(data.tables[0]?.path).toMatch(/汇总费用并出图_\d{8}_01\.xlsx$/);
    expect(data.charts[0]?.spec.title).toBe("费用");
    expect(data.charts[0]?.path.startsWith("artifacts/charts/")).toBe(true);
    expect(fs.existsSync(path.join(ws, data.charts[0].path))).toBe(true);
    expect(data.value).toBe(30);
    expect(data.lawyerSummary).toContain("已出核算对照");
    expect(data.lawyerSummary).toContain("已进在办");
    expect(data.pack?.taskId).toMatch(/^compute-/);
    expect(data.pack?.draftPath).toMatch(/^drafts\/compute-.+\.json$/);
    expect(fs.existsSync(path.join(ws, data.pack!.draftPath))).toBe(true);
    const draftJson = fs.readFileSync(path.join(ws, data.pack!.draftPath), "utf8");
    expect(draftJson).toContain("结论");
    expect(draftJson).toContain("对照");
    expect(draftJson).toContain("来源");
    expect(draftJson).not.toContain("readTable");
    expect(data.hint).toContain("lm-chart");
    expect(JSON.stringify(result)).not.toContain("readTable");
    expect(JSON.stringify(result)).not.toContain("Math.round");
  });

  it("returns the sandbox error so the model can retry", async () => {
    const result = await runCompute.execute({ source: "require('fs')" }, ctx(tmpWs()));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/禁止/);
  });

  it("rejects empty source and high-security mode", async () => {
    const ws = tmpWs();
    expect((await runCompute.execute({ source: "   " }, ctx(ws))).ok).toBe(false);
    mergeWorkspacePolicyFile(ws, { schemaVersion: 1, highSecurityMode: true });
    const blocked = await runCompute.execute({ source: "return 1" }, ctx(ws));
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toMatch(/高安全/);
    expect(hiddenPolicyToolNames(ws)).toContain("run_compute");
  });

  it("is disclosed by default and stays available when allowAnalysisScripts is off", () => {
    const ws = tmpWs();
    mergeWorkspacePolicyFile(ws, { schemaVersion: 1, allowAnalysisScripts: false });
    const registry = createLegalToolRegistry();
    const names = resolveModelToolNames({
      registeredNames: registry.listDefinitions().map((d) => d.name),
      disclosedNames: ["run_compute"],
    }).filter((n) => !hiddenPolicyToolNames(ws).includes(n));
    expect(names).toContain("run_compute");
    expect(names).not.toContain("run_analysis");
  });

  it("summarizes deliverables without code", () => {
    expect(
      summarizeComputeForLawyer({
        tables: [{ path: "artifacts/费用.xlsx" }],
        charts: [{ spec: { title: "费用" } }],
        inWorkbench: true,
      }),
    ).toBe("已出核算对照 费用.xlsx · 已出图「费用」 · 已进在办");
  });
});

describe("analysis sandbox language", () => {
  it("exposes Math and JSON so ordinary JS works", async () => {
    const result = await runAnalysisScriptInVm({
      source: `return { n: Math.max(2, 9), k: Object.keys(JSON.parse('{"a":1}')) }`,
      workspaceDir: tmpWs(),
    });
    expect(result.value).toEqual({ n: 9, k: ["a"] });
  });

  it("reads csv and json from the workspace", async () => {
    const ws = tmpWs();
    fs.writeFileSync(path.join(ws, "fees.csv"), "项,额\n差旅,12\n餐饮,8\n", "utf8");
    fs.writeFileSync(path.join(ws, "meta.json"), JSON.stringify({ unit: "元" }), "utf8");
    const result = await runAnalysisScriptInVm({
      source: `
const t = await readCsv("fees.csv");
const meta = await readJson("meta.json");
return { sum: stats(t, "额").sum, unit: meta.unit };
`,
      workspaceDir: ws,
    });
    expect(result.value).toEqual({ sum: 20, unit: "元" });
  });
});
