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
import path from "node:path";
import { loadLawMindEnv } from "../../../scripts/lawmind/lawmind-env-loader.js";
import { restoreDelegationsFromDisk } from "../../../src/lawmind/agent/collaboration/index.js";
import { loadAndApplyLawMindPolicy } from "./lawmind-policy.js";
import { LAWMIND_LOCAL_HOST } from "./lawmind-server-helpers.js";
import { lawmindHandleHttpRequest } from "./lawmind-server-dispatch.js";
import { loadJobsFromDiskOnStartup } from "./lawmind-server-jobs.js";

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

  const envDir = path.dirname(workspaceDir);
  const userEnvPath = envFile ? path.resolve(envFile) : path.resolve(envDir, ".env.lawmind");
  const repoRootRaw = process.env.LAWMIND_REPO_ROOT?.trim();
  if (repoRootRaw) {
    const repoRootAbs = path.resolve(repoRootRaw);
    const repoEnvPath = path.join(repoRootAbs, ".env.lawmind");
    if (fs.existsSync(repoEnvPath)) {
      loadLawMindEnv(repoRootAbs, undefined, { override: true });
    }
  }
  loadLawMindEnv(envDir, envFile);

  const policy = loadAndApplyLawMindPolicy(workspaceDir);

  restoreDelegationsFromDisk(workspaceDir);
  loadJobsFromDiskOnStartup(workspaceDir);

  const ctx = { workspaceDir, envFile, userEnvPath, policy };

  const server = http.createServer((req, res) => {
    void lawmindHandleHttpRequest(ctx, req, res);
  });

  server.listen(port, LAWMIND_LOCAL_HOST, () => {
    console.error(`[lawmind-local-server] http://${LAWMIND_LOCAL_HOST}:${port} workspace=${workspaceDir}`);
  });
}

void main();
