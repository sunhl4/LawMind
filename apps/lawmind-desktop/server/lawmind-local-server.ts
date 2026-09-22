/**
 * LawMind local HTTP API for desktop shell (loopback only: 127.0.0.1 + ::1, never LAN).
 *
 * 为什么是两个协议族：`localhost` 在 macOS 上同时解析到 `::1` 与 `127.0.0.1`，
 * WebKit / Word 任务窗格多半先试 `::1`。只绑 IPv4 会让 `http://localhost:<port>` 直接连不上。
 *
 * Env:
 * - LAWMIND_WORKSPACE_DIR (required)
 * - LAWMIND_DESKTOP_PORT (required)
 * - LAWMIND_ENV_FILE (optional path to .env.lawmind)
 * - LAWMIND_DESKTOP_ACTOR_ID (optional; default `lawyer:desktop`) — audit attribution for desktop review/agent
 * - LAWMIND_ENABLE_COLLABORATION (optional; default enabled) — set `false` to disable multi-assistant collaboration
 *
 * Optional workspace policy: `lawmind.policy.json` in the workspace root (see docs/archive/LAWMIND-POLICY-FILE.md).
 *
 * Run from monorepo root: node --import tsx apps/lawmind-desktop/server/lawmind-local-server.ts
 */

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { bootstrapLawMindDesktopEnv } from "./lawmind-desktop-env-bootstrap.js";
import { restoreDelegationsFromDisk } from "../../../src/lawmind/agent/collaboration/index.js";
import { ensureBuiltinWorkflowSeeds } from "../../../src/lawmind/agent/collaboration/ensure-workflow-seeds.js";
import { ensureBuiltinSkillSeeds } from "../../../src/lawmind/skills/ensure-builtin-skill-seeds.js";
import { resolveSkillSigningSecretSource } from "../../../src/lawmind/skills/skill-runtime.js";
import { startAuditExternalAnchorSync } from "../../../src/lawmind/audit/external-anchor.js";
import { loadAndApplyLawMindPolicy } from "./lawmind-policy.js";
import { corsHeaders, LAWMIND_LOCAL_HOST, LAWMIND_LOCAL_HOST_V6 } from "./lawmind-server-helpers.js";
import { lawmindHandleHttpRequest } from "./lawmind-server-dispatch.js";
import {
  ensureLoopbackBearerToken,
  hasDerivedCredentials,
  initLocalApiCredentialsFromEnv,
  initLoopbackBearerFromEnv,
} from "./lawmind-local-api-auth.js";
import { registerRateLimitBucket, TokenBucket } from "./lawmind-local-rate-limit.js";
import { getGlobalSseBus } from "./lawmind-sse-bus.js";
import {
  noteUncaughtException,
  noteUnhandledRejection,
} from "./lawmind-process-policy.js";
import {
  enqueueWorkflowRun,
  loadJobsFromDiskOnStartup,
  processDueScheduledJobs,
  setWorkflowJobSchedulerContext,
} from "./lawmind-server-jobs.js";
import { buildAgentConfig } from "./lawmind-server-helpers.js";
import {
  getSearchIndexStatus,
  indexExists,
  rebuildWorkspaceSearchIndex,
} from "../../../src/lawmind/indexing/index.js";
import { computeSearchIndexFreshness } from "../../../src/lawmind/indexing/fts-search.js";
import { readWorkspacePolicyFile } from "../../../src/lawmind/policy/workspace-policy.js";
import { processDueLawyerAutomations } from "../../../src/lawmind/platform/lawyer-automations-runner.js";
import { processDueDeadlineReminders } from "../../../src/lawmind/desk/deadline-remind.js";
import {
  clearDaemonPid,
  getDaemonStatus,
  markDaemonStarted,
  markDaemonTick,
  stopDaemonProcess,
} from "../../../src/lawmind/platform/lawmind-daemon.js";
import {
  instantiateCollaborationWorkflowFromTemplate,
  readWorkspaceWorkflowTemplate,
} from "../../../src/lawmind/agent/collaboration/workspace-workflow-templates.js";
import { resolveLawMindRoot } from "../../../src/lawmind/assistants/store.js";
import { isWordAddinAutoRunEnabled } from "../../../src/lawmind/policy/edition.js";
import { listMatterIds as listWorkspaceMatterIds } from "../../../src/lawmind/cases/index.js";
import { tickWordAddinAutoRun, setWordAddinAutoRunWaker } from "./lawmind-server-word-addin-runner.js";
import { startMatterReplicaAutoSync } from "../../../src/lawmind/matter-replica/sync-scheduler.js";
import { setMatterReplicaScheduler } from "./lawmind-server-matter-replica-scheduler.js";
import { syncMatterWithCloud } from "../../../src/lawmind/matter-cloud/index.js";

