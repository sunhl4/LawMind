/**
 * Lawyer-authored daily plan. One JSON file per local calendar day.
 * Completion can be manual or auto-linked from mail / deadline / approval ids.
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { writeFileAtomicAsync } from "../adapters/matter-storage/io.js";

export const DAILY_PLAN_REL = path.join("lawmind", "daily-plans");

export type DailyPlanItemSource = "lawyer" | "mail" | "deadline" | "approval";

export type DailyPlanItem = {
  id: string;
  text: string;
  done: boolean;
  source: DailyPlanItemSource;
  sourceRef?: string;
  matterId?: string;
  createdAt: string;
};

export type DailyPlan = {
  date: string;
  items: DailyPlanItem[];
  updatedAt: string;
};

export function localDateKey(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function dailyPlanPath(workspaceDir: string, date = localDateKey()): string {
  return path.join(path.resolve(workspaceDir), DAILY_PLAN_REL, `${date}.json`);
}

function emptyPlan(date: string): DailyPlan {
  return { date, items: [], updatedAt: new Date().toISOString() };
}

function asItem(raw: unknown): DailyPlanItem | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const o = raw as Record<string, unknown>;
  const text = typeof o.text === "string" ? o.text.trim() : "";
  if (!text) {
    return null;
  }
  const source =
    o.source === "mail" ||
    o.source === "deadline" ||
    o.source === "approval" ||
    o.source === "lawyer"
      ? o.source
      : "lawyer";
  return {
    id: typeof o.id === "string" && o.id.trim() ? o.id.trim() : randomUUID(),
    text: text.slice(0, 500),
    done: o.done === true,
    source,
    ...(typeof o.sourceRef === "string" && o.sourceRef.trim()
      ? { sourceRef: o.sourceRef.trim() }
      : {}),
    ...(typeof o.matterId === "string" && o.matterId.trim() ? { matterId: o.matterId.trim() } : {}),
    createdAt: typeof o.createdAt === "string" ? o.createdAt : new Date().toISOString(),
  };
}

export function loadDailyPlan(workspaceDir: string, date = localDateKey()): DailyPlan {
  const file = dailyPlanPath(workspaceDir, date);
  try {
    if (!fs.existsSync(file)) {
      return emptyPlan(date);
    }
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
    const items = Array.isArray(parsed.items)
      ? parsed.items.map(asItem).filter((item): item is DailyPlanItem => item !== null)
      : [];
    return {
      date,
      items,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
    };
  } catch {
    return emptyPlan(date);
  }
}

export async function saveDailyPlan(workspaceDir: string, plan: DailyPlan): Promise<DailyPlan> {
  const next: DailyPlan = {
    date: plan.date,
    items: plan.items.slice(0, 80),
    updatedAt: new Date().toISOString(),
  };
  const file = dailyPlanPath(workspaceDir, plan.date);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await writeFileAtomicAsync(file, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

export async function appendDailyPlanItems(
  workspaceDir: string,
  texts: string[],
  opts?: { date?: string; source?: DailyPlanItemSource; matterId?: string },
): Promise<DailyPlan> {
  const date = opts?.date ?? localDateKey();
  const plan = loadDailyPlan(workspaceDir, date);
  const now = new Date().toISOString();
  for (const text of texts) {
    const trimmed = text.trim();
    if (!trimmed) {
      continue;
    }
    plan.items.push({
      id: randomUUID(),
      text: trimmed.slice(0, 500),
      done: false,
      source: opts?.source ?? "lawyer",
      ...(opts?.matterId ? { matterId: opts.matterId } : {}),
      createdAt: now,
    });
  }
  return saveDailyPlan(workspaceDir, plan);
}

export const CARRY_LOOKBACK_DAYS = 14;
export const CARRY_SNAPSHOT_CAP = 8;

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isLocalDateKey(value: string): boolean {
  return DATE_KEY_RE.test(value);
}

/** Shift a `YYYY-MM-DD` local calendar key by whole days (not UTC). */
export function shiftLocalDateKey(date: string, days: number): string {
  const parts = date.split("-").map((part) => Number(part));
  const y = parts[0];
  const m = parts[1];
  const d = parts[2];
  if (!y || !m || !d) {
    return date;
  }
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return localDateKey(dt);
}

export type CarriedDailyPlanItem = DailyPlanItem & { originDate: string };

