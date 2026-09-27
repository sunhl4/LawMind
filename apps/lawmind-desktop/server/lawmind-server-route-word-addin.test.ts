import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createWordAddinReview,
  updateWordAddinReview,
} from "../../../src/lawmind/integrations/word-addin/review-requests.js";
import {
  formatWordAddinAccessLine,
  handleWordAddinRoutes,
} from "./lawmind-server-route-word-addin.js";
import type { LawmindDispatchContext } from "./lawmind-server-route-types.js";

function mockRes(): http.ServerResponse & {
  body?: unknown;
  raw?: string;
  status?: number;
  headers?: unknown;
} {
  const res = {
    status: 200,
    body: undefined as unknown,
    raw: undefined as string | undefined,
    headers: undefined as unknown,
    writeHead(code: number, headers?: unknown) {
      this.status = code;
      this.headers = headers;
    },
    end(payload?: string) {
      this.raw = payload;
      if (typeof payload === "string" && payload.trim().startsWith("{")) {
        try {
          this.body = JSON.parse(payload);
        } catch {
          this.body = undefined;
        }
      }
    },
  } as http.ServerResponse & {
    body?: unknown;
    raw?: string;
    status?: number;
    headers?: unknown;
  };
  return res;
}

function getReq(host = "localhost:52100"): http.IncomingMessage {
  return { method: "GET", headers: { host } } as http.IncomingMessage;
}

function postReq(body: unknown, host = "localhost:52100"): http.IncomingMessage {
  const req = { method: "POST", headers: { host, "content-type": "application/json" } } as
    http.IncomingMessage & { on?: unknown };
  Object.assign(req, {
    on(event: string, handler: (...args: unknown[]) => void) {
      if (event === "data") {
        handler(Buffer.from(JSON.stringify(body)));
      }
      if (event === "end") {
        handler();
      }
      return this;
    },
  });
  return req;
}

async function call(
  ctx: LawmindDispatchContext,
  opts: { pathname: string; method?: "GET" | "POST"; body?: unknown; host?: string; query?: string },
) {
  const res = mockRes();
  const handled = await handleWordAddinRoutes({
    ctx,
    req: opts.method === "POST" ? postReq(opts.body, opts.host) : getReq(opts.host),
    res,
    url: new URL(`http://localhost${opts.pathname}${opts.query ?? ""}`),
    pathname: opts.pathname,
    c: {},
  });
  return { handled, res };
}

