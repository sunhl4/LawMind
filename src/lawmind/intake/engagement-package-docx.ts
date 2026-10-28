/**
 * 委托包 DOCX 导出（P1.3 遗留）。
 *
 * Markdown 仍是真相源：每次导出都从 `收案/*.md` 的**当前内容**重新渲染，
 * 律师在 Markdown 里改过的条款会带进 Word。这里不做任何条款补写。
 *
 * 版式走 `formalDocument`：只有标题和正文，不写备忘录抬头、
 * 不写「一、结论」摘要，也不追加「本备忘录…不构成正式法律意见」。
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { writeFileAtomicAsync } from "../adapters/matter-storage/io.js";
import { renderDocxWithOptions } from "../artifacts/render-docx.js";
import { isValidMatterId } from "../cases/matter-id.js";
import type { ArtifactDraft, ArtifactSection } from "../types.js";
import {
  engagementPackageDir,
  loadEngagementPackage,
  type EngagementPackageFile,
} from "./engagement-package.js";

export type EngagementDocxError =
  | "invalid_matter_id"
  | "package_not_found"
  | "exists"
  | "render_failed"
  | "write_failed";

export type EngagementDocxResult =
  | { ok: true; generatedAt: string; files: EngagementPackageFile[] }
  | { ok: false; error: EngagementDocxError; files?: string[]; message?: string };

export type EngagementDocxDraftInput = {
  taskId: string;
  matterId: string;
  createdAt: string;
  /** 找不到 `# 标题` 时用的文件名（不含扩展名）。 */
  fallbackTitle: string;
};

function isTableRow(line: string): boolean {
  return /^\s*\|.*\|\s*$/.test(line);
}

function isTableSeparator(line: string): boolean {
  return /^\s*\|[\s:|-]+\|\s*$/.test(line) && line.includes("-");
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

/** 把一行表格压成律师能读的一行：`项目：说明；金额`。 */
function tableRowToLine(cells: string[]): string {
  const head = cells[0]?.trim() ?? "";
  const rest = cells
    .slice(1)
    .map((cell) => cell.trim())
    .filter((cell) => cell.length > 0 && cell !== "—" && cell !== "-");
  const unique = rest.filter((cell, index) => rest.indexOf(cell) === index);
  if (!head) {
    return unique.join("；");
  }
  return unique.length > 0 ? `${head}：${unique.join("；")}` : head;
}

/**
 * Word 版式没有表格容器时，把 Markdown 管道表格换成逐行文字。
 * 不丢单元格；重复单元格（如报价单里「说明」和「金额」同值）只写一次。
 */
function flattenPipeTables(lines: string[]): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    const next = lines[i + 1] ?? "";
    if (isTableRow(line) && isTableSeparator(next)) {
      i += 2;
      while (i < lines.length && isTableRow(lines[i] ?? "")) {
        const cells = splitTableRow(lines[i] ?? "");
        const rendered = tableRowToLine(cells);
        if (rendered) {
          out.push(rendered);
        }
        i += 1;
      }
      continue;
    }
    out.push(line);
    i += 1;
  }
  return out;
}

function stripBlockquote(line: string): string {
  return line.replace(/^\s*>\s?/, "").trimEnd();
}

/**
 * 委托包 Markdown → ArtifactDraft。
 *
 * - `# ` 作标题；
 * - 第一个 `## ` 之前的行（横幅、当事人、金额）放进无标题导语段；
 * - `## ` 起每节一个 section；
 * - 表格拍平成文字行。
 */
