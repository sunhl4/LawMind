import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { afterEach, describe, expect, it } from "vitest";
import {
  extractRevisionRuns,
  findNonMinimalRevisionPairs,
  qaTrackedDocxXml,
} from "./tracked-xml-qa.js";

const dirs: string[] = [];

async function writeDocx(documentXml: string): Promise<string> {
  const dir = fsSync.mkdtempSync(path.join(os.tmpdir(), "lm-xmlqa-"));
  dirs.push(dir);
  const zip = new JSZip();
  zip.file("word/document.xml", documentXml);
  const buf = await zip.generateAsync({ type: "nodebuffer" });
  const file = path.join(dir, "out.docx");
  await fs.writeFile(file, buf);
  return file;
}

function doc(body: string): string {
  return `<?xml version="1.0"?><w:document xmlns:w="x"><w:body>${body}</w:body></w:document>`;
}

function ins(text: string): string {
  return `<w:ins w:id="1" w:author="LawMind"><w:r><w:t>${text}</w:t></w:r></w:ins>`;
}

function del(text: string): string {
  return `<w:del w:id="2" w:author="LawMind"><w:r><w:delText>${text}</w:delText></w:r></w:del>`;
}

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

describe("extractRevisionRuns", () => {
  it("keeps document order across del and ins", () => {
    const xml = doc(`${del("甲")}${ins("乙")}${ins("（新增）")}`);
    expect(extractRevisionRuns(xml).map((r) => `${r.kind}:${r.text}`)).toEqual([
      "del:甲",
      "ins:乙",
      "ins:（新增）",
    ]);
  });

  it("decodes entities and joins split runs", () => {
    const xml = doc(
      `<w:del w:id="1"><w:r><w:delText>甲&amp;乙</w:delText></w:r><w:r><w:delText>丙</w:delText></w:r></w:del>`,
    );
    expect(extractRevisionRuns(xml)[0]?.text).toBe("甲&乙丙");
  });
});

describe("findNonMinimalRevisionPairs", () => {
  it("flags a whole-sentence delete + re-insert (the anti-pattern)", () => {
    const before = "甲方应当在收到发票之日起十日内付款";
    const after = "乙方应当在收到发票之日起五个工作日内付款";
    const pairs = findNonMinimalRevisionPairs(doc(`${del(before)}${ins(after)}`));
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.unchangedRun).toBeGreaterThanOrEqual(8);
    expect(pairs[0]?.reason).toContain("未改");
  });

  it("accepts minimal character-level edits", () => {
    // 最短改动落出来的形状：只标真正变动的字。
    const xml = doc(
      `${del("甲")}${ins("乙")}方应当在收到发票之日起${del("十")}${ins("五个工作")}日内付款`,
    );
    expect(findNonMinimalRevisionPairs(xml)).toEqual([]);
  });

  it("accepts a pure insert (no deleted side to pair with)", () => {
    expect(
      findNonMinimalRevisionPairs(doc(ins("，但累计赔偿总额不超过该项目已付软件费用"))),
    ).toEqual([]);
  });

  it("accepts a genuine full-clause replacement with nothing in common", () => {
    const pairs = findNonMinimalRevisionPairs(
      doc(`${del("提交甲方所在地人民法院诉讼解决")}${ins("提交上海仲裁委员会仲裁处理")}`),
    );
    // 共有片段只有「提交」「」，未达门槛 → 不算整句改写。
    expect(pairs).toEqual([]);
  });

  it("ignores short pairs even when they share a run", () => {
    const pairs = findNonMinimalRevisionPairs(doc(`${del("十日内")}${ins("十五日内")}`));
    expect(pairs).toEqual([]);
  });
});

describe("qaTrackedDocxXml", () => {
  it("returns violations and blocks when the rewrite anti-pattern is present", async () => {
    const file = await writeDocx(
      doc(
        `${del("甲方应当在收到发票之日起十日内付款")}${ins("乙方应当在收到发票之日起五个工作日内付款")}`,
      ),
    );
    const qa = await qaTrackedDocxXml(file, 1);
    expect(qa.ok).toBe(false);
    expect(qa.minimalEdit.checked).toBe(true);
    expect(qa.minimalEdit.violations).toHaveLength(1);
    expect(qa.warning).toContain("整句删+整句增");
  });

  it("passes on minimal revisions and reports the minimal-edit review", async () => {
    const file = await writeDocx(
      doc(`${del("甲")}${ins("乙")}方应当在${del("十")}${ins("五个工作")}日内付款`),
    );
    const qa = await qaTrackedDocxXml(file, 2);
    expect(qa.ok).toBe(true);
    expect(qa.minimalEdit).toMatchObject({ checked: true, pairs: 2 });
    expect(qa.minimalEdit.violations).toEqual([]);
    expect(qa.insCount).toBe(2);
    expect(qa.delCount).toBe(2);
  });

  it("still blocks when no revision markup was persisted at all", async () => {
    const file = await writeDocx(doc("<w:p><w:r><w:t>没有任何修订</w:t></w:r></w:p>"));
    const qa = await qaTrackedDocxXml(file, 1);
    expect(qa.ok).toBe(false);
    expect(qa.minimalEdit.checked).toBe(false);
    expect(qa.warning).toContain("XML 未见 w:ins/w:del");
  });
});
