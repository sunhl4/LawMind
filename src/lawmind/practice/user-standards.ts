/**
 * Named lawyer standards. Defaults ship in-code; workspace copies live under lawmind/standards/.
 * Bind by contract type / client / keywords. Learned candidates stay disabled until confirmed.
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { writeFileAtomicAsync } from "../adapters/matter-storage/io.js";
import {
  CLOSED_CONTRACT_TYPE_IDS,
  type ClosedContractTypeId,
} from "../contracts/closed-contract-type.js";
import { DEFAULT_PRACTICE_PLAYBOOK } from "../practice/practice-playbook.js";

export const USER_STANDARDS_REL = path.join("lawmind", "standards");

export const USER_STANDARD_KINDS = [
  "contract_review",
  "litigation_intake",
  "daily_triage",
] as const;
export type UserStandardKind = (typeof USER_STANDARD_KINDS)[number];

export type UserStandardItemTone = "check" | "never_accept" | "must_rewrite";

export type UserStandardItem = {
  text: string;
  tone: UserStandardItemTone;
};

export type UserStandardBindWhen = {
  contractTypes?: ClosedContractTypeId[];
  keywords?: string[];
  clientIds?: string[];
};

export type UserStandard = {
  id: string;
  title: string;
  kind: UserStandardKind;
  bindWhen: UserStandardBindWhen;
  items: UserStandardItem[];
  source: "builtin" | "lawyer" | "learned";
  enabled: boolean;
  updatedAt: string;
};

export type UserStandardMatchInput = {
  instruction?: string;
  clientId?: string;
  contractType?: string;
  standardId?: string;
};

function standardsDir(workspaceDir: string): string {
  return path.join(path.resolve(workspaceDir), USER_STANDARDS_REL);
}

export function builtinUserStandards(): UserStandard[] {
  const now = "1970-01-01T00:00:00.000Z";
  return [
    {
      id: "builtin-contract-review",
      title: "通用合同审查口径",
      kind: "contract_review",
      bindWhen: {},
      items: [
        ...DEFAULT_PRACTICE_PLAYBOOK.neverAccept.map((text) => ({
          text,
          tone: "never_accept" as const,
        })),
        { text: "核对争议解决是否对我方明显不利", tone: "check" },
        { text: "责任上限与排除人身/故意/重大过失的条款是否经提示", tone: "check" },
      ],
      source: "builtin",
      enabled: true,
      updatedAt: now,
    },
    {
      id: "builtin-mail-triage",
      title: "每日邮件待回复",
      kind: "daily_triage",
      bindWhen: { keywords: ["请尽快", "请确认", "是否"] },
      items: [{ text: "未读且含请求/问句的来信标为待回复", tone: "check" }],
      source: "builtin",
      enabled: true,
      updatedAt: now,
    },
  ];
}

function parseKind(v: unknown): UserStandardKind {
  return USER_STANDARD_KINDS.includes(v as UserStandardKind)
    ? (v as UserStandardKind)
    : "contract_review";
}

function parseItems(raw: unknown): UserStandardItem[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: UserStandardItem[] = [];
  for (const row of raw) {
    if (typeof row === "string" && row.trim()) {
      out.push({ text: row.trim().slice(0, 400), tone: "check" });
      continue;
    }
    if (!row || typeof row !== "object") {
      continue;
    }
    const o = row as Record<string, unknown>;
    const text = typeof o.text === "string" ? o.text.trim() : "";
    if (!text) {
      continue;
    }
    const tone: UserStandardItemTone =
      o.tone === "never_accept" || o.tone === "must_rewrite" ? o.tone : "check";
    out.push({ text: text.slice(0, 400), tone });
  }
  return out.slice(0, 40);
}

function parseBindWhen(raw: unknown): UserStandardBindWhen {
  if (!raw || typeof raw !== "object") {
    return {};
  }
  const o = raw as Record<string, unknown>;
  const contractTypes = Array.isArray(o.contractTypes)
    ? o.contractTypes.filter((id): id is ClosedContractTypeId =>
        (CLOSED_CONTRACT_TYPE_IDS as readonly string[]).includes(String(id)),
      )
    : undefined;
  const keywords = Array.isArray(o.keywords)
    ? o.keywords
        .filter((k): k is string => typeof k === "string" && k.trim().length > 0)
        .map((k) => k.trim())
    : undefined;
  const clientIds = Array.isArray(o.clientIds)
    ? o.clientIds.filter((k): k is string => typeof k === "string" && k.trim().length > 0)
    : undefined;
  return {
    ...(contractTypes && contractTypes.length > 0 ? { contractTypes } : {}),
    ...(keywords && keywords.length > 0 ? { keywords } : {}),
    ...(clientIds && clientIds.length > 0 ? { clientIds } : {}),
  };
}

export function parseUserStandard(raw: unknown, fallbackId: string): UserStandard | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const o = raw as Record<string, unknown>;
  const title = typeof o.title === "string" ? o.title.trim() : "";
  if (!title) {
    return null;
  }
  const source =
    o.source === "lawyer" || o.source === "learned" || o.source === "builtin" ? o.source : "lawyer";
  return {
    id: typeof o.id === "string" && o.id.trim() ? o.id.trim() : fallbackId,
    title: title.slice(0, 80),
    kind: parseKind(o.kind),
    bindWhen: parseBindWhen(o.bindWhen),
    items: parseItems(o.items),
    source,
    enabled: o.enabled !== false,
    updatedAt: typeof o.updatedAt === "string" ? o.updatedAt : new Date().toISOString(),
  };
}

export function loadUserStandards(workspaceDir: string): UserStandard[] {
  const builtins = builtinUserStandards();
  const dir = standardsDir(workspaceDir);
  if (!fs.existsSync(dir)) {
    return builtins;
  }
  const byId = new Map<string, UserStandard>(builtins.map((s) => [s.id, s]));
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".json")) {
      continue;
    }
    try {
      const parsed = parseUserStandard(
        JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")),
        name.replace(/\.json$/i, ""),
      );
      if (parsed) {
        byId.set(parsed.id, parsed);
      }
    } catch {
      /* skip */
    }
  }
  return [...byId.values()].toSorted((a, b) => a.title.localeCompare(b.title, "zh"));
}

