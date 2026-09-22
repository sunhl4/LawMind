import fs from "node:fs";
import type http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import JSZip from "jszip";
import { handleSupportRoutes } from "./lawmind-server-route-support.js";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";

function captureRes() {
  let status = 0;
  const chunks: Buffer[] = [];
  const headers: Record<string, string> = {};
  const res = {
    writeHead(s: number, h?: Record<string, string>) {
      status = s;
      if (h) {
        Object.assign(headers, h);
      }
      return res;
    },
    end(chunk?: string | Buffer) {
      if (chunk) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      return res;
    },
  } as unknown as http.ServerResponse;
  return {
    res,
    headers,
    get status() {
      return status;
    },
    buffer() {
      return Buffer.concat(chunks);
    },
    json() {
      return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
    },
  };
}

describe("support bundle route", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  function ctxFor(workspaceDir: string): LawmindRouteContext {
    return {
      ctx: {
        workspaceDir,
        envFile: undefined,
        userEnvPath: path.join(workspaceDir, ".env.lawmind"),
        policy: { loaded: false },
      } as unknown as LawmindRouteContext["ctx"],
      c: {},
    } as unknown as LawmindRouteContext;
  }

  it("previews the file list without downloading", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-support-"));
    dirs.push(ws);
    const cap = captureRes();
    const base = ctxFor(ws);
    const handled = await handleSupportRoutes({
      ...base,
      pathname: "/api/support/bundle",
      req: { method: "GET" } as http.IncomingMessage,
      res: cap.res,
      url: new URL("http://127.0.0.1/api/support/bundle"),
    } as unknown as LawmindRouteContext);
    expect(handled).toBe(true);
    expect(cap.status).toBe(200);
    const body = cap.json();
    const names = (body.files as Array<{ name: string }>).map((f) => f.name);
    expect(names).toContain("doctor.json");
    expect(names).toContain("scorecard.json");
    expect(String(body.note)).toContain("已脱敏");
  });

  it("downloads a zip whose entries are the redacted bundle files", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-support-"));
    dirs.push(ws);
    const cap = captureRes();
    const base = ctxFor(ws);
    await handleSupportRoutes({
      ...base,
      pathname: "/api/support/bundle",
      req: { method: "GET" } as http.IncomingMessage,
      res: cap.res,
      url: new URL("http://127.0.0.1/api/support/bundle?download=1"),
    } as unknown as LawmindRouteContext);
    expect(cap.status).toBe(200);
    expect(cap.headers["content-type"]).toBe("application/zip");
    const zip = await JSZip.loadAsync(cap.buffer());
    const names = Object.keys(zip.files).toSorted();
    expect(names).toEqual([
      "README.txt",
      "build.json",
      "doctor.json",
      "metrics.json",
      "scorecard.json",
    ]);
    const doctor = (await zip.file("doctor.json")?.async("string")) ?? "";
    expect(doctor).toContain("license");
    // 脱敏：不含密钥字段原文。
    expect(doctor).not.toMatch(/sk-[A-Za-z0-9]/);
  });

  /**
   * 诊断包必须同时带**水平**与**趋势**。
   *
   * 为什么这条值得单独锁：试点律师点一次诊断包回传，是我们拿到真实证据的**唯一通道**。
   * 只带单个快照的话，回传里只有「一次通过 78%」这种水平值——而水平值会被案件难度、
   * 律师风格、产品改版同时污染，证明不了「越用越省事」。缺了趋势，这次回传就白费了。
   */
  /**
   * **跨源二进制响应必须带 CORS 头**（2026-09-22 真机故障的根因）。
   *
   * 渲染层跑在 `http://127.0.0.1:5174`（打包后 `file://`），对本服务是跨源。
   * 手写 `res.writeHead` 时若漏掉 `...c`，浏览器会在几毫秒内拦掉响应 →
   * 界面显示「无法连接本地服务」，而服务端其实已经 200 并把 zip 写完了。
   *
   * 症状指纹（下次遇到可以直接认出来）：审计里 `status:"error"` + `durationMs` 只有几毫秒
   * （**不是超时**），且**同一路径的 JSON 预览正常** —— 差别只在响应头。
   */
  it("诊断包**下载**响应必须转发调度层给的 CORS 头（否则跨源 fetch 会被浏览器拦掉）", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-support-cors-"));
    dirs.push(ws);
    const cap = captureRes();
    const base = ctxFor(ws);
    // 模拟调度层：它用 `corsHeaders(origin)` 算好 CORS 头放进 `c`（`lawmind-server-dispatch.ts:55`）。
    // 本路由的职责是**原样转发**；漏 `...c` 就是这次的故障。
    const corsFromDispatcher = {
      "access-control-allow-origin": "http://127.0.0.1:5174",
      "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      "access-control-allow-headers": "Content-Type, Authorization",
    };
    await handleSupportRoutes({
      ...base,
      c: corsFromDispatcher,
      pathname: "/api/support/bundle",
      req: { method: "GET" } as http.IncomingMessage,
      res: cap.res,
      url: new URL("http://127.0.0.1/api/support/bundle?download=1"),
    } as unknown as LawmindRouteContext);

    expect(cap.status).toBe(200);
    expect(cap.headers["content-type"]).toBe("application/zip");
    for (const [name, value] of Object.entries(corsFromDispatcher)) {
      expect(
        cap.headers[name],
        `下载响应丢了 ${name}：渲染层跨源 fetch 会被浏览器直接拦掉（Failed to fetch，几毫秒内失败）`,
      ).toBe(value);
    }
  });

  it("metrics.json 里同时有水平快照与按周趋势（趋势不可省）", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-support-metrics-"));
    dirs.push(ws);
    const cap = captureRes();
    const base = ctxFor(ws);
    await handleSupportRoutes({
      ...base,
      pathname: "/api/support/bundle",
      req: { method: "GET" } as http.IncomingMessage,
      res: cap.res,
      url: new URL("http://127.0.0.1/api/support/bundle?download=1"),
    } as unknown as LawmindRouteContext);

    const zip = await JSZip.loadAsync(cap.buffer());
    const metrics = JSON.parse((await zip.file("metrics.json")?.async("string")) ?? "{}") as {
      northStar?: { samples?: { deliveries?: number } };
      northStarTrend?: { windowDays?: number; buckets?: unknown[]; trendUnavailableReason?: string };
    };
    expect(metrics.northStar).toBeTruthy();
    expect(metrics.northStarTrend).toBeTruthy();
    expect(metrics.northStarTrend?.windowDays).toBeGreaterThan(0);
    expect(Array.isArray(metrics.northStarTrend?.buckets)).toBe(true);
    // 没样本时也必须给**原因**，不能只留一个空的 trend:null。
    expect(metrics.northStarTrend?.trendUnavailableReason).toBeTruthy();
  });

  it("returns false for other paths", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-support-"));
    dirs.push(ws);
    const cap = captureRes();
    const base = ctxFor(ws);
    const handled = await handleSupportRoutes({
      ...base,
      pathname: "/api/other",
      req: { method: "GET" } as http.IncomingMessage,
      res: cap.res,
      url: new URL("http://127.0.0.1/api/other"),
    } as unknown as LawmindRouteContext);
    expect(handled).toBe(false);
  });
});