export function engagementMarkdownToDraft(
  markdown: string,
  input: EngagementDocxDraftInput,
): ArtifactDraft {
  const rawLines = markdown.replace(/\r\n/g, "\n").split("\n");
  let title = "";
  const intro: string[] = [];
  const sections: ArtifactSection[] = [];
  let current: { heading: string; lines: string[] } | null = null;

  for (const raw of rawLines) {
    const line = stripBlockquote(raw);
    if (!title && /^#\s+/.test(line)) {
      title = line.replace(/^#\s+/, "").trim();
      continue;
    }
    if (/^##\s+/.test(line)) {
      if (current) {
        sections.push({
          heading: current.heading,
          body: flattenPipeTables(current.lines).join("\n").trim(),
          citations: [],
        });
      }
      current = { heading: line.replace(/^##\s+/, "").trim(), lines: [] };
      continue;
    }
    if (current) {
      current.lines.push(line);
    } else {
      intro.push(line);
    }
  }
  if (current) {
    sections.push({
      heading: current.heading,
      body: flattenPipeTables(current.lines).join("\n").trim(),
      citations: [],
    });
  }

  const introBody = flattenPipeTables(intro).join("\n").trim();
  if (introBody) {
    sections.unshift({ heading: "", body: introBody, citations: [] });
  }

  return {
    taskId: input.taskId,
    matterId: input.matterId,
    title: title || input.fallbackTitle,
    output: "docx",
    templateId: "engagement-package",
    summary: "",
    sections,
    reviewNotes: [],
    reviewStatus: "pending",
    createdAt: input.createdAt,
  };
}

function docxNameFor(markdownName: string): string {
  const base = markdownName.replace(/\.md$/i, "");
  return `${base}.docx`;
}

function fileRecord(workspaceDir: string, absolutePath: string): EngagementPackageFile {
  const buffer = fs.readFileSync(absolutePath);
  return {
    name: path.basename(absolutePath),
    relativePath: path.relative(path.resolve(workspaceDir), absolutePath),
    sha256: createHash("sha256").update(buffer).digest("hex"),
    bytes: buffer.byteLength,
  };
}

/**
 * 从当前 Markdown 导出五份 DOCX。默认不覆盖已存在的 DOCX——
 * 律师可能已经在 Word 里改过；`overwrite: true` 才重写。
 */
export async function exportEngagementPackageDocx(
  workspaceDir: string,
  matterId: string,
  opts?: { overwrite?: boolean; now?: Date },
): Promise<EngagementDocxResult> {
  const id = matterId.trim();
  if (!isValidMatterId(id)) {
    return { ok: false, error: "invalid_matter_id" };
  }
  const manifest = loadEngagementPackage(workspaceDir, id);
  if (!manifest) {
    return { ok: false, error: "package_not_found" };
  }
  const dir = engagementPackageDir(workspaceDir, id);
  const markdownFiles = manifest.files.filter((file) => /\.md$/i.test(file.name));
  if (markdownFiles.length === 0) {
    return { ok: false, error: "package_not_found" };
  }

  const targets = markdownFiles.map((file) => docxNameFor(file.name));
  const existing = targets.filter((name) => fs.existsSync(path.join(dir, name)));
  if (existing.length > 0 && opts?.overwrite !== true) {
    return { ok: false, error: "exists", files: existing };
  }

  const generatedAt = (opts?.now ?? new Date()).toISOString();
  const tempDir = path.join(dir, `.docx-export-${process.pid}-${Date.now()}`);
  try {
    for (const [index, file] of markdownFiles.entries()) {
      const source = path.join(dir, file.name);
      if (!fs.existsSync(source)) {
        return { ok: false, error: "package_not_found" };
      }
      const markdown = fs.readFileSync(source, "utf8");
      const docxName = targets[index] ?? docxNameFor(file.name);
      const draft = engagementMarkdownToDraft(markdown, {
        taskId: `engagement-${id}-${index + 1}`,
        matterId: id,
        createdAt: generatedAt,
        fallbackTitle: docxName.replace(/\.docx$/i, ""),
      });
      const rendered = await renderDocxWithOptions(draft, tempDir, {
        templateVariant: "formalDocument",
        applyDeliverableDeai: false,
        skipDisclaimer: true,
        outputFileName: docxName,
      });
      if (!rendered.ok || !rendered.outputPath) {
        return {
          ok: false,
          error: "render_failed",
          message: `${file.name}: ${rendered.error ?? "渲染失败"}`,
        };
      }
    }

    const files: EngagementPackageFile[] = [];
    for (const name of targets) {
      const from = path.join(tempDir, name);
      const to = path.join(dir, name);
      fs.renameSync(from, to);
      files.push(fileRecord(workspaceDir, to));
    }

    const nextManifest = {
      ...manifest,
      docx: { generatedAt, files },
    };
    await writeFileAtomicAsync(
      path.join(dir, "manifest.json"),
      `${JSON.stringify(nextManifest, null, 2)}\n`,
    );
    return { ok: true, generatedAt, files };
  } catch (e) {
    return {
      ok: false,
      error: "write_failed",
      message: e instanceof Error ? e.message : String(e),
    };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}
