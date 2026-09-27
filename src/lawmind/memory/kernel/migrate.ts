import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { readMatterParties } from "../../host-access/matter-fence.js";
import { readStanceItems } from "../../stance/store.js";
import type { StanceItem } from "../../stance/types.js";
import { isStockLawyerProfileBullet } from "../lawyer-profile-for-prompt.js";
import type { MemoryRecord } from "./contract.js";
import { reactivateMemory } from "./gateway.js";
import type { MemoryInsert } from "./store.js";
import {
  insertMemoryRecordIfAbsent,
  listMemoryRecords,
  patchMemoryRecord,
  readMemoryMeta,
  replaceMemoryRecord,
  writeMemoryMeta,
} from "./store.js";

function hashId(prefix: string, text: string): string {
  const hex = createHash("sha256").update(text).digest("hex").slice(0, 16);
  return `${prefix}_${hex}`;
}

function reviveTerminalBullet(
  workspaceDir: string,
  rows: readonly MemoryRecord[],
  match: (row: MemoryRecord) => boolean,
): boolean {
  const matches = rows.filter(match);
  if (matches.length === 0) {
    return false;
  }
  if (matches.some((row) => row.validity === "current" && row.confirmation === "confirmed")) {
    return true;
  }
  const terminal = matches
    .filter((row) => row.validity === "revoked" || row.validity === "superseded")
    .toSorted((a, b) => b.body.length - a.body.length)[0];
  if (!terminal) {
    return false;
  }
  reactivateMemory(workspaceDir, terminal.id);
  return true;
}

