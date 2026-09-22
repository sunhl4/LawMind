/**
 * 支持诊断包路由（脱敏 zip）。
 *
 *   GET /api/support/bundle            → 预览：将包含哪些文件（不下载）
 *   GET /api/support/bundle?download=1 → 下载 zip
 *
 * 导出前律师须确认（前端按钮走确认对话框）；本路由本身只做脱敏与打包，
 * 不读取案件正文，不读取 `.env*`，不读取许可激活码。
 */

import { buildDiagnosticBundleFiles, isSafeBundleFileName } from "../../../src/lawmind/evaluation/diagnostic-bundle.js";
import { buildLawyerScorecard } from "../../../src/lawmind/evaluation/lawyer-scorecard.js";
import { summarizeProductMetrics } from "../../../src/lawmind/metrics/product-metrics.js";
import { buildNorthStarSnapshot, readNorthStarSnapshot } from "../../../src/lawmind/metrics/north-star.js";
import { readNorthStarTrend } from "../../../src/lawmind/metrics/north-star-trend.js";
import { resolveLicenseState } from "../../../src/lawmind/license/index.js";
import { buildAuthorityCorpusSummary } from "../../../src/lawmind/retrieval/authority-health.js";
import { isAuthorityLive, isAuthorityOfficialPublic } from "../../../src/lawmind/retrieval/authority-source-tier.js";
import { sendJson } from "./lawmind-server-helpers.js";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";

/**
 * 只摘可安全外发的状态事实：不给路径、不给端点、不给密钥。
 * 覆盖「支持方定位问题需要什么」而不是「Doctor 页面上有什么」。
 */
function safeDoctorFacts(): Record<string, unknown> {
  const license = resolveLicenseState();
  const authority = buildAuthorityCorpusSummary();
  return {
    license: {
      status: license.status,
      edition: license.edition,
      expiresAt: license.expiresAt,
      trialDaysLeft: license.trialDaysLeft,
      blocking: license.blocking,
    },
    authority: {
      provider: authority.provider,
      status: authority.status,
      configured: authority.configured,
      authConfigured: authority.authConfigured,
    },
  };
}

export async function handleSupportRoutes({
  ctx,
  pathname,
  req,
  res,
  url,
  c,
}: LawmindRouteContext): Promise<boolean> {
  if (pathname !== "/api/support/bundle") {
    return false;
  }
  if (req.method !== "GET") {
    return false;
  }
  const { workspaceDir } = ctx;
  const scorecard = buildLawyerScorecard(workspaceDir);
  const files = buildDiagnosticBundleFiles({
    workspaceDir,
    health: safeDoctorFacts(),
    metrics: {
      product: summarizeProductMetrics(workspaceDir),
      northStar: readNorthStarSnapshot(workspaceDir) ?? buildNorthStarSnapshot(workspaceDir),
      /**
       * 趋势（按周分桶）。**为什么必须一起带上**：单个快照只给「水平」，
       * 而水平会被案件难度分布、律师风格、产品改版同时污染——它证明不了任何事。
       * 「同一工作区的前后期对比」才是唯一能支撑「越用越省事」这个说法的证据形式。
       * 试点律师点一次诊断包，回传里就同时有水平与曲线，不必再让他手工导数据。
       */
      northStarTrend: readNorthStarTrend(workspaceDir),
    },
    scorecard,
    build: {
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      authorityLive: isAuthorityLive(),
      authorityOfficialPublic: isAuthorityOfficialPublic(),
      licenseStatus: resolveLicenseState().status,
    },
  }).filter((f) => isSafeBundleFileName(f.name));

  const wantsDownload = url.searchParams.get("download") === "1";
  if (!wantsDownload) {
    sendJson(
      res,
      200,
      {
        ok: true,
        files: files.map((f) => ({ name: f.name, bytes: Buffer.byteLength(f.content, "utf8") })),
        note: "本包已脱敏：不含 API Key、邮件密钥、许可激活码与案件正文。下载请加 ?download=1。",
      },
      c,
    );
    return true;
  }

  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  for (const file of files) {
    zip.file(file.name, file.content);
  }
  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  res.writeHead(200, {
    "content-type": "application/zip",
    "content-disposition": `attachment; filename="lawmind-diagnostics-${new Date()
      .toISOString()
      .slice(0, 10)}.zip"`,
    // ⚠️ 必须带上 CORS 头（`c`）：渲染层跑在 `http://127.0.0.1:5174`（打包后 `file://`），
    // 对本服务是**跨源**。缺了这几个头，浏览器会在几毫秒内直接拦掉响应，
    // 表现为 `TypeError: Failed to fetch` —— 而服务端其实已经 200 且把 zip 写完了。
    // 症状极具误导性：审计里能看到 `status:"error"` 且 `durationMs` 只有 4~8ms（不是超时），
    // 预览（`sendJson(..., c)`）却一切正常。**手写 writeHead 时不要漏 `...c`。**
    ...c,
  });
  res.end(buffer);
  return true;
}