export async function saveUserStandard(
  workspaceDir: string,
  input: Partial<UserStandard> & { title: string; kind?: UserStandardKind },
): Promise<UserStandard> {
  const id = input.id?.trim() || `std-${randomUUID().slice(0, 8)}`;
  const current = loadUserStandards(workspaceDir).find((s) => s.id === id);
  const next: UserStandard = {
    id,
    title: input.title.trim().slice(0, 80),
    kind: input.kind ?? current?.kind ?? "contract_review",
    bindWhen: parseBindWhen(input.bindWhen ?? current?.bindWhen ?? {}),
    items: input.items ?? current?.items ?? [],
    source: input.source ?? current?.source ?? "lawyer",
    enabled: input.enabled ?? current?.enabled ?? true,
    updatedAt: new Date().toISOString(),
  };
  const file = path.join(standardsDir(workspaceDir), `${id}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await writeFileAtomicAsync(file, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

export async function deleteUserStandard(workspaceDir: string, id: string): Promise<boolean> {
  if (id.startsWith("builtin-")) {
    return false;
  }
  const file = path.join(standardsDir(workspaceDir), `${id}.json`);
  if (!fs.existsSync(file)) {
    return false;
  }
  fs.unlinkSync(file);
  return true;
}

export function standardMatches(standard: UserStandard, input: UserStandardMatchInput): boolean {
  if (!standard.enabled) {
    return false;
  }
  if (input.standardId && standard.id === input.standardId) {
    return true;
  }
  const bind = standard.bindWhen;
  const hasBind =
    (bind.contractTypes && bind.contractTypes.length > 0) ||
    (bind.keywords && bind.keywords.length > 0) ||
    (bind.clientIds && bind.clientIds.length > 0);
  if (!hasBind) {
    return standard.kind === "contract_review" || standard.kind === "daily_triage";
  }
  if (bind.clientIds?.length && input.clientId && bind.clientIds.includes(input.clientId)) {
    return true;
  }
  if (
    bind.contractTypes?.length &&
    input.contractType &&
    bind.contractTypes.includes(input.contractType as ClosedContractTypeId)
  ) {
    return true;
  }
  const hay = `${input.instruction ?? ""} ${input.clientId ?? ""}`.toLowerCase();
  if (bind.keywords?.some((k) => hay.includes(k.toLowerCase()))) {
    return true;
  }
  return false;
}

export function matchUserStandards(
  workspaceDir: string,
  input: UserStandardMatchInput,
  kind?: UserStandardKind,
): UserStandard[] {
  return loadUserStandards(workspaceDir).filter((s) => {
    if (kind && s.kind !== kind) {
      return false;
    }
    return standardMatches(s, input);
  });
}

export function formatUserStandardsPromptBlock(standards: UserStandard[]): string | undefined {
  const active = standards.filter((s) => s.enabled && s.items.length > 0);
  if (active.length === 0) {
    return undefined;
  }
  const blocks = active.map((s) => {
    const items = s.items.map((item) => {
      const tag =
        item.tone === "never_accept"
          ? "原则上不接受"
          : item.tone === "must_rewrite"
            ? "必须改写"
            : "核对";
      return `- ${tag}：${item.text}`;
    });
    return `### ${s.title}\n${items.join("\n")}`;
  });
  return [
    "## 已套用审查标准",
    "来源：律师工作区标准库。可在工作台或设置中换绑、本次不用。改标准只影响之后的新任务。",
    ...blocks,
  ].join("\n");
}

export function shouldInjectUserStandards(
  bound: { id: string; pipeline: string } | null | undefined,
): boolean {
  if (!bound) {
    return false;
  }
  if (bound.pipeline === "tracked_redline" || bound.id === "mail.contract") {
    return false;
  }
  return (
    bound.id === "contract.review" ||
    bound.id === "contract.draft" ||
    bound.id === "litigation.talk"
  );
}

export async function proposeLearnedStandard(
  workspaceDir: string,
  input: { title: string; items: UserStandardItem[]; bindWhen?: UserStandardBindWhen },
): Promise<UserStandard> {
  return saveUserStandard(workspaceDir, {
    title: input.title,
    kind: "contract_review",
    items: input.items,
    bindWhen: input.bindWhen ?? {},
    source: "learned",
    enabled: false,
  });
}
