/**
 * 把 PDF 的一页渲成 PNG，供核对纸在出处旁边显示。
 * 不猜页码：调用方必须传入 1-based 页。
 */

import fs from "node:fs/promises";

const MAX_PDF_BYTES = 20 * 1024 * 1024;
const MAX_PNG_BYTES = 6 * 1024 * 1024;

export async function renderPdfPagePng(absPath: string, page: number): Promise<Buffer> {
  if (!Number.isInteger(page) || page < 1 || page > 500) {
    throw new Error("invalid_page");
  }
  const stat = await fs.stat(absPath);
  if (stat.size > MAX_PDF_BYTES) {
    throw new Error("pdf_too_large");
  }
  const data = await fs.readFile(absPath);
  const mod = await import("pdf-parse");
  const parser = new mod.PDFParse({ data });
  try {
    const shot = await parser.getScreenshot({
      partial: [page],
      scale: 1.25,
      imageBuffer: true,
      imageDataUrl: false,
    });
    const raw = shot.pages?.[0]?.data;
    if (!raw || raw.length === 0) {
      throw new Error("page_not_found");
    }
    const png = Buffer.from(raw);
    if (png.byteLength > MAX_PNG_BYTES || png.subarray(0, 4).toString("hex") !== "89504e47") {
      throw new Error("page_not_png");
    }
    return png;
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}
