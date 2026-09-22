/**
 * 上传的 .docx 模板：扫描 {{name}} 占位符并按映射填充。
 * 使用 JSZip 读写 OOXML。占位符需与 Word 中连续文本一致（同一段 w:t 内最稳妥）。
 */

import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";

const PLACEHOLDER_RE = /\{\{([a-zA-Z][a-zA-Z0-9_]*)\}\}/g;

function escapeXmlText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const XML_PARTS =
  /^(word\/document\.xml|word\/(header|footer|endnotes|footnotes|comments)\d*\.xml)$/;

/**
 * 扫描 .docx 中所有 XML 部分里出现的 `{{name}}` 占位符名（去重、排序）。
 */
export async function scanDocxPlaceholders(sourcePath: string): Promise<string[]> {
  const buf = await fs.readFile(sourcePath);
  const zip = await JSZip.loadAsync(buf);
  const found = new Set<string>();
  for (const name of Object.keys(zip.files)) {
    if (!zip.files[name] || zip.files[name].dir) {
      continue;
    }
    if (!XML_PARTS.test(name)) {
      continue;
    }
    const text = await zip.file(name)!.async("string");
    for (const m of text.matchAll(PLACEHOLDER_RE)) {
      if (m[1]) {
        found.add(m[1]);
      }
    }
  }
  return [...found].toSorted((a, b) => a.localeCompare(b));
}

/**
 * 将占位符值写入副本并保存到 outputPath（不修改源文件）。
 */
export async function fillDocxTemplateWithValues(input: {
  sourcePath: string;
  outputPath: string;
  values: Record<string, string>;
}): Promise<void> {
  const buf = await fs.readFile(input.sourcePath);
  const zip = await JSZip.loadAsync(buf);
  for (const name of Object.keys(zip.files)) {
    if (!zip.files[name] || zip.files[name].dir) {
      continue;
    }
    if (!XML_PARTS.test(name)) {
      continue;
    }
    let text = await zip.file(name)!.async("string");
    for (const [key, val] of Object.entries(input.values)) {
      if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(key)) {
        continue;
      }
      const pattern = new RegExp(`\\{\\{${key}\\}\\}`, "g");
      const replacement = escapeXmlText(val);
      text = text.replace(pattern, replacement);
    }
    zip.file(name, text);
  }
  const out = await zip.generateAsync({ type: "nodebuffer" });
  await fs.mkdir(path.dirname(input.outputPath), { recursive: true });
  await fs.writeFile(input.outputPath, out);
}
