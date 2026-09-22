/**
 * Word 插件（就地审查）。
 *
 * - GET  /word-addin/manifest.xml          侧载清单（{{BASE}} 按本次请求的实际回环地址替换）
 * - GET  /word-addin/taskpane.html|.js|.css 任务窗格静态资源
 * - GET  /word-addin/icon-32.png           清单图标
 * - GET  /api/word-addin/reviews           就地审查请求列表（?state=&since=）
 * - POST /api/word-addin/reviews           { path, matterId?, instruction? } 建请求（审这份）
 * - GET  /api/word-addin/reviews/:id       单条状态（插件轮询）
 * - POST /api/word-addin/reviews/:id/result  桌面端回填：{ task_id } 或 { outputPath, hunks, ... }
 * - POST /api/word-addin/reviews/:id/export  导出：返回产物路径与存在性
 *
 * 静态资源不带 bearer（Word 取页面时还没有令牌），但仍在回环 Host 校验之后；
 * 令牌只注入到发给回环地址的页面里。所有数据面都在 /api/word-addin/*，走统一鉴权。
 */

import fs from "node:fs";
import type http from "node:http";
import { loadMatter } from "../../../src/lawmind/adapters/matter-storage/index.js";
import { listMatterIds } from "../../../src/lawmind/cases/index.js";
import {
  resolveWordAddinDir,
  renderWordAddinTemplate,
  wordAddinIconPng,
  wordAddinMimeFor,
  WORD_ADDIN_VENDOR_REL,
  type WordAddinTemplateVars,
} from "../../../src/lawmind/integrations/word-addin/addin-assets.js";import {
  createWordAddinReview,
  hunksFromRedlineProposal,
  listWordAddinReviews,
  normalizeWordSourcePath,
  pickWordAddinReviewForDocument,
  readWordAddinReview,
  resolveWordAddinAssetPath,
  updateWordAddinReview,
  type WordAddinReviewState,
} from "../../../src/lawmind/integrations/word-addin/review-requests.js";
import {
  credentialForClient,
  getLocalApiEpoch,
  getLocalApiInstanceId,
} from "./lawmind-local-api-auth.js";
import { loopbackBaseFromRequest, readJsonBody, sendJson } from "./lawmind-server-helpers.js";
import { wakeWordAddinAutoRun } from "./lawmind-server-word-addin-runner.js";
import { isWordAddinAutoRunEnabled } from "../../../src/lawmind/policy/edition.js";
import { readWorkspacePolicyFile } from "../../../src/lawmind/policy/workspace-policy.js";
import type { LawmindDispatchContext, LawmindRouteContext } from "./lawmind-server-route-types.js";

const ADDIN_PREFIX = "/word-addin/";
const REVIEWS_PATH = "/api/word-addin/reviews";
const WORD_ADDIN_MATTERS_PATH = "/api/word-addin/matters";

const VALID_STATES: ReadonlyArray<WordAddinReviewState> = [
  "queued",
  "running",
  "ready",
  "failed",
  "needs_matter",
  "stale",
  "superseded",
];

function asState(value: string | null): WordAddinReviewState | undefined {
  if (!value) {
    return undefined;
  }
  return (VALID_STATES as readonly string[]).includes(value)
    ? (value as WordAddinReviewState)
    : undefined;
}

function baseFromRequest(req: http.IncomingMessage): string {
  return loopbackBaseFromRequest(req);
}

/**
 * 侧载期最需要的一条事实：**Word 到底有没有来取过这个页面、走的是哪个地址/协议族**。
 *
 * 只有这一条能区分两种完全不同的失败：
 * - 没有这条日志 → Word 的 webview 根本没发出请求（URL 方案 / 主机名不被接受，或压根没读到清单）；
 * - 有这条日志 → 页面确实被取走了，问题在页面里（CSP、Office.js、初始化超时）。
 *
 * 只记 `/word-addin/*` 静态面：请求量是「一次窗格打开几条」，不会淹没在 4 秒一次的轮询里。
 */
export function formatWordAddinAccessLine(input: {
  method: string;
  pathname: string;
  host?: string | undefined;
  remoteAddress?: string | undefined;
  userAgent?: string | undefined;
}): string {
  const ua = (input.userAgent ?? "-").replace(/\s+/g, " ").trim().slice(0, 160) || "-";
  const family = input.remoteAddress?.includes(":") ? "ipv6" : "ipv4";
  return `[word-addin] ${input.method} ${input.pathname} host=${input.host ?? "-"} remote=${input.remoteAddress ?? "-"} (${family}) ua="${ua}"`;
}

