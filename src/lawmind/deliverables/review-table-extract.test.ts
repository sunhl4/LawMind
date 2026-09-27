import { describe, expect, it, vi } from "vitest";
import {
  buildCellSource,
  extractReviewTable,
  guessDocKind,
  preserveLockedReviewRows,
  stableReviewRowId,
  summarizeReviewExtract,
  type ReviewExtractCellResult,
  type ReviewExtractDoc,
} from "./review-table-extract.js";
import {
  REVIEW_TABLE_ABSTAIN_TEXT,
  newReviewTable,
  reviewTableAcceptanceProblems,
  reviewTableValueColumns,
  cellProvenance,
  type ReviewTable,
} from "./review-table.js";

function table(): ReviewTable {
  const t = newReviewTable("task-1", "due_diligence", "尽调审查表");
  return t;
}

const alwaysOk = async (): Promise<ReviewExtractCellResult> => ({ ok: true, value: "已发现" });
const alwaysAbstain = async (): Promise<ReviewExtractCellResult> => ({
  ok: false,
  reason: "文中未提及",
});

describe("guessDocKind / buildCellSource", () => {
  it("classifies material kinds by extension", () => {
    expect(guessDocKind("a/b/scan.PNG")).toBe("image");
    expect(guessDocKind("contract.pdf")).toBe("pdf");
    expect(guessDocKind("note.md")).toBe("text");
    expect(guessDocKind("book.xlsx")).toBe("xlsx");
    expect(guessDocKind("thing.bin")).toBe("unknown");
  });

  it("appends a locator to the source path", () => {
    expect(buildCellSource("cases/m1/materials/a.docx")).toBe("cases/m1/materials/a.docx");
    expect(buildCellSource("cases/m1/materials/a.docx", "page=2")).toBe(
      "cases/m1/materials/a.docx#page=2",
    );
    expect(buildCellSource("a.docx", "#h=条款 3")).toBe("a.docx#h=条款 3");
  });
});

