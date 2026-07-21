import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  cancelReviewCampaign,
  createReviewCampaign,
  findCampaignByIdempotencyKey,
  readReviewCampaign,
  renderCampaignReportMarkdown,
  rerunReviewCampaignRole,
} from "./storage.js";

describe("review-campaign storage", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it("creates, persists, idempotent, reruns role, cancels", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-campaign-"));
    dirs.push(ws);
    fs.mkdirSync(path.join(ws, "matters", "m1"), { recursive: true });

    const a = createReviewCampaign(ws, {
      matterId: "m1",
      taskId: "t1",
      sourceText: "合同审查。无责任上限。个人信息处理。",
      idempotencyKey: "campaign:test:1",
      runNow: true,
    });
    expect(a.id.startsWith("campaign_")).toBe(true);
    expect(a.status).toBe("completed");
    expect(a.safetyScore?.score).toBeTypeOf("number");
    expect(a.roles.length).toBeGreaterThanOrEqual(4);

    const b = createReviewCampaign(ws, {
      matterId: "m1",
      sourceText: "different",
      idempotencyKey: "campaign:test:1",
      runNow: true,
    });
    expect(b.id).toBe(a.id);

    const loaded = readReviewCampaign(ws, a.id, "m1");
    expect(loaded?.playbookId).toBe("standard-contract-review");

    const byKey = findCampaignByIdempotencyKey(ws, "campaign:test:1", "m1");
    expect(byKey?.id).toBe(a.id);

    const rerun = rerunReviewCampaignRole(ws, a, "risk");
    expect(rerun.roles.find((r) => r.roleId === "risk")?.status).toBe("done");

    const queued = createReviewCampaign(ws, {
      matterId: "m1",
      sourceText: "x",
      runNow: false,
    });
    expect(queued.status).toBe("queued");
    const cancelled = cancelReviewCampaign(ws, queued);
    expect(cancelled.status).toBe("cancelled");

    const md = renderCampaignReportMarkdown(a);
    expect(md).toContain("Safety Score");
    expect(md).toContain("谈判优先级");
  });
});
