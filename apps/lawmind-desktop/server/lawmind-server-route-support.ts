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
  });
  res.end(buffer);
  return true;
}
