#!/usr/bin/env node
/**
 * LawMind read-only MCP server (stdio JSON-RPC).
 *
 * Tools: list_matters, list_drafts, get_source_preview, list_source_annotations,
 *        get_review_matrix, get_draft_acceptance_pack — no workspace writes.
 *
 * Env:
 *   LAWMIND_WORKSPACE_DIR — required workspace root
 *
 * Cursor MCP config example (archived) in docs/archive/LAWMIND-INTEGRATIONS.md
 */

import readline from "node:readline";
import { isReservedAgentToolName } from "../../src/lawmind/agent/tools/reserved-tool-names.js";
import {
  mcpGetDraftAcceptancePack,
  mcpGetReviewMatrix,
  mcpGetSourcePreview,
  mcpListDrafts,
  mcpListMatters,
  mcpListSourceAnnotations,
} from "../../src/lawmind/mcp/readonly-tools.js";

const rawWorkspaceDir = process.env.LAWMIND_WORKSPACE_DIR?.trim();
if (!rawWorkspaceDir) {
  process.stderr.write("LAWMIND_WORKSPACE_DIR is required\n");
  process.exit(1);
}
const workspaceDir: string = rawWorkspaceDir;

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
};

function send(msg: unknown): void {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

function toolText(result: { ok: boolean; data?: unknown; text?: string; error?: string }): string {
  if (result.text) {
    return result.text;
  }
  return JSON.stringify(result, null, 2);
}

const TOOLS = [
  {
    name: "list_matters",
    description: "List matter IDs in the workspace (read-only).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "list_drafts",
    description: "List draft task IDs and titles (read-only).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_source_preview",
    description: "Preview a research source excerpt by sourceId and taskId (read-only).",
    inputSchema: {
      type: "object",
      properties: {
        sourceId: { type: "string" },
        taskId: { type: "string" },
      },
      required: ["sourceId", "taskId"],
      additionalProperties: false,
    },
  },
  {
    name: "list_source_annotations",
    description: "List lawyer annotations on a research source (read-only).",
    inputSchema: {
      type: "object",
      properties: {
        sourceId: { type: "string" },
        taskId: { type: "string" },
        matterId: { type: "string" },
      },
      required: ["sourceId"],
      additionalProperties: false,
    },
  },
  {
    name: "get_review_matrix",
    description: "Get matter tabular review matrix (documents × diligence questions, read-only).",
    inputSchema: {
      type: "object",
      properties: { matterId: { type: "string" } },
      required: ["matterId"],
      additionalProperties: false,
    },
  },
  {
    name: "get_draft_acceptance_pack",
    description: "Export per-draft acceptance pack markdown (read-only).",
    inputSchema: {
      type: "object",
      properties: { taskId: { type: "string" } },
      required: ["taskId"],
      additionalProperties: false,
    },
  },
];

async function handleToolCall(
  name: string,
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  if (isReservedAgentToolName(name)) {
    throw new Error(`RESERVED_TOOL_NAME: ${name} is implemented only by LawMind execute()`);
  }
  if (name === "list_matters") {
    const result = await mcpListMatters(workspaceDir);
    return { content: [{ type: "text", text: toolText(result) }] };
  }
  if (name === "list_drafts") {
    const result = mcpListDrafts(workspaceDir);
    return { content: [{ type: "text", text: toolText(result) }] };
  }
  if (name === "get_source_preview") {
    const sourceId = (typeof args.sourceId === "string" ? args.sourceId : "").trim();
    const taskId = (typeof args.taskId === "string" ? args.taskId : "").trim();
    const result = mcpGetSourcePreview(workspaceDir, sourceId, taskId);
    return { content: [{ type: "text", text: toolText(result) }] };
  }
  if (name === "list_source_annotations") {
    const sourceId = (typeof args.sourceId === "string" ? args.sourceId : "").trim();
    const taskId = typeof args.taskId === "string" ? args.taskId.trim() : undefined;
    const matterId = typeof args.matterId === "string" ? args.matterId.trim() : undefined;
    const result = mcpListSourceAnnotations(workspaceDir, sourceId, taskId, matterId);
    return { content: [{ type: "text", text: toolText(result) }] };
  }
  if (name === "get_review_matrix") {
    const matterId = (typeof args.matterId === "string" ? args.matterId : "").trim();
    const result = mcpGetReviewMatrix(workspaceDir, matterId);
    return { content: [{ type: "text", text: toolText(result) }] };
  }
  if (name === "get_draft_acceptance_pack") {
    const taskId = (typeof args.taskId === "string" ? args.taskId : "").trim();
    const result = await mcpGetDraftAcceptancePack(workspaceDir, taskId);
    return { content: [{ type: "text", text: toolText(result) }] };
  }
  throw new Error(`unknown_tool:${name}`);
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });

rl.on("line", async (line) => {
  let req: JsonRpcRequest;
  try {
    req = JSON.parse(line) as JsonRpcRequest;
  } catch {
    return;
  }
  const id = req.id ?? null;
  try {
    if (req.method === "initialize") {
      send({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "lawmind-readonly", version: "0.2.0" },
        },
      });
      return;
    }
    if (req.method === "notifications/initialized") {
      return;
    }
    if (req.method === "tools/list") {
      send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
      return;
    }
    if (req.method === "tools/call") {
      const params = (req.params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
      const result = await handleToolCall(String(params.name ?? ""), params.arguments ?? {});
      send({ jsonrpc: "2.0", id, result });
      return;
    }
    send({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
  } catch (err) {
    send({
      jsonrpc: "2.0",
      id,
      error: { code: -32000, message: err instanceof Error ? err.message : String(err) },
    });
  }
});
