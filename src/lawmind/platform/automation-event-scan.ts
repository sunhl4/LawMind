/**
 * 读本机三源，看这条常设工作的条件是否已经出现。
 * 不发网络请求：webhook 只读律师（或本机程序）投到工作区里的一个 json。
 */

import fs from "node:fs";
import path from "node:path";
import { matterDir } from "../adapters/matter-storage/paths.js";
import {
  eventIntervalOpen,
  textMatchesTrigger,
  type AutomationEventTrigger,
} from "./automation-event-trigger.js";
import { listMatterMailMessages, type LawyerAutomation } from "./lawyer-automations.js";

export function eventInboxPath(workspaceDir: string, automationId: string): string {
  return path.join(workspaceDir, "lawmind", "event-inbox", `${automationId}.json`);
}

function fileNamesMatching(dir: string, match: string, sinceMs: number): boolean {
  if (!fs.existsSync(dir)) {
    return false;
  }
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return false;
  }
  for (const name of names.slice(0, 200)) {
    if (!textMatchesTrigger(match, name)) {
      continue;
    }
    try {
      const stat = fs.statSync(path.join(dir, name));
      if (stat.mtimeMs > sinceMs) {
        return true;
      }
    } catch {
      /* 单个文件读失败不影响其余 */
    }
  }
  return false;
}

export function eventTriggerIsDue(
  workspaceDir: string,
  automation: LawyerAutomation,
  now: Date,
): boolean {
  const trigger: AutomationEventTrigger | undefined = automation.eventTrigger;
  if (!automation.enabled || !trigger) {
    return false;
  }
  if (!eventIntervalOpen(automation.lastEventFiredAt, trigger.minIntervalMinutes, now)) {
    return false;
  }
  const sinceMs = automation.lastEventFiredAt ? Date.parse(automation.lastEventFiredAt) : 0;
  if (trigger.source === "matter_files") {
    return fileNamesMatching(
      path.join(matterDir(workspaceDir, automation.matterId), "documents"),
      trigger.match,
      Number.isFinite(sinceMs) ? sinceMs : 0,
    );
  }
  if (trigger.source === "mail") {
    return listMatterMailMessages(workspaceDir, automation.matterId).some((message) => {
      const at = Date.parse(message.receivedAt);
      if (Number.isFinite(sinceMs) && sinceMs > 0 && Number.isFinite(at) && at <= sinceMs) {
        return false;
      }
      return textMatchesTrigger(trigger.match, `${message.from}\n${message.subject}`);
    });
  }
  const inbox = eventInboxPath(workspaceDir, automation.id);
  if (!fs.existsSync(inbox)) {
    return false;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(inbox, "utf8")) as { text?: string };
    return textMatchesTrigger(trigger.match, parsed.text ?? "");
  } catch {
    return false;
  }
}

export function consumeWebhookEvent(workspaceDir: string, automationId: string): void {
  const inbox = eventInboxPath(workspaceDir, automationId);
  try {
    fs.rmSync(inbox, { force: true });
  } catch {
    /* 吃掉失败不该让已经领走的这一跑回滚 */
  }
}
