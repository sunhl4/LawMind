import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fileVersionOf } from "../runtime/file-version.js";
import {
  contentSha256FromFileVersion,
  fileReferencesBlockExport,
  formatEvidenceLocator,
  parseEvidenceLocator,
  splitPathAndLocator,
  validateFileReferences,
} from "./evidence-anchor.js";

const dirs: string[] = [];

function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-evidence-anchor-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("parseEvidenceLocator", () => {
  it("parses L / P / S! cell and range", () => {
    expect(parseEvidenceLocator("L3")).toEqual({ kind: "docx_paragraph", paragraphIndex: 3 });
    expect(parseEvidenceLocator("line=2")).toEqual({ kind: "line", start: 2, end: 2 });
    expect(parseEvidenceLocator("L2-L4")).toEqual({ kind: "line", start: 2, end: 4 });
    expect(parseEvidenceLocator("P12")).toEqual({ kind: "pdf_page", pageNumber: 12 });
    expect(parseEvidenceLocator("S1!B2")).toEqual({
      kind: "excel_cell",
      sheetIndex: 1,
      cell: "B2",
    });
    expect(parseEvidenceLocator("S2!A1:C3")).toEqual({
      kind: "excel_range",
      sheetIndex: 2,
      range: "A1:C3",
    });
    expect(parseEvidenceLocator("nope")).toBeNull();
  });

  it("round-trips formatEvidenceLocator", () => {
    for (const raw of ["L3", "P12", "S1!B2", "S2!A1:C3", "L2-L4"]) {
      const parsed = parseEvidenceLocator(raw);
      expect(parsed).not.toBeNull();
      expect(formatEvidenceLocator(parsed!)).toBe(raw);
    }
  });
});

describe("splitPathAndLocator / contentSha256FromFileVersion", () => {
  it("splits path#line", () => {
    expect(splitPathAndLocator("a/b.txt#L3")).toEqual({ path: "a/b.txt", locator: "L3" });
    expect(splitPathAndLocator("a/b.txt")).toEqual({ path: "a/b.txt", locator: null });
  });

  it("reads sha256 hex from fileVersionOf", () => {
    const dir = tmp();
    const file = path.join(dir, "x.txt");
    fs.writeFileSync(file, "hello\nworld\n", "utf8");
    const version = fileVersionOf(file);
    const sha = contentSha256FromFileVersion(version);
    expect(sha).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("validateFileReferences", () => {
  it("PASSES when sha + line quote match", () => {
    const dir = tmp();
    const rel = "materials/contract.txt";
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, "前言\n本合同总价款为人民币300万元\n尾注\n", "utf8");
    const sha = contentSha256FromFileVersion(fileVersionOf(abs))!;

    const result = validateFileReferences({
      rootDir: dir,
      sourceFiles: [{ path: rel, contentSha256: sha }],
      references: [
        {
          id: "r1",
          filePath: rel,
          lineRef: "L2",
          text: "本合同总价款为人民币300万元",
        },
      ],
    });
    expect(result.status).toBe("PASSED");
    expect(result.summary.passed).toBe(1);
    expect(result.issues).toEqual([]);
    expect(fileReferencesBlockExport(result)).toBe(false);
  });

  it("FAILS on sha mismatch and bad lineRef", () => {
    const dir = tmp();
    const rel = "a.txt";
    const abs = path.join(dir, rel);
    fs.writeFileSync(abs, "一行\n", "utf8");
    const sha = contentSha256FromFileVersion(fileVersionOf(abs))!;

    const stale = validateFileReferences({
      rootDir: dir,
      sourceFiles: [
        {
          path: rel,
          contentSha256: "0".repeat(64),
        },
      ],
      references: [{ id: "r1", filePath: rel, lineRef: "L1", text: "一行" }],
    });
    expect(stale.status).toBe("FAILED");
    expect(stale.issues.some((i) => i.code === "sha_mismatch")).toBe(true);

    const badRef = validateFileReferences({
      rootDir: dir,
      sourceFiles: [{ path: rel, contentSha256: sha }],
      references: [{ id: "r2", filePath: rel, lineRef: "ZZ", text: "一行" }],
    });
    expect(badRef.status).toBe("FAILED");
    expect(badRef.issues.some((i) => i.code === "bad_line_ref")).toBe(true);
  });

  it("marks PDF/Excel locators INCOMPLETE (not PASSED)", () => {
    const dir = tmp();
    const rel = "scan.pdf";
    const abs = path.join(dir, rel);
    fs.writeFileSync(abs, "%PDF-fake", "utf8");
    const sha = contentSha256FromFileVersion(fileVersionOf(abs))!;

    const result = validateFileReferences({
      rootDir: dir,
      sourceFiles: [{ path: rel, contentSha256: sha }],
      references: [{ id: "r1", filePath: rel, lineRef: "P3", text: "任意" }],
    });
    expect(result.status).toBe("INCOMPLETE");
    expect(result.issues.some((i) => i.code === "unverifiable_locator")).toBe(true);
    expect(fileReferencesBlockExport(result)).toBe(true);
  });

  it("FAILS when source was not registered", () => {
    const result = validateFileReferences({
      rootDir: tmp(),
      sourceFiles: [],
      references: [{ id: "r1", filePath: "x.txt", lineRef: "L1", text: "hi" }],
    });
    expect(result.status).toBe("FAILED");
    expect(result.issues[0]?.code).toBe("missing_source");
  });
});
