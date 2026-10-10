/**
 * Attach data-URL previews to layout runs that preserved a w:drawing.
 * Does not alter preservedXml — save still round-trips the original run.
 */
import type JSZip from "jszip";
import type { WordLayoutBlock, WordLayoutRun } from "../word-surface-layout.js";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".emf": "image/emf",
  ".wmf": "image/wmf",
};

export type LayoutImage = {
  src: string;
  widthPx?: number;
  heightPx?: number;
};

export async function hydrateLayoutImages(
  blocks: WordLayoutBlock[],
  zip: JSZip,
  relsPath = "word/_rels/document.xml.rels",
  budget: { total: number } = { total: 0 },
): Promise<WordLayoutBlock[]> {
  const rels = await zip.file(relsPath)?.async("string");
  if (!rels) {
    return blocks;
  }
  const targets = parseRelationshipTargets(rels);
  const walkRuns = async (runs: WordLayoutRun[]): Promise<WordLayoutRun[]> => {
    const out: WordLayoutRun[] = [];
    for (const run of runs) {
      if (!run.preservedXml || !/<w:drawing\b/.test(run.preservedXml)) {
        out.push(run);
        continue;
      }
      const size = extentPx(run.preservedXml);
      const embed = embedIdOf(run.preservedXml);
      const target = embed ? targets.get(embed) : undefined;
      if (!embed || !target) {
        out.push({ ...run, image: { src: "", ...size } });
        continue;
      }
      const mediaPath = resolveMediaPath(target);
      const file = zip.file(mediaPath);
      if (!file) {
        out.push({ ...run, image: { src: "", ...size } });
        continue;
      }
      const buf = await file.async("uint8array");
      if (buf.byteLength > MAX_IMAGE_BYTES || budget.total + buf.byteLength > MAX_TOTAL_BYTES) {
        out.push({ ...run, image: { src: "", ...size } });
        continue;
      }
      budget.total += buf.byteLength;
      const mime = mimeForPath(mediaPath);
      const b64 = Buffer.from(buf).toString("base64");
      out.push({
        ...run,
        image: {
          src: `data:${mime};base64,${b64}`,
          ...size,
        },
      });
    }
    return out;
  };
  const walk = async (list: WordLayoutBlock[]): Promise<WordLayoutBlock[]> => {
    const next: WordLayoutBlock[] = [];
    for (const block of list) {
      if (block.kind === "table") {
        next.push({
          ...block,
          rows: await Promise.all(
            block.rows.map(async (row) =>
              Promise.all(
                row.map(async (cell) => ({
                  ...cell,
                  blocks: await walk(cell.blocks),
                })),
              ),
            ),
          ),
        });
        continue;
      }
      next.push({ ...block, runs: await walkRuns(block.runs) });
    }
    return next;
  };
  return walk(blocks);
}

function parseRelationshipTargets(relsXml: string): Map<string, string> {
  const map = new Map<string, string>();
  const re = /<Relationship\b[^>]*>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(relsXml))) {
    const tag = match[0];
    const id = attr(tag, "Id");
    const target = attr(tag, "Target");
    if (id && target) {
      map.set(id, target);
    }
  }
  return map;
}

function attr(tag: string, name: string): string {
  const re = new RegExp(`${name}="([^"]*)"`);
  return re.exec(tag)?.[1] ?? "";
}

function embedIdOf(drawingXml: string): string | null {
  const match = /r:embed="([^"]+)"/.exec(drawingXml);
  return match?.[1] ?? null;
}

function resolveMediaPath(target: string): string {
  const cleaned = target.replace(/^\.\//, "").replace(/\\/g, "/");
  if (cleaned.startsWith("word/")) {
    return cleaned;
  }
  if (cleaned.startsWith("/word/")) {
    return cleaned.slice(1);
  }
  return `word/${cleaned.replace(/^\//, "")}`;
}

function mimeForPath(mediaPath: string): string {
  const low = mediaPath.toLowerCase();
  for (const [ext, mime] of Object.entries(MIME_BY_EXT)) {
    if (low.endsWith(ext)) {
      return mime;
    }
  }
  return "application/octet-stream";
}

/** `wp:extent` cx/cy are EMUs (914400 per inch). Convert at 96dpi. */
function extentPx(drawingXml: string): { widthPx?: number; heightPx?: number } {
  const cxAttr = /\bcx="(\d+)"/.exec(drawingXml);
  const cyAttr = /\bcy="(\d+)"/.exec(drawingXml);
  if (!cxAttr || !cyAttr) {
    return {};
  }
  const w = Math.round((Number(cxAttr[1]) * 96) / 914400);
  const h = Math.round((Number(cyAttr[1]) * 96) / 914400);
  return {
    ...(w > 0 ? { widthPx: w } : {}),
    ...(h > 0 ? { heightPx: h } : {}),
  };
}
