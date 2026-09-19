import path from "node:path";
import { buildHostAccessRuntime } from "../../../host-access/access-broker.js";
import { hostCommandNeedsSessionAllow, runHostCommand } from "../../../host-access/host-command.js";
import { appendHostAccessLog } from "../../../host-access/host-log.js";
import { searchHost } from "../../../host-access/host-search.js";
import {
  addSessionGrant,
  consumeOnceGrant,
  persistAlwaysGrant,
  rememberLocateHit,
  resolveLocateHit,
  setSessionCommandAllowed,
} from "../../../host-access/host-store.js";
import { hostdImport, hostdRead } from "../../../host-access/hostd.js";
import type { HostGrantDuration, HostSearchHit } from "../../../host-access/types.js";
import type { AgentContext, AgentTool, ToolCallResult } from "../../types.js";

function runtimeFromCtx(ctx: AgentContext) {
  return buildHostAccessRuntime({
    workspaceDir: ctx.workspaceDir,
    sessionId: ctx.sessionId,
    matterId: ctx.matterId,
    projectDir: ctx.projectDir,
    hostMounts: ctx.hostMounts,
    hostGrants: ctx.hostGrants,
    hostAccessFile: ctx.hostAccessFile,
    hostSessionCommandAllowed: ctx.hostSessionCommandAllowed,
  });
}

function grantResult(message: string, rawPath: string, hitId?: string): ToolCallResult {
  return {
    ok: false,
    approvalRequest: true,
    error: message,
    data: {
      hostGrantNeeded: true,
      hitId,
      pathHint: path.basename(rawPath),
      parentHint: path.basename(path.dirname(rawPath)),
      durations: ["once", "session", "always"],
      gateDecision: {
        gate: "approval_gate",
        decision: "awaiting_confirmation",
        reason: message,
      },
    },
  };
}

function resolveRawHostPath(
  ctx: AgentContext,
  params: Record<string, unknown>,
): {
  raw: string;
  hitId?: string;
  staleHit?: boolean;
} {
  const hitId = typeof params.hit_id === "string" ? params.hit_id.trim() : "";
  if (hitId) {
    const abs = resolveLocateHit(ctx.sessionId, hitId);
    if (!abs) {
      return { raw: "", hitId, staleHit: true };
    }
    return { raw: abs, hitId };
  }
  const raw = typeof params.path === "string" ? params.path.trim() : "";
  return { raw };
}

function publishHits(sessionId: string, hits: HostSearchHit[]): HostSearchHit[] {
  return hits.map((hit) => {
    if (hit.needsGrant && hit.locateAbs && hit.hitId) {
      rememberLocateHit(sessionId, hit.hitId, hit.locateAbs);
    }
    const { locateAbs: _drop, ...rest } = hit;
    return rest;
  });
}

function parseDuration(raw: unknown): HostGrantDuration {
  if (raw === "session" || raw === "always" || raw === "once") {
    return raw;
  }
  return "once";
}

export const searchHostTool: AgentTool = {
  definition: {
    name: "search_host",
    description:
      "在已选本机文件夹（及可选的本机查找）中按文件名或正文定位材料。工作区外命中默认只回文件名与父目录，不回正文。",
    category: "search",
    parameters: {
      query: { type: "string", description: "文件名、关键词或一句正文", required: true },
    },
    isConcurrencySafe: true,
    riskLevel: "low",
  },
  async execute(params, ctx) {
    const query = typeof params.query === "string" ? params.query.trim() : "";
    if (!query) {
      return { ok: false, error: "请提供查找关键词。" };
    }
    const runtime = runtimeFromCtx(ctx);
    if (runtime.policy.mode === "matter" && runtime.mounts.length === 0) {
      return {
        ok: true,
        data: {
          hits: [],
          message: "当前只能看本案材料。请在设置「本机能力」选择本机文件夹，或改用本机查找。",
        },
      };
    }
    if (runtime.mounts.length === 0 && runtime.policy.mode === "mounts") {
      return {
        ok: true,
        data: {
          hits: [],
          message: "尚未选择本机文件夹。请在设置里添加，或把本机能力改为「本机查找」。",
        },
      };
    }
    const hits = publishHits(ctx.sessionId, searchHost(runtime, query));
    appendHostAccessLog(runtime.logDir, {
      action: "search",
      sessionId: ctx.sessionId,
      matterId: ctx.matterId,
      detail: query,
      ok: true,
    });
    return {
      ok: true,
      data: {
        hits,
        message:
          hits.length === 0
            ? "没有找到。可补充本机文件夹，或打开本机查找后再试。"
            : hits.some((h) => h.needsGrant)
              ? "部分结果尚未授权，请用 read_host_file 并请律师允许后阅读正文。"
              : undefined,
      },
    };
  },
};