function logAddinStaticFetch(req: http.IncomingMessage, pathname: string): void {
  const rawHost = req.headers.host;
  const rawUa = req.headers["user-agent"];
  console.error(
    formatWordAddinAccessLine({
      method: req.method ?? "-",
      pathname,
      host: Array.isArray(rawHost) ? rawHost[0] : rawHost,
      remoteAddress: req.socket?.remoteAddress,
      userAgent: Array.isArray(rawUa) ? rawUa[0] : rawUa,
    }),
  );
}

/**
 * 回环基址 + **本插件专属凭据**（只发给回环来源的页面与同源 config.js）。
 *
 * 凭据按 clientId=`word-addin` 派生（见 `electron/local-api-credentials.mjs`），
 * 于是：① 它随安装密钥持久 ⇒ 桌面端重启后这个窗格仍然可用（不必再人工重载）；
 * ② 服务端验签后知道「来的是插件」⇒ 审计可归属、且只放行 `/api/word-addin/*`。
 * `epoch` / `instanceId` 一并下发，供窗格做陈旧检测与自愈。
 */
function addinVars(ctx: LawmindDispatchContext, req: http.IncomingMessage): WordAddinTemplateVars {
  return {
    base: baseFromRequest(req),
    token: credentialForClient("word-addin"),
    clientId: "word-addin",
    epoch: getLocalApiEpoch(),
    instanceId: getLocalApiInstanceId(),
    // 插件与桌面端必须是同一个口径：读工作区的 policy 文件，而不是看渲染端状态。
    autoRun: isWordAddinAutoRunEnabled({ policy: readWorkspacePolicyFile(ctx.workspaceDir) }),
  };
}

function parseReviewId(
  pathname: string,
): { id: string; action?: "result" | "export" | "matter" } | null {
  const m = /^\/api\/word-addin\/reviews\/([^/]+)(?:\/(result|export|matter))?$/.exec(pathname);
  if (!m) {
    return null;
  }
  const id = decodeURIComponent(m[1] ?? "");
  if (!id) {
    return null;
  }
  const action = m[2];
  return {
    id,
    ...(action === "result" || action === "export" || action === "matter" ? { action } : {}),
  };
}

function sendAddinAsset(
  res: http.ServerResponse,
  c: Record<string, string>,
  fileName: string,
  contentType: string,
  body: Buffer | string,
): void {
  res.writeHead(200, {
    "content-type": contentType,
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    ...(fileName.endsWith(".png") ? {} : {}),
    ...c,
  });
  res.end(body);
}

async function handleAddinStatic(
  // 注意：这里是**派发上下文**（唯一的调用点只传了 ctx，没传 route context）。
  // 原先标注成 LawmindRouteContext 是笔误，会让后来的读者以为这里拿得到 res/url/c。
  ctx: LawmindDispatchContext,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  pathname: string,
): Promise<boolean> {
  // 插件静态资源与页面同源取用，不需要 CORS 头（与既有行为一致）。
  const assetHeaders: Record<string, string> = {};
  if (!pathname.startsWith(ADDIN_PREFIX)) {
    return false;
  }
  if (req.method === "GET") {
    logAddinStaticFetch(req, pathname);
  }
  if (req.method !== "GET") {
    sendJson(res, 405, { ok: false, error: "method_not_allowed" }, assetHeaders);
    return true;
  }
  const rel = pathname.slice(ADDIN_PREFIX.length);
  if (rel === "icon-32.png") {
    sendAddinAsset(res, assetHeaders, "icon-32.png", "image/png", wordAddinIconPng());
    return true;
  }
  if (rel === "config.js") {
    // 配置走同源脚本，而不是页面里的内联 <script>：Word 任务窗格启用 CSP，
    // 内联脚本会被 script-src 挡掉（令牌与 base 变成空 → 401）。同源 'self' 本来就放行。
    const vars = addinVars(ctx, req);
    sendAddinAsset(
      res,
      assetHeaders,
      "config.js",
      "text/javascript; charset=utf-8",
      `window.LAWMIND_ADDIN = ${JSON.stringify(vars)};\n`,
    );
    return true;
  }
  // manifest.xml 由模板 + 实际回环地址生成；其余静态文件原样（页面内注入令牌）。
  const file = rel === "manifest.xml" ? "manifest.template.xml" : rel;
  const addinDir = resolveWordAddinDir();
  if (!addinDir) {
    sendJson(
      res,
      503,
      {
        ok: false,
        error: "word_addin_assets_missing",
        hint: `未找到 Word 插件资源目录（${WORD_ADDIN_VENDOR_REL}）。开发态请确认仓库完整；打包版请确认 extraResources 已含 word-addin。`,
      },
      assetHeaders,
    );
    return true;
  }
  const resolved = resolveWordAddinAssetPath(addinDir, file);
  if (!resolved.ok) {
    sendJson(res, 400, { ok: false, error: resolved.error }, assetHeaders);
    return true;
  }
  if (!fs.existsSync(resolved.abs)) {
    sendJson(res, 404, { ok: false, error: "asset_not_found" }, assetHeaders);
    return true;
  }
  const mime = wordAddinMimeFor(file);
  if (!mime) {
    sendJson(res, 415, { ok: false, error: "unsupported_asset_type" }, assetHeaders);
    return true;
  }
  const raw = fs.readFileSync(resolved.abs, "utf8");
  const body = renderWordAddinTemplate(raw, addinVars(ctx, req));
  sendAddinAsset(res, assetHeaders, file, mime, body);
  return true;
}

