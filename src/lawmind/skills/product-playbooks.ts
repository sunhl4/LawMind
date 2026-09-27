/**
 * Product playbooks ship inside the app. They are not a skill store:
 * workspace SKILL.md drops cannot add, override, or disable them.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { SkillMeta } from "./skill-runtime.js";

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;

function builtinDir(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "builtin");
}

function csvField(v: string | undefined): string[] {
  if (!v?.trim()) {
    return [];
  }
  return v
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseFrontmatter(raw: string): Record<string, string> {
  const block = FRONTMATTER.exec(raw)?.[1] ?? "";
  const out: Record<string, string> = {};
  for (const line of block.split("\n")) {
    const i = line.indexOf(":");
    if (i <= 0) {
      continue;
    }
    const k = line.slice(0, i).trim();
    const v = line
      .slice(i + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    if (k) {
      out[k] = v;
    }
  }
  return out;
}

export function productPlaybookDir(): string {
  return builtinDir();
}

/** Every `builtin/*.md` is a product playbook. The directory is the registry. */
export function listProductPlaybookFiles(): string[] {
  const root = builtinDir();
  if (!fs.existsSync(root)) {
    return [];
  }
  return fs
    .readdirSync(root)
    .filter((name) => name.endsWith(".md"))
    .toSorted((a, b) => a.localeCompare(b));
}

export function listProductPlaybooks(): SkillMeta[] {
  const root = builtinDir();
  const out: SkillMeta[] = [];
  for (const file of listProductPlaybookFiles()) {
    const body = fs.readFileSync(path.join(root, file), "utf8");
    const fm = parseFrontmatter(body);
    const id = fm.id?.trim() || file.replace(/\.md$/, "");
    out.push({
      id,
      name: fm.name?.trim() || id,
      version: fm.version?.trim() || "0",
      description: fm.description?.trim() || "",
      enabled: true,
      dir: root,
      signatureOk: true,
      workflowIds: csvField(fm.workflows),
      tags: csvField(fm.tags),
      toolNames: csvField(fm.tools),
    });
  }
  return out.toSorted((a, b) => a.id.localeCompare(b.id));
}

export function productPlaybookIds(): string[] {
  return listProductPlaybooks().map((s) => s.id);
}

/** Tools named by product playbooks. Workspace skill files cannot add names. */
export function productPlaybookToolNames(): string[] {
  const names = new Set<string>();
  for (const skill of listProductPlaybooks()) {
    for (const name of skill.toolNames ?? []) {
      names.add(name);
    }
  }
  return [...names].toSorted((a, b) => a.localeCompare(b));
}
