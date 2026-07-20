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
 * Optional workspace policy: `lawmind.policy.json` in the workspace root (see docs/LAWMIND-POLICY-FILE).
 *
 * Run from monorepo root: node --import tsx apps/lawmind-desktop/server/lawmind-local-server.ts
 */

import fs from "node:fs";
import http from "node:http";
import { bootstrapLawMindDesktopEnv } from "./lawmind-desktop-env-bootstrap.js";
import { restoreDelegationsFromDisk } from "../../../src/lawmind/agent/collaboration/index.js";
import { ensureBuiltinWorkflowSeeds } from "../../../src/lawmind/agent/collaboration/ensure-workflow-seeds.js";
import { loadAndApplyLawMindPolicy } from "./lawmind-policy.js";
import { LAWMIND_LOCAL_HOST } from "./lawmind-server-helpers.js";
import { lawmindHandleHttpRequest } from "./lawmind-server-dispatch.js";
import {
  ensureLoopbackBearerToken,
  initLoopbackBearerFromEnv,
} from "./lawmind-local-api-auth.js";
import { registerRateLimitBucket, TokenBucket } from "./lawmind-local-rate-limit.js";
import {
  enqueueWorkflowRun,
  loadJobsFromDiskOnStartup,
  processDueScheduledJobs,
  setWorkflowJobSchedulerContext,
} from "./lawmind-server-jobs.js";
import { buildAgentConfig } from "./lawmind-server-helpers.js";
import {
  indexExists,
  rebuildWorkspaceSearchIndex,
} from "../../../src/lawmind/indexing/index.js";
import { processDueLawyerAutomations } from "../../../src/lawmind/platform/lawyer-automations-runner.js";
import {
  instantiateCollaborationWorkflowFromTemplate,
  readWorkspaceWorkflowTemplate,
} from "../../../src/lawmind/agent/collaboration/workspace-workflow-templates.js";
import { resolveLawMindRoot } from "../../../src/lawmind/assistants/store.js";

async function main() {
  const workspaceDir = process.env.LAWMIND_WORKSPACE_DIR?.trim();
  const portRaw = process.env.LAWMIND_DESKTOP_PORT?.trim();
  const envFileRaw = process.env.LAWMIND_ENV_FILE?.trim();
  const envFile = envFileRaw || undefined;

  if (!workspaceDir || !portRaw) {
    console.error("LAWMIND_WORKSPACE_DIR and LAWMIND_DESKTOP_PORT are required");
    process.exit(1);
  }

  const port = Number(portRaw);
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    console.error("Invalid LAWMIND_DESKTOP_PORT");
    process.exit(1);
  }

  fs.mkdirSync(workspaceDir, { recursive: true });
  const wfSeed = ensureBuiltinWorkflowSeeds(workspaceDir);
  if (wfSeed.created.length > 0) {
    console.error(
      `[lawmind-local-server] seeded workflow templates: ${wfSeed.created.join(", ")}`,
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
  };
  tickScheduled();
  const scheduleTimer = setInterval(tickScheduled, 30_000);
  scheduleTimer.unref?.();

  if (!indexExists(workspaceDir)) {
    void rebuildWorkspaceSearchIndex(workspaceDir).catch(() => {
      /* best-effort background index */
    });
  }

  initLoopbackBearerFromEnv();
  if (!process.env.LAWMIND_LOCAL_API_TOKEN?.trim()) {
    ensureLoopbackBearerToken();
  }

  const ctx = { workspaceDir, envFile, userEnvPath, policy };
  const rateBucket = new TokenBucket({ rate: 100, capacity: 200 });
  registerRateLimitBucket(rateBucket);

  const server = http.createServer((req, res) => {
    if (!rateBucket.tryConsume(1)) {
      res.writeHead(429, { "content-type": "application/json" });
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
});
process.on("unhandledRejection", (reason) => {
  console.error("[lawmind-local-server] unhandledRejection:", reason);
});

void main();
