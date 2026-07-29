import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  convertArticleLinesToOpenLawRecords,
  convertFlkDumpToOpenLawRecords,
  detectAndConvertOpenLawDump,
  openLawRecordsToJsonl,
} from "./dump-convert.js";

const dir = path.dirname(fileURLToPath(import.meta.url));

describe("open-law/dump-convert", () => {
  it("converts FLK-style dump JSON to OpenLawRecord with attribution", () => {
    const raw = fs.readFileSync(path.join(dir, "fixtures/flk-dump-sample.json"), "utf8");
    const records = convertFlkDumpToOpenLawRecords(raw);
    expect(records.length).toBe(1);
    expect(records[0]?.title).toContain("导游人员管理条例");
    expect(records[0]?.kind).toBe("regulation");
    expect(records[0]?.corpusId).toBe("flk_dump");
    expect(records[0]?.licenseNote).toMatch(/自行确认/);
    expect(records[0]?.body).toMatch(/第一条/);
    const jsonl = openLawRecordsToJsonl(records);
    expect(jsonl.trim().split("\n")).toHaveLength(1);
  });

  it("converts article-line corpora", () => {
    const raw = fs.readFileSync(path.join(dir, "fixtures/article-line-sample.txt"), "utf8");
    const records = convertArticleLinesToOpenLawRecords(raw);
    expect(records.length).toBe(2);
    expect(records[0]?.citation).toMatch(/民法典.*第八条/);
    expect(records[0]?.corpusId).toBe("article_line");
  });

  it("auto-detects format", () => {
    const flk = detectAndConvertOpenLawDump(
      fs.readFileSync(path.join(dir, "fixtures/flk-dump-sample.json"), "utf8"),
    );
    expect(flk.format).toBe("flk_json");
    const lines = detectAndConvertOpenLawDump(
      fs.readFileSync(path.join(dir, "fixtures/article-line-sample.txt"), "utf8"),
    );
    expect(lines.format).toBe("article_line");
  });
});
