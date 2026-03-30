#!/usr/bin/env node
/**
 * Minimal LawMind local API for Playwright smoke tests (no workspace, no models).
 * Port: LAWMIND_E2E_MOCK_PORT (default 47991).
 */
import http from "node:http";

const PORT = Number(process.env.LAWMIND_E2E_MOCK_PORT || "48888");
const now = new Date().toISOString();

const assistant = {
  assistantId: "default",
  displayName: "默认助手",
  introduction: "E2E mock",
  presetKey: "general",
  createdAt: now,
  updatedAt: now,
  stats: { lastUsedAt: "", turnCount: 0, sessionCount: 0 },
};

const json = (res, status, body) => {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
  });
  res.end(JSON.stringify(body));
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  const path = url.pathname;

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
      "access-control-allow-headers": "content-type",
    });
    res.end();
    return;
  }

  if (path === "/api/health" && req.method === "GET") {
    json(res, 200, {
      modelConfigured: true,
      retrievalMode: "single",
      dualLegalConfigured: false,
      webSearchApiKeyConfigured: false,
    });
    return;
  }

  if (path === "/api/tasks" && req.method === "GET") {
    json(res, 200, { ok: true, tasks: [] });
    return;
  }

  if (path === "/api/history" && req.method === "GET") {
    json(res, 200, { ok: true, items: [] });
    return;
  }

  if (path === "/api/assistants" && req.method === "GET") {
    json(res, 200, { ok: true, assistants: [assistant], presets: [] });
    return;
  }

  if (path === "/api/delegations" && req.method === "GET") {
    json(res, 200, { ok: true, delegations: [], total: 0 });
    return;
  }

  if (path === "/api/collaboration-events" && req.method === "GET") {
    json(res, 200, { ok: true, events: [], total: 0 });
    return;
  }

  json(res, 404, { ok: false, error: "e2e mock: not found" });
});

server.listen(PORT, "127.0.0.1", () => {
  process.stderr.write(`lawmind e2e mock listening on http://127.0.0.1:${PORT}\n`);
});
