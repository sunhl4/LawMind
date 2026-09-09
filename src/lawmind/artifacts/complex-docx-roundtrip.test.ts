import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  Document,
  Footer,
  Header,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
} from "docx";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { readDocxText } from "../agent/tools/legal/ingest-helpers.js";
import { qaTrackedDocxXml } from "../drafts/tracked-xml-qa.js";

async function createComplexContract(file: string): Promise<void> {
  const document = new Document({
    sections: [
      {
        headers: {
          default: new Header({
            children: [new Paragraph("项目采购合同（保密）")],
          }),
        },
        footers: {
          default: new Footer({
            children: [new Paragraph("第 1 页")],
          }),
        },
        children: [
          new Paragraph({
            children: [new TextRun({ text: "采购合同", bold: true })],
          }),
          new Paragraph("甲方：示例采购有限公司"),
          new Paragraph("乙方：示例技术有限公司"),
          new Table({
            rows: [
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph("付款")] }),
                  new TableCell({ children: [new Paragraph("签约后30日内付款")] }),
                ],
              }),
            ],
          }),
          new Paragraph("乙方承担无限责任并赔偿全部损失。"),
          new Paragraph("争议提交上海仲裁委员会。"),
        ],
      },
    ],
  });
  await fs.writeFile(file, Buffer.from(await Packer.toBuffer(document)));
}

async function overlayTrackedXml(input: string, output: string): Promise<void> {
  const zip = await JSZip.loadAsync(await fs.readFile(input));
  const xmlFile = zip.file("word/document.xml");
  if (!xmlFile) {
    throw new Error("document.xml missing");
  }
  let xml = await xmlFile.async("string");
  const token = "无限责任";
  const index = xml.indexOf(token);
  if (index < 0) {
    throw new Error("contract token missing");
  }
  xml = `${xml.slice(0, index)}${token}<w:del w:id="1" w:author="LawMind"><w:r><w:delText>旧责任</w:delText></w:r></w:del><w:ins w:id="2" w:author="LawMind"><w:r><w:t>责任上限不超过合同总额</w:t></w:r></w:ins>${xml.slice(index + token.length)}`;
  zip.file("word/document.xml", xml);
  await fs.writeFile(output, await zip.generateAsync({ type: "nodebuffer" }));
}

describe("complex DOCX tracked roundtrip", () => {
  it("preserves header/footer/table and exposes tracked text on readback", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lm-complex-docx-"));
    const source = path.join(dir, "采购合同.docx");
    const output = path.join(dir, "采购合同_审阅稿.docx");
    await createComplexContract(source);
    await overlayTrackedXml(source, output);

    const qa = await qaTrackedDocxXml(output, 1);
    expect(qa.ok).toBe(true);
    expect(qa.insCount).toBeGreaterThanOrEqual(1);
    expect(qa.delCount).toBeGreaterThanOrEqual(1);

    const zip = await JSZip.loadAsync(await fs.readFile(output));
    expect(zip.file("word/header1.xml")).toBeTruthy();
    expect(zip.file("word/footer1.xml")).toBeTruthy();
    const documentXml = await zip.file("word/document.xml")!.async("string");
    expect(documentXml).toContain("<w:tbl>");
    expect(documentXml).toContain("责任上限不超过合同总额");
    expect(documentXml).toContain("上海仲裁委员会");

    const readback = await readDocxText(output);
    expect(readback).toContain("采购合同");
    expect(readback).toContain("责任上限不超过合同总额");
    expect(readback).toContain("上海仲裁委员会");
  });
});
