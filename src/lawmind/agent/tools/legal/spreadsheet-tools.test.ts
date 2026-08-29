import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentContext } from "../../types.js";
import { analyzeSpreadsheet, writeSpreadsheet } from "./spreadsheet-tools.js";
import { writeXlsxWorkbook } from "./xlsx-workbook.js";

const dirs: string[] = [];

function tmpWs(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-xlsx-"));
  dirs.push(dir);
  return dir;
}

function ctx(workspaceDir: string, extra?: Partial<AgentContext>): AgentContext {
  return { workspaceDir, sessionId: "s1", actorId: "test", ...extra };
}

afterEach(() => {
  for (const d of dirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

describe("spreadsheet tools", () => {
  it("analyzes columns, types, and stats from a real xlsx", async () => {
    const ws = tmpWs();
    const abs = path.join(ws, "费用.xlsx");
    await writeXlsxWorkbook(abs, [
      {
        name: "明细",
        rows: [
          ["项目", "金额", "日期"],
          ["差旅", 100, "2024-01-01"],
          ["住宿", 200, "2024-01-02"],
          ["", 50, "2024-01-03"],
        ],
      },
    ]);
    const result = await analyzeSpreadsheet.execute({ path: "费用.xlsx", sheet: "明细" }, ctx(ws));
    expect(result.ok).toBe(true);
    const data = result.data as {
      rowCount: number;
      columns: Array<{ name: string; type: string; sum?: number; empty: number }>;
    };
    expect(data.rowCount).toBe(3);
    const amount = data.columns.find((c) => c.name === "金额");
    expect(amount?.type).toBe("number");
    expect(amount?.sum).toBe(350);
    expect(amount?.empty).toBe(0);
    const date = data.columns.find((c) => c.name === "日期");
    expect(date?.type).toBe("date");
  });

  it("rejects a path outside workspace and project", async () => {
    const ws = tmpWs();
    const result = await analyzeSpreadsheet.execute({ path: "../../etc/passwd.xlsx" }, ctx(ws));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/工作区外|找不到/);
  });

  it("caps rows at 5000 and still returns stats", async () => {
    const ws = tmpWs();
    const ExcelJS = await import("exceljs");
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet("s");
    sheet.addRow(["n"]);
    for (let i = 0; i < 5010; i++) {
      sheet.addRow([i]);
    }
    await wb.xlsx.writeFile(path.join(ws, "big.xlsx"));
    const result = await analyzeSpreadsheet.execute({ path: "big.xlsx" }, ctx(ws));
    expect(result.ok).toBe(true);
    const data = result.data as { rowCount: number; truncatedRows: boolean };
    expect(data.truncatedRows).toBe(true);
    expect(data.rowCount).toBeLessThanOrEqual(4999);
  });

  it("writes an xlsx under artifacts/", async () => {
    const ws = tmpWs();
    const result = await writeSpreadsheet.execute(
      {
        rows: [
          ["列", "值"],
          ["a", 1],
        ],
        filename: "out.xlsx",
        sheet: "结果",
      },
      ctx(ws),
    );
    expect(result.ok).toBe(true);
    expect(fs.existsSync(path.join(ws, "artifacts", "out.xlsx"))).toBe(true);
    const again = await analyzeSpreadsheet.execute({ path: "artifacts/out.xlsx" }, ctx(ws));
    expect(again.ok).toBe(true);
  });
});
