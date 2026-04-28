import fs from "node:fs/promises";
import path from "node:path";
import type { ArtifactDraft } from "../types.js";
import { scanDocxPlaceholders } from "./docx-template-fill.js";
import { suggestPlaceholderFieldPaths } from "./draft-template-values.js";

export type TemplateFormat = "docx" | "pptx";

/** 文书模板业务分类（用于 UI 分组与扩展清单）。 */
export type BuiltInTemplateCategory = "contracts" | "litigation" | "client" | "internal";

export type BuiltInTemplateSpec = {
  id: string;
  format: TemplateFormat;
  label: string;
  variant: string;
  category: BuiltInTemplateCategory;
};

export type UploadedTemplateRecord = {
  id: string;
  format: TemplateFormat;
  label: string;
  sourcePath: string;
  version: number;
  enabled: boolean;
  placeholderMap: Record<string, string>;
  uploadedAt: string;
};

type TemplateRegistryFile = {
  templates: UploadedTemplateRecord[];
};

export type ResolvedTemplate = {
  requestedId: string;
  resolvedId: string;
  format: TemplateFormat;
  variant: string;
  source: "built-in" | "uploaded" | "fallback";
  fallbackReason?: string;
  uploaded?: UploadedTemplateRecord;
};

const UPLOADED_ID_RE = /^upload\/[a-z0-9][a-z0-9._-]{1,63}$/;
const PLACEHOLDER_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/;

const BUILT_IN_TEMPLATES: BuiltInTemplateSpec[] = [
  {
    id: "word/legal-memo-default",
    format: "docx",
    label: "Legal Memo",
    variant: "legalMemo",
    category: "internal",
  },
  {
    id: "word/contract-default",
    format: "docx",
    label: "Contract Review",
    variant: "contractReview",
    category: "contracts",
  },
  {
    id: "word/demand-letter-default",
    format: "docx",
    label: "Demand Letter",
    variant: "demandLetter",
    category: "client",
  },
  {
    id: "ppt/client-brief-default",
    format: "pptx",
    label: "Client Brief",
    variant: "clientBrief",
    category: "client",
  },
  {
    id: "ppt/evidence-timeline-default",
    format: "pptx",
    label: "Evidence Timeline",
    variant: "evidenceTimeline",
    category: "litigation",
  },
  {
    id: "ppt/hearing-strategy-default",
    format: "pptx",
    label: "Hearing Strategy",
    variant: "hearingStrategy",
    category: "litigation",
  },
];

const DEFAULT_BUILT_IN_BY_FORMAT: Record<TemplateFormat, string> = {
  docx: "word/legal-memo-default",
  pptx: "ppt/client-brief-default",
};

export function listBuiltInTemplates(): BuiltInTemplateSpec[] {
  return [...BUILT_IN_TEMPLATES];
}

function registryFilePath(workspaceDir: string): string {
  return path.join(workspaceDir, "lawmind", "templates", "index.json");
}

async function readRegistry(workspaceDir: string): Promise<TemplateRegistryFile> {
  const filePath = registryFilePath(workspaceDir);
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<TemplateRegistryFile>;
    if (!Array.isArray(parsed.templates)) {
      return { templates: [] };
    }
    return {
      templates: parsed.templates.filter((item): item is UploadedTemplateRecord => {
        return (
          item &&
          typeof item.id === "string" &&
          (item.format === "docx" || item.format === "pptx") &&
          typeof item.label === "string" &&
          typeof item.sourcePath === "string" &&
          typeof item.version === "number" &&
          typeof item.enabled === "boolean" &&
          typeof item.uploadedAt === "string" &&
          typeof item.placeholderMap === "object" &&
          item.placeholderMap !== null
        );
      }),
    };
  } catch {
    return { templates: [] };
  }
}

async function writeRegistry(workspaceDir: string, registry: TemplateRegistryFile): Promise<void> {
  const filePath = registryFilePath(workspaceDir);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(registry, null, 2), "utf8");
}

function defaultTemplateIdFor(format: TemplateFormat): string {
  return DEFAULT_BUILT_IN_BY_FORMAT[format];
}

function toTemplateFormatFromDraft(draft: ArtifactDraft): TemplateFormat {
  return draft.output === "pptx" ? "pptx" : "docx";
}

function findBuiltIn(id: string): BuiltInTemplateSpec | undefined {
  return BUILT_IN_TEMPLATES.find((item) => item.id === id);
}

function normalizePlaceholderMap(input: Record<string, string>): Record<string, string> {
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    const trimmedKey = key.trim();
    const trimmedValue = value.trim();
    if (!trimmedKey || !trimmedValue) {
      continue;
    }
    if (!PLACEHOLDER_RE.test(trimmedKey)) {
      throw new Error(`invalid placeholder key: ${trimmedKey}`);
    }
    output[trimmedKey] = trimmedValue;
  }
  return output;
}

