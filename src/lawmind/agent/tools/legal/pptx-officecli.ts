/**
 * Visual PPTX preview + simple text edits via bundled officecli.
 * Screenshot path mirrors WPS/PowerPoint slide canvas; shape `set` writes text back.
 */

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveOfficeCliBin } from "../../../artifacts/officecli-bin.js";
import { buildMinimalChildEnv, runSafeCommand } from "../../../platform/safe-command.js";
import { ensureLocalFile } from "../../../runtime/icloud-materialize.js";

const OFFICECLI_MAX_STDOUT = 4_000_000;
const OFFICECLI_MAX_STDERR = 16_000;
const MAX_SLIDES = 80;
const MAX_EDITABLE_SHAPES = 200;

export type PptxEditableShape = {
  path: string;
  slideIndex: number;
  text: string;
  isTitle: boolean;
  name?: string;
  x?: string;
  y?: string;
  width?: string;
  height?: string;
};

export type PptxVisualSlideMeta = {
  index: number;
  label: string;
  title: string;
  shapes: PptxEditableShape[];
};

export type PptxVisualPreview = {
  mode: "visual";
  slideCount: number;
  truncatedSlides: boolean;
  slides: PptxVisualSlideMeta[];
  /** Cache key derived from abs path + mtime; slide PNGs live under cacheDir. */
  cacheKey: string;
};

export type PptxTextEdit = {
  path: string;
  text: string;
};

function officecliBin(explicit?: string): string {
  return explicit?.trim() || resolveOfficeCliBin() || "officecli";
}

async function runOfficeCli(
  args: string[],
  timeoutMs = 180_000,
  explicitBin?: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const bin = officecliBin(explicitBin);
  const result = await runSafeCommand({
    command: bin,
    args,
    env: buildMinimalChildEnv(),
    timeoutMs,
    stdio: ["ignore", "pipe", "pipe"],
    maxStdoutBytes: OFFICECLI_MAX_STDOUT,
    maxStderrBytes: OFFICECLI_MAX_STDERR,
  });
  if (result.exitSignal === "SIGTERM" || result.exitSignal === "SIGKILL") {
    throw new Error("officecli_timeout");
  }
  return {
    code: result.exitCode ?? 1,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function parseJsonPayload(stdout: string): unknown {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1)) as unknown;
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}

export function pptxPreviewCacheKey(absPath: string, mtimeMs: number): string {
  return createHash("sha1")
    .update(`${path.resolve(absPath)}\0${mtimeMs}`)
    .digest("hex")
    .slice(0, 24);
}

export function pptxSlideCachePath(
  cacheRoot: string,
  cacheKey: string,
  page1Based: number,
): string {
  return path.join(cacheRoot, "pptx-preview", cacheKey, `slide-${page1Based}.png`);
}

export async function loadPptxVisualPreview(params: {
  absPath: string;
  officecliCommand?: string;
}): Promise<PptxVisualPreview> {
  const abs = path.resolve(params.absPath);
  await ensureLocalFile(abs);
  const stat = await fs.stat(abs);
  if (!stat.isFile()) {
    throw new Error("not_a_file");
  }

  const statsRun = await runOfficeCli(
    ["view", abs, "stats", "--json"],
    120_000,
    params.officecliCommand,
  );
  if (statsRun.code !== 0) {
    throw new Error((statsRun.stderr || statsRun.stdout || "officecli_stats_failed").slice(0, 300));
  }
  const statsJson = parseJsonPayload(statsRun.stdout) as
    | { data?: { slides?: number }; slides?: number }
    | undefined;
  const slideCountRaw =
    typeof statsJson?.data?.slides === "number"
      ? statsJson.data.slides
      : typeof statsJson?.slides === "number"
        ? statsJson.slides
        : 0;
  if (!Number.isFinite(slideCountRaw) || slideCountRaw < 1) {
    throw new Error("pptx_no_slides");
  }
  const truncatedSlides = slideCountRaw > MAX_SLIDES;
  const slideCount = truncatedSlides ? MAX_SLIDES : slideCountRaw;

  const queryRun = await runOfficeCli(
    ["query", abs, "shape", "--json"],
    180_000,
    params.officecliCommand,
  );
  if (queryRun.code !== 0) {
    throw new Error((queryRun.stderr || queryRun.stdout || "officecli_query_failed").slice(0, 300));
  }
  const queryJson = parseJsonPayload(queryRun.stdout) as
    | {
        data?: { results?: unknown[] };
        results?: unknown[];
      }
    | undefined;
  const rawResults = Array.isArray(queryJson?.data?.results)
    ? queryJson.data.results
    : Array.isArray(queryJson?.results)
      ? queryJson.results
      : [];

  const shapesBySlide = new Map<number, PptxEditableShape[]>();
  let editableCount = 0;
  for (const raw of rawResults) {
    if (editableCount >= MAX_EDITABLE_SHAPES) {
      break;
    }
    const shape = normalizeShape(raw);
    if (!shape || !shape.text.trim()) {
      continue;
    }
    if (shape.slideIndex < 0 || shape.slideIndex >= slideCount) {
      continue;
    }
    const list = shapesBySlide.get(shape.slideIndex) ?? [];
    list.push(shape);
    shapesBySlide.set(shape.slideIndex, list);
    editableCount += 1;
  }

  const slides: PptxVisualSlideMeta[] = [];
  for (let i = 0; i < slideCount; i += 1) {
    const shapes = shapesBySlide.get(i) ?? [];
    const title =
      shapes.find((s) => s.isTitle)?.text.trim() ||
      shapes.find((s) => s.text.trim())?.text.trim() ||
      `第 ${i + 1} 页`;
    slides.push({
      index: i,
      label: String(i + 1),
      title: title.slice(0, 80),
      shapes,
    });
  }

  return {
    mode: "visual",
    slideCount,
    truncatedSlides,
    slides,
    cacheKey: pptxPreviewCacheKey(abs, stat.mtimeMs),
  };
}