describe("extractReviewTable", () => {
  /** due_diligence: item/document are name columns; finding/risk are extraction targets. */
  function firstValueKey(t: ReviewTable): string {
    return reviewTableValueColumns(t)[0].key;
  }

  it("keeps the file-name column as metadata and extracts only content columns", async () => {
    const docs: ReviewExtractDoc[] = [
      { relPath: "cases/m1/materials/a.docx", text: "甲方应于 30 日内付款。" },
    ];
    const { table: out } = await extractReviewTable({
      table: table(),
      docs,
      extractCell: alwaysOk,
    });
    const row = out.rows[0];
    // 文件名列保留材料名，不被抽取结果覆盖。
    expect(row.cells["item"]).toBe("a.docx");
    expect(row.cells["document"]).toBe("a.docx");
    expect(row.cells["finding"]).toBe("已发现");
  });

  it("fills one row per document with per-cell provenance", async () => {
    const docs: ReviewExtractDoc[] = [
      { relPath: "cases/m1/materials/a.docx", text: "甲方应于 30 日内付款。" },
      { relPath: "cases/m1/materials/b.docx", text: "乙方负责交付。" },
    ];
    const { table: out, stats } = await extractReviewTable({
      table: table(),
      docs,
      extractCell: async ({ doc }) =>
        doc.relPath.endsWith("a.docx")
          ? { ok: true, value: "30 日", locator: "page=1", confidence: "high" }
          : { ok: false, reason: "未见付款条款" },
    });

    expect(out.rows).toHaveLength(2);
    expect(stats.filled).toBeGreaterThan(0);
    expect(stats.abstained).toBeGreaterThan(0);

    const row = out.rows[0];
    expect(row.source).toBe("cases/m1/materials/a.docx");
    const key = firstValueKey(out);
    const meta = row.cellMeta?.[key];
    expect(meta?.source).toBe("cases/m1/materials/a.docx#page=1");
    expect(meta?.confidence).toBe("high");
    expect(cellProvenance(row, key).state).toBe("sourced");

    // Abstained cells carry the honest marker value plus a reason, never a guess.
    expect(out.rows[1].cells[key]).toBe(REVIEW_TABLE_ABSTAIN_TEXT);
    expect(out.rows[1].cellMeta?.[key]?.abstained).toBe(true);
    expect(out.rows[1].cellMeta?.[key]?.note).toBe("未见付款条款");
  });

  it("never fabricates when a document has no usable text", async () => {
    const { table: out, stats } = await extractReviewTable({
      table: table(),
      docs: [{ relPath: "cases/m1/materials/empty.docx" }],
      extractCell: alwaysOk,
    });
    expect(stats.rowsWithoutText).toBe(1);
    expect(stats.filled).toBe(0);
    const row = out.rows[0];
    for (const col of reviewTableValueColumns(out)) {
      expect(row.cells[col.key]).toBe(REVIEW_TABLE_ABSTAIN_TEXT);
      expect(row.cellMeta?.[col.key]?.abstained).toBe(true);
    }
    // 没有正文也不丢材料名——行仍可追溯。
    expect(row.cells["item"]).toBe("empty.docx");
  });

  it("uses read-only OCR fallback for scans without asking the lawyer", async () => {
    const ocr = vi.fn(async () => ({
      ok: true as const,
      text: "扫描件正文：付款期 30 日",
      provider: "tesseract",
    }));
    const { table: out, stats } = await extractReviewTable({
      table: table(),
      docs: [
        {
          relPath: "cases/m1/materials/scan.png",
          absolutePath: "/tmp/scan.png",
          kind: "image",
        },
      ],
      extractCell: async ({ fromOcr }) => ({
        ok: true,
        value: "30 日",
        confidence: fromOcr ? "low" : "high",
      }),
      ocr,
    });
    expect(ocr).toHaveBeenCalledOnce();
    expect(stats.ocrUsed).toBe(1);
    const row = out.rows[0];
    const key = firstValueKey(out);
    // OCR-derived cells are automatically downgraded and labelled, but still sourced.
    expect(row.cellMeta?.[key]?.confidence).toBe("low");
    expect(row.cellMeta?.[key]?.note).toBe("OCR 只读抽取");
    expect(cellProvenance(row, key).state).toBe("sourced");
  });

  it("abstains instead of inventing when OCR fails", async () => {
    const { table: out, stats } = await extractReviewTable({
      table: table(),
      docs: [
        { relPath: "cases/m1/materials/scan.png", absolutePath: "/tmp/scan.png", kind: "image" },
      ],
      extractCell: alwaysOk,
      ocr: async () => ({ ok: false, error: "tesseract missing" }),
    });
    expect(stats.ocrFailed).toBe(1);
    expect(stats.filled).toBe(0);
    expect(out.rows[0].cells[firstValueKey(out)]).toBe(REVIEW_TABLE_ABSTAIN_TEXT);
  });

  it("treats a thrown extractor as an abstain, not a crash", async () => {
    const { table: out, stats } = await extractReviewTable({
      table: table(),
      docs: [{ relPath: "a.docx", text: "有正文" }],
      extractCell: async () => {
        throw new Error("模型超时");
      },
    });
    expect(stats.abstained).toBeGreaterThan(0);
    const key = firstValueKey(out);
    expect(out.rows[0].cellMeta?.[key]?.note).toBe("模型超时");
  });

  it("only extracts the requested columns but still stamps sources", async () => {
    const t = table();
    const { table: out } = await extractReviewTable({
      table: t,
      docs: [{ relPath: "a.docx", text: "正文" }],
      extractCell: alwaysOk,
      columnKeys: ["finding"],
    });
    const row = out.rows[0];
    expect(row.cells["finding"]).toBe("已发现");
    expect(row.cells["risk"]).toBeUndefined();
    expect(row.cells["source"]).toBe("a.docx");
  });

  it("reports progress for every document without waiting on a human", async () => {
    const seen: string[] = [];
    await extractReviewTable({
      table: table(),
      docs: [
        { relPath: "a.docx", text: "甲" },
        { relPath: "b.docx", text: "乙" },
      ],
      extractCell: alwaysOk,
      onProgress: (e) => seen.push(e.phase),
    });
    expect(seen).toContain("read");
    expect(seen).toContain("cell");
    expect(seen).toContain("done");
  });

  it("bounds document concurrency", async () => {
    let active = 0;
    let peak = 0;
    const docs: ReviewExtractDoc[] = Array.from({ length: 12 }, (_, i) => ({
      relPath: `d${i}.docx`,
      text: "正文",
    }));
    await extractReviewTable({
      table: table(),
      docs,
      concurrency: 3,
      extractCell: async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active -= 1;
        return { ok: true, value: "x" };
      },
    });
    expect(peak).toBeLessThanOrEqual(3);
  });

  it("stops cleanly on abort and abstains the rest", async () => {
    const controller = new AbortController();
    controller.abort();
    const { table: out, stats } = await extractReviewTable({
      table: table(),
      docs: [{ relPath: "a.docx", text: "正文" }],
      extractCell: alwaysOk,
      signal: controller.signal,
    });
    expect(stats.filled).toBe(0);
    expect(stats.abstained).toBeGreaterThan(0);
    expect(out.rows[0].cells[reviewTableValueColumns(out)[0].key]).toBe(REVIEW_TABLE_ABSTAIN_TEXT);
  });

  it("summarises the run in one lawyer-readable line", () => {
    const line = summarizeReviewExtract({
      docs: 300,
      cells: 1500,
      filled: 1400,
      abstained: 100,
      ocrUsed: 12,
      ocrFailed: 1,
      readFailed: 0,
      rowsWithoutText: 1,
    });
    expect(line).toContain("300 份材料");
    expect(line).toContain("1400 格有出处");
    expect(line).toContain("100 格弃答");
  });

  it("uses a stable row id and does not blame another document for OCR failure", async () => {
    const first = await extractReviewTable({
      table: table(),
      docs: [
        { relPath: "cases/m/materials/empty.txt" },
        {
          relPath: "cases/m/materials/scan.png",
          absolutePath: "/tmp/scan.png",
          kind: "image",
        },
      ],
      extractCell: async () => ({ ok: true, value: "x" }),
      ocr: async () => ({ ok: false, error: "missing" }),
    });
    expect(first.table.rows[0]?.id).toBe(stableReviewRowId(0, "cases/m/materials/empty.txt"));
    expect(first.table.rows[0]?.cellMeta?.[firstValueKey(first.table)]?.note).toBe(
      "该材料无可用正文",
    );
    expect(first.table.rows[1]?.cellMeta?.[firstValueKey(first.table)]?.note).toBe(
      "扫描件未能识别出正文",
    );
    const second = await extractReviewTable({
      table: table(),
      docs: [{ relPath: "cases/m/materials/empty.txt" }],
      extractCell: async () => ({ ok: false, reason: "无" }),
    });
    expect(second.table.rows[0]?.id).toBe(first.table.rows[0]?.id);
  });

  it("keeps a locked row when the same material is extracted again", () => {
    const previous = table();
    previous.rows = [
      {
        id: "kept",
        cells: { finding: "律师核过" },
        source: "a.docx",
        review: { locked: true },
      },
    ];
    const next = [
      {
        id: "new",
        cells: { finding: "重抽" },
        source: "a.docx",
      },
    ];
    const merged = preserveLockedReviewRows(previous.rows, next);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.cells.finding).toBe("律师核过");
    expect(merged[0]?.id).toBe("kept");
  });
});

describe("acceptance with abstains", () => {
  it("accepts sourced rows and explicit abstains, rejects unsourced values", async () => {
    const good = await extractReviewTable({
      table: table(),
      docs: [{ relPath: "a.docx", text: "正文" }],
      extractCell: alwaysOk,
    });
    expect(reviewTableAcceptanceProblems(good.table)).toEqual([]);

    const abstained = await extractReviewTable({
      table: table(),
      docs: [{ relPath: "a.docx", text: "正文" }],
      extractCell: alwaysAbstain,
    });
    // Every value cell abstained, and the row still carries its material path.
    expect(reviewTableAcceptanceProblems(abstained.table)).toEqual([]);

    // A hand-written value with no source and no abstain is the only blocker.
    const handWritten: ReviewTable = {
      ...table(),
      rows: [
        {
          id: "r1",
          cells: { item: "某事项", finding: "有风险" },
        },
      ],
    };
    expect(reviewTableAcceptanceProblems(handWritten)).toEqual(["1 行缺来源"]);
  });
});
