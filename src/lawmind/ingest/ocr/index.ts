/**
 * Productized OCR entry (C2-1 / G6).
 *
 * Wraps local tesseract path used by legal ingest-helpers.
 * Cloud OCR is opt-in (LAWMIND_OCR_CLOUD=1) — USER must supply vendor later.
 *
 * Confirmation gate: callers should not auto-commit OCR text into matter
 * knowledge without lawyer confirm (see confirmOcrExtraction).
 */

import fs from "node:fs/promises";
import path from "node:path";

export type OcrProviderId = "local_tesseract" | "cloud_placeholder";

export type OcrExtraction = {
  text: string;
  provider: OcrProviderId;
  sourcePath: string;
  /** Always true for product path — UI must ask lawyer before matter ingest */
  needsLawyerConfirmation: true;
  message: string;
};

export function isCloudOcrEnabled(opts?: { flag?: string }): boolean {
  const raw = (opts?.flag ?? process.env.LAWMIND_OCR_CLOUD ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

async function createOcrWorker() {
  const mod = await import("tesseract.js");
  const maybeFactory =
    (mod as { createWorker?: unknown }).createWorker ??
    (mod as { default?: { createWorker?: unknown } }).default?.createWorker ??
    (mod as { default?: unknown }).default;
  if (typeof maybeFactory !== "function") {
    throw new Error("OCR worker initialization failed");
  }
  const langs = (process.env.LAWMIND_OCR_LANGS?.trim() || "chi_sim+eng").split("+").filter(Boolean);
  return (
    maybeFactory as (langs?: string | string[]) => Promise<{
      recognize: (image: Buffer | Uint8Array) => Promise<{ data?: { text?: string } }>;
      terminate: () => Promise<unknown>;
    }>
  )(langs.length === 0 ? "eng" : langs);
}

/** Local OCR for image paths (png/jpg/webp/tif). PDF page rasterization is future work. */
export async function extractTextFromImageFile(filePath: string): Promise<OcrExtraction> {
  const abs = path.resolve(filePath);
  const image = await fs.readFile(abs);
  const worker = await createOcrWorker();
  try {
    const result = await worker.recognize(image);
    const text = (result.data?.text ?? "").split("\0").join("").trim();
    return {
      text,
      provider: "local_tesseract",
      sourcePath: abs,
      needsLawyerConfirmation: true,
      message: text
        ? "本地 OCR 完成：请律师确认后再写入案件知识库。"
        : "本地 OCR 无文本：请检查图片清晰度或改用人工录入。",
    };
  } finally {
    await worker.terminate().catch(() => undefined);
  }
}

/**
 * Cloud OCR placeholder — returns explicit not-configured until USER wires vendor.
 */
export async function extractTextViaCloudOcrPlaceholder(filePath: string): Promise<OcrExtraction> {
  return {
    text: "",
    provider: "cloud_placeholder",
    sourcePath: path.resolve(filePath),
    needsLawyerConfirmation: true,
    message:
      "云 OCR 未接入（占位）：请配置厂商后实现；或关闭 LAWMIND_OCR_CLOUD 使用本地 tesseract。",
  };
}

export type ConfirmedOcrIngest = {
  matterId: string;
  sourcePath: string;
  text: string;
  confirmedBy: string;
  confirmedAt: string;
};

/** Persist confirmed OCR text under matter materials (lawyer-gated). */
export async function confirmOcrExtraction(
  workspaceDir: string,
  input: {
    matterId: string;
    sourcePath: string;
    text: string;
    confirmedBy: string;
  },
): Promise<{ ok: true; relativePath: string } | { ok: false; error: string }> {
  const text = input.text.trim();
  if (!text) {
    return { ok: false, error: "empty_ocr_text" };
  }
  const matterId = input.matterId.trim();
  if (!matterId || matterId.includes("..") || matterId.includes("/") || matterId.includes("\\")) {
    return { ok: false, error: "invalid_matter_id" };
  }
  const dir = path.join(workspaceDir, "matters", matterId, "ocr-confirmed");
  await fs.mkdir(dir, { recursive: true });
  const base =
    path
      .basename(input.sourcePath)
      .replace(/[^\w.\-()\u4e00-\u9fff]+/g, "_")
      .slice(0, 80) || "scan";
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const relativePath = path.join("matters", matterId, "ocr-confirmed", `${stamp}-${base}.md`);
  const abs = path.join(workspaceDir, relativePath);
  const body = [
    `# OCR 确认入库`,
    ``,
    `- 来源：${input.sourcePath}`,
    `- 确认人：${input.confirmedBy}`,
    `- 确认时间：${new Date().toISOString()}`,
    ``,
    `---`,
    ``,
    text,
    ``,
  ].join("\n");
  await fs.writeFile(abs, body, "utf8");
  return { ok: true, relativePath };
}