export async function renderPptxSlideScreenshot(params: {
  absPath: string;
  page1Based: number;
  outPng: string;
  width?: number;
  height?: number;
  officecliCommand?: string;
}): Promise<void> {
  const abs = path.resolve(params.absPath);
  await ensureLocalFile(abs);
  await fs.mkdir(path.dirname(params.outPng), { recursive: true });
  const width = params.width ?? 1280;
  const height = params.height ?? 720;
  const run = await runOfficeCli(
    [
      "view",
      abs,
      "screenshot",
      "--page",
      String(params.page1Based),
      "-o",
      params.outPng,
      "--screenshot-width",
      String(width),
      "--screenshot-height",
      String(height),
      "--render",
      "html",
    ],
    180_000,
    params.officecliCommand,
  );
  if (run.code !== 0) {
    throw new Error((run.stderr || run.stdout || "officecli_screenshot_failed").slice(0, 400));
  }
  try {
    const st = await fs.stat(params.outPng);
    if (!st.isFile() || st.size < 32) {
      throw new Error("screenshot_missing");
    }
  } catch {
    throw new Error("screenshot_missing");
  }
}

export async function applyPptxTextEdits(params: {
  absPath: string;
  edits: readonly PptxTextEdit[];
  officecliCommand?: string;
}): Promise<{ applied: number }> {
  const abs = path.resolve(params.absPath);
  await ensureLocalFile(abs);
  let applied = 0;
  for (const edit of params.edits) {
    const shapePath = edit.path.trim();
    if (!shapePath.startsWith("/slide[")) {
      throw new Error(`invalid_shape_path:${shapePath.slice(0, 40)}`);
    }
    const text = sanitizeEditText(edit.text);
    const run = await runOfficeCli(
      ["set", abs, shapePath, "--prop", `text=${text}`],
      120_000,
      params.officecliCommand,
    );
    if (run.code !== 0) {
      throw new Error((run.stderr || run.stdout || `set_failed:${shapePath}`).slice(0, 400));
    }
    applied += 1;
  }
  try {
    await runOfficeCli(["save", abs], 60_000, params.officecliCommand);
  } catch {
    /* idle flush may still persist */
  }
  try {
    await runOfficeCli(["close", abs], 60_000, params.officecliCommand);
  } catch {
    /* ignore */
  }
  return { applied };
}

function sanitizeEditText(raw: string): string {
  return raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").slice(0, 8000);
}

function normalizeShape(raw: unknown): PptxEditableShape | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const rec = raw as Record<string, unknown>;
  const shapePath = typeof rec.path === "string" ? rec.path : "";
  if (!shapePath.startsWith("/slide[")) {
    return null;
  }
  const slideMatch = shapePath.match(/^\/slide\[(\d+)\]/i);
  const slide1 = Number(slideMatch?.[1] ?? 0);
  if (!Number.isFinite(slide1) || slide1 < 1) {
    return null;
  }
  const text =
    typeof rec.text === "string" ? rec.text : typeof rec.preview === "string" ? rec.preview : "";
  const format =
    rec.format && typeof rec.format === "object" ? (rec.format as Record<string, unknown>) : {};
  const isTitle = format.isTitle === true || rec.type === "title";
  return {
    path: shapePath,
    slideIndex: slide1 - 1,
    text,
    isTitle,
    ...(typeof format.name === "string" ? { name: format.name } : {}),
    ...(typeof format.x === "string" ? { x: format.x } : {}),
    ...(typeof format.y === "string" ? { y: format.y } : {}),
    ...(typeof format.width === "string" ? { width: format.width } : {}),
    ...(typeof format.height === "string" ? { height: format.height } : {}),
  };
}