export const readHostFileTool: AgentTool = {
  definition: {
    name: "read_host_file",
    description:
      "读取已授权的本机文件正文。工作区与已选本机文件夹可直接读；其外路径须律师允许一次/本会话/始终。",
    category: "search",
    parameters: {
      path: {
        type: "string",
        description: "绝对路径或本机文件夹内相对路径；工作区外请优先用 hit_id",
      },
      grant_duration: {
        type: "string",
        description: "律师确认后的授权时长：once / session / always",
      },
      hit_id: {
        type: "string",
        description: "本机查找返回的命中编号；工作区外阅读请用此字段，不要编造绝对路径",
      },
    },
    isConcurrencySafe: true,
    riskLevel: "low",
    approvalTemplate: "readonly",
  },
  async execute(params, ctx) {
    const resolved = resolveRawHostPath(ctx, params);
    if (resolved.staleHit) {
      return { ok: false, error: "该查找结果已失效，请再搜一次。" };
    }
    const raw = resolved.raw;
    if (!raw) {
      return { ok: false, error: "请提供文件路径或本机查找命中编号。" };
    }
    const runtime = runtimeFromCtx(ctx);
    const approved = params.__approved === true;
    if (approved) {
      const duration = parseDuration(params.grant_duration);
      const grant = addSessionGrant(ctx.sessionId, {
        absPath: path.resolve(raw),
        kind: "read",
        duration,
      });
      if (duration === "always" && runtime.storePath) {
        persistAlwaysGrant(grant, runtime.storePath);
      }
    }
    const runtime2 = runtimeFromCtx(ctx);
    const result = hostdRead(runtime2, raw);
    if (!result.ok) {
      appendHostAccessLog(runtime2.logDir, {
        action: result.needsGrant ? "grant" : "deny",
        sessionId: ctx.sessionId,
        matterId: ctx.matterId,
        path: path.basename(raw),
        detail: result.error,
        ok: false,
      });
      if (result.needsGrant) {
        return grantResult(result.message ?? "需要律师允许后才能读取该文件。", raw, resolved.hitId);
      }
      return { ok: false, error: result.message ?? result.error };
    }
    const once = runtime2.grants.find(
      (g) => g.duration === "once" && path.resolve(g.absPath) === path.resolve(result.abs),
    );
    if (once) {
      consumeOnceGrant(ctx.sessionId, result.abs);
    }
    appendHostAccessLog(runtime2.logDir, {
      action: "read",
      sessionId: ctx.sessionId,
      matterId: ctx.matterId,
      path: result.rel,
      ok: true,
    });
    return {
      ok: true,
      data: result.directory
        ? {
            kind: "directory",
            path: result.rel,
            content: result.text,
            entries: result.entries,
            truncated: result.truncated,
            hint: "这是目录列表。请按 entries[].path 调用 read_host_file / analyze_document 阅读文件。",
          }
        : { path: result.rel, content: result.text },
    };
  },
};

