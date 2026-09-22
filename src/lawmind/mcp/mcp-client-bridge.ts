/**
 * Attach enabled MCP servers to the LawMind tool registry.
 * Write/delete tools are stripped unless allowWrites; those still require approval.
 * Failures must not break the core tool table.
 */

import path from "node:path";
import type { ToolRegistry } from "../agent/tools/registry.js";
import { isReservedAgentToolName } from "../agent/tools/reserved-tool-names.js";
import type { AgentTool, ToolCallResult } from "../agent/types.js";
import { emit } from "../audit/index.js";
import { OutboundProxyError } from "../platform/outbound-proxy.js";
import { isMcpClientAllowed } from "../policy/analysis-scripts.js";
import {
  connectMcpHttp,
  connectMcpHttpSdk,
  connectMcpStdio,
  connectMcpStdioSdk,
  type McpSession,
} from "./mcp-jsonrpc-client.js";
import {
  mcpStdioCommandError,
  normalizeMcpHttpUrl,
  readMcpServersConfig,
  resolveMcpSecret,
  type McpServerRecord,
} from "./mcp-servers-config.js";

export type McpAttachResult = {
  attached: string[];
  skipped: string[];
  sessions: McpSession[];
};

const WRITE_LIKE =
  /write|delete|remove|unlink|truncate|create_file|put_file|send_email|send_mail|patch_file|update_file|exec|shell|run_command|http_post/i;

export function isMcpWriteLikeTool(name: string, description?: string): boolean {
  return WRITE_LIKE.test(name) || WRITE_LIKE.test(description ?? "");
}

export function mcpToolName(serverId: string, remoteName: string): string {
  const safe = remoteName.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
  return `mcp__${serverId}__${safe}`;
}

export function shouldExposeMcpTool(
  record: McpServerRecord,
  name: string,
  description?: string,
): boolean {
  if (isReservedAgentToolName(name) || isReservedAgentToolName(mcpToolName(record.id, name))) {
    return false;
  }
  if (!record.allowWrites && isMcpWriteLikeTool(name, description)) {
    return false;
  }
  return true;
}

async function openSession(record: McpServerRecord): Promise<McpSession> {
  if (record.transport === "stdio") {
    const cmdErr = mcpStdioCommandError(record.command ?? "", record.args);
    if (cmdErr) {
      throw new Error(cmdErr);
    }
  }
  if (record.transport === "http") {
    const url = normalizeMcpHttpUrl(record.url ?? "", {
      allowInsecureHttp: record.allowInsecureHttp === true,
    });
    if (!url.ok) {
      throw new Error(url.error);
    }
  }
  const secret = resolveMcpSecret(record);
  if (record.transport === "http") {
    const allowInsecureHttp = record.allowInsecureHttp === true;
    try {
      return await connectMcpHttp({ url: record.url ?? "", secret, allowInsecureHttp });
    } catch (err) {
      if (err instanceof OutboundProxyError) {
        throw err;
      }
      return connectMcpHttpSdk({ url: record.url ?? "", secret, allowInsecureHttp });
    }
  }
  const stdio = {
    command: record.command ?? "node",
    args: record.args ?? [],
    env: secret ? { LAWMIND_MCP_SECRET: secret } : undefined,
  };
  try {
    return await connectMcpStdio({ ...stdio, timeoutMs: 2_500 });
  } catch {
    return connectMcpStdioSdk(stdio);
  }
}

function wrapMcpTool(
  record: McpServerRecord,
  remoteName: string,
  description: string,
  session: McpSession,
  workspaceDir: string,
): AgentTool {
  const name = mcpToolName(record.id, remoteName);
  const writeLike = isMcpWriteLikeTool(remoteName, description);
  return {
    definition: {
      name,
      description: `${description || remoteName}（MCP · ${record.label}）`,
      category: "system",
      parameters: {
        arguments: { type: "object", description: "传给外部工具的参数对象" },
      },
      requiresApproval: writeLike || record.allowWrites,
      riskLevel: writeLike ? "high" : "medium",
    },
    async execute(params, ctx): Promise<ToolCallResult> {
      const args =
        params.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments)
          ? (params.arguments as Record<string, unknown>)
          : Object.fromEntries(
              Object.entries(params).filter(([k]) => k !== "__approved" && k !== "arguments"),
            );
      try {
        const result = await session.callTool(remoteName, args);
        await emit(path.join(ctx.workspaceDir || workspaceDir, "audit"), {
          taskId: ctx.sessionId,
          kind: "tool_call",
          actor: "model",
          actorId: ctx.actorId,
          detail: `mcp ${name}`,
        }).catch(() => undefined);
        const text = result.content
          ?.map((c) => c.text ?? "")
          .filter(Boolean)
          .join("\n");
        return {
          ok: result.isError !== true,
          data: result,
          error: result.isError ? text : undefined,
        };
      } catch (err) {
        await emit(path.join(ctx.workspaceDir || workspaceDir, "audit"), {
          taskId: ctx.sessionId,
          kind: "tool_call",
          actor: "model",
          actorId: ctx.actorId,
          detail: `mcp ${name} fail`,
        }).catch(() => undefined);
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}

export async function testMcpServer(record: McpServerRecord): Promise<{
  ok: boolean;
  tools?: Array<{ name: string; description?: string; exposed: boolean }>;
  error?: string;
}> {
  try {
    const session = await openSession(record);
    try {
      const listed = await session.listTools();
      return {
        ok: true,
        tools: listed.map((t) => ({
          name: t.name,
          description: t.description,
          exposed: shouldExposeMcpTool(record, t.name, t.description),
        })),
      };
    } finally {
      await session.close();
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function attachEnabledMcpServers(opts: {
  registry: ToolRegistry;
  workspaceDir: string;
}): Promise<McpAttachResult> {
  const attached: string[] = [];
  const skipped: string[] = [];
  const sessions: McpSession[] = [];
  if (!isMcpClientAllowed(opts.workspaceDir)) {
    return { attached, skipped: ["high_security"], sessions };
  }
  const servers = readMcpServersConfig(opts.workspaceDir).filter((s) => s.enabled);
  for (const record of servers) {
    try {
      const session = await openSession(record);
      try {
        const listed = await session.listTools();
        let any = false;
        for (const tool of listed) {
          if (!shouldExposeMcpTool(record, tool.name, tool.description)) {
            skipped.push(`${record.id}:${tool.name}`);
            continue;
          }
          const wrapped = wrapMcpTool(
            record,
            tool.name,
            tool.description ?? "",
            session,
            opts.workspaceDir,
          );
          try {
            opts.registry.registerExternal(wrapped);
            attached.push(wrapped.definition.name);
            any = true;
          } catch {
            skipped.push(`${record.id}:${tool.name}`);
          }
        }
        if (any) {
          sessions.push(session);
        } else {
          await session.close();
        }
      } catch {
        await session.close().catch(() => undefined);
        skipped.push(record.id);
      }
    } catch {
      skipped.push(record.id);
    }
  }
  return { attached, skipped, sessions };
}
