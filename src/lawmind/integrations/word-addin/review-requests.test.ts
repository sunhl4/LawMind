import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RedlineHunk } from "../../drafts/redline-proposal.js";
import { attachWordAddinResultForSource } from "./attach-result.js";
import {
  createWordAddinReview,
  fingerprintWordFile,
  hunksFromRedlineProposal,
  listWordAddinReviews,
  recordWordAddinSuggestionDecision,
  normalizeWordSourcePath,
  pickWordAddinReviewForDocument,
  readWordAddinReview,
  resolveWordAddinAssetPath,
  updateWordAddinReview,
  type WordAddinReviewState,
} from "./review-requests.js";

describe("word addin review requests", () => {
  let workspaceDir: string;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "lm-word-addin-"));
  });

  afterEach(async () => {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  it("hashes bytes past the old 256 KiB head so a tail edit is stale", async () => {
    const file = path.join(workspaceDir, "合同.docx");
    const body = Buffer.alloc(300 * 1024, 1);
    await fs.writeFile(file, body);
    const before = fingerprintWordFile(file);
    body[body.length - 1] = 2;
    await fs.writeFile(file, body);
    const after = fingerprintWordFile(file);
    expect(before?.hash).toBeTruthy();
    expect(after?.hash).not.toBe(before?.hash);
    expect(after?.size).toBe(before?.size);
  });

  it("refuses paths that are not absolute Word files", () => {
    expect(normalizeWordSourcePath("").ok).toBe(false);
    expect(normalizeWordSourcePath("relative/合同.docx").ok).toBe(false);
    expect(normalizeWordSourcePath("/tmp/../../etc/passwd").ok).toBe(false);
    expect(normalizeWordSourcePath("/tmp/合同.pdf").ok).toBe(false);
    const ok = normalizeWordSourcePath("/tmp/合同.docx");
    expect(ok.ok).toBe(true);
  });

  it("queues a request without touching the source file", async () => {
    const created = await createWordAddinReview(workspaceDir, {
      sourcePath: "/tmp/某案/合作协议.docx",
      matterId: "m-1",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }
    expect(created.request.state).toBe("queued");
    expect(created.request.fileName).toBe("合作协议.docx");
    expect(created.request.instruction).toContain("最短锚点");
    const listed = listWordAddinReviews(workspaceDir);
    expect(listed.map((r) => r.id)).toEqual([created.request.id]);
    expect(readWordAddinReview(workspaceDir, created.request.id)?.matterId).toBe("m-1");
  });

  it("refuses to mark ready without a usable result", async () => {
    const created = await createWordAddinReview(workspaceDir, { sourcePath: "/tmp/a.docx" });
    if (!created.ok) {
      throw new Error("seed failed");
    }
    const bad = await updateWordAddinReview(workspaceDir, created.request.id, { state: "ready" });
    expect(bad.ok).toBe(false);
    const good = await updateWordAddinReview(workspaceDir, created.request.id, {
      state: "ready",
      outputPath: "/tmp/a_2026-09-20_01.docx",
      hunks: [{ find: "十日内", replace: "五个工作日内" }],
    });
    expect(good.ok).toBe(true);
    if (good.ok) {
      expect(good.request.state).toBe("ready");
      expect(good.request.hunks).toHaveLength(1);
    }
  });

  it("reports a missing request instead of inventing one", async () => {
    const res = await updateWordAddinReview(workspaceDir, "waddin-nope", { state: "running" });
    expect(res.ok).toBe(false);
  });

  it("carries the independent reviewer's gaps into the pane note (advisory must not be silent)", async () => {
    const created = await createWordAddinReview(workspaceDir, { sourcePath: "/tmp/甲/合同.docx" });
    if (!created.ok) {
      throw new Error("seed failed");
    }
    await attachWordAddinResultForSource({
      workspaceDir,
      sourceAbs: "/tmp/甲/合同.docx",
      outputPath: "/tmp/甲/合同_01.docx",
      hunks: [],
      guardian: {
        verdict: "fail",
        gaps: [
          { code: "residual_unfair_payment_clause", message: "第二条实质缺陷未消除。" },
          { code: "jurisdiction_clause_ambiguous", message: "管辖约定不明确。" },
        ],
      },
    });
    const row = readWordAddinReview(workspaceDir, created.request.id);
    expect(row?.state).toBe("ready");
    expect(row?.note).toContain("独立审稿提示 2 处（首条）");
    expect(row?.note).toContain("第二条实质缺陷未消除");
  });

  it("carries a partial-apply notice so the pane does not look like a full success", async () => {
    const created = await createWordAddinReview(workspaceDir, { sourcePath: "/tmp/丙/合同.docx" });
    if (!created.ok) {
      throw new Error("seed failed");
    }
    await attachWordAddinResultForSource({
      workspaceDir,
      sourceAbs: "/tmp/丙/合同.docx",
      outputPath: "/tmp/丙/合同_01.docx",
      hunks: [
        {
          hunkId: "h",
          sectionIndex: 0,
          before: "十日内",
          after: "五个工作日内",
          status: "pending",
        },
      ],
      partialHunks: { applied: 1, attempted: 3 },
    });
    const row = readWordAddinReview(workspaceDir, created.request.id);
    expect(row?.state).toBe("ready");
    expect(row?.note).toContain("本次叠加 1/3 处修订");
    expect(row?.note).toContain("2 处原文未匹配");
  });

  it("stays silent when the reviewer passed", async () => {
    const created = await createWordAddinReview(workspaceDir, { sourcePath: "/tmp/乙/合同.docx" });
    if (!created.ok) {
      throw new Error("seed failed");
    }
    await attachWordAddinResultForSource({
      workspaceDir,
      sourceAbs: "/tmp/乙/合同.docx",
      outputPath: "/tmp/乙/合同_01.docx",
      hunks: [
        {
          hunkId: "h",
          sectionIndex: 0,
          before: "十日内",
          after: "五个工作日内",
          status: "pending",
        },
      ],
      guardian: { verdict: "pass", gaps: [] },
    });
    expect(readWordAddinReview(workspaceDir, created.request.id)?.note).toBeUndefined();
  });

  it("finds the request for one document only (Word 窗格重载后接回)", async () => {
    const a = await createWordAddinReview(workspaceDir, { sourcePath: "/tmp/甲案/合同.docx" });
    await createWordAddinReview(workspaceDir, { sourcePath: "/tmp/乙案/保密协议.docx" });
    if (!a.ok) {
      throw new Error("seed failed");
    }
    const hits = listWordAddinReviews(workspaceDir, { sourcePath: "/tmp/甲案/合同.docx" });
    expect(hits.map((r) => r.id)).toEqual([a.request.id]);
  });

  it("picks the ready result for the pane even when a newer request is queued", async () => {
    const ready = await createWordAddinReview(workspaceDir, { sourcePath: "/tmp/甲案/合同.docx" });
    if (!ready.ok) {
      throw new Error("seed failed");
    }
    await updateWordAddinReview(workspaceDir, ready.request.id, {
      state: "ready",
      hunks: [{ find: "十日内", replace: "五个工作日内" }],
    });
    await createWordAddinReview(workspaceDir, { sourcePath: "/tmp/甲案/合同.docx" });

    const items = listWordAddinReviews(workspaceDir, { sourcePath: "/tmp/甲案/合同.docx" });
    expect(items).toHaveLength(2);
    expect(pickWordAddinReviewForDocument(items)?.id).toBe(ready.request.id);
  });

  it("filters by state and updated-at cursor", async () => {
    const a = await createWordAddinReview(workspaceDir, { sourcePath: "/tmp/a.docx" });
    const b = await createWordAddinReview(workspaceDir, { sourcePath: "/tmp/b.docx" });
    if (!a.ok || !b.ok) {
      throw new Error("seed failed");
    }
    await updateWordAddinReview(workspaceDir, a.request.id, { state: "running" });
    expect(listWordAddinReviews(workspaceDir, { state: "queued" }).map((r) => r.id)).toEqual([
      b.request.id,
    ]);
    // 游标语义：只回「比游标更新」的条目（增量轮询用）。
    const cursor = readWordAddinReview(workspaceDir, a.request.id)?.updatedAt ?? "";
    expect(listWordAddinReviews(workspaceDir, { since: cursor }).map((r) => r.id)).toEqual([]);
    const earlier = new Date(Date.parse(a.request.createdAt) - 1000).toISOString();
    expect(
      listWordAddinReviews(workspaceDir, { since: earlier }).some((r) => r.id === a.request.id),
    ).toBe(true);
  });
});

describe("pickWordAddinReviewForDocument", () => {
  const row = (id: string, state: WordAddinReviewState, createdAt: string) => ({
    id,
    state,
    createdAt,
  });

  it("prefers a finished result over a newer empty queue entry", () => {
    // 真机踩到的坑：律师又点了一次「审这份」，新排的空请求盖住了已有结果。
    const picked = pickWordAddinReviewForDocument([
      row("new-queued", "queued", "2026-09-20T03:21:08.000Z"),
      row("older-ready", "ready", "2026-09-20T03:06:50.000Z"),
    ]);
    expect(picked?.id).toBe("older-ready");
  });

  it("takes the newest ready when several finished", () => {
    const picked = pickWordAddinReviewForDocument([
      row("ready-old", "ready", "2026-09-19T00:00:00.000Z"),
      row("ready-new", "ready", "2026-09-20T00:00:00.000Z"),
    ]);
    expect(picked?.id).toBe("ready-new");
  });

  it("falls back to the newest entry when nothing finished yet", () => {
    const picked = pickWordAddinReviewForDocument([
      row("queued-old", "queued", "2026-09-19T00:00:00.000Z"),
      row("running-new", "running", "2026-09-20T00:00:00.000Z"),
    ]);
    expect(picked?.id).toBe("running-new");
  });

  it("returns nothing for an empty list", () => {
    expect(pickWordAddinReviewForDocument([])).toBeUndefined();
  });
});

describe("hunksFromRedlineProposal", () => {
  it("keeps surgical hunks, minimizes section hunks, and drops rejected ones", () => {
    const hunks: RedlineHunk[] = [
      {
        hunkId: "h1",
        sectionIndex: 0,
        sectionHeading: "第三条 付款",
        before: "十日内",
        after: "五个工作日内",
        rationale: "与商务口径一致",
        status: "pending",
        granularity: "surgical",
      },
      {
        hunkId: "h2",
        sectionIndex: 1,
        before: "整节旧文",
        after: "整节新文",
        status: "pending",
        granularity: "section",
      },
      {
        hunkId: "h3",
        sectionIndex: 2,
        before: "已拒绝",
        after: "不该出现",
        status: "rejected",
        granularity: "surgical",
      },
    ];
    const result = hunksFromRedlineProposal({ hunks });
    expect(result.hunks).toEqual([
      {
        find: "十",
        replace: "五个工作",
        hunkId: "h1",
        note: "与商务口径一致",
        where: "第三条 付款",
      },
      { find: "旧", replace: "新", hunkId: "h2" },
    ]);
    // 整节粒度不再直接丢弃：重算后能就地落的就落，落不了的才计数。
    expect(result.skippedSectionHunks).toBe(0);
  });

  it("把整节 hunk 也重算成多处最短锚点（保留文字不进修订轨）", () => {
    const result = hunksFromRedlineProposal({
      hunks: [
        {
          hunkId: "h1",
          sectionIndex: 0,
          before: "甲方应当在收到发票之日起十日内付款。",
          after: "乙方应当在收到发票之日起五个工作日内付款。",
          status: "pending",
          granularity: "section",
        },
      ],
    });
    // 不整节删写：两处最短改动，且没有任何一处的锚点里夹着没动的字。
    expect(result.skippedSectionHunks).toBe(0);
    expect(result.hunks.map((h) => `${h.find}→${h.replace}`)).toEqual(["甲→乙", "十→五个工作"]);
    for (const hunk of result.hunks) {
      expect(hunk.find).not.toContain("应当在收到发票之日起");
    }
  });

  it("纯插入改成「锚点整体替换」，一个字都不删", () => {
    const result = hunksFromRedlineProposal({
      hunks: [
        {
          hunkId: "h1",
          sectionIndex: 0,
          before: "赔偿甲方的实际损失。",
          after: "赔偿甲方的实际损失，但累计赔偿总额不超过该项目已付软件费用。",
          status: "pending",
          granularity: "surgical",
        },
      ],
    });
    expect(result.skippedSectionHunks).toBe(0);
    // find 变成插入点之后的短锚点；replace = 插入内容 + 锚点 → Word 只见插入。
    expect(result.hunks[0]?.find).toBe("。");
    expect(result.hunks[0]?.replace).toBe("，但累计赔偿总额不超过该项目已付软件费用。");
  });

  it("重算后仍超过 60 字的整段替换不上插件", () => {
    const before = "甲".repeat(80);
    const after = "乙".repeat(80);
    const result = hunksFromRedlineProposal({
      hunks: [
        {
          hunkId: "h1",
          sectionIndex: 0,
          before,
          after,
          status: "pending",
          granularity: "section",
        },
      ],
    });
    expect(result.skippedSectionHunks).toBe(1);
    expect(result.hunks).toEqual([]);
  });
});

describe("recordWordAddinSuggestionDecision", () => {
  let workspaceDir: string;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "lm-word-addin-decision-"));
  });

  afterEach(async () => {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  it("remembers a decision and refuses to discard one already written", async () => {
    const file = path.join(workspaceDir, "合同.docx");
    await fs.writeFile(file, "十日内付款。");
    const created = await createWordAddinReview(workspaceDir, { sourcePath: file });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }
    const ready = await updateWordAddinReview(workspaceDir, created.request.id, {
      state: "ready",
      outputPath: file,
      hunks: [{ find: "十日内", replace: "五个工作日内", where: "第三条 付款" }],
    });
    expect(ready.ok).toBe(true);
    const saved = recordWordAddinSuggestionDecision({
      workspaceDir,
      id: created.request.id,
      index: 0,
      status: "applied",
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) {
      return;
    }
    expect(saved.request.decisions).toEqual({ "0": "applied" });
    const again = recordWordAddinSuggestionDecision({
      workspaceDir,
      id: created.request.id,
      index: 0,
      status: "discarded",
    });
    expect(again).toEqual({ ok: false, error: "already_applied" });
    expect(readWordAddinReview(workspaceDir, created.request.id)?.decisions).toEqual({
      "0": "applied",
    });
  });
});

describe("resolveWordAddinAssetPath", () => {
  const root = "/tmp/lawmind-word-addin";

  it("allows files inside the add-in directory", () => {
    const res = resolveWordAddinAssetPath(root, "taskpane.html");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.abs).toBe(path.join(root, "taskpane.html"));
    }
  });

  it("rejects traversal and sibling paths", () => {
    expect(resolveWordAddinAssetPath(root, "../secrets.txt").ok).toBe(false);
    expect(resolveWordAddinAssetPath(root, "a/../../b.js").ok).toBe(false);
  });
});