describe("word addin routes", () => {
  let workspaceDir: string;
  let ctx: LawmindDispatchContext;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "lm-word-addin-route-"));
    ctx = {
      workspaceDir,
      envFile: undefined,
      userEnvPath: path.join(workspaceDir, ".env.lawmind"),
      policy: { loaded: false, policy: null },
    };
  });

  afterEach(async () => {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  it("serves the task pane without any inline script, and never leaks the token into it", async () => {
    const { handled, res } = await call(ctx, { pathname: "/word-addin/taskpane.html" });
    expect(handled).toBe(true);
    expect(res.status).toBe(200);
    expect((res.headers as Record<string, string>)["content-type"]).toContain("text/html");
    const html = res.raw ?? "";
    // 端口来自请求 Host，不写死。
    expect(html).toContain("http://localhost:52100");
    expect(html).not.toContain("{{BASE}}");
    expect(html).not.toContain("{{TOKEN}}");
    // Word 任务窗格启用 CSP：内联 <script> 会被 script-src 挡掉，令牌必须走同源脚本。
    expect(html).toContain("按本所标准审这份");
    expect(html).not.toContain("记到案卷");
    expect(html).not.toContain("btn-review");
    expect(html).not.toMatch(/<script(?![^>]*\ssrc=)/);
    expect(html).toContain("http://localhost:52100/word-addin/config.js");
    expect(html).not.toMatch(/[0-9a-f]{64}/);
    // 顺序有意义：配置必须先于任务窗格脚本执行。
    expect(html.indexOf("/word-addin/config.js")).toBeLessThan(
      html.indexOf("/word-addin/taskpane.js"),
    );
  });

  it("serves base + token from a same-origin config.js", async () => {
    const { handled, res } = await call(ctx, { pathname: "/word-addin/config.js" });
    expect(handled).toBe(true);
    expect(res.status).toBe(200);
    expect((res.headers as Record<string, string>)["content-type"]).toContain("text/javascript");
    const body = res.raw ?? "";
    const match = /^window\.LAWMIND_ADDIN = (\{.*\});$/m.exec(body.trim());
    expect(match).not.toBeNull();
    const config = JSON.parse(match?.[1] ?? "{}") as {
      base?: string;
      token?: string;
      autoRun?: boolean;
      standardName?: string;
    };
    expect(config.base).toBe("http://localhost:52100");
    expect(config.token).toMatch(/^[0-9a-f]{64}$/);
    // 默认 edition（solo）自动开跑：任务窗格据此选文案，不能猜。
    expect(config.autoRun).toBe(true);
    expect(config.standardName).toBe("中立偏委托方（开箱默认）");
  });

  it("tells the pane to use manual wording when this machine requires a desk-side confirm", async () => {
    // firm edition 默认关（不需要显式写 policy 字段）。
    await fs.writeFile(
      path.join(workspaceDir, "lawmind.policy.json"),
      JSON.stringify({ schemaVersion: 1, edition: "firm" }),
      "utf8",
    );
    const { res } = await call(ctx, { pathname: "/word-addin/config.js" });
    const config = JSON.parse(
      /^window\.LAWMIND_ADDIN = (\{.*\});$/m.exec((res.raw ?? "").trim())?.[1] ?? "{}",
    ) as { autoRun?: boolean };
    expect(config.autoRun).toBe(false);
  });

  it("lets the workspace policy turn auto-run back on for a firm install", async () => {
    await fs.writeFile(
      path.join(workspaceDir, "lawmind.policy.json"),
      JSON.stringify({ schemaVersion: 1, edition: "firm", wordAddinAutoRun: true }),
      "utf8",
    );
    const { res } = await call(ctx, { pathname: "/word-addin/config.js" });
    const config = JSON.parse(
      /^window\.LAWMIND_ADDIN = (\{.*\});$/m.exec((res.raw ?? "").trim())?.[1] ?? "{}",
    ) as { autoRun?: boolean };
    expect(config.autoRun).toBe(true);
  });

  it("renders the manifest for the requesting loopback port", async () => {
    const res = mockRes();
    await handleWordAddinRoutes({
      ctx,
      req: getReq("127.0.0.1:54321"),
      res,
      url: new URL("http://127.0.0.1:54321/word-addin/manifest.xml"),
      pathname: "/word-addin/manifest.xml",
      c: {},
    });
    expect(res.status).toBe(200);
    const body = res.raw ?? "";
    expect(body).toContain("http://127.0.0.1:54321/word-addin/taskpane.html");
    expect(body).not.toContain("{{BASE}}");
  });

  it("serves the icon as a png", async () => {
    const res = mockRes();
    await handleWordAddinRoutes({
      ctx,
      req: getReq(),
      res,
      url: new URL("http://localhost/word-addin/icon-32.png"),
      pathname: "/word-addin/icon-32.png",
      c: {},
    });
    expect(res.status).toBe(200);
    expect((res.headers as Record<string, string>)["content-type"]).toBe("image/png");
  });

  it("refuses traversal out of the add-in directory", async () => {
    const { res } = await call(ctx, { pathname: "/word-addin/../package.json" });
    expect([400, 404, 415]).toContain(res.status);
  });

  it("runs the review lifecycle: queue → result (with hunks) → export", async () => {
    const docx = path.join(workspaceDir, "合同.docx");
    await fs.writeFile(docx, "placeholder", "utf8");

    const created = await call(ctx, {
      pathname: "/api/word-addin/reviews",
      method: "POST",
      body: { path: docx },
    });
    expect(created.res.status).toBe(201);
    const request = (created.res.body as { request: { id: string; state: string } }).request;
    expect(request.state).toBe("queued");

    const listed = await call(ctx, { pathname: "/api/word-addin/reviews" });
    expect((listed.res.body as { items: unknown[] }).items).toHaveLength(1);

    const attached = await call(ctx, {
      pathname: `/api/word-addin/reviews/${request.id}/result`,
      method: "POST",
      body: {
        outputPath: path.join(workspaceDir, "合同_01.docx"),
        hunks: [{ find: "十日内", replace: "五个工作日内" }],
        summary: "审查完成",
      },
    });
    expect(attached.res.status).toBe(200);
    const ready = (attached.res.body as { request: { state: string; hunks: unknown[] } }).request;
    expect(ready.state).toBe("ready");
    expect(ready.hunks).toHaveLength(1);

    const exported = await call(ctx, {
      pathname: `/api/word-addin/reviews/${request.id}/export`,
      method: "POST",
      body: {},
    });
    expect(exported.res.status).toBe(200);
    expect(exported.res.body).toMatchObject({ ok: true, exists: false });
  });

  it("derives hunks from a draft's redline proposal when given task_id", async () => {
    const docx = path.join(workspaceDir, "保密协议.docx");
    await fs.writeFile(docx, "placeholder", "utf8");
    const created = await call(ctx, {
      pathname: "/api/word-addin/reviews",
      method: "POST",
      body: { path: docx },
    });
    const request = (created.res.body as { request: { id: string } }).request;

    const draftsDir = path.join(workspaceDir, "drafts");
    await fs.mkdir(draftsDir, { recursive: true });
    await fs.writeFile(
      path.join(draftsDir, "t-review.redline.json"),
      JSON.stringify({
        taskId: "t-review",
        baselineSections: [],
        updatedAt: new Date().toISOString(),
        hunks: [
          {
            hunkId: "h1",
            sectionIndex: 0,
            before: "十日内",
            after: "五个工作日内",
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
        ],
      }),
      "utf8",
    );

    const attached = await call(ctx, {
      pathname: `/api/word-addin/reviews/${request.id}/result`,
      method: "POST",
      body: { task_id: "t-review" },
    });
    expect(attached.res.status).toBe(200);
    const ready = (
      attached.res.body as {
        request: { state: string; hunks: Array<{ find: string }>; skippedSectionHunks: number };
      }
    ).request;
    expect(ready.state).toBe("ready");
    // 最短改动：两个 hunk 都只交出真正变动的字（共有的「日内」「整节」留在修订轨之外），
    // 没有 hunk 因为「整节粒度」被丢弃。
    expect(ready.hunks.map((h) => h.find)).toEqual(["十", "旧"]);
    expect(ready.skippedSectionHunks).toBe(0);
  });

  it("lists matters for the task pane picker (id + title only)", async () => {
    await fs.mkdir(path.join(workspaceDir, "matters", "甲案"), { recursive: true });
    await fs.mkdir(path.join(workspaceDir, "cases", "乙案"), { recursive: true });
    const { handled, res } = await call(ctx, { pathname: "/api/word-addin/matters" });
    expect(handled).toBe(true);
    expect(res.status).toBe(200);
    const items = (res.body as { items: Array<{ matterId: string; title: string }> }).items;
    // cases/ 与 matters/ 都要列出来：只读 matters/ 会让只有文件夹的案卷选不到。
    expect(items.map((i) => i.matterId).toSorted()).toEqual(["乙案", "甲案"].toSorted());
    expect(items.every((i) => typeof i.title === "string" && i.title.length > 0)).toBe(true);
  });

  it("still lists every matter when one matter.json is corrupt", async () => {
    await fs.mkdir(path.join(workspaceDir, "matters", "坏案卷"), { recursive: true });
    await fs.writeFile(
      path.join(workspaceDir, "matters", "坏案卷", "matter.json"),
      "{ not valid json at all",
      "utf8",
    );
    await fs.mkdir(path.join(workspaceDir, "cases", "好案卷"), { recursive: true });
    const { res } = await call(ctx, { pathname: "/api/word-addin/matters" });
    // 一个坏文件不能让下拉 500——否则律师连案卷都选不了。
    expect(res.status).toBe(200);
    const items = (res.body as { items: Array<{ matterId: string }> }).items;
    expect(items.map((i) => i.matterId).toSorted()).toEqual(["好案卷", "坏案卷"].toSorted());
  });

  it("lets the lawyer pick a matter in Word and puts the request back in the queue", async () => {
    await fs.mkdir(path.join(workspaceDir, "matters", "甲案"), { recursive: true });
    const docx = path.join(workspaceDir, "outside.docx");
    await fs.writeFile(docx, "placeholder", "utf8");
    const created = await call(ctx, {
      pathname: "/api/word-addin/reviews",
      method: "POST",
      body: { path: docx },
    });
    const request = (created.res.body as { request: { id: string } }).request;
    // 自动取件判定不出案卷时写回的状态。
    await updateWordAddinReview(ctx.workspaceDir, request.id, {
      state: "needs_matter",
      matterCandidates: ["甲案"],
      note: "请选一个案卷。",
    });

    const picked = await call(ctx, {
      pathname: `/api/word-addin/reviews/${request.id}/matter`,
      method: "POST",
      body: { matterId: "甲案" },
    });
    expect(picked.res.status).toBe(200);
    expect(
      (picked.res.body as { request: { state: string; matterId?: string } }).request,
    ).toMatchObject({ state: "queued", matterId: "甲案" });

    const listed = await call(ctx, {
      pathname: "/api/word-addin/reviews",
      query: "?state=needs_matter",
    });
    expect((listed.res.body as { items: unknown[] }).items).toHaveLength(0);
  });

  it("refuses an unknown matter and a request that is not awaiting a matter", async () => {
    const docx = path.join(workspaceDir, "a.docx");
    await fs.writeFile(docx, "placeholder", "utf8");
    const created = await call(ctx, {
      pathname: "/api/word-addin/reviews",
      method: "POST",
      body: { path: docx },
    });
    const request = (created.res.body as { request: { id: string } }).request;

    // 还在 queued：不是「等选案卷」的状态。
    const early = await call(ctx, {
      pathname: `/api/word-addin/reviews/${request.id}/matter`,
      method: "POST",
      body: { matterId: "甲案" },
    });
    expect(early.res.status).toBe(409);

    await updateWordAddinReview(ctx.workspaceDir, request.id, { state: "needs_matter" });
    const unknown = await call(ctx, {
      pathname: `/api/word-addin/reviews/${request.id}/matter`,
      method: "POST",
      body: { matterId: "不存在的案卷" },
    });
    expect(unknown.res.status).toBe(400);
    expect((unknown.res.body as { error: string }).error).toBe("unknown_matter");
  });

  it("is idempotent: clicking 审这份 twice on the same in-flight file reuses one request", async () => {
    // 真机复现的时序：POST#1 立刻被自动取件领成 running，POST#2 才到。
    const docx = path.join(workspaceDir, "幂等合同.docx");
    await fs.writeFile(docx, "placeholder bytes", "utf8");
    const first = await call(ctx, {
      pathname: "/api/word-addin/reviews",
      method: "POST",
      body: { path: docx },
    });
    expect(first.res.status).toBe(201);
    const firstId = (first.res.body as { request: { id: string } }).request.id;

    const second = await call(ctx, {
      pathname: "/api/word-addin/reviews",
      method: "POST",
      body: { path: docx },
    });
    expect(second.res.status).toBe(200);
    const body = second.res.body as { request: { id: string }; reused?: boolean };
    expect(body.reused).toBe(true);
    expect(body.request.id).toBe(firstId);

    const listed = await call(ctx, { pathname: "/api/word-addin/reviews" });
    expect((listed.res.body as { items: unknown[] }).items).toHaveLength(1);
  });

  it("does not reuse when the file content changed after the click", async () => {
    const docx = path.join(workspaceDir, "改后合同.docx");
    await fs.writeFile(docx, "placeholder bytes", "utf8");
    const first = await call(ctx, {
      pathname: "/api/word-addin/reviews",
      method: "POST",
      body: { path: docx },
    });
    const firstId = (first.res.body as { request: { id: string } }).request.id;
    // 律师改了文件再点 → 必须重新审，不能接到旧基线上。
    await fs.writeFile(docx, "different bytes now", "utf8");
    const second = await call(ctx, {
      pathname: "/api/word-addin/reviews",
      method: "POST",
      body: { path: docx },
    });
    expect(second.res.status).toBe(201);
    expect((second.res.body as { request: { id: string } }).request.id).not.toBe(firstId);
  });

  it("rejects non-Word or relative paths", async () => {
    const bad = await call(ctx, {
      pathname: "/api/word-addin/reviews",
      method: "POST",
      body: { path: "合同.docx" },
    });
    expect(bad.res.status).toBe(400);
  });

  it("does not claim a route it does not own", async () => {
    const { handled } = await call(ctx, { pathname: "/api/memory/adoption" });
    expect(handled).toBe(false);
  });
});

/**
 * 侧载期唯一能自证「Word 有没有来取页面」的日志。格式契约写死在测试里：
 * 换行/超长 UA 不能把日志搞成多行，host 与协议族必须留得住。
 */
describe("word addin access log line", () => {
  it("keeps host, address family and user agent on one line", () => {
    const line = formatWordAddinAccessLine({
      method: "GET",
      pathname: "/word-addin/taskpane.html",
      host: "localhost:54881",
      remoteAddress: "::1",
      userAgent: "Mozilla/5.0 (Macintosh) Word/16.109",
    });
    expect(line).toBe(
      '[word-addin] GET /word-addin/taskpane.html host=localhost:54881 remote=::1 (ipv6) ua="Mozilla/5.0 (Macintosh) Word/16.109"',
    );
    expect(line.split("\n")).toHaveLength(1);
  });

  it("labels IPv4 fetches and never emits a raw newline from the UA", () => {
    const line = formatWordAddinAccessLine({
      method: "GET",
      pathname: "/word-addin/manifest.xml",
      host: "127.0.0.1:54881",
      remoteAddress: "127.0.0.1",
      userAgent: "evil\nua\r\nlog",
    });
    expect(line).toContain("remote=127.0.0.1 (ipv4)");
    expect(line).toContain('ua="evil ua log"');
    expect(line.split("\n")).toHaveLength(1);
  });

  it("tolerates a missing socket / headers without throwing", () => {
    const line = formatWordAddinAccessLine({ method: "GET", pathname: "/word-addin/taskpane.js" });
    expect(line).toBe('[word-addin] GET /word-addin/taskpane.js host=- remote=- (ipv4) ua="-"');
  });
});

describe("word addin suggestion decisions", () => {
  let workspaceDir: string;
  let ctx: LawmindDispatchContext;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "lm-word-addin-decision-route-"));
    ctx = {
      workspaceDir,
      envFile: undefined,
      userEnvPath: path.join(workspaceDir, ".env.lawmind"),
      policy: { loaded: false, policy: null },
    };
  });

  afterEach(async () => {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  it("stores a suggestion decision and refuses to discard one already applied", async () => {
    const file = path.join(workspaceDir, "合同.docx");
    await fs.writeFile(file, "十日内付款。");
    const created = await createWordAddinReview(workspaceDir, { sourcePath: file });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }
    await updateWordAddinReview(workspaceDir, created.request.id, {
      state: "ready",
      outputPath: file,
      hunks: [{ find: "十日内", replace: "五个工作日内" }],
    });
    const saved = await call(ctx, {
      method: "POST",
      pathname: `/api/word-addin/reviews/${created.request.id}/decisions`,
      body: { index: 0, status: "applied" },
    });
    expect(saved.res.status).toBe(200);
    const undone = await call(ctx, {
      method: "POST",
      pathname: `/api/word-addin/reviews/${created.request.id}/decisions`,
      body: { index: 0, status: "discarded" },
    });
    expect(undone.res.status).toBe(409);
  });
});
