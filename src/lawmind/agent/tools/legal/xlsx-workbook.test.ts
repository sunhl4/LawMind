import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  cellRaw,
  loadXlsxWorkbook,
  resolveExcelJsModule,
  writeXlsxWorkbook,
} from "./xlsx-workbook.js";

const tmpDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("resolveExcelJsModule", () => {
  it("accepts a flattened namespace (Vitest-style)", () => {
    class Workbook {}
    const ns = resolveExcelJsModule({ Workbook });
    expect(ns.Workbook).toBe(Workbook);
  });

  it("unwraps CJS default export (native ESM)", () => {
    class Workbook {}
    const ns = resolveExcelJsModule({ default: { Workbook } });
    expect(ns.Workbook).toBe(Workbook);
  });

  it("rejects modules without Workbook", () => {
    expect(() => resolveExcelJsModule({})).toThrow(/Workbook is not a constructor/);
  });
});

describe("cellRaw", () => {
  it("keeps null/empty and common object shapes without needing cell.text", () => {
    expect(cellRaw(null)).toBeNull();
    expect(cellRaw("")).toBeNull();
    expect(cellRaw({ result: null })).toBeNull();
    expect(cellRaw({ text: "条款A", hyperlink: "https://example.com" })).toBe("条款A");
    expect(cellRaw({ richText: [{ text: "甲" }, { text: "乙" }] })).toBe("甲乙");
    expect(cellRaw({ error: "#N/A" })).toBe("#N/A");
  });
});

describe("xlsx-workbook roundtrip", () => {
  it("writes and loads sheet rows via exceljs interop", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lm-xlsx-"));
    tmpDirs.push(dir);
    const filePath = path.join(dir, "ledger.xlsx");
    await writeXlsxWorkbook(filePath, [
      {
        name: "报价",
        rows: [
          ["项目", "金额"],
          ["吉利", 100],
        ],
      },
    ]);
    const loaded = await loadXlsxWorkbook(filePath);
    expect(loaded.sheets).toHaveLength(1);
    expect(loaded.sheets[0]?.name).toBe("报价");
    expect(loaded.sheets[0]?.rows[0]).toEqual(["项目", "金额"]);
    expect(loaded.sheets[0]?.rows[1]).toEqual(["吉利", 100]);
  });

  it("loads merged empty master cells without throwing on cell.text", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lm-xlsx-"));
    tmpDirs.push(dir);
    const filePath = path.join(dir, "merged.xlsx");
    const ExcelJS = resolveExcelJsModule(await import("exceljs"));
    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet("拆解");
    ws.getCell("A1").value = "标题";
    ws.mergeCells("A1:D1");
    // Empty merged block — exceljs MergeValue.toString() would throw on .text
    ws.mergeCells("A2:D2");
    ws.getCell("A3").value = 12;
    await workbook.xlsx.writeFile(filePath);

    const loaded = await loadXlsxWorkbook(filePath);
    expect(loaded.sheets[0]?.rows[0]?.[0]).toBe("标题");
    expect(loaded.sheets[0]?.rows[1]?.[0] ?? null).toBeNull();
    expect(loaded.sheets[0]?.rows[2]?.[0]).toBe(12);
  });
});