export async function handleWordAddinRoutes({
  ctx,
  req,
  res,
  url,
  pathname,
  c,
  clientId,
}: LawmindRouteContext): Promise<boolean> {
  if (await handleAddinStatic(ctx, req, res, pathname)) {
    return true;
  }

  if (pathname === WORD_ADDIN_MATTERS_PATH && req.method === "GET") {
    // 任务窗格选案卷用：只回 id + 标题，不回案卷正文。
    // 用 `listMatterIds`（= 桌面「本案列表」同一份真相：matters/ 存储 + cases/ 文件夹 + 任务归属），
    // 否则只有 cases/<id>/ 文件夹的案卷在下拉里选不到，律师就卡在 needs_matter 出不去。
    const matterIds = await listMatterIds(ctx.workspaceDir);
    const items = matterIds
      .map((matterId) => {
        // loadMatter 对损坏的 matter.json 会抛 zod 错（调用方一律 try/catch）。
        // 单个案卷文件坏掉不能让整个下拉 500——那样律师就选不出案卷、卡在 needs_matter。
        try {
          const rec = loadMatter(ctx.workspaceDir, matterId);
          return { matterId, title: rec?.title?.trim() || matterId };
        } catch {
          return { matterId, title: matterId };
        }
      })
      .toSorted((a, b) => a.title.localeCompare(b.title, "zh-CN"));
    sendJson(res, 200, { ok: true, items }, c);
    return true;
  }

  if (pathname === REVIEWS_PATH && req.method === "GET") {
    const state = asState(url.searchParams.get("state"));
    const since = url.searchParams.get("since")?.trim() || undefined;
    const rawPath = url.searchParams.get("path")?.trim() || undefined;
    const sourcePath = rawPath ? normalizeWordSourcePath(rawPath) : undefined;
    if (sourcePath && !sourcePath.ok) {
      sendJson(res, 400, { ok: false, error: sourcePath.error }, c);
      return true;
    }
    const items = listWordAddinReviews(ctx.workspaceDir, {
      ...(state ? { state } : {}),
      ...(since ? { since } : {}),
      ...(sourcePath?.ok ? { sourcePath: sourcePath.abs } : {}),
    });
    // 按文档问的时候顺带给「该看哪一条」：规则在引擎侧（可测），插件不自己判断。
    const picked = sourcePath?.ok ? pickWordAddinReviewForDocument(items) : undefined;
    sendJson(res, 200, { ok: true, items, ...(picked ? { picked } : {}) }, c);
    return true;
  }

  if (pathname === REVIEWS_PATH && req.method === "POST") {
    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch {
      sendJson(res, 400, { ok: false, error: "invalid_json" }, c);
      return true;
    }
    const record = (body ?? {}) as Record<string, unknown>;
    const created = await createWordAddinReview(ctx.workspaceDir, {
      sourcePath: record.path ?? record.sourcePath,
      matterId: record.matterId,
      instruction: record.instruction,
      // 记下这条请求是谁送来的：取件时原样抄进授权留痕（谁 / 从哪来 成对）。
      clientId,
    });
    if (!created.ok) {
      sendJson(res, 400, { ok: false, error: created.error }, c);
      return true;
    }
    // 幂等：同一文件同一内容同指令若已在途，直接接回那条（200），不新建（201）。
    sendJson(
      res,
      created.reused ? 200 : 201,
      { ok: true, request: created.request, ...(created.reused ? { reused: true } : {}) },
      c,
    );
    // 自动取件：不要等下一个 30s tick，立刻领一次（串行闸保证不会并发跑两条）。
    wakeWordAddinAutoRun();
    return true;
  }

  const parsed = parseReviewId(pathname);

  if (parsed?.action === "matter" && req.method === "POST") {
    // 律师在 Word 窗格里选完案卷：把请求放回队首，由自动取件接着跑。
    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch {
      sendJson(res, 400, { ok: false, error: "invalid_json" }, c);
      return true;
    }
    const record = (body ?? {}) as Record<string, unknown>;
    const matterId = typeof record.matterId === "string" ? record.matterId.trim() : "";
    const existing = readWordAddinReview(ctx.workspaceDir, parsed.id);
    if (!existing) {
      sendJson(res, 404, { ok: false, error: "not_found" }, c);
      return true;
    }
    if (existing.state !== "needs_matter") {
      sendJson(res, 409, { ok: false, error: `not_awaiting_matter:${existing.state}` }, c);
      return true;
    }
    if (!matterId || !(await listMatterIds(ctx.workspaceDir)).includes(matterId)) {
      sendJson(res, 400, { ok: false, error: "unknown_matter" }, c);
      return true;
    }
    const updated = await updateWordAddinReview(ctx.workspaceDir, parsed.id, {
      state: "queued",
      matterId,
    });
    if (!updated.ok) {
      sendJson(res, 400, { ok: false, error: updated.error }, c);
      return true;
    }
    wakeWordAddinAutoRun();
    sendJson(res, 200, { ok: true, request: updated.request }, c);
    return true;
  }

  if (parsed && req.method === "GET" && !parsed.action) {
    const request = readWordAddinReview(ctx.workspaceDir, parsed.id);    if (!request) {
      sendJson(res, 404, { ok: false, error: "not_found" }, c);
      return true;
    }
    sendJson(res, 200, { ok: true, request }, c);
    return true;
  }

  if (parsed?.action === "result" && req.method === "POST") {
    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch {
      sendJson(res, 400, { ok: false, error: "invalid_json" }, c);
      return true;
    }
    const record = (body ?? {}) as Record<string, unknown>;
    const existing = readWordAddinReview(ctx.workspaceDir, parsed.id);
    if (!existing) {
      sendJson(res, 404, { ok: false, error: "not_found" }, c);
      return true;
    }

    let hunks = Array.isArray(record.hunks)
      ? (record.hunks as Array<{ find?: unknown; replace?: unknown; note?: unknown }>)
          .filter(
            (h) => typeof h?.find === "string" && h.find.length > 0 && typeof h.replace === "string",
          )
          .map((h) => ({
            find: String(h.find),
            replace: String(h.replace),
            ...(typeof h.note === "string" && h.note ? { note: h.note } : {}),
          }))
      : undefined;
    let skippedSectionHunks =
      typeof record.skippedSectionHunks === "number" ? record.skippedSectionHunks : undefined;
    let summary = typeof record.summary === "string" ? record.summary : undefined;
    let outputPath = typeof record.outputPath === "string" ? record.outputPath.trim() : undefined;

    // 桌面端常用口径：跑完审查后直接给草稿 taskId，锚点从 Redline 提案取。
    const taskId = typeof record.task_id === "string" ? record.task_id.trim() : "";
    if (taskId) {
      const { readRedlineProposal, redlineProposalPath } =
        await import("../../../src/lawmind/drafts/redline-proposal.js");
      const proposal = readRedlineProposal(ctx.workspaceDir, taskId);
      if (!proposal) {
        sendJson(res, 400, { ok: false, error: "redline_proposal_not_found" }, c);
        return true;
      }
      const derived = hunksFromRedlineProposal(proposal);
      hunks = derived.hunks;
      skippedSectionHunks = derived.skippedSectionHunks;
      if (!summary) {
        summary = `来自草稿 ${taskId}`;
      }
      if (!outputPath) {
        const rel = redlineProposalPath(ctx.workspaceDir, taskId).replace(/\.redline\.json$/, "");
        outputPath = rel;
      }
    }

    const state =
      asState(typeof record.state === "string" ? record.state : null) ??
      (typeof record.error === "string" && record.error.trim() ? "failed" : "ready");
    const updated = await updateWordAddinReview(ctx.workspaceDir, parsed.id, {
      state,
      ...(outputPath ? { outputPath } : {}),
      ...(hunks ? { hunks } : {}),
      ...(skippedSectionHunks !== undefined ? { skippedSectionHunks } : {}),
      ...(summary ? { summary } : {}),
      ...(typeof record.error === "string" && record.error.trim() ? { error: record.error } : {}),
    });
    if (!updated.ok) {
      sendJson(res, 400, { ok: false, error: updated.error }, c);
      return true;
    }
    sendJson(res, 200, { ok: true, request: updated.request }, c);
    return true;
  }

  if (parsed?.action === "export" && req.method === "POST") {
    const request = readWordAddinReview(ctx.workspaceDir, parsed.id);
    if (!request) {
      sendJson(res, 404, { ok: false, error: "not_found" }, c);
      return true;
    }
    const outputPath = request.outputPath ?? "";
    const exists = Boolean(outputPath) && fs.existsSync(outputPath);
    sendJson(
      res,
      200,
      {
        ok: true,
        outputPath: outputPath || null,
        exists,
        ...(outputPath && !exists
          ? { hint: "桌面端登记的产物路径当前不存在（可能被移动或重命名）。" }
          : {}),
        ...(outputPath ? {} : { hint: "桌面端尚未产出修订稿；请先在桌面端完成这次审查。" }),
      },
      c,
    );
    return true;
  }

  return false;
}
