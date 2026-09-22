/**
 * MCP client config — LawMind consumes external servers.
 * GET/PUT /api/mcp/servers · POST /api/mcp/servers/:id/test
 */

import path from "node:path";
import { z } from "zod";
import { emit } from "../../../src/lawmind/audit/index.js";
import { isHighSecurityMode } from "../../../src/lawmind/policy/analysis-scripts.js";
import { testMcpServer } from "../../../src/lawmind/mcp/mcp-client-bridge.js";
import {
  readMcpServersConfig,
  sanitizeMcpServerId,
  writeMcpServersConfig,
  type McpServerRecord,
} from "../../../src/lawmind/mcp/mcp-servers-config.js";
import { isInvalidRequestBodyError, parseJsonBodyZod } from "./lawmind-api-parse.js";
import { resolveDesktopActorId, sendJson } from "./lawmind-server-helpers.js";
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
  allowInsecureHttp: z.boolean().optional(),
  secretRef: z.string().trim().max(80).optional(),
});

/** stdio 服务器等同本机命令执行：响应里固定标注的安全提示。 */
const STDIO_SECURITY_NOTE =
  "stdio 类型 MCP 服务器会以本机权限启动其 command/args（等同本机命令执行）；仅配置可信来源的服务器。";

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
      const body = await parseJsonBodyZod(
        req,
        z.object({
          servers: z.array(serverSchema),
          confirmCommandExecution: z.boolean().optional(),
        }),
      );
      // stdio command 等同本机命令执行：要求显式确认字段作为最小摩擦。
      const hasStdioCommand = body.servers.some(
        (s) => s.transport === "stdio" && Boolean(s.command?.trim()),
      );
      if (hasStdioCommand && body.confirmCommandExecution !== true) {
        sendJson(
          res,
          400,
          {
            ok: false,
            error: "confirm_command_execution_required",
            message: `${STDIO_SECURITY_NOTE} 确认风险后请在请求体中带 confirmCommandExecution: true 再提交。`,
          },
          c,
        );
        return true;
      }
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
          allowInsecureHttp: row.allowInsecureHttp === true,
          secretRef: row.secretRef,
        });
      }
      const written = writeMcpServersConfig(ctx.workspaceDir, records);
      if (!written.ok) {
        sendJson(res, 400, { ok: false, error: written.error }, c);
        return true;
      }
      // 每次写入落审计（含 command/args；secretRef 只是引用，不含密钥本体）。
      await emit(path.join(ctx.workspaceDir, "audit"), {
        taskId: "mcp-servers",
        kind: "mcp.servers_updated",
        actor: "lawyer",
        actorId: resolveDesktopActorId(),
        detail: JSON.stringify(
          records.map((r) => ({
            id: r.id,
            transport: r.transport,
            command: r.command,
            args: r.args,
          })),
        ),
      });
      sendJson(
        res,
        200,
        {
          ok: true,
          servers: publicServers(ctx.workspaceDir),
          ...(hasStdioCommand ? { securityNote: STDIO_SECURITY_NOTE } : {}),
          ...(written.warnings?.length ? { warnings: written.warnings } : {}),
        },
        c,
      );
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
