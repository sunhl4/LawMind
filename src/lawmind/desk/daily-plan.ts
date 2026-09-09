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

export async function setDailyPlanItemDone(
  workspaceDir: string,
  itemId: string,
  done: boolean,
  date = localDateKey(),
): Promise<DailyPlan | undefined> {
  const plan = loadDailyPlan(workspaceDir, date);
  const idx = plan.items.findIndex((item) => item.id === itemId);
  if (idx < 0) {
    return undefined;
  }
  plan.items[idx] = { ...plan.items[idx], done };
  return saveDailyPlan(workspaceDir, plan);
}

export async function markDailyPlanSourceDone(
  workspaceDir: string,
  source: DailyPlanItemSource,
  sourceRef: string,
  date = localDateKey(),
): Promise<DailyPlan> {
  const plan = loadDailyPlan(workspaceDir, date);
  let changed = false;
  plan.items = plan.items.map((item) => {
    if (item.source === source && item.sourceRef === sourceRef && !item.done) {
      changed = true;
      return { ...item, done: true };
    }
    return item;
  });
  if (!changed) {
    return plan;
  }
  return saveDailyPlan(workspaceDir, plan);
}
