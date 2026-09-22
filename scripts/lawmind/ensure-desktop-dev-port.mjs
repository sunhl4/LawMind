#!/usr/bin/env node
/**
 * Ensure LawMind desktop Vite dev port (5174) is free before starting dev stack.
 * Reclaims stale vite processes from prior interrupted `pnpm lawmind:desktop` runs.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = 5174;
const DEBUG_LOG_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../.cursor/debug-5fdbce.log",
);
const DEBUG_ENDPOINT = "http://127.0.0.1:7674/ingest/3b5ce2a9-15bd-4d45-8b96-988fe1e6086c";
const SESSION_ID = "5fdbce";

function debugLog(hypothesisId, location, message, data = {}) {
  const payload = {
    sessionId: SESSION_ID,
    runId: process.env.LAWMIND_DEBUG_RUN_ID || "pre-fix",
    hypothesisId,
    location,
    message,
    data,
    timestamp: Date.now(),
  };
  // #region agent log
  fetch(DEBUG_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": SESSION_ID },
    body: JSON.stringify(payload),
  }).catch(() => {});
  try {
    fs.mkdirSync(path.dirname(DEBUG_LOG_PATH), { recursive: true });
    fs.appendFileSync(DEBUG_LOG_PATH, `${JSON.stringify(payload)}\n`, "utf8");
  } catch {
    /* ignore */
  }
  // #endregion
}

function listPortListeners(port) {
  try {
    const out = execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"], {
      encoding: "utf8",
    }).trim();
    if (!out) {
      return [];
    }
    const lines = out.split("\n").slice(1);
    return lines
      .map((line) => {
        const parts = line.trim().split(/\s+/);
        const pid = Number(parts[1]);
        const command = parts[0] ?? "unknown";
        if (!Number.isFinite(pid)) {
          return null;
        }
        let cmdline = "";
        try {
          cmdline = execFileSync("ps", ["-p", String(pid), "-o", "command="], {
            encoding: "utf8",
          }).trim();
        } catch {
          cmdline = command;
        }
        return { pid, command, cmdline };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function isReclaimableLawmindVite(listener) {
  const haystack = `${listener.command} ${listener.cmdline}`.toLowerCase();
  const looksLikeVite = haystack.includes("vite");
  const looksLikeLawmindPort =
    haystack.includes(String(PORT)) ||
    haystack.includes("lawmind-desktop") ||
    haystack.includes("apps/lawmind-desktop");
  return looksLikeVite && looksLikeLawmindPort;
}

function terminatePid(pid) {
  try {
    process.kill(pid, "SIGTERM");
    return true;
  } catch {
    return false;
  }
}

function main() {
  const listeners = listPortListeners(PORT);
  debugLog("A", "ensure-desktop-dev-port.mjs:main", "port scan", {
    port: PORT,
    listenerCount: listeners.length,
    listeners: listeners.map((l) => ({ pid: l.pid, command: l.command, cmdline: l.cmdline })),
  });

  if (listeners.length === 0) {
    debugLog("A", "ensure-desktop-dev-port.mjs:main", "port free", { port: PORT });
    return;
  }

  const reclaimable = listeners.filter(isReclaimableLawmindVite);
  const foreign = listeners.filter((l) => !isReclaimableLawmindVite(l));

  debugLog("B", "ensure-desktop-dev-port.mjs:main", "classified listeners", {
    reclaimable: reclaimable.map((l) => l.pid),
    foreign: foreign.map((l) => ({ pid: l.pid, cmdline: l.cmdline })),
  });

  if (foreign.length > 0) {
    const detail = foreign.map((l) => `pid ${l.pid}: ${l.cmdline}`).join("; ");
    debugLog("E", "ensure-desktop-dev-port.mjs:main", "foreign process blocks port", {
      port: PORT,
      detail,
    });
    console.error(
      `[lawmind-desktop] Port ${PORT} is in use by another app (${detail}). Stop it or change vite port.`,
    );
    process.exit(1);
  }

  for (const listener of reclaimable) {
    const stopped = terminatePid(listener.pid);
    debugLog("C", "ensure-desktop-dev-port.mjs:main", "reclaim stale vite listener", {
      pid: listener.pid,
      stopped,
      cmdline: listener.cmdline,
    });
    if (!stopped) {
      console.error(`[lawmind-desktop] Could not stop stale dev process pid ${listener.pid}.`);
      process.exit(1);
    }
  }

  // Brief wait for OS to release the port after SIGTERM.
  const deadline = Date.now() + 1500;
  while (Date.now() < deadline) {
    if (listPortListeners(PORT).length === 0) {
      debugLog("C", "ensure-desktop-dev-port.mjs:main", "port reclaimed", { port: PORT });
      return;
    }
  }

  debugLog("D", "ensure-desktop-dev-port.mjs:main", "port still busy after reclaim", {
    port: PORT,
  });
  console.error(
    `[lawmind-desktop] Port ${PORT} is still busy after stopping stale LawMind Vite. Retry in a few seconds.`,
  );
  process.exit(1);
}

main();
