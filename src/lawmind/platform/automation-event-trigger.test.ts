import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { eventInboxPath, eventTriggerIsDue } from "./automation-event-scan.js";
import { validateEventTrigger } from "./automation-event-trigger.js";
import { processDueLawyerAutomations } from "./lawyer-automations-runner.js";
import {
  claimEventAutomation,
  createAutomation,
  getAutomation,
  saveAutomation,
} from "./lawyer-automations.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  dirs.length = 0;
});

function tmpWs(): string {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-event-"));
  dirs.push(ws);
  return ws;
}

describe("local event triggers", () => {
  it("rejects an unbounded match", () => {
    expect(validateEventTrigger({ source: "mail", match: "每条" }).ok).toBe(false);
    expect(validateEventTrigger({ source: "mail", match: "*" }).ok).toBe(false);
    const ok = validateEventTrigger({ source: "mail", match: "续签", minIntervalMinutes: 1 });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.trigger.minIntervalMinutes).toBe(15);
    }
  });

  it("fires a future schedule when a matching file appears", async () => {
    const ws = tmpWs();
    const created = createAutomation(ws, {
      presetId: "custom",
      matterId: "m1",
      title: "看到续签材料就办",
      schedule: { kind: "weekly", weekday: 1, hour: 4, minute: 5 },
      eventTrigger: { source: "matter_files", match: "续签", minIntervalMinutes: 60 },
    });
    const docs = path.join(ws, "matters", "m1", "documents");
    fs.mkdirSync(docs, { recursive: true });
    fs.writeFileSync(path.join(docs, "甲公司续签合同.docx"), "x");
    expect(eventTriggerIsDue(ws, created, new Date())).toBe(true);
    const jobs: string[] = [];
    const n = await processDueLawyerAutomations(ws, {
      enqueueTemplate: () => {
        jobs.push("ran");
        return null;
      },
    });
    expect(n).toBe(1);
    expect(jobs).toEqual([]);
    expect(getAutomation(ws, created.id)?.enabled).toBe(true);
    const again = await processDueLawyerAutomations(ws, {});
    expect(again).toBe(0);
  });

  it("second claim inside the min interval loses even if it passed the scan before the first write", () => {
    const ws = tmpWs();
    const created = createAutomation(ws, {
      presetId: "custom",
      matterId: "m1",
      title: "看到续签材料就办",
      schedule: { kind: "weekly", weekday: 1, hour: 4, minute: 5 },
      eventTrigger: { source: "matter_files", match: "续签", minIntervalMinutes: 60 },
    });
    saveAutomation(ws, created);
    const now = new Date();
    // 桌面与 lawmindd 同时扫到同一事件（扫描侧都判定可跑）；先领的写 lastEventFiredAt，
    // 后领的在锁内复验时必须放弃，否则同一事件双跑。
    expect(claimEventAutomation(ws, created.id, now)?.id).toBe(created.id);
    expect(claimEventAutomation(ws, created.id, now)).toBeNull();
  });

  it("fires from a local webhook note and then consumes it", async () => {
    const ws = tmpWs();
    const created = createAutomation(ws, {
      presetId: "custom",
      matterId: "m1",
      title: "收到通知就办",
      schedule: { kind: "weekly", weekday: 1, hour: 4, minute: 5 },
      eventTrigger: { source: "webhook", match: "开庭", minIntervalMinutes: 60 },
    });
    saveAutomation(ws, created);
    const inbox = eventInboxPath(ws, created.id);
    fs.mkdirSync(path.dirname(inbox), { recursive: true });
    fs.writeFileSync(inbox, JSON.stringify({ text: "明天开庭" }));
    await processDueLawyerAutomations(ws, {});
    expect(fs.existsSync(inbox)).toBe(false);
  });
});
