#!/usr/bin/env node
import { spawn } from "node:child_process";
import net from "node:net";
import os from "node:os";
import path from "node:path";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pickFreePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        server.close(() => reject(new Error("failed to get ephemeral port")));
        return;
      }
      const { port } = addr;
      server.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(port);
      });
    });
  });
}

async function waitForHealth(url, timeoutMs) {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url);
      const text = await res.text();
      if (!res.ok) {
        lastError = new Error(`health status=${res.status} body=${text.slice(0, 180)}`);
      } else {
        const body = JSON.parse(text);
        if (body && body.ok === true) {
          return;
        }
        lastError = new Error(`health ok!==true body=${text.slice(0, 180)}`);
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
    await sleep(250);
  }
  throw lastError ?? new Error("health check timeout");
}

function spawnAndWait(command, args, env) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      env,
      stdio: "inherit",
    });
    child.on("exit", (code, signal) => {
      resolve({ code: code ?? 1, signal });
    });
  });
}

async function main() {
  const repoRoot = process.cwd();
  const port = Number(process.env.LAWMIND_DESKTOP_PORT) || (await pickFreePort());
  const workspaceDir =
    process.env.LAWMIND_WORKSPACE_DIR ||
    path.join(os.tmpdir(), "lawmind-desktop-http-smoke", String(process.pid));
  const baseUrl = `http://127.0.0.1:${Number(port)}`;

  const serverEnv = {
    ...process.env,
    LAWMIND_REPO_ROOT: repoRoot,
    LAWMIND_WORKSPACE_DIR: workspaceDir,
    LAWMIND_DESKTOP_PORT: String(port),
  };

  const server = spawn(
    process.execPath,
    ["--import", "tsx", "apps/lawmind-desktop/server/lawmind-local-server.ts"],
    {
      cwd: repoRoot,
      env: serverEnv,
      stdio: "inherit",
    },
  );

  let shutdownRequested = false;
  const cleanup = () => {
    if (shutdownRequested) {
      return;
    }
    shutdownRequested = true;
    if (!server.killed) {
      server.kill("SIGTERM");
    }
  };

  process.on("SIGINT", () => {
    cleanup();
    process.exit(130);
  });
  process.on("SIGTERM", () => {
    cleanup();
    process.exit(143);
  });

  try {
    await waitForHealth(`${baseUrl}/api/health`, 30_000);
    const smokeResult = await spawnAndWait(
      process.execPath,
      ["scripts/lawmind/lawmind-desktop-http-smoke.mjs", baseUrl],
      process.env,
    );
    if (smokeResult.code !== 0) {
      process.exit(smokeResult.code);
    }
  } finally {
    cleanup();
    await sleep(300);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[LawMind desktop http-smoke] ${message}`);
  process.exit(1);
});
