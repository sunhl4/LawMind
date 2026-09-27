/**
 * 本机事件触发。只认三处：本案文件名、新来信的发件人或标题、本机投递的一条 webhook 文本。
 *
 * 「全部 / 每条 / *」直接拒绝：那会变成无界消耗，不是在卡模型写什么。
 * 匹配是子串，不用正则，避免一条坏规则把常设工作打崩。
 */

export type AutomationEventSource = "matter_files" | "mail" | "webhook";

export type AutomationEventTrigger = {
  source: AutomationEventSource;
  match: string;
  minIntervalMinutes: number;
};

const MIN_INTERVAL = 15;
const MAX_INTERVAL = 24 * 60;
const UNBOUNDED = new Set(["*", "全部", "所有", "每条", "任何", "any", "all"]);

export function validateEventTrigger(input: {
  source?: string;
  match?: string;
  minIntervalMinutes?: number;
}): { ok: true; trigger: AutomationEventTrigger } | { ok: false; message: string } {
  const source = input.source;
  if (source !== "matter_files" && source !== "mail" && source !== "webhook") {
    return { ok: false, message: "事件只支持本案文件、新来信或本机 webhook" };
  }
  const match = input.match?.trim() ?? "";
  if (match.length < 2 || match.length > 80 || UNBOUNDED.has(match.toLowerCase())) {
    return { ok: false, message: "请写一个具体条件（至少 2 个字），不要用「全部」或「每条」" };
  }
  const minutes = input.minIntervalMinutes ?? 60;
  if (!Number.isFinite(minutes)) {
    return { ok: false, message: "触发间隔需要是分钟数" };
  }
  return {
    ok: true,
    trigger: {
      source,
      match,
      minIntervalMinutes: Math.min(MAX_INTERVAL, Math.max(MIN_INTERVAL, Math.round(minutes))),
    },
  };
}

export function textMatchesTrigger(match: string, text: string): boolean {
  const needle = match.trim().toLowerCase();
  if (needle.length < 2) {
    return false;
  }
  return text.toLowerCase().includes(needle);
}

export function eventIntervalOpen(
  lastFiredAt: string | undefined,
  minIntervalMinutes: number,
  now: Date,
): boolean {
  if (!lastFiredAt) {
    return true;
  }
  const last = Date.parse(lastFiredAt);
  if (!Number.isFinite(last)) {
    return true;
  }
  return now.getTime() - last >= minIntervalMinutes * 60_000;
}
