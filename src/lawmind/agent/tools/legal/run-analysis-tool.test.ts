import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { hiddenPolicyToolNames } from "../../../policy/analysis-scripts.js";
import { mergeWorkspacePolicyFile } from "../../../policy/workspace-policy.js";
import { ensureBuiltinSkillSeeds } from "../../../skills/ensure-builtin-skill-seeds.js";
import { writeSkillEnabled } from "../../../skills/skill-runtime.js";
import type { AgentContext } from "../../types.js";
import { resolveModelToolNames } from "../governance.js";
import { createLegalToolRegistry } from "../legal-tools.js";
import { runAnalysisScriptInVm } from "./analysis-sandbox.js";
import { writeDocument } from "./file-tools.js";
import { runAnalysis } from "./run-analysis-tool.js";
import { writeXlsxWorkbook } from "./xlsx-workbook.js";

const dirs: string[] = [];

function tmpWs(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-an-"));
  dirs.push(dir);
  return dir;
}

function ctx(workspaceDir: string): AgentContext {
  return { workspaceDir, sessionId: "s1", actorId: "test" };
}

const SUM_SCRIPT = `
const t = await readTable("src.xlsx");
const s = stats(t, "额");
await writeTable("artifacts/out.xlsx", { headers: ["sum"], rows: [[s.sum]] });
emitChart({ title: "额", type: "bar", categories: ["合计"], series: [{ name: "额", values: [s.sum] }] });
`;

afterEach(() => {
  for (const d of dirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

describe("run_analysis", () => {
  it("runs a confirmed artifacts script to write a table and emit a chart", async () => {
    const ws = tmpWs();
    mergeWorkspacePolicyFile(ws, { schemaVersion: 1, allowAnalysisScripts: true });
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
    const scriptDir = path.join(ws, "artifacts", "analysis-scripts");
    fs.mkdirSync(scriptDir, { recursive: true });
    fs.writeFileSync(path.join(scriptDir, "sum.js"), SUM_SCRIPT, "utf8");
    const result = await runAnalysis.execute(
      { path: "artifacts/analysis-scripts/sum.js", confirmed: true },
      ctx(ws),
    );
    expect(result.ok).toBe(true);
    const data = result.data as {
      tables: Array<{ path: string }>;
      charts: Array<{ title: string }>;
    };
    expect(data.tables[0]?.path).toBe("artifacts/out.xlsx");
    expect(data.charts[0]?.title).toBe("额");
    expect(fs.existsSync(path.join(ws, "artifacts", "out.xlsx"))).toBe(true);
  });

  it("runs a script from an enabled signed skill", async () => {
    const ws = tmpWs();
    mergeWorkspacePolicyFile(ws, { schemaVersion: 1, allowAnalysisScripts: true });
    ensureBuiltinSkillSeeds(ws);
    writeSkillEnabled(ws, "spreadsheet-analysis", true);
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
    const scriptDir = path.join(ws, "lawmind", "skills", "spreadsheet-analysis", "scripts");
    fs.mkdirSync(scriptDir, { recursive: true });
    fs.writeFileSync(path.join(scriptDir, "sum.js"), SUM_SCRIPT, "utf8");
    const result = await runAnalysis.execute(
      { path: "lawmind/skills/spreadsheet-analysis/scripts/sum.js" },
      ctx(ws),
    );
    expect(result.ok).toBe(true);
  });

  it("rejects unsigned skill scripts", async () => {
    const ws = tmpWs();
    mergeWorkspacePolicyFile(ws, { schemaVersion: 1, allowAnalysisScripts: true });
    const scriptDir = path.join(ws, "lawmind", "skills", "demo", "scripts");
    fs.mkdirSync(scriptDir, { recursive: true });
    fs.writeFileSync(
      path.join(scriptDir, "sum.js"),
      "emitChart({title:'x',type:'bar',categories:['a'],series:[{name:'n',values:[1]}]})",
      "utf8",
    );
    const result = await runAnalysis.execute(
      { path: "lawmind/skills/demo/scripts/sum.js" },
      ctx(ws),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/签名/);
  });

  it("rejects artifacts scripts without confirmed", async () => {
    const ws = tmpWs();
    mergeWorkspacePolicyFile(ws, { schemaVersion: 1, allowAnalysisScripts: true });
    const scriptDir = path.join(ws, "artifacts", "analysis-scripts");
    fs.mkdirSync(scriptDir, { recursive: true });
    fs.writeFileSync(path.join(scriptDir, "sum.js"), "1", "utf8");
    const result = await runAnalysis.execute(
      { path: "artifacts/analysis-scripts/sum.js" },
      ctx(ws),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/确认/);
  });

  it("rejects write_document planting a script", async () => {
    const ws = tmpWs();
    const result = await writeDocument.execute(
      { file_path: "artifacts/analysis-scripts/evil.js", content: "require('fs')" },
      ctx(ws),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/分析脚本/);
  });

  it("rejects fs / fetch and constructor escapes in the guest script", async () => {
    await expect(
      runAnalysisScriptInVm({
        source: `require("fs")`,
        workspaceDir: tmpWs(),
      }),
    ).rejects.toThrow(/禁止/);
    await expect(
      runAnalysisScriptInVm({
        source: `await fetch("https://example.com")`,
        workspaceDir: tmpWs(),
      }),
    ).rejects.toThrow(/禁止/);
    await expect(
      runAnalysisScriptInVm({
        source: `({}).constructor.constructor("return process")()`,
        workspaceDir: tmpWs(),
      }),
    ).rejects.toThrow(/禁止/);
  });

  it("times out a hanging guest script", async () => {
    await expect(
      runAnalysisScriptInVm({
        source: `await new Promise(() => {})`,
        workspaceDir: tmpWs(),
        timeoutMs: 80,
      }),
    ).rejects.toThrow(/超时/);
  });

  it("refuses non-xlsx readTable", async () => {
    const ws = tmpWs();
    fs.writeFileSync(path.join(ws, "note.md"), "x", "utf8");
    await expect(
      runAnalysisScriptInVm({
        source: `await readTable("note.md")`,
        workspaceDir: ws,
      }),
    ).rejects.toThrow(/xlsx/);
  });

  it("hides the tool from the model when policy is off", () => {
    const ws = tmpWs();
    mergeWorkspacePolicyFile(ws, { schemaVersion: 1, allowAnalysisScripts: false });
    const registry = createLegalToolRegistry();
    const names = resolveModelToolNames({
      registeredNames: registry.listDefinitions().map((d) => d.name),
      disclosedNames: ["run_analysis"],
    }).filter((n) => !hiddenPolicyToolNames(ws).includes(n));
    expect(names).not.toContain("run_analysis");
  });

  it("refuses execute when policy is off", async () => {
    const ws = tmpWs();
    const result = await runAnalysis.execute({ path: "lawmind/skills/demo/scripts/x.js" }, ctx(ws));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/未开启/);
  });
});
