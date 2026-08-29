/**
 * MCP client config — LawMind consumes external servers.
 * GET/PUT /api/mcp/servers · POST /api/mcp/servers/:id/test
 */

import { z } from "zod";
import { isHighSecurityMode } from "../../../src/lawmind/policy/analysis-scripts.js";
import { testMcpServer } from "../../../src/lawmind/mcp/mcp-client-bridge.js";
import {
  readMcpServersConfig,
  sanitizeMcpServerId,
  writeMcpServersConfig,
  type McpServerRecord,
} from "../../../src/lawmind/mcp/mcp-servers-config.js";
import { isInvalidRequestBodyError, parseJsonBodyZod } from "./lawmind-api-parse.js";
import { sendJson } from "./lawmind-server-helpers.js";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";

const serverSchema = z.object({
  id: z.string().trim().min(1).max(48),
  label: z.string().trim().max(80).optional(),
  transport: z.enum(["stdio", "http"]),
  command: z.string().trim().max(400).optional(),
  args: z.array(z.string().max(200)).max(16).optional(),
  url: z.string().trim().max(500).optional(),
  enabled: z.boolean(),
  allowWrites: z.boolean().optional(),
  secretRef: z.string().trim().max(80).optional(),
});

function publicServers(workspaceDir: string) {
  return readMcpServersConfig(workspaceDir).map((s) => ({
    ...s,
    hasSecretRef: Boolean(s.secretRef),
  }));
}

export async function handleMcpRoutes(args: LawmindRouteContext): Promise<boolean> {
  const { ctx, pathname, req, res, c } = args;

  if (pathname === "/api/mcp/servers" && req.method === "GET") {
    sendJson(
      res,
      200,
      {
        ok: true,
        highSecurityMode: isHighSecurityMode(ctx.workspaceDir),
        servers: publicServers(ctx.workspaceDir),
      },
      c,
    );
    return true;
  }

  if (pathname === "/api/mcp/servers" && req.method === "PUT") {
    if (isHighSecurityMode(ctx.workspaceDir)) {
      sendJson(res, 403, { ok: false, error: "高安全模式下不可配置 MCP 客户端。" }, c);
      return true;
    }
    try {
      const body = await parseJsonBodyZod(req, z.object({ servers: z.array(serverSchema) }));
      const records: McpServerRecord[] = [];
      for (const row of body.servers) {
        const id = sanitizeMcpServerId(row.id);
        if (!id) {
          sendJson(res, 400, { ok: false, error: `无效的服务器 id：${row.id}` }, c);
          return true;
        }
        records.push({
          id,
          label: row.label ?? id,
          transport: row.transport,
          command: row.command,
          args: row.args,
          url: row.url,
          enabled: row.enabled,
          allowWrites: row.allowWrites === true,
          secretRef: row.secretRef,
        });
      }
      const written = writeMcpServersConfig(ctx.workspaceDir, records);
      if (!written.ok) {
        sendJson(res, 400, { ok: false, error: written.error }, c);
        return true;
      }
      sendJson(res, 200, { ok: true, servers: publicServers(ctx.workspaceDir) }, c);
    } catch (err) {
      if (isInvalidRequestBodyError(err)) {
        sendJson(res, 400, { ok: false, error: "invalid body" }, c);
        return true;
      }
      throw err;
    }
    return true;
  }

  const testMatch = pathname.match(/^\/api\/mcp\/servers\/([^/]+)\/test$/);
  if (testMatch && req.method === "POST") {
    if (isHighSecurityMode(ctx.workspaceDir)) {
      sendJson(res, 403, { ok: false, error: "高安全模式下 MCP 客户端已关闭。" }, c);
      return true;
    }
    const id = decodeURIComponent(testMatch[1] ?? "");
    const record = readMcpServersConfig(ctx.workspaceDir).find((s) => s.id === id);
    if (!record) {
      sendJson(res, 404, { ok: false, error: "找不到该 MCP 服务器。" }, c);
      return true;
    }
    const result = await testMcpServer(record);
    sendJson(res, result.ok ? 200 : 502, { ok: result.ok, tools: result.tools, error: result.error }, c);
    return true;
  }

  return false;
}
