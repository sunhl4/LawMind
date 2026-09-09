/**
 * Seed signed built-in Skills under workspace/lawmind/skills/<id>/.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { signSkillBody, skillSignatureSecret } from "./skill-runtime.js";

const BUILTIN_IDS = [
  "contract-redline-craft",
  "intake-required-inputs",
  "citation-grounding",
  "delivery-language",
  "spreadsheet-analysis",
  "practice-defaults",
  "legal-element-extraction",
  "contract-review-layers",
  "research-query-matrix",
  "evidence-argument-chain",
  "labor-compensation-calc",
  "chronology-from-materials",
  "matter-from-materials",
  "quick-legal-triage",
  "contract-drafting-route",
  "litigation-stage-route",
  "norm-validity",
  "complaint-elements-fill",
  "legal-period-calc",
  "criminal-stage-route",
  "bankruptcy-stage-route",
  "invoice-organizer",
  "court-sms-intake",
  "matter-budget-lite",
  "ip-dispute-route",
  "ma-diligence-route",
  "data-compliance-route",
  "ads-compliance-route",
  "matter-status-report",
  "family-matter-route",
  "capital-markets-route",
  "governance-route",
] as const;

function builtinDir(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "builtin");
}

function skillsRoot(workspaceDir: string): string {
  return path.join(path.resolve(workspaceDir), "lawmind", "skills");
}

function parseVersion(raw: string): number {
  const m = /^---\r?\n[\s\S]*?^version:\s*["']?(\d+)/m.exec(raw);
  return m ? Number(m[1]) : 0;
}

function isBuiltinSourced(raw: string): boolean {
  return /source:\s*lawmind-builtin/.test(raw);
}

/**
 * Ensure built-in SKILL.md + SKILL.sig exist. Refreshes only when missing or
 * existing file is still marked `source: lawmind-builtin` with older/equal body.
 */
export function ensureBuiltinSkillSeeds(workspaceDir: string): {
  created: string[];
  upgraded: string[];
  skipped: string[];
} {
  const root = skillsRoot(workspaceDir);
  fs.mkdirSync(root, { recursive: true });
  const secret = skillSignatureSecret(workspaceDir);
  const created: string[] = [];
  const upgraded: string[] = [];
  const skipped: string[] = [];
  const srcRoot = builtinDir();

  for (const id of BUILTIN_IDS) {
    const srcPath = path.join(srcRoot, `${id}.md`);
    if (!fs.existsSync(srcPath)) {
      skipped.push(id);
      continue;
    }
    const body = fs.readFileSync(srcPath, "utf8");
    const dir = path.join(root, id);
    const skillPath = path.join(dir, "SKILL.md");
    const sigPath = path.join(dir, "SKILL.sig");

    if (fs.existsSync(skillPath)) {
      const existing = fs.readFileSync(skillPath, "utf8");
      if (!isBuiltinSourced(existing)) {
        skipped.push(id);
        continue;
      }
      if (existing === body && fs.existsSync(sigPath)) {
        skipped.push(id);
        continue;
      }
      if (parseVersion(existing) > parseVersion(body)) {
        skipped.push(id);
        continue;
      }
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(skillPath, body, "utf8");
      fs.writeFileSync(sigPath, `${signSkillBody(body, secret)}\n`, "utf8");
      upgraded.push(id);
      continue;
    }

    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(skillPath, body, "utf8");
    fs.writeFileSync(sigPath, `${signSkillBody(body, secret)}\n`, "utf8");
    created.push(id);
  }

  return { created, upgraded, skipped };
}

export const BUILTIN_SKILL_SEED_IDS = BUILTIN_IDS;
