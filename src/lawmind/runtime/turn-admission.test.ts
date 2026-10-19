import { afterEach, describe, expect, it } from "vitest";
import {
  AdmissionAbortedError,
  getMaxModelConcurrency,
  MODEL_SUCCESS_STREAK_FOR_INCREASE,
  noteModelRateLimit,
  noteModelSampleSuccess,
  resetTurnAdmissionForTests,
  resourceLeaseKeyForTool,
  selectModelWaiter,
  withModelAdmission,
  withResourceLease,
  withTurnToolSlot,
} from "./turn-admission.js";

describe("turn admission", () => {
  const previous = process.env.LAWMIND_MAX_MODEL_CONCURRENCY;
  const previousTools = process.env.LAWMIND_MAX_TOOL_CONCURRENCY;

  afterEach(() => {
    if (previous === undefined) {
      delete process.env.LAWMIND_MAX_MODEL_CONCURRENCY;
    } else {
      process.env.LAWMIND_MAX_MODEL_CONCURRENCY = previous;
    }
    if (previousTools === undefined) {
      delete process.env.LAWMIND_MAX_TOOL_CONCURRENCY;
    } else {
      process.env.LAWMIND_MAX_TOOL_CONCURRENCY = previousTools;
    }
    resetTurnAdmissionForTests();
  });

  it("defaults model slots to 8 and clamps an explicit cap at 8", () => {
    delete process.env.LAWMIND_MAX_MODEL_CONCURRENCY;
    expect(getMaxModelConcurrency()).toBe(8);
    process.env.LAWMIND_MAX_MODEL_CONCURRENCY = "99";
    expect(getMaxModelConcurrency()).toBe(8);
    process.env.LAWMIND_MAX_MODEL_CONCURRENCY = "1";
    expect(getMaxModelConcurrency()).toBe(1);
  });

  it("lets two model calls overlap and queues the third", async () => {
    process.env.LAWMIND_MAX_MODEL_CONCURRENCY = "2";
    let inFlight = 0;
    let max = 0;
    const release: Array<() => void> = [];
    let waited = 0;
    const hold = () =>
      withModelAdmission(
        async () => {
          inFlight += 1;
          max = Math.max(max, inFlight);
          await new Promise<void>((resolve) => release.push(resolve));
          inFlight -= 1;
        },
        {
          onWait: () => {
            waited += 1;
          },
        },
      );
    const first = hold();
    const second = hold();
    const third = hold();
    await viWaitUntil(() => max === 2 && waited === 1);
    expect(inFlight).toBe(2);
    release.shift()?.();
    await viWaitUntil(() => inFlight === 2 && release.length === 2);
    expect(waited).toBe(1);
    while (release.length > 0) {
      release.shift()?.();
    }
    await Promise.all([first, second, third]);
    expect(max).toBe(2);
  });

  it("drops a queued model call when the lawyer stops", async () => {
    process.env.LAWMIND_MAX_MODEL_CONCURRENCY = "1";
    let release: (() => void) | undefined;
    const first = withModelAdmission(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const ac = new AbortController();
    const second = withModelAdmission(() => Promise.resolve("ran"), { signal: ac.signal });
    await viWaitUntil(() => release !== undefined);
    ac.abort();
    await expect(second).rejects.toBeInstanceOf(AdmissionAbortedError);
    release?.();
    await first;
  });

  it("serializes one file path and overlaps two paths", async () => {
    let overlap = 0;
    let max = 0;
    const release: Array<() => void> = [];
    const hold = (key: string) =>
      withResourceLease(key, async () => {
        overlap += 1;
        max = Math.max(max, overlap);
        await new Promise<void>((resolve) => release.push(resolve));
        overlap -= 1;
      });
    const sameA = hold("path:/tmp/a.docx");
    const sameB = hold("path:/tmp/a.docx");
    const other = hold("path:/tmp/b.docx");
    await viWaitUntil(() => max === 2 && release.length === 2);
    expect(overlap).toBe(2);
    release.shift()?.();
    release.shift()?.();
    await viWaitUntil(() => release.length === 1);
    release.shift()?.();
    await Promise.all([sameA, sameB, other]);
    expect(max).toBe(2);
  });

  it("reenters a lease the caller already holds", async () => {
    const seen = await withResourceLease("external:pkulaw", () =>
      withResourceLease("external:pkulaw", async () => "inner"),
    );
    expect(seen).toBe("inner");
  });

  it("shares one tool slot pool across callers", async () => {
    process.env.LAWMIND_MAX_TOOL_CONCURRENCY = "1";
    const order: string[] = [];
    const release: Array<() => void> = [];
    const run = (name: string) =>
      withTurnToolSlot(async () => {
        order.push(name);
        await new Promise<void>((resolve) => release.push(resolve));
      });
    const first = run("a");
    const second = run("b");
    await viWaitUntil(() => order.length === 1 && release.length === 1);
    expect(order).toEqual(["a"]);
    release.shift()?.();
    await viWaitUntil(() => order.length === 2);
    release.shift()?.();
    await Promise.all([first, second]);
    expect(order).toEqual(["a", "b"]);
  });

  it("gives a waiting conversation its first model lane before another chat's second", async () => {
    process.env.LAWMIND_MAX_MODEL_CONCURRENCY = "2";
    let releaseA1: (() => void) | undefined;
    let releaseA2: (() => void) | undefined;
    const a1 = withModelAdmission(
      () =>
        new Promise<void>((resolve) => {
          releaseA1 = resolve;
        }),
      { identity: { sessionId: "A", kind: "parent" } },
    );
    const a2 = withModelAdmission(
      () =>
        new Promise<void>((resolve) => {
          releaseA2 = resolve;
        }),
      { identity: { sessionId: "A", kind: "worker" } },
    );
    await viWaitUntil(() => releaseA1 !== undefined && releaseA2 !== undefined);
    const order: string[] = [];
    let waited = 0;
    const a3 = withModelAdmission(
      async () => {
        order.push("A3");
      },
      {
        identity: { sessionId: "A", kind: "worker" },
        onWait: () => {
          waited += 1;
        },
      },
    );
    let releaseB: (() => void) | undefined;
    const b = withModelAdmission(
      () =>
        new Promise<void>((resolve) => {
          order.push("B");
          releaseB = resolve;
        }),
      {
        identity: { sessionId: "B", kind: "parent" },
        onWait: () => {
          waited += 1;
        },
      },
    );
    await viWaitUntil(() => waited === 2);
    releaseA2?.();
    await viWaitUntil(() => order[0] === "B" && releaseB !== undefined);
    expect(order).toEqual(["B"]);
    releaseB?.();
    releaseA1?.();
    await Promise.all([a1, a2, a3, b]);
    expect(order).toEqual(["B", "A3"]);
  });

  it("lets an aged second lane pass a newly arrived first lane", () => {
    const now = 20_000;
    const aged = selectModelWaiter(
      [
        { sessionKey: "A", enqueuedAt: now - 9_000 },
        { sessionKey: "B", enqueuedAt: now - 10 },
      ],
      ["A"],
      now,
    );
    expect(aged).toBe(0);
    const fresh = selectModelWaiter(
      [
        { sessionKey: "A", enqueuedAt: now - 100 },
        { sessionKey: "B", enqueuedAt: now - 10 },
      ],
      ["A"],
      now,
    );
    expect(fresh).toBe(1);
  });

  it("halves the live model cap on 429 and raises it after a success streak", () => {
    delete process.env.LAWMIND_MAX_MODEL_CONCURRENCY;
    expect(getMaxModelConcurrency()).toBe(8);
    noteModelRateLimit();
    expect(getMaxModelConcurrency()).toBe(4);
    for (let i = 0; i < MODEL_SUCCESS_STREAK_FOR_INCREASE; i += 1) {
      noteModelSampleSuccess();
    }
    expect(getMaxModelConcurrency()).toBe(5);
    while (getMaxModelConcurrency() < 8) {
      for (let i = 0; i < MODEL_SUCCESS_STREAK_FOR_INCREASE; i += 1) {
        noteModelSampleSuccess();
      }
    }
    expect(getMaxModelConcurrency()).toBe(8);
    noteModelRateLimit();
    expect(getMaxModelConcurrency()).toBe(4);
  });

  it("keeps an explicit model cap and drops adaptation when the env changes", () => {
    process.env.LAWMIND_MAX_MODEL_CONCURRENCY = "1";
    resetTurnAdmissionForTests();
    for (let i = 0; i < MODEL_SUCCESS_STREAK_FOR_INCREASE; i += 1) {
      noteModelSampleSuccess();
    }
    expect(getMaxModelConcurrency()).toBe(1);
    process.env.LAWMIND_MAX_MODEL_CONCURRENCY = "2";
    expect(getMaxModelConcurrency()).toBe(2);
  });

  it("gives a newly opened model lane to a conversation that has none", async () => {
    process.env.LAWMIND_MAX_MODEL_CONCURRENCY = "1";
    resetTurnAdmissionForTests();
    let releaseA: (() => void) | undefined;
    const a = withModelAdmission(
      () =>
        new Promise<void>((resolve) => {
          releaseA = resolve;
        }),
      { identity: { sessionId: "A", kind: "parent" } },
    );
    await viWaitUntil(() => releaseA !== undefined);
    let workerStarted = false;
    let workerWaited = false;
    const worker = withModelAdmission(
      async () => {
        workerStarted = true;
      },
      {
        identity: { sessionId: "A", kind: "worker" },
        onWait: () => {
          workerWaited = true;
        },
      },
    );
    await viWaitUntil(() => workerWaited);
    process.env.LAWMIND_MAX_MODEL_CONCURRENCY = "2";
    let parentStarted = false;
    let releaseB: (() => void) | undefined;
    const parent = withModelAdmission(
      () =>
        new Promise<void>((resolve) => {
          parentStarted = true;
          releaseB = resolve;
        }),
      { identity: { sessionId: "B", kind: "parent" } },
    );
    await viWaitUntil(() => parentStarted && releaseB !== undefined);
    expect(workerStarted).toBe(false);
    releaseB?.();
    releaseA?.();
    await Promise.all([a, worker, parent]);
    expect(workerStarted).toBe(true);
  });

  it("keys write leases by absolute path and skips reads", () => {
    expect(resourceLeaseKeyForTool("search_statute", { query: "合同" }, true)).toBeNull();
    expect(resourceLeaseKeyForTool("update_plan", {}, false)).toBeNull();
    const key = resourceLeaseKeyForTool("apply_surgical_edits", { path: "案/合同.docx" }, false);
    expect(key?.startsWith("path:")).toBe(true);
    expect(key?.endsWith("/案/合同.docx")).toBe(true);
    expect(resourceLeaseKeyForTool("draft_document", { title: "备忘" }, false)).toBeNull();
    expect(resourceLeaseKeyForTool("render_document", { task_id: "t1" }, false)).toBeNull();
    const baseline = resourceLeaseKeyForTool(
      "draft_document",
      { contract_edit_baseline_path: "案/合同.docx" },
      false,
    );
    expect(baseline?.startsWith("path:")).toBe(true);
    expect(baseline?.endsWith("/案/合同.docx")).toBe(true);
  });

  it("does not let one conversation's tool slot delay another", async () => {
    process.env.LAWMIND_MAX_TOOL_CONCURRENCY = "1";
    const order: string[] = [];
    let releaseA: (() => void) | undefined;
    const a = withTurnToolSlot(
      () =>
        new Promise<void>((resolve) => {
          order.push("A");
          releaseA = resolve;
        }),
      { identity: { sessionId: "chat-a", kind: "parent" } },
    );
    const b = withTurnToolSlot(
      async () => {
        order.push("B");
      },
      { identity: { sessionId: "chat-b", kind: "parent" } },
    );
    await viWaitUntil(() => order.includes("A") && order.includes("B"));
    expect(order).toEqual(["A", "B"]);
    releaseA?.();
    await Promise.all([a, b]);
  });
});

async function viWaitUntil(predicate: () => boolean): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > 2_000) {
      throw new Error("timed out waiting for admission");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
