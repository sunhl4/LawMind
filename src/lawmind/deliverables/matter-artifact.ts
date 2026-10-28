/**
 * 案件成果物：时间线 / 大事记 / 思维导图 —— 磁盘读写。
 *
 * 真相源是案件根目录的结构化 JSON（`cases/<matterId>/project.case-*.json`）。
 * 纯模型在 `matter-artifact-model.ts`（无 node 依赖，渲染层可直接用）；
 * 本文件只做路径解析与读盘，避免把 fs 带进 renderer bundle。
 */

import fs from "node:fs";
import path from "node:path";
import { assertSafeMatterId } from "../adapters/matter-storage/paths.js";
import {
  matterArtifactFileName,
  normalizeMatterArtifact,
  summarizeMatterArtifact,
  type MatterArtifact,
  type MatterArtifactIssue,
  type MatterArtifactKind,
  type MatterArtifactReadResult,
  type MatterArtifactSummary,
  type MatterChronologyEntry,
  type MatterTimelineEvent,
} from "./matter-artifact-model.js";

export * from "./matter-artifact-model.js";

/** 案件可见根目录（与 `cases/<id>/CASE.md` 同一层；不是 `matters/<id>/` JSON 库）。 */
export function matterCaseDir(workspaceDir: string, matterId: string): string {
  return path.join(path.resolve(workspaceDir), "cases", assertSafeMatterId(matterId));
}

export function matterArtifactPath(
  workspaceDir: string,
  matterId: string,
  kind: MatterArtifactKind,
): string {
  return path.join(matterCaseDir(workspaceDir, matterId), matterArtifactFileName(kind));
}

/**
 * 读一件成果物。`ok` 表示 JSON 可解析（可能带 issues，UI 照常渲染可用部分）；
 * `invalid` 只在文件损坏/不是对象时出现。
 */
export function readMatterArtifact(
  workspaceDir: string,
  matterId: string,
  kind: MatterArtifactKind,
): MatterArtifactReadResult {
  const file = matterArtifactPath(workspaceDir, matterId, kind);
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return { status: "missing" };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return {
      status: "invalid",
      issues: [{ path: "/", reasonZh: "JSON 解析失败（文件损坏或未保存完整）" }],
    };
  }
  const { artifact, issues } = normalizeMatterArtifact(kind, raw);
  if (issues.some((issue) => issue.path === "/")) {
    return { status: "invalid", issues };
  }
  return { status: "ok", artifact, issues };
}

/** 读三件套（缺文件返回 missing，不抛）。 */
export function readMatterArtifacts(
  workspaceDir: string,
  matterId: string,
): Record<MatterArtifactKind, MatterArtifactReadResult> {
  return {
    "case-timeline": readMatterArtifact(workspaceDir, matterId, "case-timeline"),
    "case-chronology": readMatterArtifact(workspaceDir, matterId, "case-chronology"),
    "case-mindmap": readMatterArtifact(workspaceDir, matterId, "case-mindmap"),
  };
}

export type MatterArtifactWriteMode = "replace" | "upsert";

export type MatterArtifactWriteResult =
  | {
      ok: true;
      path: string;
      artifact: MatterArtifact;
      summary: MatterArtifactSummary;
      issues: MatterArtifactIssue[];
      /** upsert 时新增/更新的条目数。 */
      changed: number;
    }
  | { ok: false; errorZh: string; issues?: MatterArtifactIssue[] };

function itemKey(kind: MatterArtifactKind, raw: unknown, index: number): string {
  const rec = (raw ?? {}) as Record<string, unknown>;
  const id = typeof rec.id === "string" ? rec.id.trim() : "";
  if (id) {
    return id;
  }
  if (kind === "case-timeline") {
    const title = typeof rec.title === "string" ? rec.title.trim() : "";
    const date = typeof rec.date === "string" ? rec.date.trim() : "";
    const key = `${date}|${title}`;
    return key === "|" ? `#${index}` : key;
  }
  if (kind === "case-chronology") {
    const fact = typeof rec.fact === "string" ? rec.fact.trim() : "";
    const date = typeof rec.date === "string" ? rec.date.trim() : "";
    const key = `${date}|${fact}`;
    return key === "|" ? `#${index}` : key;
  }
  return `#${index}`;
}

function rawItems(kind: MatterArtifactKind, raw: unknown): unknown[] {
  const rec = (raw ?? {}) as Record<string, unknown>;
  if (kind === "case-timeline") {
    return Array.isArray(rec.events) ? rec.events : [];
  }
  if (kind === "case-chronology") {
    return Array.isArray(rec.entries) ? rec.entries : [];
  }
  return [];
}