async function main() {
  const daemonMode = process.env.LAWMIND_DAEMON === "1";
  const workspaceDir = process.env.LAWMIND_WORKSPACE_DIR?.trim();
  const portRaw = process.env.LAWMIND_DESKTOP_PORT?.trim();
  const envFileRaw = process.env.LAWMIND_ENV_FILE?.trim();
  const envFile = envFileRaw || undefined;

  if (!workspaceDir || (!daemonMode && !portRaw)) {
    console.error("LAWMIND_WORKSPACE_DIR and LAWMIND_DESKTOP_PORT are required");
    process.exit(1);
  }

  const port = Number(portRaw);
  if (!daemonMode && (!Number.isFinite(port) || port < 1 || port > 65535)) {
    console.error("Invalid LAWMIND_DESKTOP_PORT");
    process.exit(1);
  }

  fs.mkdirSync(workspaceDir, { recursive: true });

  if (!daemonMode) {
    try {
      stopDaemonProcess(workspaceDir);
    } catch {
      /* desktop owns ticks while the window is open */
    }
  }

  if (daemonMode) {
    const existing = getDaemonStatus(workspaceDir);
    if (existing.running && existing.pid !== process.pid) {
      console.error(`[lawmindd] already running pid=${existing.pid}`);
      process.exit(0);
    }
    markDaemonStarted(workspaceDir, process.pid);
    const stop = () => {
      if (getDaemonStatus(workspaceDir).pid === process.pid) {
        clearDaemonPid(workspaceDir);
      }
      process.exit(0);
    };
    process.on("SIGTERM", stop);
    process.on("SIGINT", stop);
  }
  // 先把 .env.lawmind 加载进 process.env，再动任何「要读密钥」的事情。
  // 顺序是硬约束：`ensureBuiltinSkillSeeds` 会用签名密钥签 SKILL.sig，而消费方
  // （listLocalSkills → skill-match / read_skill）用**加载后**的密钥验签；
  // 若 seed 跑在 env 之前，签的是 `derived` 兜底值，验签必然不通过 ⇒ Skill 静默失效。
  const { userEnvPath } = bootstrapLawMindDesktopEnv({
    workspaceDir,
    envFile,
    repoRoot: process.env.LAWMIND_REPO_ROOT,
  });

  const wfSeed = ensureBuiltinWorkflowSeeds(workspaceDir);
  if (wfSeed.created.length > 0) {
    console.error(
      `[lawmind-local-server] seeded workflow templates: ${wfSeed.created.join(", ")}`,
    );
  }
  // 显式把「此刻解析出来的密钥」交给 seed，避免它自己去猜来源（见上面的顺序约束）。
  const skillSecret = resolveSkillSigningSecretSource(workspaceDir);
  if (skillSecret.source === "derived") {
    console.error(
      "[lawmind-local-server] 警告：未配置 Skill 签名密钥，正在用「按工作区路径派生」的兜底值。" +
        "它不是秘密，任何知道该路径的人都能伪造 SKILL.md + SKILL.sig；打包部署请设 " +
        "LAWMIND_SKILL_SIGNING_SECRET（见 docs/lawmind/LAWMIND-SKILLS-SIGNING.md）。",
    );
  }
  const skillSeed = ensureBuiltinSkillSeeds(workspaceDir, { secret: skillSecret.secret });
  if (skillSeed.created.length > 0 || skillSeed.upgraded.length > 0) {
    console.error(
      `[lawmind-local-server] seeded skills: created=${skillSeed.created.join(",") || "—"} upgraded=${skillSeed.upgraded.join(",") || "—"}`,
    );
  }

  // 桌面端默认开启全轮次 token 流式，便于对话区展示模型真实输出（Cursor 式）
  if (!process.env.LAWMIND_STRICT_TOOL_STREAM?.trim()) {
    process.env.LAWMIND_STRICT_TOOL_STREAM = "0";
  }

  const policy = loadAndApplyLawMindPolicy(workspaceDir);

  restoreDelegationsFromDisk(workspaceDir);
  loadJobsFromDiskOnStartup(workspaceDir);

  setWorkflowJobSchedulerContext((ws) => {
    const built = buildAgentConfig(ws, { envFile });
    return built.config ?? null;
  });
  const tickScheduled = () => {
    try {
      processDueScheduledJobs(workspaceDir);
    } catch {
      /* best-effort */
    }
    try {
      const built = buildAgentConfig(workspaceDir, { envFile });
      const config = built.config;
      void processDueLawyerAutomations(workspaceDir, {
        envFile,
        lawMindRoot: resolveLawMindRoot(workspaceDir, envFile),
        enqueueTemplate: ({ templateId, matterId, instruction, automationId }) => {
          if (!config) {
            return null;
          }
          ensureBuiltinWorkflowSeeds(workspaceDir);
          const template = readWorkspaceWorkflowTemplate(workspaceDir, templateId);
          if (!template) {
            return null;
          }
          const workflow = instantiateCollaborationWorkflowFromTemplate(template, {
            matterId,
            createdBy: "lawyer_automation",
            vars: instruction?.trim()
              ? { instruction: instruction.trim(), automationId }
              : { automationId },
          });
          return enqueueWorkflowRun(config, workflow, {
            templateId,
            workflowVars: instruction?.trim()
              ? { instruction: instruction.trim(), automationId }
              : { automationId },
            idempotencyKey: `automation:${automationId}:${new Date().toISOString().slice(0, 13)}`,
          });
        },
      }).catch((err) => {
        console.error(
          "[lawmind-local-server] automations tick failed:",
          err instanceof Error ? err.message : err,
        );
      });
    } catch {
      /* best-effort */
    }
    try {
      processDueDeadlineReminders(workspaceDir);
    } catch {
      /* best-effort */
    }
    tickWordAddin();
  };

  /**
   * Word 插件自动取件：按 tick 领一条 queued 请求跑固定流水线。
   * 开关关闭时不再领新请求（人工档行为不变），但仍会清理卡住的孤儿运行——
   * 否则律师在跑的过程中关掉开关，那条请求会永远停在「正在审查…」。
   */
  const tickWordAddin = (): void => {
    try {
      const config = buildAgentConfig(workspaceDir, { envFile }).config;
      const enabled = isWordAddinAutoRunEnabled({ policy: readWorkspacePolicyFile(workspaceDir) });
      void tickWordAddinAutoRun({
        workspaceDir,
        autoRunEnabled: enabled && Boolean(config),
        actorId: config?.actorId ?? "lawyer:desktop",
        listMatterIds: () => listWorkspaceMatterIds(workspaceDir),
        enqueue: ({ workflow, requestId, grantedDir }) => {
          if (!config) {
            return null;
          }
          // 源文件可能在工作区外（桌面/下载目录）：把它的目录作为本次运行的本机文件夹，
          // 之后 render_tracked_draft 才能读写源文件同目录。仅本次运行，不落常驻授权。
          const runConfig = grantedDir ? { ...config, projectDir: grantedDir } : config;
          return enqueueWorkflowRun(runConfig, workflow, {
            idempotencyKey: `word-addin:${requestId}`,
          });
        },
      });
    } catch {
      /* best-effort：插件侧零影响 */
    }
  };
  setWordAddinAutoRunWaker(() => {
     tickWordAddin();
  });
  const autoRebuildSearchIndexIfStale = () => {
    try {
      // policy 门禁（默认关）：searchIndexAutoRebuild=true 才允许过期自动轻量重建。
      const policy = readWorkspacePolicyFile(workspaceDir);
      if (policy?.searchIndexAutoRebuild !== true) {
        return;
      }
      const status = getSearchIndexStatus(workspaceDir);
      if (!computeSearchIndexFreshness(status).stale) {
        return;
      }
      void rebuildWorkspaceSearchIndex(workspaceDir).catch(() => {
        /* best-effort */
      });
    } catch {
      /* best-effort */
    }
  };

  const tickScheduledWithIndex = () => {
    tickScheduled();
    if (daemonMode) {
      try {
        markDaemonTick(workspaceDir);
      } catch {
        /* best-effort */
      }
    }
    autoRebuildSearchIndexIfStale();
  };
  tickScheduledWithIndex();
  const scheduleTimer = setInterval(tickScheduledWithIndex, 30_000);
  scheduleTimer.unref?.();

  // 案件副本自动同步（Firm/Private 默认开，Solo 关闭）：同事丢进的材料不用手点就会出现。
  const replicaAutoSync = startMatterReplicaAutoSync({
    workspaceDir,
    // 云感知：自动同步也要把云侧名册拉成本地投影并补发钥匙，否则新成员要等手动同步
    sync: async (ws, matterId) => {
      const r = await syncMatterWithCloud(ws, matterId);
      return {
        pulled: r.sync.pulled,
        applied: { locks: r.sync.applied.locks, members: r.sync.applied.members },
        materials: {
          downloadedFiles: r.sync.materials.downloadedFiles,
          deletedLocally: r.sync.materials.deletedLocally,
          rejectedIntegrity: r.sync.materials.rejectedIntegrity,
        },
      };
    },
    onOutcome: (o) => {
      if (!o.ok) {
        console.error(
          `[lawmind-local-server] 案件副本自动同步失败 matter=${o.matterId}: ${o.error ?? "unknown"}`,
        );
      }
    },
  });
  setMatterReplicaScheduler(replicaAutoSync);

  const externalAnchorUrl = process.env.LAWMIND_AUDIT_EXTERNAL_ANCHOR_URL?.trim();
  if (externalAnchorUrl) {
    // 每日同步最新审计摘要到外部锚；emit 路径已实时触发，此定时器覆盖静默日。
    const anchorSync = startAuditExternalAnchorSync(
      path.join(workspaceDir, "audit"),
      externalAnchorUrl,
    );
    anchorSync.syncNow().catch(() => {
      /* 失败只告警，不阻断启动 */
    });
  }

  if (!indexExists(workspaceDir)) {
    void rebuildWorkspaceSearchIndex(workspaceDir).catch(() => {
      /* best-effort background index */
    });
  }

  if (daemonMode) {
    console.error(`[lawmindd] workspace=${workspaceDir} pid=${process.pid}`);
    return;
  }

  initLoopbackBearerFromEnv();
  initLocalApiCredentialsFromEnv();
  if (!process.env.LAWMIND_LOCAL_API_TOKEN?.trim() && !hasDerivedCredentials()) {
    ensureLoopbackBearerToken();
  }

  const ctx = { workspaceDir, envFile, userEnvPath, policy, sseBus: getGlobalSseBus() };
  const rateBucket = new TokenBucket({ rate: 100, capacity: 200 });
  registerRateLimitBucket(rateBucket);

  // 两个监听（IPv4 / IPv6 回环）共用同一个 handler 与同一个限流桶。
  const handleRequest = (req: http.IncomingMessage, res: http.ServerResponse): void => {
    if (!rateBucket.tryConsume(1)) {
      // 限流响应也要带 CORS 头，否则浏览器侧拿不到错误体（只看到网络错误）。
      res.writeHead(429, { "content-type": "application/json", ...corsHeaders(req.headers.origin) });
      res.end(JSON.stringify({ ok: false, error: "rate_limited" }));
      return;
    }
    void lawmindHandleHttpRequest(ctx, req, res);
  };

  const server = http.createServer(handleRequest);
  // `localhost` 在 macOS 上同时解析到 `::1` 与 `127.0.0.1`，WebKit（Word 任务窗格）多半先试 `::1`。
  // 只绑 IPv4 时，用 `http://localhost:<port>` 打开的客户会连不上，Word 里报「无法加载该加载项」。
  // 所以同一个 handler 再挂一个 IPv6 回环监听；仍是回环，不对局域网暴露。
  const serverV6 = http.createServer(handleRequest);
  serverV6.on("error", (err) => {
    // best-effort：内核无 IPv6、端口被占、权限不足都不该阻断主服务启动。
    console.error(
      `[lawmind-local-server] IPv6 回环监听失败（主服务不受影响）: ${err instanceof Error ? err.message : String(err)}`,
    );
  });

  server.listen(port, LAWMIND_LOCAL_HOST, () => {
    console.error(`[lawmind-local-server] http://${LAWMIND_LOCAL_HOST}:${port} workspace=${workspaceDir}`);
  });
  serverV6.listen(port, LAWMIND_LOCAL_HOST_V6, () => {
    console.error(
      `[lawmind-local-server] http://[${LAWMIND_LOCAL_HOST_V6}]:${port} (IPv6 回环，供 localhost 解析) workspace=${workspaceDir}`,
    );
  });
}

process.on("uncaughtException", (err) => {
  console.error("[lawmind-local-server] uncaughtException:", err);
  noteUncaughtException();
  // 状态可能已损坏：记录后干净退出，交给 Electron 监督层指数退避重启
  // （取舍说明见 lawmind-process-policy.ts 顶部）。
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  // 可用性优先的故意取舍：记录 + 计入健康信号（doctor.process.degraded），不退出。
  console.error("[lawmind-local-server] unhandledRejection:", reason);
  noteUnhandledRejection();
});

void main();