export async function registerUploadedTemplate(input: {
  workspaceDir: string;
  id: string;
  format: TemplateFormat;
  label: string;
  sourcePath: string;
  enabled?: boolean;
  placeholderMap?: Record<string, string>;
}): Promise<UploadedTemplateRecord> {
  const id = input.id.trim();
  if (!UPLOADED_ID_RE.test(id)) {
    throw new Error("template id must match upload/<name>");
  }
  const label = input.label.trim();
  if (!label) {
    throw new Error("template label is required");
  }
  const sourcePath = input.sourcePath.trim();
  if (!sourcePath) {
    throw new Error("template source path is required");
  }
  const ext = path.extname(sourcePath).toLowerCase();
  if (
    (input.format === "docx" && ext !== ".docx") ||
    (input.format === "pptx" && ext !== ".pptx")
  ) {
    throw new Error(`template extension ${ext || "<none>"} does not match format ${input.format}`);
  }

  await fs.access(sourcePath);

  let placeholderMap = normalizePlaceholderMap(input.placeholderMap ?? {});
  if (Object.keys(placeholderMap).length === 0 && input.format === "docx") {
    try {
      const names = await scanDocxPlaceholders(sourcePath);
      placeholderMap = normalizePlaceholderMap(suggestPlaceholderFieldPaths(names));
    } catch {
      placeholderMap = {};
    }
  }
  const registry = await readRegistry(input.workspaceDir);
  const existing = registry.templates.find((item) => item.id === id);
  const nextVersion = (existing?.version ?? 0) + 1;
  const storedDir = path.join(input.workspaceDir, "lawmind", "templates", "stored");
  await fs.mkdir(storedDir, { recursive: true });
  const safeName = id.replace(/\//g, "_");
  const destPath = path.join(storedDir, `${safeName}_v${nextVersion}${ext}`);
  await fs.copyFile(sourcePath, destPath);

  const next: UploadedTemplateRecord = {
    id,
    format: input.format,
    label,
    sourcePath: destPath,
    version: nextVersion,
    enabled: input.enabled ?? true,
    placeholderMap,
    uploadedAt: new Date().toISOString(),
  };
  const remaining = registry.templates.filter((item) => item.id !== id);
  await writeRegistry(input.workspaceDir, { templates: [...remaining, next] });
  return next;
}

export async function setUploadedTemplateEnabled(input: {
  workspaceDir: string;
  id: string;
  enabled: boolean;
}): Promise<UploadedTemplateRecord | undefined> {
  const registry = await readRegistry(input.workspaceDir);
  const current = registry.templates.find((item) => item.id === input.id);
  if (!current) {
    return undefined;
  }
  const next: UploadedTemplateRecord = {
    ...current,
    enabled: input.enabled,
  };
  const remaining = registry.templates.filter((item) => item.id !== input.id);
  await writeRegistry(input.workspaceDir, { templates: [...remaining, next] });
  return next;
}

export async function listUploadedTemplates(
  workspaceDir: string,
): Promise<UploadedTemplateRecord[]> {
  const registry = await readRegistry(workspaceDir);
  return [...registry.templates].toSorted((a, b) => a.id.localeCompare(b.id));
}

/** 从登记册删除上传模板并尝试删除已存储的模板文件。 */
export async function removeUploadedTemplate(input: {
  workspaceDir: string;
  id: string;
}): Promise<boolean> {
  const registry = await readRegistry(input.workspaceDir);
  const rec = registry.templates.find((item) => item.id === input.id);
  if (!rec) {
    return false;
  }
  try {
    await fs.unlink(rec.sourcePath);
  } catch {
    // 文件已不存在时仍移登记
  }
  await writeRegistry(input.workspaceDir, {
    templates: registry.templates.filter((item) => item.id !== input.id),
  });
  return true;
}

export async function resolveTemplateForDraft(input: {
  workspaceDir: string;
  draft: ArtifactDraft;
}): Promise<ResolvedTemplate> {
  const { draft, workspaceDir } = input;
  const format = toTemplateFormatFromDraft(draft);
  const requestedId = draft.templateId;

  const builtIn = findBuiltIn(requestedId);
  if (builtIn && builtIn.format === format) {
    return {
      requestedId,
      resolvedId: builtIn.id,
      format,
      variant: builtIn.variant,
      source: "built-in",
    };
  }

  const uploaded = (await readRegistry(workspaceDir)).templates.find(
    (item) => item.id === requestedId,
  );
  if (uploaded) {
    if (uploaded.format !== format) {
      const fallback = findBuiltIn(defaultTemplateIdFor(format))!;
      return {
        requestedId,
        resolvedId: fallback.id,
        format,
        variant: fallback.variant,
        source: "fallback",
        fallbackReason: `uploaded template format mismatch: ${uploaded.format} vs ${format}`,
      };
    }
    if (!uploaded.enabled) {
      const fallback = findBuiltIn(defaultTemplateIdFor(format))!;
      return {
        requestedId,
        resolvedId: fallback.id,
        format,
        variant: fallback.variant,
        source: "fallback",
        fallbackReason: "uploaded template disabled",
      };
    }
    try {
      await fs.access(uploaded.sourcePath);
      return {
        requestedId,
        resolvedId: uploaded.id,
        format,
        variant: "uploadedMapped",
        source: "uploaded",
        uploaded,
      };
    } catch {
      const fallback = findBuiltIn(defaultTemplateIdFor(format))!;
      return {
        requestedId,
        resolvedId: fallback.id,
        format,
        variant: fallback.variant,
        source: "fallback",
        fallbackReason: "uploaded template file missing",
      };
    }
  }

  const fallback = findBuiltIn(defaultTemplateIdFor(format))!;
  return {
    requestedId,
    resolvedId: fallback.id,
    format,
    variant: fallback.variant,
    source: "fallback",
    fallbackReason: "unknown template id",
  };
}
