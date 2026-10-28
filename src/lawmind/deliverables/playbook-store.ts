/**
 * 本所剧本的落盘层：`<workspace>/lawmind/playbooks/<id>.json`。
 *
 * 只存律师/所内维护的三色条件，不内置任何美国 NDA 条款；
 * 没有文件就是「没加载本所剧本」，分流照实说 `basis=default`。
 * 这是 node-only 模块，不放进入口 barrel（渲染进程不需要读写文件）。
 */

import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { readJsonValidated, writeJsonAtomic } from "../adapters/matter-storage/io.js";
import type { Playbook, PlaybookCheck, PlaybookCriterion } from "./playbook-triage.js";

export const PLAYBOOK_SCHEMA_VERSION = 1;

/** 剧本 id 会变成文件名：只允许安全字符，拒绝路径穿越。 */
const SAFE_PLAYBOOK_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

const clauseTypeSchema = z.enum([
  "definition",
  "obligation",
  "right",
  "liability",
  "dispute",
  "general",
]);

const headingListSchema = z.array(z.string().trim().min(1).max(120)).min(1).max(20);
const phraseListSchema = z.array(z.string().trim().min(1).max(200)).min(1).max(20);

const checkSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("clause_present") }),
  z.object({ kind: z.literal("section_present"), headings: headingListSchema }),
  z.object({ kind: z.literal("phrase_present"), phrases: phraseListSchema }),
  z.object({ kind: z.literal("phrase_absent"), phrases: phraseListSchema }),
  z.object({ kind: z.literal("citation_present") }),
]);

const criterionSchema = z.object({
  id: z.string().trim().min(1).max(120),
  kind: z.enum(["green", "red"]),
  title: z.string().trim().min(1).max(200),
  check: checkSchema.optional(),
  clauseTypes: z.array(clauseTypeSchema).max(6).optional(),
});

const playbookSchema = z
  .object({
    id: z.string().trim().regex(SAFE_PLAYBOOK_ID, "剧本 id 只能包含字母、数字、点、下划线与连字符"),
    name: z.string().trim().min(1).max(200),
    jurisdiction: z.literal("PRC"),
    version: z.string().trim().min(1).max(40),
    stance: z.string().trim().max(2_000),
    acceptableRange: z.string().trim().max(2_000),
    escalationTriggers: z.array(z.string().trim().min(1).max(300)).max(30),
    criteria: z.array(criterionSchema).min(1).max(60),
    deliverableTypes: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
  })
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    for (const criterion of value.criteria) {
      if (seen.has(criterion.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["criteria"],
          message: `条件 id 重复：${criterion.id}`,
        });
      }
      seen.add(criterion.id);
    }
  });

/** 请求体与落盘共用同一份校验；路由不必再抄一遍字段规则。 */
export const PlaybookInputSchema = playbookSchema;

const storedPlaybookSchema = z.object({
  schemaVersion: z.literal(PLAYBOOK_SCHEMA_VERSION),
  playbook: playbookSchema,
});

type StoredPlaybook = z.infer<typeof storedPlaybookSchema>;

export type WorkspacePlaybookSummary = {
  id: string;
  name: string;
  version: string;
  jurisdiction: "PRC";
  criteriaCount: number;
  /** 适用范围；空 = 所有合同类。 */
  deliverableTypes: string[];
};

export function playbooksDir(workspaceDir: string): string {
  return path.join(path.resolve(workspaceDir), "lawmind", "playbooks");
}

function assertSafePlaybookId(id: string): string {
  const trimmed = id.trim();
  if (!SAFE_PLAYBOOK_ID.test(trimmed)) {
    throw new Error("invalid_playbook_id");
  }
  return trimmed;
}

export function playbookPath(workspaceDir: string, id: string): string {
  return path.join(playbooksDir(workspaceDir), `${assertSafePlaybookId(id)}.json`);
}

/** 读一份剧本；文件不在或格式不对都返回 undefined（调用方按 `basis=default` 处理）。 */
export function loadWorkspacePlaybook(workspaceDir: string, id: string): Playbook | undefined {
  let stored: StoredPlaybook | undefined;
  try {
    stored = readJsonValidated(playbookPath(workspaceDir, id), storedPlaybookSchema);
  } catch {
    return undefined;
  }
  return stored ? toPlaybook(stored.playbook) : undefined;
}

/** 列表只返回可读的剧本；坏档跳过，不让一份坏 JSON 挡住其它剧本。 */
export function listWorkspacePlaybooks(workspaceDir: string): WorkspacePlaybookSummary[] {
  let names: string[];
  try {
    names = fs.readdirSync(playbooksDir(workspaceDir));
  } catch {
    return [];
  }
  const out: WorkspacePlaybookSummary[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) {
      continue;
    }
    const id = name.slice(0, -".json".length);
    if (!SAFE_PLAYBOOK_ID.test(id)) {
      continue;
    }
    const playbook = loadWorkspacePlaybook(workspaceDir, id);
    if (!playbook) {
      continue;
    }
    out.push({
      id: playbook.id,
      name: playbook.name,
      version: playbook.version,
      jurisdiction: playbook.jurisdiction,
      criteriaCount: playbook.criteria.length,
      deliverableTypes: [...(playbook.deliverableTypes ?? [])],
    });
  }
  return out.toSorted((a, b) => a.id.localeCompare(b.id));
}

/**
 * 保存一份剧本。校验失败直接抛（调用方给 400）；
 * id 不一致属于调用方 bug，也直接抛，不做静默改名。
 */
export function saveWorkspacePlaybook(workspaceDir: string, playbook: Playbook): Playbook {
  const parsed = playbookSchema.parse(playbook);
  const stored: StoredPlaybook = {
    schemaVersion: PLAYBOOK_SCHEMA_VERSION,
    playbook: parsed,
  };
  writeJsonAtomic(playbookPath(workspaceDir, parsed.id), stored);
  return toPlaybook(parsed);
}

export function deleteWorkspacePlaybook(workspaceDir: string, id: string): boolean {
  const file = playbookPath(workspaceDir, id);
  if (!fs.existsSync(file)) {
    return false;
  }
  fs.rmSync(file, { force: true });
  return true;
}

function copyCheck(check: z.infer<typeof checkSchema>): PlaybookCheck {
  switch (check.kind) {
    case "section_present":
      return { kind: check.kind, headings: [...check.headings] };
    case "phrase_present":
    case "phrase_absent":
      return { kind: check.kind, phrases: [...check.phrases] };
    default:
      return { kind: check.kind };
  }
}

function toPlaybook(parsed: z.infer<typeof playbookSchema>): Playbook {
  return {
    id: parsed.id,
    name: parsed.name,
    jurisdiction: parsed.jurisdiction,
    version: parsed.version,
    stance: parsed.stance,
    acceptableRange: parsed.acceptableRange,
    escalationTriggers: [...parsed.escalationTriggers],
    criteria: parsed.criteria.map((criterion): PlaybookCriterion => ({
      id: criterion.id,
      kind: criterion.kind,
      title: criterion.title,
      ...(criterion.check ? { check: copyCheck(criterion.check) } : {}),
      ...(criterion.clauseTypes ? { clauseTypes: [...criterion.clauseTypes] } : {}),
    })),
    ...(parsed.deliverableTypes?.length ? { deliverableTypes: [...parsed.deliverableTypes] } : {}),
  };
}
