/**
 * Skills E7 — local SKILL.md discovery + HMAC-style signature check.
 */

import { createHash, createHmac } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type SkillMeta = {
  id: string;
  name: string;
  version: string;
  description: string;
  enabled: boolean;
  dir: string;
  signatureOk: boolean;
  signatureError?: string;
  /** Comma-separated in frontmatter `workflows:` */
  workflowIds?: string[];
  /** Comma-separated in frontmatter `tags:` */
  tags?: string[];
  /** Comma-separated in frontmatter `tools:` — disclosed when the skill is enabled. */
  toolNames?: string[];
};

function csvField(v: string | undefined): string[] {
  if (!v?.trim()) {
    return [];
  }
  return v
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;

function parseFrontmatter(raw: string): Record<string, string> {
  const m = FRONTMATTER.exec(raw);
  const block = m?.[1] ?? "";
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

export function skillSignatureSecret(workspaceDir: string): string {
  const env = process.env.LAWMIND_SKILL_SIGNING_SECRET?.trim();
  if (env) {
    return env;
  }
  const packFile = path.join(workspaceDir, "lawmind", "skills", ".signing-secret");
  try {
    if (fs.existsSync(packFile)) {
      const s = fs.readFileSync(packFile, "utf8").trim();
      if (s) {
        return s;
      }
    }
  } catch {
    /* fall through */
  }
  // Dev default — not for production attestation.
  return createHash("sha256").update(`lawmind-skill:${workspaceDir}`).digest("hex").slice(0, 32);
}

export function signSkillBody(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

export function verifySkillSignature(
  body: string,
  signatureFileContents: string | null,
  secret: string,
): { ok: boolean; error?: string } {
  if (!signatureFileContents?.trim()) {
    return { ok: false, error: "missing_signature" };
  }
  const expected = signSkillBody(body, secret).toLowerCase();
  const got = signatureFileContents.trim().toLowerCase();
  if (got !== expected) {
    return { ok: false, error: "signature_mismatch" };
  }
  return { ok: true };
}

function skillsRoot(workspaceDir: string): string {
  return path.join(workspaceDir, "lawmind", "skills");
}

function readEnabledSet(workspaceDir: string): Set<string> | null {
  const file = path.join(skillsRoot(workspaceDir), "enabled.json");
  try {
    if (!fs.existsSync(file)) {
      return null;
    }
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as { enabled?: string[] };
    return new Set((raw.enabled ?? []).map(String));
  } catch {
    return null;
  }
}

export function writeSkillEnabled(workspaceDir: string, skillId: string, enabled: boolean): void {
  const root = skillsRoot(workspaceDir);
  fs.mkdirSync(root, { recursive: true });
  const file = path.join(root, "enabled.json");
  let list: string[] = [];
  try {
    if (fs.existsSync(file)) {
      list = (JSON.parse(fs.readFileSync(file, "utf8")) as { enabled?: string[] }).enabled ?? [];
    }
  } catch {
    list = [];
  }
  const set = new Set(list);
  if (enabled) {
    set.add(skillId);
  } else {
    set.delete(skillId);
  }
  fs.writeFileSync(file, `${JSON.stringify({ enabled: [...set] }, null, 2)}\n`, "utf8");
}

/** Discover SKILL.md under workspace/lawmind/skills/<id>/ */
export function listLocalSkills(workspaceDir: string): SkillMeta[] {
  const root = skillsRoot(workspaceDir);
  const secret = skillSignatureSecret(workspaceDir);
  const enabledSet = readEnabledSet(workspaceDir);
  if (!fs.existsSync(root)) {
    return [];
  }
  const out: SkillMeta[] = [];
  for (const name of fs.readdirSync(root)) {
    const dir = path.join(root, name);
    if (!fs.statSync(dir).isDirectory()) {
      continue;
    }
    const skillPath = path.join(dir, "SKILL.md");
    if (!fs.existsSync(skillPath)) {
      continue;
    }
    const body = fs.readFileSync(skillPath, "utf8");
    const fm = parseFrontmatter(body);
    const id = fm.id?.trim() || name;
    const sigPath = path.join(dir, "SKILL.sig");
    const sig = fs.existsSync(sigPath) ? fs.readFileSync(sigPath, "utf8") : null;
    const verified = verifySkillSignature(body, sig, secret);
    const enabledDefault = enabledSet == null ? verified.ok : enabledSet.has(id);
    out.push({
      id,
      name: fm.name?.trim() || id,
      version: fm.version?.trim() || "0",
      description: fm.description?.trim() || "",
      enabled: enabledDefault && verified.ok,
      dir,
      signatureOk: verified.ok,
      signatureError: verified.error,
      workflowIds: csvField(fm.workflows),
      tags: csvField(fm.tags),
      toolNames: csvField(fm.tools),
    });
  }
  return out.toSorted((a, b) => a.id.localeCompare(b.id));
}
