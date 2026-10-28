/**
 * 交付包输出：ZIP / 逐份清单 / 合并 PDF。
 *
 * 合并 PDF 只接受全 PDF 的包；混合格式明确返回 `mixed_formats`，不悄悄退化成 ZIP。
 * 需要连续页码时按 packet.output.bates 盖 Bates 号。
 *
 * ZIP 可复现：文件名带顺序前缀、文件时间固定、内容只取决于 manifest。
 */

import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import {
  describePacketReadiness,
  packetCanSend,
  type PacketManifest,
  type PacketManifestFile,
} from "./packet.js";

export type PacketExportFormat = "zip" | "individual" | "merged_pdf";

export type PacketExportResult =
  | {
      ok: true;
      format: "zip" | "merged_pdf";
      fileName: string;
      contentType: string;
      content: Buffer;
    }
  | {
      ok: true;
      format: "individual";
      files: PacketManifestFile[];
    }
  | {
      ok: false;
      reason: "blocked" | "mixed_formats" | "pdf_failed";
      message: string;
      blockers?: string[];
    };

function normalizeRel(raw: string): string {
  return raw.trim().replace(/\\/g, "/").replace(/^\.\//, "");
}

/** ZIP 内文件名必须跨平台稳定：去掉控制字符与路径分隔符，保留扩展名。 */
export function packetArchiveName(file: PacketManifestFile): string {
  const raw = normalizeRel(file.path);
  const base = path.posix.basename(raw).normalize("NFC");
  const ext = path.posix.extname(base);
  const stem = (base.slice(0, base.length - ext.length) || "file")
    .replace(/[\p{Cc}<>:"/\\|?*]+/gu, "_")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 80);
  return `${String(file.order).padStart(2, "0")}_${stem || "file"}${ext}`;
}

/** 标题里的非法字符不能进下载文件名。 */
export function packetDownloadFileName(
  title: string,
  audience: string,
  packetHash: string,
  ext: "zip" | "pdf" = "zip",
): string {
  const safe =
    title
      .normalize("NFC")
      .replace(/[\p{Cc}<>:"/\\|?*]+/gu, "_")
      .replace(/^\.+/, "")
      .trim()
      .slice(0, 80) || "交付包";
  return `${safe}_${audience}_${packetHash.slice(0, 8)}.${ext}`;
}

export function packetManifestJson(manifest: PacketManifest): string {
  return JSON.stringify(
    {
      schemaVersion: manifest.schemaVersion,
      packetId: manifest.packetId,
      matterId: manifest.matterId,
      title: manifest.title,
      audience: manifest.audience,
      packetHash: manifest.packetHash,
      generatedAt: manifest.generatedAt,
      readiness: describePacketReadiness(manifest),
      blockers: manifest.blockers,
      warnings: manifest.warnings,
      sections: manifest.sections,
      files: manifest.files,
    },
    null,
    2,
  );
}

/**
 * 生成 ZIP。blocked 的包直接拒绝，避免律师下载到一个必然被退回的包。
 * 文件时间固定为 epoch，保证同一 manifest 生成的 ZIP 字节稳定。
 */
export async function buildPacketZip(
  workspaceDir: string,
  manifest: PacketManifest,
): Promise<Buffer> {
  if (!packetCanSend(manifest)) {
    throw new Error(`packet_blocked:${manifest.blockers.join(";")}`);
  }
  const zip = new JSZip();
  const stableDate = new Date(0);
  for (const file of manifest.files) {
    const abs = path.resolve(workspaceDir, normalizeRel(file.path));
    const content = fs.readFileSync(abs);
    zip.file(packetArchiveName(file), content, { date: stableDate });
  }
  zip.file("00_manifest.json", packetManifestJson(manifest), { date: stableDate });
  return zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
  });
}

export function packetIsAllPdf(files: readonly PacketManifestFile[]): boolean {
  return files.length > 0 && files.every((file) => /\.pdf$/i.test(file.path));
}

/**
 * Bates 号：前缀 + 固定位数流水号。默认 `LM000001`。
 * 只用于 PDF 页脚；不改变包内文件字节，也不进 packetHash。
 */
export function packetBatesLabel(input: {
  prefix?: string;
  start?: number;
  pad?: number;
  index: number;
}): string {
  const prefix = input.prefix?.trim() || "LM";
  const start = Math.max(0, Math.floor(input.start ?? 1));
  const pad = Math.min(12, Math.max(1, Math.floor(input.pad ?? 6)));
  return `${prefix}${String(start + input.index).padStart(pad, "0")}`;
}

/**
 * 合并 PDF：只接受全 PDF 的包；逐份按 manifest 顺序复制页面。
 * `packet.output.bates` 有值时在每页右下角盖连续页码。
 */
export async function buildMergedPacketPdf(
  workspaceDir: string,
  manifest: PacketManifest,
): Promise<Buffer> {
  if (!packetCanSend(manifest)) {
    throw new Error(`packet_blocked:${manifest.blockers.join(";")}`);
  }
  if (!packetIsAllPdf(manifest.files)) {
    throw new Error("packet_not_all_pdf");
  }
  const output = await PDFDocument.create();
  for (const file of manifest.files) {
    const abs = path.resolve(workspaceDir, normalizeRel(file.path));
    const bytes = fs.readFileSync(abs);
    const source = await PDFDocument.load(bytes, { ignoreEncryption: false });
    const pages = await output.copyPages(source, source.getPageIndices());
    for (const page of pages) {
      output.addPage(page);
    }
  }
  const bates = manifest.output?.bates;
  if (bates) {
    const font = await output.embedFont(StandardFonts.Helvetica);
    output.getPages().forEach((page, index) => {
      const label = packetBatesLabel({ ...bates, index });
      const width = font.widthOfTextAtSize(label, 9);
      page.drawText(label, {
        x: Math.max(12, page.getWidth() - width - 24),
        y: 16,
        size: 9,
        font,
        color: rgb(0.35, 0.35, 0.35),
      });
    });
  }
  output.setTitle(manifest.title);
  output.setAuthor("LawMind");
  output.setCreator("LawMind");
  output.setProducer("LawMind");
  output.setCreationDate(new Date(0));
  output.setModificationDate(new Date(0));
  return Buffer.from(await output.save({ useObjectStreams: false }));
}

export async function exportDeliveryPacket(
  workspaceDir: string,
  manifest: PacketManifest,
  format: PacketExportFormat,
): Promise<PacketExportResult> {
  if (format === "individual") {
    if (!packetCanSend(manifest)) {
      return {
        ok: false,
        reason: "blocked",
        message: describePacketReadiness(manifest),
        blockers: manifest.blockers,
      };
    }
    return { ok: true, format: "individual", files: manifest.files };
  }
  if (format === "merged_pdf") {
    if (!packetCanSend(manifest)) {
      return {
        ok: false,
        reason: "blocked",
        message: describePacketReadiness(manifest),
        blockers: manifest.blockers,
      };
    }
    if (!packetIsAllPdf(manifest.files)) {
      const nonPdf = manifest.files
        .filter((file) => !/\.pdf$/i.test(file.path))
        .map((file) => file.path);
      return {
        ok: false,
        reason: "mixed_formats",
        message: `合并 PDF 只能包含 PDF 文件；当前包内还有：${nonPdf.join("、")}。请改用 ZIP 或逐份导出。`,
      };
    }
    try {
      const content = await buildMergedPacketPdf(workspaceDir, manifest);
      return {
        ok: true,
        format: "merged_pdf",
        fileName: packetDownloadFileName(
          manifest.title,
          manifest.audience,
          manifest.packetHash,
          "pdf",
        ),
        contentType: "application/pdf",
        content,
      };
    } catch (err) {
      return {
        ok: false,
        reason: "pdf_failed",
        message: `合并 PDF 失败：${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
  if (!packetCanSend(manifest)) {
    return {
      ok: false,
      reason: "blocked",
      message: describePacketReadiness(manifest),
      blockers: manifest.blockers,
    };
  }
  const content = await buildPacketZip(workspaceDir, manifest);
  return {
    ok: true,
    format: "zip",
    fileName: packetDownloadFileName(manifest.title, manifest.audience, manifest.packetHash),
    contentType: "application/zip",
    content,
  };
}
