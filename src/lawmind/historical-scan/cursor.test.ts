import { describe, expect, it } from "vitest";
import { classifyWalkedItems, hashCatalogFingerprint, mergeCatalog } from "./cursor.js";
import type { HistoricalCatalogItem, HistoricalScanCursor } from "./types.js";

function item(
  partial: Partial<HistoricalCatalogItem> & Pick<HistoricalCatalogItem, "relPath">,
): HistoricalCatalogItem {
  return {
    rootId: "root_a",
    fileName: "供货合同.docx",
    ext: ".docx",
    size: 10,
    mtimeMs: 1_000,
    kind: "contract",
    layout: "organized",
    proposedMatterLabel: "华能采购案",
    ...partial,
  };
}

describe("historical-scan cursor", () => {
  it("classifies same relPath + mtimeMs + size as unchanged", () => {
    const walked = [
      item({ relPath: "华能采购案/供货合同.docx" }),
      item({
        relPath: "随便一份.pdf",
        fileName: "随便一份.pdf",
        ext: ".pdf",
        size: 3,
        kind: "other",
        layout: "messy",
      }),
    ];
    const cursor: HistoricalScanCursor = {
      schemaVersion: 1,
      roots: {
        root_a: {
          files: {
            "华能采购案/供货合同.docx": { mtimeMs: 1_000, size: 10 },
          },
        },
      },
    };
    const classified = classifyWalkedItems(walked, cursor);
    expect(classified.unchanged).toHaveLength(1);
    expect(classified.unchanged[0]?.relPath).toBe("华能采购案/供货合同.docx");
    expect(classified.changed).toHaveLength(1);
    expect(classified.changed[0]?.relPath).toBe("随便一份.pdf");
  });

  it("treats size or mtime change as changed", () => {
    const walked = [item({ relPath: "华能采购案/供货合同.docx", size: 11, mtimeMs: 2_000 })];
    const cursor: HistoricalScanCursor = {
      schemaVersion: 1,
      roots: {
        root_a: {
          files: {
            "华能采购案/供货合同.docx": { mtimeMs: 1_000, size: 10 },
          },
        },
      },
    };
    expect(classifyWalkedItems(walked, cursor).changed).toHaveLength(1);
    expect(classifyWalkedItems(walked, cursor).unchanged).toHaveLength(0);
  });

  it("keeps previous catalog rows for unchanged files and replaces changed ones", () => {
    const previous = [
      item({ relPath: "华能采购案/供货合同.docx", proposedMatterLabel: "旧标签" }),
      item({ relPath: "华能采购案/补充协议.docx", fileName: "补充协议.docx", size: 4 }),
    ];
    const walked = [
      item({ relPath: "华能采购案/供货合同.docx", proposedMatterLabel: "新标签" }),
      item({
        relPath: "华能采购案/补充协议.docx",
        fileName: "补充协议.docx",
        size: 9,
        proposedMatterLabel: "华能采购案",
      }),
    ];
    const { unchanged, changed } = classifyWalkedItems(walked, {
      schemaVersion: 1,
      roots: {
        root_a: {
          files: {
            "华能采购案/供货合同.docx": { mtimeMs: 1_000, size: 10 },
            "华能采购案/补充协议.docx": { mtimeMs: 1_000, size: 4 },
          },
        },
      },
    });
    expect(unchanged).toHaveLength(1);
    expect(changed).toHaveLength(1);
    const merged = mergeCatalog(previous, walked, unchanged);
    expect(merged).toHaveLength(2);
    expect(merged[0]?.proposedMatterLabel).toBe("旧标签");
    expect(merged[1]?.size).toBe(9);
  });

  it("hashes kinds + organized folders + messy count stably", () => {
    const a = [
      item({ relPath: "华能采购案/供货合同.docx" }),
      item({
        relPath: "桌面/笔记.txt",
        fileName: "笔记.txt",
        ext: ".txt",
        kind: "other",
        layout: "messy",
      }),
    ];
    const b = [
      item({ relPath: "华能采购案/供货合同.docx", mtimeMs: 9_999 }),
      item({
        relPath: "桌面/笔记.txt",
        fileName: "笔记.txt",
        ext: ".txt",
        kind: "other",
        layout: "messy",
        size: 99,
      }),
    ];
    expect(hashCatalogFingerprint(a)).toBe(hashCatalogFingerprint(b));
    const extra = [
      ...a,
      item({
        relPath: "桌面/另一份.txt",
        fileName: "另一份.txt",
        ext: ".txt",
        kind: "other",
        layout: "messy",
      }),
    ];
    expect(hashCatalogFingerprint(extra)).not.toBe(hashCatalogFingerprint(a));
  });
});
