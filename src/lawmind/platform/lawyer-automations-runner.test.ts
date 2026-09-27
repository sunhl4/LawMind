import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * mock 远程邮箱同步：这是运行期唯一能自然产生「源数据不可用」的地方。
 * 默认返回「未配置远程邮箱」（skipped），需要别的形态时在用例内改。
 */
const syncMatterMailbox = vi.fn(async () => ({ ok: true as const, skipped: true as const }));
vi.mock("../mail/sync-inbox.js", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("../mail/sync-inbox.js");
  return { ...actual, syncMatterMailbox };
});

const {
  createAutomation,
  getAutomation,
  listOpenAutomationInbox,
  listAutomations,
  saveAutomation,
} = await import("./lawyer-automations.js");
const { listAutomationRuns } = await import("./automation-run-history.js");
const { processDueLawyerAutomations } = await import("./lawyer-automations-runner.js");

const dirs: string[] = [];

function tmpWs(): string {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-runner-"));
  dirs.push(ws);
  return ws;
}

afterEach(() => {
  syncMatterMailbox.mockReset();
  syncMatterMailbox.mockImplementation(async () => ({ ok: true, skipped: true }));
  for (const d of dirs) {
    fs.rmSync(d, { recursive: true, force: true });
  }
  dirs.length = 0;
});

/** 建一条到期的邮件匣整理自动办件，并可按需覆写六确认字段。 */
function dueMailAutomation(ws: string, over: Record<string, unknown> = {}) {
  const created = createAutomation(ws, {
    presetId: "mail-inbox-digest",
    matterId: "m1",
    title: "邮箱整理",
    ...over,
  });
  // 让它立刻到期（interval 首次约 1 秒后；直接压到过去更稳）。
  const saved = getAutomation(ws, created.id);
  if (!saved) {
    throw new Error("automation not saved");
  }
  saveAutomation(ws, { ...saved, nextRunAt: new Date(0).toISOString() });
  return created.id;
}

describe("缺资料策略在运行期真的生效", () => {
  it("默认（report_partial）沿用既有行为：退回本地匣继续办，并把缺口记进运行记录", async () => {
    const ws = tmpWs();
    const id = dueMailAutomation(ws);

    await processDueLawyerAutomations(ws, {});

    // 新建时写入模板草稿 report_partial；旧文件缺字段时 getter 仍是同一默认。
    expect(getAutomation(ws, id)?.missingDataPolicy).toBe("report_partial");
    const runs = listAutomationRuns(ws, id);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.status).toBe("ok");
    expect(runs[0]?.missingData?.[0]).toContain("未配置远程邮箱");
    // 仍然出了运行结果（不是失败）。
    const titles = listOpenAutomationInbox(ws).map((i) => i.title);
    expect(titles.some((t) => t.includes("运行结果"))).toBe(true);
    expect(titles.some((t) => t.includes("没能办成"))).toBe(false);
  });

  it("report_failure：停下来，如实报失败，并把缺口写进运行记录", async () => {
    const ws = tmpWs();
    const id = dueMailAutomation(ws, { missingDataPolicy: "report_failure" });

    await processDueLawyerAutomations(ws, {});

    const runs = listAutomationRuns(ws, id);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.status).toBe("skipped");
    expect(runs[0]?.missingData?.[0]).toContain("未配置远程邮箱");

    const titles = listOpenAutomationInbox(ws).map((i) => i.title);
    expect(titles.some((t) => t.includes("没能办成"))).toBe(true);
    // 关键：不再产出「运行结果」，避免律师以为这次办成了。
    expect(titles.some((t) => t.includes("运行结果"))).toBe(false);
    // 失败必须让律师知道，所以 notified 为真。
    expect(runs[0]?.notified).toBe(true);
  });

  it("skip_run：停下来且不打扰（无收件箱项）", async () => {
    const ws = tmpWs();
    const id = dueMailAutomation(ws, { missingDataPolicy: "skip_run" });

    await processDueLawyerAutomations(ws, {});

    const runs = listAutomationRuns(ws, id);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.status).toBe("skipped");
    expect(runs[0]?.notified).toBe(false);
    expect(listOpenAutomationInbox(ws)).toHaveLength(0);
  });

  it("远程同步失败也走同一条策略（不只覆盖「未配置」）", async () => {
    const ws = tmpWs();
    const id = dueMailAutomation(ws, { missingDataPolicy: "report_failure" });
    syncMatterMailbox.mockImplementation(async () => ({
      ok: false as const,
      error: "graph_unauthorized",
      hint: "令牌过期",
    }));

    await processDueLawyerAutomations(ws, {});

    const runs = listAutomationRuns(ws, id);
    expect(runs[0]?.status).toBe("skipped");
    expect(runs[0]?.missingData?.[0]).toContain("远程同步失败");
  });

  it("跳过时仍然推进下次运行时间，不会卡死在原地反复触发", async () => {
    const ws = tmpWs();
    const id = dueMailAutomation(ws, { missingDataPolicy: "skip_run" });

    await processDueLawyerAutomations(ws, {});

    const next = Date.parse(getAutomation(ws, id)?.nextRunAt ?? "");
    expect(Number.isFinite(next)).toBe(true);
    expect(next).toBeGreaterThan(Date.now());
  });
});

