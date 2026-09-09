/**
 * LawMind local HTTP API for desktop shell (bind 127.0.0.1 only).
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
import { bootstrapLawMindDesktopEnv } from "./lawmind-desktop-env-bootstrap.js";
import { restoreDelegationsFromDisk } from "../../../src/lawmind/agent/collaboration/index.js";
import { ensureBuiltinWorkflowSeeds } from "../../../src/lawmind/agent/collaboration/ensure-workflow-seeds.js";
import { ensureBuiltinSkillSeeds } from "../../../src/lawmind/skills/ensure-builtin-skill-seeds.js";
import { startAuditExternalAnchorSync } from "../../../src/lawmind/audit/external-anchor.js";
import { loadAndApplyLawMindPolicy } from "./lawmind-policy.js";
import { corsHeaders, LAWMIND_LOCAL_HOST } from "./lawmind-server-helpers.js";
import { lawmindHandleHttpRequest } from "./lawmind-server-dispatch.js";
import {
  ensureLoopbackBearerToken,
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
  const wfSeed = ensureBuiltinWorkflowSeeds(workspaceDir);
  if (wfSeed.created.length > 0) {
    console.error(
      `[lawmind-local-server] seeded workflow templates: ${wfSeed.created.join(", ")}`,
    );
  }
  const skillSeed = ensureBuiltinSkillSeeds(workspaceDir);
  if (skillSeed.created.length > 0 || skillSeed.upgraded.length > 0) {
    console.error(
      `[lawmind-local-server] seeded skills: created=${skillSeed.created.join(",") || "—"} upgraded=${skillSeed.upgraded.join(",") || "—"}`,
    );
  }

  const { userEnvPath } = bootstrapLawMindDesktopEnv({
    workspaceDir,
    envFile,
    repoRoot: process.env.LAWMIND_REPO_ROOT,
  });

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
  };
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
  if (!process.env.LAWMIND_LOCAL_API_TOKEN?.trim()) {
    ensureLoopbackBearerToken();
  }

  const ctx = { workspaceDir, envFile, userEnvPath, policy, sseBus: getGlobalSseBus() };
  const rateBucket = new TokenBucket({ rate: 100, capacity: 200 });
  registerRateLimitBucket(rateBucket);

  const server = http.createServer((req, res) => {
    if (!rateBucket.tryConsume(1)) {
      // 限流响应也要带 CORS 头，否则浏览器侧拿不到错误体（只看到网络错误）。
      res.writeHead(429, { "content-type": "application/json", ...corsHeaders(req.headers.origin) });
      res.end(JSON.stringify({ ok: false, error: "rate_limited" }));
      return;
    }
    void lawmindHandleHttpRequest(ctx, req, res);
  });

  server.listen(port, LAWMIND_LOCAL_HOST, () => {
    console.error(`[lawmind-local-server] http://${LAWMIND_LOCAL_HOST}:${port} workspace=${workspaceDir}`);
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
