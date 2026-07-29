import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  loadEmbeddedOpenLawSample,
  loadOpenLawCorpus,
  openLawCorpusStats,
  searchOpenLawCorpus,
} from "./local-corpus.js";
import { OPEN_LAW_SAMPLE_STATUTES_JSONL } from "./sample-statutes.embedded.js";

describe("open-law/local-corpus", () => {
  it("loads embedded sample without filesystem corpus/ beside dist", () => {
    const embedded = loadEmbeddedOpenLawSample();
    expect(embedded.length).toBeGreaterThanOrEqual(3);
    expect(OPEN_LAW_SAMPLE_STATUTES_JSONL).toContain("cn-civil-code-563");
    expect(OPEN_LAW_SAMPLE_STATUTES_JSONL).toContain("cn-company-law-20");
    const records = loadOpenLawCorpus();
    expect(records.length).toBe(embedded.length);
    const stats = openLawCorpusStats();
    expect(stats.recordCount).toBe(records.length);
    expect(stats.bundledSample).toBe(true);
  });

  it("keeps embedded sample in sync with corpus/sample-statutes.jsonl when present", () => {
    const jsonlPath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "corpus",
      "sample-statutes.jsonl",
    );
    if (!fs.existsSync(jsonlPath)) {
      return;
    }
    const fromFile = fs.readFileSync(jsonlPath, "utf8").trim();
    expect(OPEN_LAW_SAMPLE_STATUTES_JSONL.trim()).toBe(fromFile);
  });

  it("lets LAWMIND_OPEN_LAW_CORPUS win on id collision", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "open-law-corpus-"));
    const corpusPath = path.join(dir, "override.jsonl");
    fs.writeFileSync(
      corpusPath,
      JSON.stringify({
        id: "cn-civil-code-563",
        title: "外部覆盖·民法典第五百六十三条",
        citation: "《民法典》第563条·外部",
        excerpt: "外部语料覆盖同一 id",
        tags: ["外部覆盖"],
      }) + "\n",
      "utf8",
    );
    const prev = process.env.LAWMIND_OPEN_LAW_CORPUS;
    try {
      process.env.LAWMIND_OPEN_LAW_CORPUS = corpusPath;
      const records = loadOpenLawCorpus();
      const hit = records.find((r) => r.id === "cn-civil-code-563");
      expect(hit?.title).toContain("外部覆盖");
      const stats = openLawCorpusStats();
      expect(stats.externalCorpus).toBe(true);
      expect(stats.recordCount).toBeGreaterThanOrEqual(embeddedCountOr(3));
    } finally {
      if (prev === undefined) {
        delete process.env.LAWMIND_OPEN_LAW_CORPUS;
      } else {
        process.env.LAWMIND_OPEN_LAW_CORPUS = prev;
      }
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("finds 民法典解除条款", () => {
    const hits = searchOpenLawCorpus("民法典 解除合同");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => h.citation?.includes("563") || h.title.includes("五百六十三"))).toBe(
      true,
    );
  });

  it("marks bundled sample hits as demo", () => {
    const prev = process.env.LAWMIND_OPEN_LAW_CORPUS;
    delete process.env.LAWMIND_OPEN_LAW_CORPUS;
    try {
      const hits = searchOpenLawCorpus("个人信息 同意");
      expect(hits.length).toBeGreaterThan(0);
      expect(hits.every((h) => h.demo === true)).toBe(true);
    } finally {
      if (prev === undefined) {
        delete process.env.LAWMIND_OPEN_LAW_CORPUS;
      } else {
        process.env.LAWMIND_OPEN_LAW_CORPUS = prev;
      }
    }
  });

  it("marks external CORPUS hits demo when record.demo or CORPUS_DEMO env", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "open-law-demo-"));
    const corpusPath = path.join(dir, "demo-corpus.jsonl");
    fs.writeFileSync(
      corpusPath,
      [
        JSON.stringify({
          id: "ext-demo-1",
          title: "外部演示条例第一条",
          excerpt: "演示摘录",
          tags: ["demo"],
        }),
        JSON.stringify({
          id: "ext-prod-1",
          title: "外部正式语料第二条",
          excerpt: "正式摘录",
          demo: false,
        }),
      ].join("\n") + "\n",
      "utf8",
    );
    const prevCorpus = process.env.LAWMIND_OPEN_LAW_CORPUS;
    const prevDemo = process.env.LAWMIND_OPEN_LAW_CORPUS_DEMO;
    try {
      process.env.LAWMIND_OPEN_LAW_CORPUS = corpusPath;
      delete process.env.LAWMIND_OPEN_LAW_CORPUS_DEMO;
      const tagged = searchOpenLawCorpus("外部演示条例");
      expect(tagged.some((h) => h.id === "ext-demo-1" && h.demo === true)).toBe(true);
      const formal = searchOpenLawCorpus("外部正式语料");
      expect(formal.some((h) => h.id === "ext-prod-1" && h.demo !== true)).toBe(true);

      process.env.LAWMIND_OPEN_LAW_CORPUS_DEMO = "1";
      const allDemo = searchOpenLawCorpus("外部正式语料");
      expect(allDemo.some((h) => h.id === "ext-prod-1" && h.demo === true)).toBe(true);
    } finally {
      if (prevCorpus === undefined) {
        delete process.env.LAWMIND_OPEN_LAW_CORPUS;
      } else {
        process.env.LAWMIND_OPEN_LAW_CORPUS = prevCorpus;
      }
      if (prevDemo === undefined) {
        delete process.env.LAWMIND_OPEN_LAW_CORPUS_DEMO;
      } else {
        process.env.LAWMIND_OPEN_LAW_CORPUS_DEMO = prevDemo;
      }
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("finds unspaced CJK query 民法典解除", () => {
    const hits = searchOpenLawCorpus("民法典解除");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => h.title.includes("民法典"))).toBe(true);
  });

  it("finds 劳动合同解除", () => {
    const hits = searchOpenLawCorpus("劳动合同 解除");
    expect(hits.some((h) => h.title.includes("劳动合同"))).toBe(true);
  });

  it("company law sample reflects 2023 revision art.20 (not stale旧法股东条款)", () => {
    const records = loadEmbeddedOpenLawSample();
    const row = records.find((r) => r.id === "cn-company-law-20");
    expect(row).toBeTruthy();
    expect(row?.citation).toMatch(/2023|修订/);
    expect(row?.body ?? row?.excerpt ?? "").toMatch(/社会责任|社会公共利益/);
    expect(row?.body ?? "").not.toMatch(/滥用公司法人独立地位/);
    expect(row?.status).toBe("现行有效");
  });

  it("includes a regulation-kind sample (not only statutes)", () => {
    const records = loadEmbeddedOpenLawSample();
    const reg = records.find((r) => r.kind === "regulation");
    expect(reg?.id).toBe("cn-labor-contract-impl-21");
    const hits = searchOpenLawCorpus("法定退休年龄 劳动合同终止");
    expect(
      hits.some((h) => h.id === "cn-labor-contract-impl-21" || h.title.includes("实施条例")),
    ).toBe(true);
  });

  it("defaults unmarked external CORPUS to demo (conservative N-A4)", () => {
    // 外部 CORPUS 条目未显式标注 demo 字段、也无 demo 标签时，保守按演示语料处理，
    // 避免许可/核验不明的语料被当作正式权威直接用于成稿。显式 demo:false 仍为正式。
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "open-law-unmarked-"));
    const corpusPath = path.join(dir, "unmarked-corpus.jsonl");
    fs.writeFileSync(
      corpusPath,
      [
        JSON.stringify({ id: "ext-unmarked-1", title: "未标注条例", excerpt: "未标注摘录" }),
        JSON.stringify({
          id: "ext-formal-1",
          title: "正式条例",
          excerpt: "正式摘录",
          demo: false,
        }),
      ].join("\n") + "\n",
      "utf8",
    );
    const prevCorpus = process.env.LAWMIND_OPEN_LAW_CORPUS;
    const prevDemo = process.env.LAWMIND_OPEN_LAW_CORPUS_DEMO;
    try {
      process.env.LAWMIND_OPEN_LAW_CORPUS = corpusPath;
      delete process.env.LAWMIND_OPEN_LAW_CORPUS_DEMO;
      const unmarked = searchOpenLawCorpus("未标注条例");
      expect(unmarked.some((h) => h.id === "ext-unmarked-1" && h.demo === true)).toBe(true);
      const formal = searchOpenLawCorpus("正式条例");
      expect(formal.some((h) => h.id === "ext-formal-1" && h.demo !== true)).toBe(true);
    } finally {
      if (prevCorpus === undefined) {
        delete process.env.LAWMIND_OPEN_LAW_CORPUS;
      } else {
        process.env.LAWMIND_OPEN_LAW_CORPUS = prevCorpus;
      }
      if (prevDemo === undefined) {
        delete process.env.LAWMIND_OPEN_LAW_CORPUS_DEMO;
      } else {
        process.env.LAWMIND_OPEN_LAW_CORPUS_DEMO = prevDemo;
      }
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

function embeddedCountOr(min: number): number {
  return Math.max(min, loadEmbeddedOpenLawSample().length);
}
