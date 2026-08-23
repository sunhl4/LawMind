import fs from "node:fs";
import path from "node:path";
import { CLAUSE_PLAYBOOK_RELATIVE } from "../memory/playbook-learning.js";
import type { ComposeContextPin } from "../platform/compose-context-pin.js";
import { getFleetPlaybook } from "../review-campaign/playbooks.js";
import { deliverableTypeFromInstruction } from "../router/intake-gate.js";

/** Contract works always see the clause playbook — lawyer does not hunt settings. */
export function withContractPlaybookPin(
  pins: ComposeContextPin[] | undefined,
  instruction: string,
): ComposeContextPin[] {
  const current = pins ?? [];
  if (current.some((pin) => pin.pinKind === "clause")) {
    return current;
  }
  const type = deliverableTypeFromInstruction(instruction);
  if (!type?.startsWith("contract.")) {
    return current;
  }
  return [...current, { pinKind: "clause", scope: "full" }];
}

const PINNED_EXCERPT_MAX_CHARS = 8_000;

export type PinnedContextSummary = {
  included: boolean;
  evidence: string[];
  markdownBlock?: string;
};

function readTextExcerpt(absPath: string, maxChars = PINNED_EXCERPT_MAX_CHARS): string | null {
  try {
    const text = fs.readFileSync(absPath, "utf8").trim();
    if (!text) {
      return null;
    }
    return text.length > maxChars
      ? `${text.slice(0, maxChars)}\n…[钉选内容截断，完整内容请用工具读取]`
      : text;
  } catch {
    return null;
  }
}

function extractMarkdownSection(content: string, heading: string): string | null {
  const normalized = heading.trim();
  if (!normalized) {
    return null;
  }
  const headingPattern = new RegExp(`^${normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m");
  const match = headingPattern.exec(content);
  if (!match || match.index < 0) {
    return null;
  }
  const start = match.index + match[0].length;
  const rest = content.slice(start);
  const nextHeading = rest.search(/\n##\s+/);
  const section = nextHeading >= 0 ? rest.slice(0, nextHeading) : rest;
  const trimmed = section.trim();
  return trimmed || null;
}

export function resolvePinnedContextSummary(opts: {
  workspaceDir: string;
  pins: ComposeContextPin[];
}): PinnedContextSummary {
  if (opts.pins.length === 0) {
    return { included: false, evidence: [] };
  }

  const evidence: string[] = [];
  const blocks: string[] = [];

  for (const pin of opts.pins) {
    switch (pin.pinKind) {
      case "file":
        evidence.push(`file:${pin.root}:${pin.relPath}`);
        break;
      case "evidence": {
        const rel = `cases/${pin.matterId}/${pin.relPath.replace(/^\/+/, "")}`;
        evidence.push(`evidence:${rel}`);
        blocks.push(`- 证据材料 \`${rel}\` — 请用 analyze_document 或 read_case_file 读取该路径。`);
        break;
      }
      case "theory": {
        const rel = `cases/${pin.matterId}/MATTER_STRATEGY.md`;
        evidence.push(`theory:${rel}`);
        const excerpt = readTextExcerpt(path.join(opts.workspaceDir, rel));
        blocks.push(
          excerpt
            ? `### 本案理论（MATTER_STRATEGY）\n${excerpt}`
            : `- 本案理论 \`${rel}\` — 文件不存在或为空，请用 read_case_file 读取。`,
        );
        break;
      }
      case "clause": {
        const rel = CLAUSE_PLAYBOOK_RELATIVE;
        evidence.push(
          pin.scope === "section" && pin.sectionHeading
            ? `clause:${rel}#${pin.sectionHeading}`
            : `clause:${rel}`,
        );
        const full = readTextExcerpt(
          path.join(opts.workspaceDir, rel),
          PINNED_EXCERPT_MAX_CHARS * 2,
        );
        if (!full) {
          blocks.push(
            `- 条款 Playbook \`${rel}\` — 请用 search_workspace 或 read_case_file 读取。`,
          );
          break;
        }
        if (pin.scope === "section" && pin.sectionHeading) {
          const section = extractMarkdownSection(full, pin.sectionHeading);
          blocks.push(
            section
              ? `### 条款 Playbook 片段 · ${pin.sectionHeading}\n${section.slice(0, PINNED_EXCERPT_MAX_CHARS)}`
              : `- 条款 Playbook 片段「${pin.sectionHeading}」未找到；整册路径 \`${rel}\`。`,
          );
        } else {
          blocks.push(`### 条款 Playbook（整册）\n${full.slice(0, PINNED_EXCERPT_MAX_CHARS)}`);
        }
        break;
      }
      case "playbook": {
        evidence.push(`playbook:${pin.playbookId}`);
        const pb = getFleetPlaybook(opts.workspaceDir, pin.playbookId);
        if (!pb) {
          blocks.push(`- 审查剧本 \`${pin.playbookId}\` — 未找到，请核对 fleet playbook 配置。`);
          break;
        }
        const roleLines = pb.roles.map(
          (role) => `- ${role.label}（${role.id}）：${role.promptHint ?? "按角色职责审查"}`,
        );
        blocks.push([`### 审查剧本 · ${pb.label}（${pb.id}）`, ...roleLines].join("\n"));
        break;
      }
      default: {
        const _exhaustive: never = pin;
        evidence.push(String(_exhaustive));
      }
    }
  }

  const markdownBlock =
    blocks.length > 0 ? ["## 律师钉选真源（本回合）", "", ...blocks].join("\n") : undefined;

  return {
    included: true,
    evidence,
    markdownBlock,
  };
}
