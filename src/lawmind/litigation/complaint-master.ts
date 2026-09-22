/**
 * 起诉状母版：若工作区有 Word 母版则用之，否则走线性栏目骨架（避免 pandoc 打表）。
 */

import fs from "node:fs";
import path from "node:path";
import { scanDocxPlaceholders } from "../templates/docx-template-fill.js";
import { suggestPlaceholderFieldPaths } from "../templates/draft-template-values.js";
import type { ResolvedTemplate, UploadedTemplateRecord } from "../templates/index.js";

const CANDIDATES = [
  "templates/word/complaint-master.docx",
  "templates/word/起诉状母版.docx",
  "templates/word/民事起诉状.docx",
];

export function resolveComplaintMasterTemplate(workspaceDir: string): string | undefined {
  for (const rel of CANDIDATES) {
    const abs = path.join(workspaceDir, rel);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
      return rel.replace(/\\/g, "/");
    }
  }
  return undefined;
}

export function complaintMasterHint(workspaceDir: string): string {
  const rel = resolveComplaintMasterTemplate(workspaceDir);
  if (rel) {
    return `工作区有起诉状母版 \`${rel}\`：渲染时用该模板克隆栏目与页码，不要用 markdown 表。`;
  }
  return "工作区无起诉状 Word 母版。用线性栏目（当事人 / 诉讼请求 / 要件-事实-证据）出稿，不要 markdown 表。可把母版放到 templates/word/complaint-master.docx；渲染起诉状时也会写入一份栏目骨架母版。";
}

/** Seed a real OOXML skeleton if the workspace has no complaint master file at all. */
export async function ensureComplaintMasterSkeleton(
  workspaceDir: string,
): Promise<string | undefined> {
  const existing = resolveComplaintMasterTemplate(workspaceDir);
  if (existing) {
    return existing;
  }
  const rel = CANDIDATES[0];
  const abs = path.join(workspaceDir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const { Document, Packer, Paragraph, TextRun } = await import("docx");
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ children: [new TextRun("民事起诉状")] }),
          new Paragraph({ children: [new TextRun("当事人：{{title}}")] }),
          new Paragraph({ children: [new TextRun("诉讼请求：{{claims}}")] }),
          new Paragraph({ children: [new TextRun("事实与理由：{{body}}")] }),
        ],
      },
    ],
  });
  fs.writeFileSync(abs, Buffer.from(await Packer.toBuffer(doc)));
  return rel.replace(/\\/g, "/");
}

/** Real OOXML only — a placeholder file named .docx is not a clone source. */
export async function resolveComplaintMasterUploaded(
  workspaceDir: string,
): Promise<UploadedTemplateRecord | undefined> {
  const rel = resolveComplaintMasterTemplate(workspaceDir);
  if (!rel) {
    return undefined;
  }
  const sourcePath = path.join(workspaceDir, rel);
  try {
    const names = await scanDocxPlaceholders(sourcePath);
    return {
      id: "complaint-master",
      format: "docx",
      label: "起诉状母版",
      sourcePath,
      version: 1,
      enabled: true,
      placeholderMap: suggestPlaceholderFieldPaths(names),
      uploadedAt: new Date().toISOString(),
    };
  } catch {
    return undefined;
  }
}

/** Prefer the workspace Word master when rendering a 起诉状, unless the lawyer already chose an upload. */
export async function preferComplaintMasterTemplate(
  workspaceDir: string,
  current: ResolvedTemplate,
  draft: { output?: string; deliverableType?: string },
): Promise<ResolvedTemplate> {
  if (draft.output && draft.output !== "docx") {
    return current;
  }
  if (draft.deliverableType !== "litigation.complaint") {
    return current;
  }
  if (current.source === "uploaded") {
    return current;
  }
  await ensureComplaintMasterSkeleton(workspaceDir);
  const uploaded = await resolveComplaintMasterUploaded(workspaceDir);
  if (!uploaded) {
    return current;
  }
  return {
    requestedId: current.requestedId,
    resolvedId: uploaded.id,
    format: "docx",
    variant: "uploadedMapped",
    source: "uploaded",
    uploaded,
  };
}
