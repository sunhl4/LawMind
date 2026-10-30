/**
 * 收案自动化端到端：真实投递口扫描、真实 HTTP 路由、真实审阅办件。
 * 不走 Playwright 的 mock 待归案。
 */

import fs from "node:fs";
import type http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadMatter } from "../../../src/lawmind/adapters/matter-storage/index.js";
import { createMatterIfMissing } from "../../../src/lawmind/application/services/matter-write-service.js";
import { listQueueItemsForMatter } from "../../../src/lawmind/application/services/queue-write-service.js";
import { listDeadlinesForMatter } from "../../../src/lawmind/application/services/deadline-service.js";
import { runIntakeTick } from "../../../src/lawmind/intake/tick.js";
import {
  createAutomation,
  getAutomation,
  saveAutomation,
} from "../../../src/lawmind/platform/lawyer-automations.js";
import { processDueLawyerAutomations } from "../../../src/lawmind/platform/lawyer-automations-runner.js";
import { handleLawyerDeskRoutes } from "./lawmind-server-route-lawyer-desk.js";
import { handleMatterRoutes } from "./lawmind-server-route-matters.js";
import type { LawmindDispatchContext } from "./lawmind-server-route-types.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function response() {
  let status = 0;
  let body = "";
  const res = {
    writeHead(next: number) {
      status = next;
    },
    end(value?: string | Buffer) {
      body += value?.toString() ?? "";
    },
  } as unknown as http.ServerResponse;
  return {
    res,
    get status() {
      return status;
    },
    json: () => JSON.parse(body) as Record<string, unknown>,
  };
}

function request(method: string, value?: unknown): http.IncomingMessage {
  const req = { method, headers: {} } as http.IncomingMessage;
  Object.assign(req, {
    on(event: string, cb: (...args: unknown[]) => void) {
      if (event === "data" && value !== undefined) {
        cb(Buffer.from(JSON.stringify(value)));
      }
      if (event === "end") {
        cb();
      }
      return this;
    },
  });
  return req;
}

function context(workspaceDir: string): LawmindDispatchContext {
  return {
    workspaceDir,
    envFile: undefined,
    userEnvPath: path.join(workspaceDir, ".env.lawmind"),
    policy: { loaded: false },
  };
}

function drop(workspaceDir: string, matterId: string, name: string, content: string): void {
  const file = path.join(workspaceDir, "收件投递", matterId, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  const old = new Date(Date.now() - 10_000);
  fs.utimesSync(file, old, old);
}

describe("intake automation end to end", () => {
  it("files a summons, opens review cards, accepts a deadline edit, and sends a dropped contract to review", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-auto-e2e-"));
    dirs.push(workspaceDir);
    const matterId = "matter-a";
    createMatterIfMissing(workspaceDir, { matterId, title: "甲案" });
    drop(
      workspaceDir,
      matterId,
      "（2026）沪01民初1001号.txt",
      "北京市朝阳区人民法院传票：请于2026年9月15日9时到第三法庭开庭。案由：买卖合同纠纷。被告：王五。",
    );
    drop(workspaceDir, matterId, "合同已寄出.txt", "合同已寄出。发票到期日为2026年3月1日。");

    const tick = await runIntakeTick(workspaceDir, workspaceDir, {
      now: new Date(Date.now() + 60_000),
    });
    expect(tick?.dropzone).toMatchObject({ recorded: 2, autoAttached: 2 });

    const matter = loadMatter(workspaceDir, matterId);
    expect(matter?.docket?.caseNo).toBe("（2026）沪01民初1001号");
    expect(matter?.docket?.court).toBe("北京市朝阳区人民法院");
    expect(matter?.causeOfAction).toBe("买卖合同纠纷");
    expect(matter?.counterparty).toBe("王五");
    expect(matter?.docket?.hearingAt).toMatch(/^2026-09-15/);

    const deadlines = listDeadlinesForMatter(workspaceDir, matterId);
    expect(deadlines.map((row) => row.title)).toEqual(["开庭"]);
    expect(deadlines.some((row) => row.title === "合同到期")).toBe(false);

    const openCards = listQueueItemsForMatter(workspaceDir, matterId, { status: "open" });
    const courtCard = openCards.find((row) => row.title === "核对法院");
    const causeCard = openCards.find((row) => row.title === "核对案由");
    const deadlineCard = openCards.find((row) => row.title === "核对已登记的期限");
    expect(courtCard?.detail).toContain("北京市朝阳区人民法院");
    expect(causeCard?.detail).toContain("买卖合同纠纷");
    expect(deadlineCard?.detail).toContain("开庭");

    const ctx = context(workspaceDir);
    const resolved = response();
    const resolvePath = `/api/matters/${matterId}/queue/${courtCard?.queueItemId}/resolve`;
    await handleMatterRoutes({
      ctx,
      pathname: resolvePath,
      req: request("POST", {}),
      res: resolved.res,
      url: new URL(`http://127.0.0.1${resolvePath}`),
      c: {},
    });
    expect(resolved.status).toBe(200);
    expect(
      listQueueItemsForMatter(workspaceDir, matterId, { status: "open" }).some(
        (row) => row.title === "核对法院",
      ),
    ).toBe(false);

    const hearing = deadlines[0];
    expect(hearing).toBeTruthy();
    const patched = response();
    const patchPath = `/api/matters/${matterId}/deadlines/${hearing?.deadlineId}`;
    const nextDue = "2026-09-16T01:00:00.000Z";
    await handleLawyerDeskRoutes({
      pathname: patchPath,
      req: request("PATCH", { dueAt: nextDue }),
      res: patched.res,
      url: new URL(`http://127.0.0.1${patchPath}`),
      c: {},
      ctx,
    });
    expect(patched.status).toBe(200);
    expect(loadMatter(workspaceDir, matterId)?.docket?.hearingAt).toBe(nextDue);
    const listed = response();
    const listPath = `/api/matters/${matterId}/deadlines`;
    await handleLawyerDeskRoutes({
      pathname: listPath,
      req: request("GET"),
      res: listed.res,
      url: new URL(`http://127.0.0.1${listPath}`),
      c: {},
      ctx,
    });
    expect(listed.status).toBe(200);
    const listedDeadlines = listed.json().deadlines as Array<{ dueAt: string; title: string }>;
    expect(listedDeadlines.find((row) => row.title === "开庭")?.dueAt).toBe(nextDue);

    drop(workspaceDir, matterId, "租赁合同.docx", "PK-fake-docx");
    drop(workspaceDir, matterId, "证据.pdf", "scan");
    const second = await runIntakeTick(workspaceDir, workspaceDir, {
      now: new Date(Date.now() + 120_000),
    });
    expect(second?.dropzone).toMatchObject({ recorded: 2, autoAttached: 2 });

    const created = createAutomation(workspaceDir, {
      presetId: "mail-contract-review",
      matterId,
      title: "邮件合同审阅改稿",
    });
    const scheduled = getAutomation(workspaceDir, created.id);
    if (!scheduled) {
      throw new Error("automation missing");
    }
    saveAutomation(workspaceDir, { ...scheduled, nextRunAt: new Date(0).toISOString() });
    let instruction = "";
    await processDueLawyerAutomations(workspaceDir, {
      enqueueTemplate: ({ templateId, instruction: text }) => {
        expect(templateId).toBe("mail-contract-redline");
        instruction = text ?? "";
        return "job-e2e";
      },
    });
    expect(instruction).toContain("租赁合同.docx");
    expect(instruction).not.toContain("证据.pdf");
  });
});