export const importHostFileTool: AgentTool = {
  definition: {
    name: "import_host_file",
    description: "把已授权的本机文件或整个文件夹复制进当前案件材料目录（收进本案）。不改写源文件。",
    category: "matter",
    parameters: {
      path: {
        type: "string",
        description: "本机文件或文件夹。可用绝对路径，或已选文件夹内的相对路径（如 诉讼/某纠纷）",
      },
      hit_id: { type: "string", description: "本机查找返回的命中编号" },
      grant_duration: {
        type: "string",
        description: "律师确认后的授权时长：once / session / always",
      },
      matter_id: {
        type: "string",
        description: "案件 ID 或案件展示名；省略则用当前会话案件",
      },
    },
    riskLevel: "medium",
  },
  async execute(params, ctx) {
    const resolved = resolveRawHostPath(ctx, params);
    if (resolved.staleHit) {
      return { ok: false, error: "该查找结果已失效，请再搜一次。" };
    }
    const raw = resolved.raw;
    if (!raw) {
      return { ok: false, error: "请提供要收进本案的文件路径或命中编号。" };
    }
    const matterId =
      (typeof params.matter_id === "string" && params.matter_id.trim()) || ctx.matterId || "";
    const runtime = runtimeFromCtx(ctx);
    const approved = params.__approved === true;
    if (approved) {
      const duration = parseDuration(params.grant_duration);
      const grant = addSessionGrant(ctx.sessionId, {
        absPath: path.resolve(raw),
        kind: "read",
        duration,
      });
      if (duration === "always" && runtime.storePath) {
        persistAlwaysGrant(grant, runtime.storePath);
      }
    }
    const runtime2 = runtimeFromCtx(ctx);
    const result = hostdImport(runtime2, raw, matterId);
    appendHostAccessLog(runtime2.logDir, {
      action: "import",
      sessionId: ctx.sessionId,
      matterId,
      path: path.basename(raw),
      detail: result.ok ? result.destRel : result.error,
      ok: result.ok,
    });
    if (!result.ok) {
      if (result.error === "needs_grant") {
        return grantResult(result.message ?? "请先允许读取该文件。", raw, resolved.hitId);
      }
      return { ok: false, error: result.message ?? result.error };
    }
    return {
      ok: true,
      data: {
        destRel: result.destRel,
        files: result.files,
        truncated: result.truncated,
        message: result.files
          ? `已将文件夹收进本案（${result.files} 个文件）${result.truncated ? "，其余因体积或层级未复制" : ""}，源文件未改写。`
          : "已收进本案，源文件未改写。",
      },
    };
  },
};

export const runHostCommandTool: AgentTool = {
  definition: {
    name: "run_host_command",
    description:
      "在已授权目录内运行受控本机命令（officecli / mdfind / git / python 等）。默认关闭；须在本机能力中打开。",
    category: "system",
    parameters: {
      command: { type: "string", description: "命令名（如 officecli、git）", required: true },
      args: { type: "array", description: "参数数组，禁止拼接 shell" },
      cwd: { type: "string", description: "工作目录，必须在已授权根内" },
    },
    requiresApproval: true,
    riskLevel: "high",
    approvalTemplate: "generic",
  },
  async execute(params, ctx) {
    const command = typeof params.command === "string" ? params.command.trim() : "";
    if (!command) {
      return { ok: false, error: "请提供命令名。" };
    }
    const args = Array.isArray(params.args)
      ? params.args.filter((a): a is string => typeof a === "string")
      : [];
    const cwd = typeof params.cwd === "string" ? params.cwd : undefined;
    if (params.__approved === true && hostCommandNeedsSessionAllow(command)) {
      setSessionCommandAllowed(ctx.sessionId, true);
    }
    const runtime = runtimeFromCtx(ctx);
    const result = await runHostCommand(
      runtime,
      { command, args, cwd },
      { approved: params.__approved === true },
    );
    appendHostAccessLog(runtime.logDir, {
      action: "command",
      sessionId: ctx.sessionId,
      matterId: ctx.matterId,
      detail: command,
      ok: result.ok,
    });
    if (!result.ok) {
      if (result.needsApproval) {
        return {
          ok: false,
          approvalRequest: true,
          error: result.error,
          data: {
            gateDecision: {
              gate: "approval_gate",
              decision: "awaiting_confirmation",
              reason: result.error,
            },
          },
        };
      }
      return { ok: false, error: result.error };
    }
    return { ok: true, data: result };
  },
};