function isNonEmptyArtifact(artifact: MatterArtifact): boolean {
  if (artifact.kind === "case-mindmap") {
    return artifact.root.children.length > 0 || artifact.root.label.trim() !== "思维导图";
  }
  return (artifact.kind === "case-timeline" ? artifact.events : artifact.entries).length > 0;
}

/**
 * 写一件成果物。纪律（对照 MeWork 再生 prompt）：
 *   - 空载荷拒绝：宁可保留旧文件，也不用空表覆盖已整理好的成果；
 *   - `upsert`（默认）按条目 id（缺省 `日期|标题`）合并，律师改过的锚不会被无锚版本冲掉；
 *   - 原子写（同目录临时文件 + rename），避免半截 JSON 被 UI 读到。
 */
export function writeMatterArtifact(input: {
  workspaceDir: string;
  matterId: string;
  kind: MatterArtifactKind;
  payload: unknown;
  mode?: MatterArtifactWriteMode;
  title?: string;
}): MatterArtifactWriteResult {
  const mode = input.mode ?? "upsert";
  const { artifact: incoming, issues } = normalizeMatterArtifact(input.kind, {
    ...(input.payload && typeof input.payload === "object" ? input.payload : {}),
    schemaVersion: 1,
    kind: input.kind,
    ...(input.title?.trim() ? { title: input.title.trim() } : {}),
  });
  const fatal = issues.filter((issue) => issue.path === "/");
  if (fatal.length > 0) {
    return { ok: false, errorZh: fatal[0].reasonZh, issues };
  }
  if (!isNonEmptyArtifact(incoming)) {
    return {
      ok: false,
      errorZh: "内容为空，未写入（避免用空表覆盖已整理的成果；资料不足请先向律师确认）。",
      issues,
    };
  }

  const existing = readMatterArtifact(input.workspaceDir, input.matterId, input.kind);
  const base = mode === "upsert" && existing.status === "ok" ? existing.artifact : undefined;

  let merged: MatterArtifact = incoming;
  let changed = rawItems(input.kind, input.payload).length;

  if (base && base.kind === incoming.kind) {
    if (incoming.kind === "case-timeline" && base.kind === "case-timeline") {
      const map = new Map<string, MatterTimelineEvent>(
        base.events.map((item) => [itemKey(base.kind, item, 0), item] as const),
      );
      const before = map.size;
      for (const event of incoming.events) {
        map.set(itemKey(incoming.kind, event, 0), event);
      }
      const events = [...map.values()].toSorted(
        (a, b) => a.sortKey.localeCompare(b.sortKey) || a.id.localeCompare(b.id),
      );
      merged = {
        schemaVersion: 1,
        kind: "case-timeline",
        ...((incoming.title ?? base.title) ? { title: incoming.title ?? base.title } : {}),
        events,
      };
      changed = events.length - before;
    } else if (incoming.kind === "case-chronology" && base.kind === "case-chronology") {
      const map = new Map<string, MatterChronologyEntry>(
        base.entries.map((item) => [itemKey(base.kind, item, 0), item] as const),
      );
      const before = map.size;
      for (const entry of incoming.entries) {
        map.set(itemKey(incoming.kind, entry, 0), entry);
      }
      const entries = [...map.values()].toSorted(
        (a, b) => a.sortKey.localeCompare(b.sortKey) || a.id.localeCompare(b.id),
      );
      merged = {
        schemaVersion: 1,
        kind: "case-chronology",
        ...((incoming.title ?? base.title) ? { title: incoming.title ?? base.title } : {}),
        entries,
      };
      changed = entries.length - before;
    } else if (incoming.kind === "case-mindmap" && base.kind === "case-mindmap") {
      merged = {
        ...incoming,
        ...((incoming.title ?? base.title) ? { title: incoming.title ?? base.title } : {}),
      };
    }
  }

  const file = matterArtifactPath(input.workspaceDir, input.matterId, input.kind);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmp, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
    fs.renameSync(tmp, file);
  } catch (e) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* ignore */
    }
    return { ok: false, errorZh: `写入失败：${e instanceof Error ? e.message : String(e)}` };
  }

  return {
    ok: true,
    path: file,
    artifact: merged,
    summary: summarizeMatterArtifact(merged),
    issues,
    changed,
  };
}
