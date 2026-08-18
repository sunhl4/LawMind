/**
 * Word 选区与任务的一对一绑定：inbox/sidecar-*.md ↔ taskId。
 * 不挪 inbox 文件；ack 列表与绑定各自独立。
 */

import fs from "node:fs";
import path from "node:path";
import { isSidecarInboxRelativePath } from "./ingest.js";

export const SIDECAR_BINDINGS_REL = "lawmind/sidecar-bindings.json";

export type SidecarBinding = {
  relativePath: string;
  taskId: string;
  boundAt: string;
};

type BindingsFile = {
  items?: unknown;
};

const PATH_IN_TEXT = /inbox\/sidecar-(?:word|wps|paste)-[A-Za-z0-9._-]+\.md/g;

function bindingsPath(workspaceDir: string): string {
  return path.join(workspaceDir, ...SIDECAR_BINDINGS_REL.split("/"));
}

export function normalizeSidecarIngestPath(value: string): string | undefined {
  const normalized = value.replace(/\\/g, "/").replace(/^\//, "").trim();
  if (!isSidecarInboxRelativePath(normalized)) {
    return undefined;
  }
  return `inbox/${path.basename(normalized)}`;
}

export function extractSidecarIngestPathsFromText(text: string): string[] {
  const found = text.match(PATH_IN_TEXT) ?? [];
  return unique(
    found
      .map((item) => normalizeSidecarIngestPath(item))
      .filter((item): item is string => Boolean(item)),
  );
}

export function extractSidecarIngestPathsFromPins(pins: unknown): string[] {
  if (!Array.isArray(pins)) {
    return [];
  }
  const paths: string[] = [];
  for (const pin of pins) {
    if (typeof pin === "string") {
      const normalized = normalizeSidecarIngestPath(pin);
      if (normalized) {
        paths.push(normalized);
      }
      continue;
    }
    if (!pin || typeof pin !== "object") {
      continue;
    }
    const rel = (pin as { relPath?: unknown }).relPath;
    if (typeof rel === "string") {
      const normalized = normalizeSidecarIngestPath(rel);
      if (normalized) {
        paths.push(normalized);
      }
    }
  }
  return unique(paths);
}

function readBindings(workspaceDir: string): SidecarBinding[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(bindingsPath(workspaceDir), "utf8")) as BindingsFile;
    if (!Array.isArray(parsed.items)) {
      return [];
    }
    return parsed.items
      .map((row): SidecarBinding | undefined => {
        if (!row || typeof row !== "object") {
          return undefined;
        }
        const rec = row as Partial<SidecarBinding>;
        const relativePath =
          typeof rec.relativePath === "string"
            ? normalizeSidecarIngestPath(rec.relativePath)
            : undefined;
        if (!relativePath || typeof rec.taskId !== "string" || !rec.taskId.trim()) {
          return undefined;
        }
        return {
          relativePath,
          taskId: rec.taskId.trim(),
          boundAt: typeof rec.boundAt === "string" ? rec.boundAt : "",
        };
      })
      .filter((row): row is SidecarBinding => Boolean(row));
  } catch {
    return [];
  }
}

function writeBindings(workspaceDir: string, items: SidecarBinding[]): void {
  const file = bindingsPath(workspaceDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ items }, null, 2)}\n`, "utf8");
}

export function bindSidecarIngestToTask(
  workspaceDir: string,
  relativePath: string,
  taskId: string,
): SidecarBinding {
  const normalized = normalizeSidecarIngestPath(relativePath);
  if (!normalized) {
    throw new Error("invalid_sidecar_path");
  }
  const id = taskId.trim();
  if (!id) {
    throw new Error("invalid_task_id");
  }
  const next: SidecarBinding = {
    relativePath: normalized,
    taskId: id,
    boundAt: new Date().toISOString(),
  };
  const items = readBindings(workspaceDir).filter(
    (item) => item.relativePath !== normalized && item.taskId !== id,
  );
  items.push(next);
  writeBindings(workspaceDir, items);
  return next;
}

export function findSidecarIngestPathForTask(
  workspaceDir: string,
  taskId: string,
): string | undefined {
  return readBindings(workspaceDir).find((item) => item.taskId === taskId)?.relativePath;
}

export function maybeBindSidecarIngests(
  workspaceDir: string,
  taskId: string,
  hints: string[],
): string[] {
  const paths = unique(
    hints
      .flatMap((hint) => extractSidecarIngestPathsFromText(hint))
      .concat(
        hints
          .map((hint) => normalizeSidecarIngestPath(hint))
          .filter((item): item is string => Boolean(item)),
      ),
  );
  const bound: string[] = [];
  for (const relativePath of paths) {
    bindSidecarIngestToTask(workspaceDir, relativePath, taskId);
    bound.push(relativePath);
  }
  return bound;
}

function unique(items: string[]): string[] {
  return [...new Set(items)];
}
