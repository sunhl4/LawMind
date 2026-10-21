/**
 * Read workspace material text for desk extract / talk (PDF / image / txt).
 */

import fs from "node:fs";
import path from "node:path";
import {
  isDocxPath,
  isOcrImagePath,
  isPdfPath,
  readDocxText,
  readImageTextHybrid,
  readPdfText,
  readPdfTextByOcr,
  readPdfTextByVision,
  readSafe,
  shouldUseVisionFallback,
  visionUsageContextFromAgentCtx,
} from "../agent/tools/legal/ingest-helpers.js";
import { isPathInsideRoot } from "../runtime/workspace-path.js";

export async function readDeskMaterialText(
  workspaceDir: string,
  relPath: string,
  /** 记账号本上下文（可选）。案卷侧栏读材料同样会走视觉 OCR，不能漏账。 */
  usage?: {
    sessionId?: string;
    turnId?: string;
    matterId?: string;
  },
): Promise<{ ok: true; text: string; sourceType: string } | { ok: false; error: string }> {
  const usageCtx = visionUsageContextFromAgentCtx({ workspaceDir, ...usage });
  const rel = relPath.replace(/\\/g, "/").replace(/^\/+/, "").trim();
  if (!rel || rel.includes("..")) {
    return { ok: false, error: "路径不合法。" };
  }
  const abs = path.resolve(workspaceDir, rel);
  if (!isPathInsideRoot(workspaceDir, abs)) {
    return { ok: false, error: "路径超出工作区。" };
  }
  if (!fs.existsSync(abs)) {
    return { ok: false, error: "找不到文件。" };
  }
  try {
    if (isPdfPath(abs)) {
      let text = await readPdfText(abs);
      let sourceType = "pdf_text";
      if (!text.trim()) {
        text = await readPdfTextByOcr(abs, usageCtx);
        sourceType = "pdf_ocr";
      }
      if (!text.trim() && shouldUseVisionFallback()) {
        text = await readPdfTextByVision(abs, usageCtx);
        sourceType = "pdf_vision";
      }
      return { ok: true, text: text.trim(), sourceType };
    }
    if (isOcrImagePath(abs)) {
      const hybrid = await readImageTextHybrid(abs, usageCtx);
      if (!hybrid?.text.trim()) {
        return { ok: false, error: "图片未识别到文字。请换一张更清晰的，或手填。" };
      }
      return { ok: true, text: hybrid.text.trim(), sourceType: hybrid.sourceType };
    }
    if (isDocxPath(abs)) {
      const text = await readDocxText(abs);
      return { ok: true, text: text.trim(), sourceType: "docx" };
    }
    const text = await readSafe(abs);
    return { ok: true, text: text.trim(), sourceType: "text" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