function sectionBullets(markdown: string, headingRe: RegExp): string[] {
  const match = headingRe.exec(markdown);
  if (!match) {
    return [];
  }
  const rest = markdown.slice(match.index + match[0].length);
  const next = rest.search(/\n##\s+/);
  const body = next >= 0 ? rest.slice(0, next) : rest;
  return body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- ") && !line.includes("已省略") && !line.includes("已轮转"))
    .map((line) => line.replace(/^- /, "").trim())
    .filter((line) => line.length > 0 && !isStockLawyerProfileBullet(line));
}

function importStance(workspaceDir: string, item: StanceItem): void {
  const id = `stance_${item.id}`;
  const evidenceMatterIds = [
    ...new Set((item.evidence ?? []).map((e) => e.matterId).filter((x): x is string => Boolean(x))),
  ];
  const parties = evidenceMatterIds[0] ? readMatterParties(workspaceDir, evidenceMatterIds[0]) : {};
  const firmDefault = item.id.startsWith("firm_default_");
  const input: MemoryInsert & { id: string } = {
    id,
    kind: "stance",
    scope: "lawyer",
    scopeId: "",
    key: `stance.${item.clauseType}`,
    body: [item.preferredLanguage, item.position].filter(Boolean).join(" ").trim() || item.position,
    confirmation: firmDefault || item.supersededBy ? "pending" : "confirmed",
    validity: item.supersededBy ? "superseded" : "current",
    origin: firmDefault ? "firm_default" : "stance",
    confidence: item.modelConfidence ?? item.confidence,
    evidenceMatterIds,
    ...(item.supersededBy ? { supersededBy: `stance_${item.supersededBy}` } : {}),
    ...(evidenceMatterIds[0] ? { sourceMatterId: evidenceMatterIds[0] } : {}),
    ...(parties.clientId ? { clientId: parties.clientId } : {}),
    ...(parties.counterparty ? { counterparty: parties.counterparty } : {}),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
  if (!input.body) {
    return;
  }
  replaceMemoryRecord(workspaceDir, input);
}

function importProfile(workspaceDir: string): void {
  let raw = "";
  try {
    raw = fs.readFileSync(path.join(workspaceDir, "LAWYER_PROFILE.md"), "utf8");
  } catch {
    return;
  }
  const bullets = sectionBullets(raw, /##\s*八[、.．]?\s*个人积累/m);
  for (const bullet of bullets) {
    const known = listMemoryRecords(workspaceDir);
    if (
      reviveTerminalBullet(
        workspaceDir,
        known,
        (row) => row.body.length > 0 && bullet.includes(row.body),
      )
    ) {
      continue;
    }
    insertMemoryRecordIfAbsent(workspaceDir, {
      id: hashId("habit", bullet),
      kind: "habit",
      scope: "lawyer",
      key: "habit.note",
      body: bullet,
      confirmation: "confirmed",
      origin: "migration",
    });
  }
  // 档案里已经删掉或改写的旧句，不再保持「当前」。已撤回的行不动。
  for (const row of listMemoryRecords(workspaceDir)) {
    if (row.origin !== "migration" || row.key !== "habit.note") {
      continue;
    }
    if (row.confirmation !== "confirmed" || row.validity !== "current") {
      continue;
    }
    const holders = bullets.filter((bullet) => bullet.includes(row.body));
    if (holders.length === 0) {
      patchMemoryRecord(workspaceDir, row.id, { validity: "superseded" });
      continue;
    }
    const longer = holders.length === 1 ? holders[0] : undefined;
    if (longer && longer !== row.body) {
      patchMemoryRecord(workspaceDir, row.id, { body: longer });
    }
  }
}

function importPendingAdoptions(workspaceDir: string): void {
  const file = path.join(workspaceDir, "memory-adoption", "suggestions.jsonl");
  let raw = "";
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return;
  }
  for (const line of raw.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    let row: {
      id?: string;
      state?: string;
      scope?: string;
      kind?: string;
      payload?: string;
      targetId?: string;
    };
    try {
      row = JSON.parse(line) as typeof row;
    } catch {
      continue;
    }
    if (row.state !== "pending" || !row.id || !row.payload?.trim()) {
      continue;
    }
    const matter = row.scope === "matter";
    insertMemoryRecordIfAbsent(workspaceDir, {
      id: `adopt_${row.id}`,
      kind: matter ? "matter_fact" : row.scope === "client" ? "client_note" : "habit",
      scope: matter
        ? "matter"
        : row.scope === "client"
          ? "client"
          : row.scope === "firm"
            ? "firm"
            : "lawyer",
      scopeId: row.targetId ?? "",
      key: matter ? "matter.note" : "habit.note",
      body: row.payload.trim(),
      confirmation: "pending",
      origin: "migration",
      ...(matter && row.targetId ? { sourceMatterId: row.targetId } : {}),
    });
  }
}

function importOneCase(workspaceDir: string, matterId: string, raw: string): void {
  const parties = readMatterParties(workspaceDir, matterId);
  if (parties.clientId || parties.counterparty) {
    const body = [
      parties.clientId ? `客户 ${parties.clientId}` : "",
      parties.counterparty ? `对方 ${parties.counterparty}` : "",
    ]
      .filter(Boolean)
      .join("；");
    insertMemoryRecordIfAbsent(workspaceDir, {
      id: `parties_${matterId}`,
      kind: "matter_fact",
      scope: "matter",
      scopeId: matterId,
      key: "matter.parties",
      body,
      confirmation: "confirmed",
      origin: "migration",
      sourceMatterId: matterId,
      ...(parties.clientId ? { clientId: parties.clientId } : {}),
      ...(parties.counterparty ? { counterparty: parties.counterparty } : {}),
    });
  }
  const sections: Array<{ re: RegExp; key: string }> = [
    { re: /##\s*[^\n]*(核心争点|争点)/m, key: "matter.core_issue" },
    { re: /##\s*[^\n]*风险/m, key: "matter.risk" },
    { re: /##\s*[^\n]*进展/m, key: "matter.progress" },
    { re: /##\s*[^\n]*(目标|任务)/m, key: "matter.goal" },
  ];
  const bullets: string[] = [];
  for (const section of sections) {
    for (const bullet of sectionBullets(raw, section.re)) {
      bullets.push(bullet);
      const known = listMemoryRecords(workspaceDir);
      if (
        reviveTerminalBullet(
          workspaceDir,
          known,
          (row) => row.scope === "matter" && row.scopeId === matterId && row.body === bullet,
        )
      ) {
        continue;
      }
      insertMemoryRecordIfAbsent(workspaceDir, {
        id: hashId(`case_${matterId}_${section.key}`, bullet),
        kind: "matter_fact",
        scope: "matter",
        scopeId: matterId,
        key: section.key,
        body: bullet,
        confirmation: "confirmed",
        origin: "migration",
        sourceMatterId: matterId,
        ...(parties.clientId ? { clientId: parties.clientId } : {}),
        ...(parties.counterparty ? { counterparty: parties.counterparty } : {}),
      });
    }
  }
  for (const row of listMemoryRecords(workspaceDir)) {
    if (row.origin !== "migration" || row.scope !== "matter" || row.scopeId !== matterId) {
      continue;
    }
    if (
      row.key === "matter.parties" ||
      row.confirmation !== "confirmed" ||
      row.validity !== "current"
    ) {
      continue;
    }
    if (!bullets.some((bullet) => bullet.includes(row.body))) {
      patchMemoryRecord(workspaceDir, row.id, { validity: "superseded" });
    }
  }
}

function fileStamp(filePath: string): string {
  try {
    const st = fs.statSync(filePath);
    return `${st.mtimeMs}:${st.size}`;
  } catch {
    return "missing";
  }
}

function importIfChanged(
  workspaceDir: string,
  metaKey: string,
  filePath: string,
  load: () => void,
): void {
  const stamp = fileStamp(filePath);
  if (readMemoryMeta(workspaceDir, metaKey) === stamp) {
    return;
  }
  load();
  writeMemoryMeta(workspaceDir, metaKey, stamp);
}

/** 来源文件变了才再导。已存在的 id 不覆盖，撤回不会被导入复活。 */
export function ensureMemoryImported(workspaceDir: string): void {
  const root = path.resolve(workspaceDir);
  importIfChanged(root, "import:stance", path.join(root, "lawmind", "stance", "items.json"), () => {
    try {
      for (const item of readStanceItems(root)) {
        importStance(root, item);
      }
    } catch {
      /* stance file optional */
    }
  });
  importIfChanged(root, "import:profile", path.join(root, "LAWYER_PROFILE.md"), () => {
    importProfile(root);
  });
  importIfChanged(
    root,
    "import:adoptions",
    path.join(root, "memory-adoption", "suggestions.jsonl"),
    () => {
      importPendingAdoptions(root);
    },
  );
  let ids: string[] = [];
  try {
    ids = fs
      .readdirSync(path.join(root, "cases"), { withFileTypes: true })
      .filter((ent) => ent.isDirectory())
      .map((ent) => ent.name);
  } catch {
    ids = [];
  }
  for (const matterId of ids) {
    const filePath = path.join(root, "cases", matterId, "CASE.md");
    importIfChanged(root, `import:case:${matterId}`, filePath, () => {
      let raw = "";
      try {
        raw = fs.readFileSync(filePath, "utf8");
      } catch {
        return;
      }
      importOneCase(root, matterId, raw);
    });
  }
}

export function resetMemoryImportCache(): void {
  /* 导入以文件戳为准，测试里改文件就会重导。 */
}
