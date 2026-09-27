import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createWordAddinReview,
  listWordAddinReviews,
  readWordAddinReview,
  updateWordAddinReview,
} from "../../../src/lawmind/integrations/word-addin/review-requests.js";
import {
  processOneQueuedWordAddinReview,
  reconcileStalledWordAddinRuns,
  tickWordAddinAutoRun,
  resetWordAddinAutoRunForTests,
  summarizeWordAddinQueue,
  WORD_ADDIN_RUN_ORPHAN_MS,
  type WordAddinAutoRunDeps,
  type WordAddinJobSnapshot,
} from "./lawmind-server-word-addin-runner.js";

describe("word addin auto-run", () => {
  let workspaceDir: string;
  let sourceDir: string;
  let sourceFile: string;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "lm-waddin-ws-"));
    sourceDir = await fs.mkdtemp(path.join(os.tmpdir(), "lm-waddin-src-"));
    sourceFile = path.join(sourceDir, "诉讼律师费收费说明.docx");
    await fs.writeFile(sourceFile, "fake docx bytes");
    resetWordAddinAutoRunForTests();
  });

  afterEach(async () => {
    await fs.rm(workspaceDir, { recursive: true, force: true });
    await fs.rm(sourceDir, { recursive: true, force: true });
  });

  const deps = (
    overrides: Partial<WordAddinAutoRunDeps> & { enqueue?: WordAddinAutoRunDeps["enqueue"] } = {},
  ): WordAddinAutoRunDeps => ({
    workspaceDir,
    autoRunEnabled: true,
    actorId: "lawyer:desktop",
    listMatterIds: () => ["甲案"],
    enqueue: () => "job-1",
    // 默认不接真实 jobs 注册表：孤儿判定走「查不到记录」的时间兜底路径。
    getJob: () => undefined,
    ...overrides,
  });

  it("does nothing when the switch is off (老的人工档行为不变)", async () => {
    await createWordAddinReview(workspaceDir, { sourcePath: sourceFile, matterId: "甲案" });
    const report = await processOneQueuedWordAddinReview(deps({ autoRunEnabled: false }));
    expect(report).toEqual({ picked: 0, outcomes: [] });
    expect(readWordAddinReview(workspaceDir, listWordAddinReviews(workspaceDir)[0].id)?.state).toBe(
      "queued",
    );
  });

  it("claims a queued request, records authorization, and enqueues one job", async () => {
    const created = await createWordAddinReview(workspaceDir, {
      sourcePath: sourceFile,
      matterId: "甲案",
    });
    if (!created.ok) {
      throw new Error("seed failed");
    }

    const seen: Array<{ matterId: string; grantedDir: string; stepCount: number }> = [];
    const report = await processOneQueuedWordAddinReview(
      deps({
        enqueue: ({ workflow, matterId, grantedDir }) => {
          seen.push({ matterId, grantedDir, stepCount: workflow.steps.length });
          return "job-42";
        },
      }),
    );

    expect(report.outcomes).toEqual([
      { requestId: created.request.id, result: "enqueued", jobId: "job-42", matterId: "甲案" },
    ]);
    expect(seen).toEqual([{ matterId: "甲案", grantedDir: sourceDir, stepCount: 1 }]);

    const row = readWordAddinReview(workspaceDir, created.request.id);
    expect(row?.state).toBe("running");
    expect(row?.jobId).toBe("job-42");
    expect(row?.authorization).toMatchObject({
      actorId: "lawyer:desktop",
      matterId: "甲案",
      sourcePath: sourceFile,
      grantedDir: sourceDir,
    });
    expect(row?.authorization?.sourceHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("runs ad-hoc and records candidates instead of blocking on matter", async () => {
    // 律师的核心诉求：任何文件夹的文件打开就能操作 → 对不到案卷也必须跑。
    const created = await createWordAddinReview(workspaceDir, { sourcePath: sourceFile });
    if (!created.ok) {
      throw new Error("seed failed");
    }
    let enqueuedMatter: string | undefined | null = null;
    const report = await processOneQueuedWordAddinReview(
      deps({
        enqueue: ({ workflow, matterId }) => {
          enqueuedMatter = matterId;
          // 无案卷时 workflow 不该带 matterId
          return workflow.matterId === undefined ? "job-adhoc" : "job-with-matter";
        },
      }),
    );
    expect(report.outcomes[0]).toMatchObject({ requestId: created.request.id, result: "enqueued" });
    expect(enqueuedMatter).toBeUndefined();

    const row = readWordAddinReview(workspaceDir, created.request.id);
    expect(row?.state).toBe("running");
    expect(row?.jobId).toBe("job-adhoc");
    // 候选留给窗格做「可选记到案卷」，但不阻断
    expect(row?.matterCandidates).toEqual(["甲案"]);
    expect(row?.matterId).toBeUndefined();
  });

  it("refuses a stale baseline when the file changed since the click", async () => {
    const created = await createWordAddinReview(workspaceDir, {
      sourcePath: sourceFile,
      matterId: "甲案",
    });
    if (!created.ok) {
      throw new Error("seed failed");
    }
    // 律师点击后文件被改（内容变了 → 指纹变了）。
    await fs.writeFile(sourceFile, "fake docx bytes BUT EDITED after the click");

    let enqueued = 0;
    const report = await processOneQueuedWordAddinReview(
      deps({
        enqueue: () => {
          enqueued += 1;
          return "job-should-not-happen";
        },
      }),
    );
    expect(report.outcomes).toEqual([{ requestId: created.request.id, result: "stale" }]);
    expect(enqueued).toBe(0);

    const row = readWordAddinReview(workspaceDir, created.request.id);
    expect(row?.state).toBe("stale");
    expect(row?.note).toContain("重新点一次");
  });

  it("reports a moved/deleted source file instead of writing an empty redline", async () => {
    const created = await createWordAddinReview(workspaceDir, {
      sourcePath: sourceFile,
      matterId: "甲案",
    });
    if (!created.ok) {
      throw new Error("seed failed");
    }
    await fs.rm(sourceFile);
    const report = await processOneQueuedWordAddinReview(deps());
    expect(report.outcomes).toEqual([
      { requestId: created.request.id, result: "failed", error: "source_file_missing" },
    ]);
    expect(readWordAddinReview(workspaceDir, created.request.id)?.state).toBe("failed");
  });

  it("fails honestly when the desktop cannot enqueue", async () => {
    const created = await createWordAddinReview(workspaceDir, {
      sourcePath: sourceFile,
      matterId: "甲案",
    });
    if (!created.ok) {
      throw new Error("seed failed");
    }
    const report = await processOneQueuedWordAddinReview(deps({ enqueue: () => null }));
    expect(report.outcomes[0]).toMatchObject({ result: "failed", error: "enqueue_unavailable" });
    expect(readWordAddinReview(workspaceDir, created.request.id)?.state).toBe("failed");
  });

  it("reuses the in-flight request instead of starting a second run", async () => {
    // 真机复现的时序：POST#1 被立刻领成 running，POST#2 才到。旧规则只折 queued，
    // 于是两条各跑一遍（同一文件同一指令花两次钱）。现在第二次点击是幂等的：
    // 直接接回在跑的那条，A 的结果照常回来。
    const a = await createWordAddinReview(workspaceDir, {
      sourcePath: sourceFile,
      matterId: "甲案",
    });
    if (!a.ok) {
      throw new Error("seed failed");
    }
    await updateWordAddinReview(workspaceDir, a.request.id, { state: "running", jobId: "job-a" });
    const b = await createWordAddinReview(workspaceDir, {
      sourcePath: sourceFile,
      matterId: "甲案",
    });
    if (!b.ok) {
      throw new Error("seed failed");
    }
    expect(b.reused).toBe(true);
    expect(b.request.id).toBe(a.request.id);
    expect(listWordAddinReviews(workspaceDir)).toHaveLength(1);
    expect(readWordAddinReview(workspaceDir, a.request.id)?.state).toBe("running");
  });

  it("reuses a still-queued request rather than queueing a duplicate", async () => {
    const a = await createWordAddinReview(workspaceDir, {
      sourcePath: sourceFile,
      matterId: "甲案",
    });
    if (!a.ok) {
      throw new Error("seed failed");
    }
    const b = await createWordAddinReview(workspaceDir, {
      sourcePath: sourceFile,
      matterId: "甲案",
    });
    if (!b.ok) {
      throw new Error("seed failed");
    }
    expect(b.reused).toBe(true);
    expect(listWordAddinReviews(workspaceDir)).toHaveLength(1);

    const enqueued: string[] = [];
    await processOneQueuedWordAddinReview(
      deps({
        enqueue: ({ requestId }) => {
          enqueued.push(requestId);
          return "job-1";
        },
      }),
    );
    expect(enqueued).toEqual([a.request.id]);
  });

  it("retires an unstarted request for the old content when the file was edited", async () => {
    // 律师改了文件再点：必须重新审（不能接旧基线），同时把那条还没开跑、
    // 基线已经作废的旧请求折掉——supersede 现在只服务这一种情形。
    const a = await createWordAddinReview(workspaceDir, {
      sourcePath: sourceFile,
      matterId: "甲案",
    });
    if (!a.ok) {
      throw new Error("seed failed");
    }
    await fs.writeFile(sourceFile, "bytes edited after the first click");
    const b = await createWordAddinReview(workspaceDir, {
      sourcePath: sourceFile,
      matterId: "甲案",
    });
    if (!b.ok) {
      throw new Error("seed failed");
    }
    expect(b.reused).toBe(false);
    expect(b.request.id).not.toBe(a.request.id);
    expect(readWordAddinReview(workspaceDir, a.request.id)?.state).toBe("superseded");
    expect(readWordAddinReview(workspaceDir, a.request.id)?.supersededBy).toBe(b.request.id);
    expect(readWordAddinReview(workspaceDir, b.request.id)?.state).toBe("queued");
  });

  it("grants the source folder only when the file is outside the workspace", async () => {
    // 工作区内的文件：不额外挂本机目录（否则会打开本机文件台账，与桌面回合行为不一致）。
    const inWs = path.join(workspaceDir, "cases", "甲案", "material", "合同.docx");
    await fs.mkdir(path.dirname(inWs), { recursive: true });
    await fs.writeFile(inWs, "bytes");
    const inside = await createWordAddinReview(workspaceDir, { sourcePath: inWs });
    if (!inside.ok) {
      throw new Error("seed failed");
    }
    const grants: string[] = [];
    await processOneQueuedWordAddinReview(
      deps({
        enqueue: ({ grantedDir }) => {
          grants.push(grantedDir);
          return "job-in";
        },
      }),
    );
    expect(grants).toEqual([""]);
    expect(readWordAddinReview(workspaceDir, inside.request.id)?.authorization?.grantedDir).toBe("");

    // 工作区外的文件（桌面/下载目录）：授予它所在目录，仅本次运行。
    const outside = await createWordAddinReview(workspaceDir, {
      sourcePath: sourceFile,
      matterId: "甲案",
    });
    if (!outside.ok) {
      throw new Error("seed failed");
    }
    await processOneQueuedWordAddinReview(
      deps({
        enqueue: ({ grantedDir }) => {
          grants.push(grantedDir);
          return "job-out";
        },
      }),
    );
    expect(grants).toEqual(["", sourceDir]);
    expect(readWordAddinReview(workspaceDir, outside.request.id)?.authorization?.grantedDir).toBe(
      sourceDir,
    );
  });

  it("picks the earliest click first, one per tick", async () => {
    const first = await createWordAddinReview(workspaceDir, {
      sourcePath: path.join(sourceDir, "a.docx"),
      matterId: "甲案",
    });
    await fs.writeFile(path.join(sourceDir, "a.docx"), "a");
    const second = await createWordAddinReview(workspaceDir, {
      sourcePath: path.join(sourceDir, "b.docx"),
      matterId: "甲案",
    });
    await fs.writeFile(path.join(sourceDir, "b.docx"), "b");
    if (!first.ok || !second.ok) {
      throw new Error("seed failed");
    }
    // b 后建（createdAt 更新），但 a 先点 → 先跑 a。
    const order: string[] = [];
    await processOneQueuedWordAddinReview(
      deps({
        enqueue: ({ requestId }) => {
          order.push(requestId);
          return "job-a";
        },
      }),
    );
    expect(order).toEqual([first.request.id]);
    expect(readWordAddinReview(workspaceDir, first.request.id)?.state).toBe("running");
    expect(readWordAddinReview(workspaceDir, second.request.id)?.state).toBe("queued");
  });

  it("counts only real work: repeat clicks reuse instead of adding queue entries", async () => {
    const first = await createWordAddinReview(workspaceDir, {
      sourcePath: sourceFile,
      matterId: "甲案",
    });
    const second = await createWordAddinReview(workspaceDir, {
      sourcePath: sourceFile,
      matterId: "甲案",
    });
    if (!first.ok || !second.ok) {
      throw new Error("seed failed");
    }
    // 第二次点击没有新建：只有一条 active，没有 superseded。
    expect(second.request.id).toBe(first.request.id);
    expect(summarizeWordAddinQueue(listWordAddinReviews(workspaceDir))).toEqual({
      active: 1,
      superseded: 0,
      needsMatter: 0,
    });
  });

  it("folds duplicates that were already in the queue before this run", async () => {
    // 模拟「升级前就躺在队列里的重复行」：先建 A，再把它的 createdAt 推到窗口之外，
    // 这样它不会在创建 B 时被折叠——只能靠取件时的折叠兜住。
    const first = await createWordAddinReview(workspaceDir, {
      sourcePath: sourceFile,
      matterId: "甲案",
    });
    if (!first.ok) {
      throw new Error("seed failed");
    }
    const storePath = path.join(workspaceDir, "lawmind", "word-addin", "reviews.json");
    const raw = JSON.parse(await fs.readFile(storePath, "utf8")) as {
      requests: Array<{ id: string; createdAt: string }>;
    };
    const stale = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    for (const row of raw.requests) {
      if (row.id === first.request.id) {
        row.createdAt = stale;
      }
    }
    await fs.writeFile(storePath, JSON.stringify(raw));
    const second = await createWordAddinReview(workspaceDir, {
      sourcePath: sourceFile,
      matterId: "甲案",
    });
    if (!second.ok) {
      throw new Error("seed failed");
    }

    const enqueued: string[] = [];
    await processOneQueuedWordAddinReview(
      deps({
        enqueue: ({ requestId }) => {
          enqueued.push(requestId);
          return "job-1";
        },
      }),
    );
    // 只跑一次（最老的那条），另一条被折成共用结果。
    expect(enqueued).toEqual([first.request.id]);
    expect(readWordAddinReview(workspaceDir, first.request.id)?.state).toBe("running");
    expect(readWordAddinReview(workspaceDir, second.request.id)?.state).toBe("superseded");
    expect(readWordAddinReview(workspaceDir, second.request.id)?.supersededBy).toBe(
      first.request.id,
    );

    // 再 tick 一次也不该跑第二条。
    await processOneQueuedWordAddinReview(deps());
    expect(enqueued).toEqual([first.request.id]);
  });

  it("summarizes a retired stale-baseline request as superseded, not work", async () => {
    const first = await createWordAddinReview(workspaceDir, {
      sourcePath: sourceFile,
      matterId: "甲案",
    });
    if (!first.ok) {
      throw new Error("seed failed");
    }
    await fs.writeFile(sourceFile, "bytes edited before the second click");
    const second = await createWordAddinReview(workspaceDir, {
      sourcePath: sourceFile,
      matterId: "甲案",
    });
    if (!second.ok) {
      throw new Error("seed failed");
    }
    // 旧基线那条退休（superseded），实际要跑的只有新的那条。
    expect(summarizeWordAddinQueue(listWordAddinReviews(workspaceDir))).toEqual({
      active: 1,
      superseded: 1,
      needsMatter: 0,
    });
  });

  it("serializes ticks: a second wake while one is in flight is a no-op", async () => {
    await createWordAddinReview(workspaceDir, { sourcePath: sourceFile, matterId: "甲案" });
    let enqueues = 0;
    const first = tickWordAddinAutoRun(
      deps({
        enqueue: () => {
          enqueues += 1;
          return "job-1";
        },
      }),
    );
    // 立刻再 wake 一次：应当被串行闸挡掉，不产生第二次取件。
    const second = await tickWordAddinAutoRun(deps());
    expect(second).toEqual({ picked: 0, outcomes: [] });
    const report = await first;
    expect(report.picked).toBe(1);
    expect(enqueues).toBe(1);
  });
});

describe("word addin orphan reconcile", () => {
  let workspaceDir: string;
  let sourceDir: string;
  let sourceFile: string;
  const NOW = new Date("2026-09-20T04:00:00.000Z");

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "lm-waddin-orphan-"));
    sourceDir = await fs.mkdtemp(path.join(os.tmpdir(), "lm-waddin-osrc-"));
    sourceFile = path.join(sourceDir, "合同.docx");
    await fs.writeFile(sourceFile, "bytes");
    resetWordAddinAutoRunForTests();
  });

  afterEach(async () => {
    await fs.rm(workspaceDir, { recursive: true, force: true });
    await fs.rm(sourceDir, { recursive: true, force: true });
  });

  const seedRunning = async (jobId: string | undefined, authorizationAt?: string) => {
    const created = await createWordAddinReview(workspaceDir, {
      sourcePath: sourceFile,
      matterId: "甲案",
    });
    if (!created.ok) {
      throw new Error("seed failed");
    }
    await updateWordAddinReview(workspaceDir, created.request.id, {
      state: "running",
      ...(jobId ? { jobId } : {}),
      ...(authorizationAt
        ? {
            authorization: {
              at: authorizationAt,
              actorId: "lawyer:desktop",
              sourcePath: sourceFile,
              sourceHash: "h",
              grantedDir: sourceDir,
              matterId: "甲案",
              instruction: created.request.instruction,
            },
          }
        : {}),
    });
    return created.request.id;
  };

  const reconcile = (jobs: Record<string, WordAddinJobSnapshot>) =>
    reconcileStalledWordAddinRuns({
      workspaceDir,
      getJob: (jobId) => jobs[jobId],
      now: NOW,
    });

  it("marks a failed job as failed instead of spinning forever", async () => {
    const id = await seedRunning("job-x");
    const outcomes = await reconcile({ "job-x": { status: "failed", error: "模型超时" } });
    expect(outcomes).toEqual([{ requestId: id, result: "reconciled", reason: "job_failed" }]);
    const row = readWordAddinReview(workspaceDir, id);
    expect(row?.state).toBe("failed");
    expect(row?.note).toContain("模型超时");
  });

  it("marks a cancelled job as failed and says it was cancelled", async () => {
    const id = await seedRunning("job-c");
    await reconcile({ "job-c": { status: "cancelled" } });
    const row = readWordAddinReview(workspaceDir, id);
    expect(row?.state).toBe("failed");
    expect(row?.note).toContain("被取消");
  });

  it("tells the truth when the job completed but nothing could be attached", async () => {
    // 降级导出 / 模型调用失败都会走到这里：请求会一直挂在 running。
    const id = await seedRunning("job-done");
    const outcomes = await reconcile({ "job-done": { status: "completed" } });
    expect(outcomes).toEqual([
      { requestId: id, result: "reconciled", reason: "completed_without_result" },
    ]);
    const note = readWordAddinReview(workspaceDir, id)?.note ?? "";
    // 真机实测最常见的真因是模型密钥失效（引擎仍把该步骤算 completed），
    // 所以文案不能只提「降级导出」把人往错方向带。
    expect(note).toContain("模型密钥失效");
    expect(note).toContain("桌面端");
  });

  it("translates a machine error code into a sentence the lawyer can read", async () => {
    // 真机场景：服务器重启会把在跑的 job 标成 interrupted_by_restart。
    const id = await seedRunning("job-restarted");
    await reconcile({ "job-restarted": { status: "failed", error: "interrupted_by_restart" } });
    const note = readWordAddinReview(workspaceDir, id)?.note ?? "";
    expect(note).toContain("桌面端中途重启过");
    expect(note).not.toContain("interrupted_by_restart");
  });

  it("passes an unrecognized error code through rather than inventing a meaning", async () => {
    const id = await seedRunning("job-weird");
    await reconcile({ "job-weird": { status: "failed", error: "some_new_code_we_do_not_know" } });
    expect(readWordAddinReview(workspaceDir, id)?.note).toContain("some_new_code_we_do_not_know");
  });

  it("surfaces a step-level job error in the note", async () => {
    const id = await seedRunning("job-done-2");
    await reconcile({
      "job-done-2": { status: "completed", stepError: "Model API error 401" },
    });
    expect(readWordAddinReview(workspaceDir, id)?.note).toContain("401");
  });

  it("leaves a genuinely running job alone", async () => {
    const id = await seedRunning("job-live");
    expect(await reconcile({ "job-live": { status: "running" } })).toEqual([]);
    expect(await reconcile({ "job-live": { status: "queued" } })).toEqual([]);
    expect(readWordAddinReview(workspaceDir, id)?.state).toBe("running");
  });

  it("waits before giving up on a job record that is merely missing", async () => {
    // 记录暂时查不到（注册表只留最近 200 条 / 正在写盘）：不能立刻判死。
    const fresh = await seedRunning("job-gone", NOW.toISOString());
    expect(await reconcile({})).toEqual([]);
    expect(readWordAddinReview(workspaceDir, fresh)?.state).toBe("running");

    const old = await seedRunning("job-old", new Date(NOW.getTime() - WORD_ADDIN_RUN_ORPHAN_MS - 1000).toISOString());
    const outcomes = await reconcile({});
    expect(outcomes).toEqual([{ requestId: old, result: "reconciled", reason: "job_record_missing" }]);
    expect(readWordAddinReview(workspaceDir, old)?.state).toBe("failed");
  });

  it("cleans up a request that was claimed but never recorded a job", async () => {
    // 进程在 enqueue 与写盘之间被杀：没有 jobId 就永远没人回填。
    const id = await seedRunning(undefined);
    const outcomes = await reconcile({});
    expect(outcomes).toEqual([{ requestId: id, result: "reconciled", reason: "run_interrupted" }]);
    expect(readWordAddinReview(workspaceDir, id)?.state).toBe("failed");
  });

  it("cleans orphans even when the auto-run switch is off", async () => {
    const id = await seedRunning("job-x");
    const report = await processOneQueuedWordAddinReview({
      workspaceDir,
      autoRunEnabled: false,
      actorId: "lawyer:desktop",
      listMatterIds: () => ["甲案"],
      enqueue: () => null,
      getJob: (jobId) => (jobId === "job-x" ? { status: "failed", error: "boom" } : undefined),
      now: () => NOW,
    });
    expect(report.outcomes).toEqual([
      { requestId: id, result: "reconciled", reason: "job_failed" },
    ]);
    expect(readWordAddinReview(workspaceDir, id)?.state).toBe("failed");
  });
});
