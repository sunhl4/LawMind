import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyXlsxCellEdits, loadXlsxUiPreview } from "./xlsx-preview.js";
import { importExcelJsForPreview, writeXlsxWorkbook } from "./xlsx-workbook.js";

const tmpDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("loadXlsxUiPreview", () => {
  it("exports borders, merges, column widths, and sheet names for Excel-like UI", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lm-xlsx-ui-"));
    tmpDirs.push(dir);
    const filePath = path.join(dir, "styled.xlsx");
    const ExcelJS = await importExcelJsForPreview();
    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet("费用");
    ws.getColumn(1).width = 20;
    ws.getColumn(2).width = 12;
    ws.getCell("A1").value = "科目";
    ws.getCell("A1").fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFD9EAD3" },
    };
    ws.getCell("A1").border = {
      top: { style: "medium", color: { argb: "FF000000" } },
      left: { style: "medium", color: { argb: "FF000000" } },
      bottom: { style: "medium", color: { argb: "FF000000" } },
      right: { style: "thin", color: { argb: "FF000000" } },
    };
    ws.getCell("B1").value = "金额";
    ws.getCell("A2").value = "律师费";
    ws.getCell("B2").value = 12000;
    ws.mergeCells("A3:B3");
    ws.getCell("A3").value = "合计";
    workbook.addWorksheet("附注");
    await workbook.xlsx.writeFile(filePath);

    const loaded = await loadXlsxUiPreview(filePath);
    expect(loaded.sheets.map((s) => s.name)).toEqual(["费用", "附注"]);
    const sheet = loaded.sheets[0];
    expect(sheet.colCount).toBeGreaterThanOrEqual(2);
    expect(sheet.colWidthsPx[0]).toBeGreaterThan(100);
    const a1 = sheet.cells[0]?.[0];
    expect(a1?.v).toBe("科目");
    expect(a1?.s?.bg?.toLowerCase()).toBe("#d9ead3");
    expect(a1?.s?.border?.t?.style).toBe("medium");
    const merged = sheet.cells[2]?.[0];
    expect(merged?.v).toBe("合计");
    expect(merged?.cs).toBe(2);
    expect(sheet.cells[2]?.[1]).toBeNull();
  });

  it("still loads plain workbooks written by writeXlsxWorkbook", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lm-xlsx-ui-"));
    tmpDirs.push(dir);
    const filePath = path.join(dir, "plain.xlsx");
    await writeXlsxWorkbook(filePath, [{ name: "Sheet1", rows: [["a", 1]] }]);
    const loaded = await loadXlsxUiPreview(filePath);
    expect(loaded.sheets[0]?.cells[0]?.[0]?.v).toBe("a");
    expect(loaded.sheets[0]?.cells[0]?.[1]?.v).toBe(1);
  });

  it("saves over a read-only xlsx (WeChat-style 0444)", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lm-xlsx-ro-"));
    tmpDirs.push(dir);
    const filePath = path.join(dir, "readonly.xlsx");
    await writeXlsxWorkbook(filePath, [{ name: "费用", rows: [["旧"]] }]);
    await fs.chmod(filePath, 0o444);
    await applyXlsxCellEdits(filePath, [{ sheet: "费用", row: 1, col: 1, value: "新" }]);
    const loaded = await loadXlsxUiPreview(filePath);
    expect(loaded.sheets[0]?.cells[0]?.[0]?.v).toBe("新");
  });

  it("applies cell edits while keeping fill style", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lm-xlsx-ui-"));
    tmpDirs.push(dir);
    const filePath = path.join(dir, "edit.xlsx");
    const ExcelJS = await importExcelJsForPreview();
    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet("费用");
    ws.getCell("A1").value = "旧";
    ws.getCell("A1").fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFFFF2CC" },
    };
    await workbook.xlsx.writeFile(filePath);

    await applyXlsxCellEdits(filePath, [{ sheet: "费用", row: 1, col: 1, value: "新" }]);
    const loaded = await loadXlsxUiPreview(filePath);
    expect(loaded.sheets[0]?.cells[0]?.[0]?.v).toBe("新");
    expect(loaded.sheets[0]?.cells[0]?.[0]?.s?.bg?.toLowerCase()).toBe("#fff2cc");
  });
});
