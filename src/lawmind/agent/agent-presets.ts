/**
 * Workspace agent presets — Cursor `.cursor/agents/*.md` parity for legal subagents.
 * Files live under `<workspace>/lawmind/agents/*.md`.
 */

import fs from "node:fs";
import path from "node:path";
import type { AgentPreset } from "../platform/agent-fleet.js";

const AGENTS_DIR = path.join("lawmind", "agents");

const META_KEYS = new Set([
  "role",
  "roleId",
  "deliverableType",
  "riskLevel",
  "practiceArea",
  "description",
]);

export function agentPresetsDir(workspaceDir: string): string {
  return path.join(workspaceDir, AGENTS_DIR);
}

function parseAgentPresetFile(filePath: string, raw: string): AgentPreset | null {
  const id = path.basename(filePath, path.extname(filePath));
  const lines = raw.split(/\r?\n/);
  let title = id;
  const meta: Record<string, string> = {};
  const body: string[] = [];
  let inBody = false;

  for (const line of lines) {
    const heading = /^#\s+(.+)$/.exec(line.trim());
    if (heading && !inBody) {
      title = heading[1].trim();
      continue;
    }
    const kv = /^([a-zA-Z][\w]*)\s*:\s*(.+)$/.exec(line.trim());
    if (kv && !inBody && META_KEYS.has(kv[1])) {
      meta[kv[1]] = kv[2].trim();
      continue;
    }
    if (!inBody && line.trim() === "" && Object.keys(meta).length > 0) {
      inBody = true;
      continue;
    }
    if (inBody || (!kv && line.trim() !== "" && !heading)) {
      inBody = true;
      body.push(line);
    }
  }

  const starterPrompt = body.join("\n").trim();
  return {
    id,
    title,
    description: meta.description ?? starterPrompt.slice(0, 160),
    roleId: meta.roleId ?? meta.role,
    deliverableType: meta.deliverableType,
    riskLevel: meta.riskLevel,
    practiceArea: meta.practiceArea,
    starterPrompt: starterPrompt || `请以「${title}」角色处理以下法律任务：\n\n`,
    sourcePath: filePath,
  };
}

export function listWorkspaceAgentPresets(workspaceDir: string): AgentPreset[] {
  const dir = agentPresetsDir(workspaceDir);
  if (!fs.existsSync(dir)) {
    return [];
  }
  const out: AgentPreset[] = [];
  for (const name of fs.readdirSync(dir).toSorted()) {
    if (!name.endsWith(".md")) {
      continue;
    }
    const filePath = path.join(dir, name);
    try {
      const raw = fs.readFileSync(filePath, "utf8");
      const preset = parseAgentPresetFile(filePath, raw);
      if (preset) {
        out.push(preset);
      }
    } catch {
      /* skip unreadable preset */
    }
  }
  return out;
}

export function loadWorkspaceAgentPreset(
  workspaceDir: string,
  presetId: string,
): AgentPreset | null {
  const safe = presetId.replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safe) {
    return null;
  }
  const filePath = path.join(agentPresetsDir(workspaceDir), `${safe}.md`);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    return parseAgentPresetFile(filePath, fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}
