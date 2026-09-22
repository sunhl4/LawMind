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

describe("run_compute 批量整理材料", () => {
  it("一次跑完一个文件夹的清单（不必逐个文件调工具）", async () => {
    const ws = tmpWs();
    const materials = path.join(ws, "cases", "甲案", "materials", "岚江公司");
    fs.mkdirSync(materials, { recursive: true });
    for (let i = 1; i <= 30; i += 1) {
      fs.writeFileSync(
        path.join(materials, `材料${String(i).padStart(3, "0")}.txt`),
        i % 3 === 0 ? "含违约金条款" : "普通条款",
        "utf8",
      );
    }
    const source = `
const listed = await listFiles("cases/甲案/materials", { recursive: true });
const files = listed.entries.filter((e) => e.kind === "file");
const rows = [];
for (const f of files) {
  const text = await readText(f.path);
  rows.push([f.name, text.includes("违约金") ? "有" : "无"]);
}
await writeTable("材料清单.xlsx", { headers: ["文件", "含违约金"], rows });
const written = await writeText("材料清单.txt", files.map((f) => f.name).join("\\n"));
return { files: files.length, hits: rows.filter((r) => r[1] === "有").length, written };
`;
    const result = await runCompute.execute({ source, purpose: "整理岚江公司材料清单" }, ctx(ws));
    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    const data = result.data as {
      tables: Array<{ path: string; rowCount: number }>;
      files?: Array<{ path: string }>;
      value: { files: number; hits: number };
      lawyerSummary: string;
    };
    expect(data.value).toMatchObject({ files: 30, hits: 10 });
    expect(data.tables[0]?.rowCount).toBe(30);
    // 文本清单也落了盘，路径回传给模型供后续 write_document。
    expect(data.files?.[0]?.path).toBe("artifacts/analysis/材料清单.txt");
    expect(fs.existsSync(path.join(ws, "artifacts", "analysis", "材料清单.txt"))).toBe(true);
    // 给律师的摘要仍然只说交件，不露代码。
    expect(data.lawyerSummary).toContain("已出核算对照");
    expect(JSON.stringify(result)).not.toContain("listFiles");
  });
});