describe("运行结论不再靠「推了几条」猜", () => {
  it("只推一条信息通报时结论是 ok（此前会被误判成 blocked）", async () => {
    const ws = tmpWs();
    const id = dueMailAutomation(ws);

    await processDueLawyerAutomations(ws, {});

    // 邮箱匣摘要只是通报，律师不需要拍板。
    expect(listAutomationRuns(ws, id)[0]?.status).toBe("ok");
  });

  it("自定义无模板时结论是 blocked（确实需要律师接手）", async () => {
    const ws = tmpWs();
    const created = createAutomation(ws, {
      presetId: "custom",
      matterId: "m1",
      title: "自定义交办",
      instruction: "把本周到期的合同列一下。",
    });
    const saved = getAutomation(ws, created.id);
    saveAutomation(ws, { ...saved!, nextRunAt: new Date(0).toISOString() });

    await processDueLawyerAutomations(ws, {});

    expect(listAutomationRuns(ws, created.id)[0]?.status).toBe("blocked");
  });
});

describe("期望结果与审批边界真的进到交办里", () => {
  it("随 instruction 传给工作流（否则律师填了等于没填）", async () => {
    const ws = tmpWs();
    const captured: Array<{ templateId: string; instruction?: string }> = [];
    createAutomation(ws, {
      presetId: "renewal-monitor",
      matterId: "m1",
      title: "续签盯梢",
      instruction: "顺便看下付款条款",
      expectedResult: "一份续签提醒清单",
      approvalBoundary: "外发前必须问我",
    });
    const [only] = listAutomations(ws);
    // listAutomations 刚从盘上读回，必然存在；这里用断言收紧类型，不做非空猜测。
    if (!only) {
      throw new Error("automation not found after save");
    }
    saveAutomation(ws, { ...only, nextRunAt: new Date(0).toISOString() });

    await processDueLawyerAutomations(ws, {
      enqueueTemplate: ({ templateId, instruction }) => {
        captured.push({ templateId, instruction });
        return "job-1";
      },
    });

    expect(captured).toHaveLength(1);
    const instruction = captured[0]?.instruction ?? "";
    expect(instruction).toContain("办完的标准：一份续签提醒清单");
    expect(instruction).toContain("必须先问我：外发前必须问我");
    // 原有的交办补充不能被挤掉。
    expect(instruction).toContain("顺便看下付款条款");
  });

  it("puts the previous result into the next brief so the run does not start cold", async () => {
    const ws = tmpWs();
    const created = createAutomation(ws, {
      presetId: "renewal-monitor",
      matterId: "m1",
      title: "续签盯梢",
    });
    saveAutomation(ws, {
      ...created,
      nextRunAt: new Date(0).toISOString(),
      lastResultSummary: "上周已列出甲合同 6 月到期。",
    });
    const captured: string[] = [];
    await processDueLawyerAutomations(ws, {
      enqueueTemplate: ({ instruction }) => {
        captured.push(instruction ?? "");
        return "job-2";
      },
    });
    expect(captured[0]).toContain("上周已列出甲合同 6 月到期");
    expect(captured[0]).toContain("无新变化");
  });
});