/**
 * Open lawyer-authored plan rows from prior days. Mail / deadline / approval
 * sourced rows are excluded: those already rehydrate from live mail, docket,
 * and approval stores and must not be copied into a second to-do list.
 */
export function listOpenLawyerPlanItemsBefore(
  workspaceDir: string,
  beforeDate: string,
  opts?: { lookbackDays?: number; maxItems?: number },
): { items: CarriedDailyPlanItem[]; omitted: number } {
  const lookback = opts?.lookbackDays ?? CARRY_LOOKBACK_DAYS;
  const maxItems = opts?.maxItems ?? CARRY_SNAPSHOT_CAP;
  const out: CarriedDailyPlanItem[] = [];
  let seen = 0;
  for (let i = 1; i <= lookback; i += 1) {
    const originDate = shiftLocalDateKey(beforeDate, -i);
    const plan = loadDailyPlan(workspaceDir, originDate);
    for (const item of plan.items) {
      if (item.done || item.source !== "lawyer") {
        continue;
      }
      seen += 1;
      if (out.length < maxItems) {
        out.push({ ...item, originDate });
      }
    }
  }
  return { items: out, omitted: Math.max(0, seen - out.length) };
}

function planContainsItem(workspaceDir: string, date: string, itemId: string): boolean {
  return loadDailyPlan(workspaceDir, date).items.some((item) => item.id === itemId);
}

/** Locate a plan row by id: preferred date first, then today + lookback. */
export function findDailyPlanItemDate(
  workspaceDir: string,
  itemId: string,
  preferredDate?: string,
): string | undefined {
  if (
    preferredDate &&
    isLocalDateKey(preferredDate) &&
    planContainsItem(workspaceDir, preferredDate, itemId)
  ) {
    return preferredDate;
  }
  const today = localDateKey();
  for (let i = 0; i <= CARRY_LOOKBACK_DAYS; i += 1) {
    const date = shiftLocalDateKey(today, -i);
    if (planContainsItem(workspaceDir, date, itemId)) {
      return date;
    }
  }
  return undefined;
}

export async function setDailyPlanItemDone(
  workspaceDir: string,
  itemId: string,
  done: boolean,
  date?: string,
): Promise<DailyPlan | undefined> {
  const origin = findDailyPlanItemDate(workspaceDir, itemId, date);
  if (!origin) {
    return undefined;
  }
  const plan = loadDailyPlan(workspaceDir, origin);
  const idx = plan.items.findIndex((item) => item.id === itemId);
  if (idx < 0) {
    return undefined;
  }
  plan.items[idx] = { ...plan.items[idx], done };
  return saveDailyPlan(workspaceDir, plan);
}

/**
 * 按来源引用标记完成态。`done: true` 时若尚无 plan 行则补哨兵；
 * `done: false` 时把已有哨兵改回未完成（用于今日提醒反勾）。
 */
export async function setDailyPlanSourceDone(
  workspaceDir: string,
  source: DailyPlanItemSource,
  sourceRef: string,
  done: boolean,
  date = localDateKey(),
): Promise<DailyPlan> {
  const plan = loadDailyPlan(workspaceDir, date);
  let changed = false;
  let found = false;
  plan.items = plan.items.map((item) => {
    if (item.source === source && item.sourceRef === sourceRef) {
      found = true;
      if (item.done !== done) {
        changed = true;
        return { ...item, done };
      }
    }
    return item;
  });
  // 今日提醒勾选邮件/期限时，未必事先有 plan 行——补一条已完成哨兵，供 today-work 消项。
  if (!found && done && source !== "lawyer") {
    plan.items.push({
      id: randomUUID(),
      text: `${source}:${sourceRef}`.slice(0, 500),
      done: true,
      source,
      sourceRef,
      createdAt: new Date().toISOString(),
    });
    changed = true;
  }
  if (!changed) {
    return plan;
  }
  return saveDailyPlan(workspaceDir, plan);
}

/** @deprecated Prefer setDailyPlanSourceDone(..., true). Kept for call sites that only mark done. */
export async function markDailyPlanSourceDone(
  workspaceDir: string,
  source: DailyPlanItemSource,
  sourceRef: string,
  date = localDateKey(),
): Promise<DailyPlan> {
  return setDailyPlanSourceDone(workspaceDir, source, sourceRef, true, date);
}