describe("同一批来信不再反复打扰", () => {
  it("second digest of the same mailbox stays quiet", async () => {
    const ws = tmpWs();
    const id = dueMailAutomation(ws);
    await processDueLawyerAutomations(ws, {});
    expect(listOpenAutomationInbox(ws)).toHaveLength(1);

    const after = getAutomation(ws, id);
    if (!after?.lastQuietKey) {
      throw new Error("quiet key missing");
    }
    saveAutomation(ws, { ...after, nextRunAt: new Date(0).toISOString() });
    await processDueLawyerAutomations(ws, {});

    expect(listOpenAutomationInbox(ws)).toHaveLength(1);
    expect(listAutomationRuns(ws, id).some((run) => run.status === "skipped")).toBe(true);
    expect(getAutomation(ws, id)?.lastResultSummary).toContain("没有新来信");
  });

  it("always-notify still reports an unchanged mailbox", async () => {
    const ws = tmpWs();
    const id = dueMailAutomation(ws, { notifyPolicy: "always" });
    await processDueLawyerAutomations(ws, {});
    const after = getAutomation(ws, id);
    if (!after) {
      throw new Error("automation missing");
    }
    saveAutomation(ws, { ...after, nextRunAt: new Date(0).toISOString() });
    await processDueLawyerAutomations(ws, {});
    expect(listOpenAutomationInbox(ws)).toHaveLength(2);
  });

  it("clears the previous failure code after a later run completes", async () => {
    const ws = tmpWs();
    const created = createAutomation(ws, {
      presetId: "renewal-monitor",
      matterId: "m1",
      title: "续签盯梢",
    });
    saveAutomation(ws, {
      ...created,
      nextRunAt: new Date(0).toISOString(),
      lastErrorCode: "mail_unconfigured",
      lastResultSummary: "上次失败",
    });
    await processDueLawyerAutomations(ws, {
      enqueueTemplate: () => "job-3",
    });
    expect(getAutomation(ws, created.id)?.lastErrorCode).toBeUndefined();
  });
});

describe("续签与周报的卷宗缺口", () => {
  it("report_failure 在没有卷宗时不启动工作流", async () => {
    const ws = tmpWs();
    const created = createAutomation(ws, {
      presetId: "renewal-monitor",
      matterId: "missing-matter",
      title: "续签盯梢",
      missingDataPolicy: "report_failure",
    });
    saveAutomation(ws, { ...created, nextRunAt: new Date(0).toISOString() });
    const jobs: string[] = [];
    await processDueLawyerAutomations(ws, {
      enqueueTemplate: ({ templateId }) => {
        jobs.push(templateId);
        return "job-should-not-run";
      },
    });
    expect(jobs).toEqual([]);
    const run = listAutomationRuns(ws, created.id)[0];
    expect(run?.status).toBe("skipped");
    expect(run?.missingData?.[0]).toContain("还没有卷宗");
    expect(listOpenAutomationInbox(ws, "missing-matter")[0]?.title).toContain("没能办成");
  });

  it("默认仍继续办，但运行记录里写明缺卷宗", async () => {
    const ws = tmpWs();
    const created = createAutomation(ws, {
      presetId: "client-weekly-update",
      matterId: "missing-matter",
      title: "客户周报",
    });
    saveAutomation(ws, { ...created, nextRunAt: new Date(0).toISOString() });
    const jobs: string[] = [];
    await processDueLawyerAutomations(ws, {
      enqueueTemplate: ({ templateId }) => {
        jobs.push(templateId);
        return "job-weekly";
      },
    });
    expect(jobs).toEqual(["client-update-memo"]);
    expect(listAutomationRuns(ws, created.id)[0]?.missingData?.[0]).toContain("还没有卷宗");
  });
});
