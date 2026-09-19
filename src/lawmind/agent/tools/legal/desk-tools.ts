/**
 * Desk archive tools — extract / apply legal events, intake brief, matter profile.
 * Same helpers as workbench HTTP; chat write-through when the lawyer asks to fill.
 */

import {
  applyIntakeBrief,
  applyLegalEvents,
  applyMatterProfile,
  compileAndSaveIntakeBrief,
  createMatterFromIntake,
  eventsFromExtracted,
  revertDeskWrite,
} from "../../../desk/desk-apply.js";
import { LEGAL_EVENT_KINDS, extractLegalEvents } from "../../../desk/legal-event-extract.js";
import { parseMatterDocket, parseMatterKind } from "../../../desk/matter-kind.js";
import type { AgentTool } from "../../types.js";
import { matterRequiredResult } from "../matter-required.js";

function resolveMatterId(params: Record<string, unknown>, fallback?: string): string | undefined {
  const raw = typeof params.matter_id === "string" ? params.matter_id.trim() : "";
  return raw || fallback?.trim() || undefined;
}

function asEventsArray(raw: unknown): Array<{
  eventKind: (typeof LEGAL_EVENT_KINDS)[number];
  title: string;
  dueAt?: string;
  notes?: string;
}> {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: Array<{
    eventKind: (typeof LEGAL_EVENT_KINDS)[number];
    title: string;
    dueAt?: string;
    notes?: string;
  }> = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") {
      continue;
    }
    const o = row as Record<string, unknown>;
    const eventKind = typeof o.eventKind === "string" ? o.eventKind.trim() : "";
    const title = typeof o.title === "string" ? o.title.trim() : "";
    if (!LEGAL_EVENT_KINDS.includes(eventKind as (typeof LEGAL_EVENT_KINDS)[number]) || !title) {
      continue;
    }
    out.push({
      eventKind: eventKind as (typeof LEGAL_EVENT_KINDS)[number],
      title,
      dueAt: typeof o.dueAt === "string" ? o.dueAt.trim() : undefined,
      notes: typeof o.notes === "string" ? o.notes.trim() : undefined,
    });
  }
  return out;
}

export const extractLegalEventsTool: AgentTool = {
  definition: {
    name: "extract_legal_events",
    description:
      "从传票、法院短信、举证通知等文本抽出开庭/答辩/举证等期限候选（只读）。有日期的项再调用 apply_legal_events 写入工作台。",
    category: "matter",
    parameters: {
      text: { type: "string", description: "传票/短信/通知全文", required: true },
    },
    isConcurrencySafe: true,
    riskLevel: "low",
  },
  async execute(params) {
    const text = typeof params.text === "string" ? params.text : "";
    if (!text.trim()) {
      return { ok: false, error: "文本为空，无法抽出期限。" };
    }
    const events = extractLegalEvents(text);
    return {
      ok: true,
      data: {
        events,
        withDueAt: events.filter((e) => e.dueAt).length,
        message:
          events.length === 0
            ? "未抽出期限。请换材料或手填。"
            : `抽出 ${events.length} 项（有日期 ${events.filter((e) => e.dueAt).length}）。有日期的请 apply_legal_events。`,
      },
    };
  },
};

export const applyLegalEventsTool: AgentTool = {
  definition: {
    name: "apply_legal_events",
    description:
      "把带日期的期限候选写入本案 deadlines.jsonl（与工作台「确认写入」同一存储）。无日期不写。律师对话交办即授权，无需再确认。",
    category: "matter",
    parameters: {
      matter_id: { type: "string", description: "案件 ID（默认当前会话）" },
      events: {
        type: "array",
        description: "extract_legal_events 返回的候选（须含 eventKind/title/dueAt）",
        required: true,
        items: { type: "object" },
      },
      text: {
        type: "string",
        description: "也可直接传原文，会先抽出再写（仅写入有日期的项）",
      },
    },
    requiresApproval: false,
    riskLevel: "medium",
  },
  async execute(params, ctx) {
    const matterId = resolveMatterId(params, ctx.matterId);
    if (!matterId) {
      return matterRequiredResult(ctx.workspaceDir);
    }
    let events = asEventsArray(params.events);
    if (events.length === 0 && typeof params.text === "string" && params.text.trim()) {
      events = eventsFromExtracted(extractLegalEvents(params.text));
    }
    if (events.length === 0) {
      return { ok: false, error: "没有可写入的期限项。" };
    }
    const result = await applyLegalEvents(ctx.workspaceDir, matterId, events, {
      createMatterIfMissing: false,
    });
    if (!result.ok) {
      return { ok: false, error: result.error };
    }
    const titles = result.deadlines.map((d) => `${d.title} ${d.dueAt}`).join("；");
    return {
      ok: true,
      data: {
        writeId: result.writeId,
        deadlineIds: result.deadlineIds,
        deadlines: result.deadlines,
        message: `已写入：${titles}。工作台可改；写错可用 revert_desk_write。`,
      },
    };
  },
};

export const compileIntakeBriefTool: AgentTool = {
  definition: {
    name: "compile_intake_brief",
    description:
      "把客户谈话/会议纪要整理为结构化摘要并先落盘（未确认）。对话路径随后应立刻调用 apply_intake_brief。",
    category: "matter",
    parameters: {
      matter_id: { type: "string", description: "案件 ID（默认当前会话）" },
      transcript: { type: "string", description: "谈话原文", required: true },
    },
    requiresApproval: false,
    riskLevel: "medium",
  },
  async execute(params, ctx) {
    const matterId = resolveMatterId(params, ctx.matterId);
    if (!matterId) {
      return matterRequiredResult(ctx.workspaceDir);
    }
    const transcript = typeof params.transcript === "string" ? params.transcript : "";
    const saved = await compileAndSaveIntakeBrief({
      workspaceDir: ctx.workspaceDir,
      matterId,
      transcript,
    });
    if ("ok" in saved && !saved.ok) {
      return { ok: false, error: saved.error };
    }
    const brief = saved as Exclude<typeof saved, { ok: false }>;
    return {
      ok: true,
      data: {
        brief,
        message: "谈话摘要已整理。对话路径请立刻 apply_intake_brief 写入本案档案。",
      },
    };
  },
};

export const applyIntakeBriefTool: AgentTool = {
  definition: {
    name: "apply_intake_brief",
    description: "确认谈话摘要写入本案档案（打 confirmedAt，与工作台「写入本案档案」相同）。",
    category: "matter",
    parameters: {
      matter_id: { type: "string", description: "案件 ID（默认当前会话）" },
    },
    requiresApproval: false,
    riskLevel: "medium",
  },
  async execute(params, ctx) {
    const matterId = resolveMatterId(params, ctx.matterId);
    if (!matterId) {
      return matterRequiredResult(ctx.workspaceDir);
    }
    const result = await applyIntakeBrief(ctx.workspaceDir, matterId);
    if (!result.ok) {
      return { ok: false, error: result.error };
    }
    return {
      ok: true,
      data: {
        writeId: result.writeId,
        brief: result.brief,
        message: "谈话档案已写入。工作台谈话页可见同一份。",
      },
    };
  },
};

const MATTER_STATUS_VALUES = [
  "intake",
  "active",
  "waiting_on_client",
  "waiting_on_firm",
  "under_review",
  "delivered",
  "closed",
] as const;

const MATTER_PARTY_ROLE_VALUES = ["client", "counterparty", "agent", "counsel", "other"] as const;

type MatterPartyParam = {
  name: string;
  role: (typeof MATTER_PARTY_ROLE_VALUES)[number];
  standing?: string;
  serviceAddress?: string;
};

function asPartiesArray(raw: unknown): MatterPartyParam[] | undefined {
  if (!Array.isArray(raw)) {
    return undefined;
  }
  const out: MatterPartyParam[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") {
      continue;
    }
    const o = row as Record<string, unknown>;
    const name = typeof o.name === "string" ? o.name.trim() : "";
    if (!name) {
      continue;
    }
    const roleRaw = typeof o.role === "string" ? o.role.trim() : "";
    const role = (MATTER_PARTY_ROLE_VALUES as readonly string[]).includes(roleRaw)
      ? (roleRaw as MatterPartyParam["role"])
      : "other";
    out.push({
      name,
      role,
      standing: typeof o.standing === "string" ? o.standing.trim() || undefined : undefined,
      serviceAddress:
        typeof o.service_address === "string" ? o.service_address.trim() || undefined : undefined,
    });
  }
  return out;
}

export const updateMatterProfileTool: AgentTool = {
  definition: {
    name: "update_matter_profile",
    description:
      "更新卷宗字段（案号/法院/审级/地位/开庭日/当事人/案由/门类/阶段）。只填读到的键，不编造。",
    category: "matter",
    parameters: {
      matter_id: { type: "string", description: "案件 ID（默认当前会话）" },
      title: { type: "string", description: "案件标题" },
      client_id: { type: "string", description: "委托人" },
      counterparty: { type: "string", description: "对方" },
      cause_of_action: { type: "string", description: "案由" },
      matter_kind: {
        type: "string",
        description: "门类",
        enum: ["contract", "litigation", "general"],
      },
      status: {
        type: "string",
        description: "阶段",
        enum: [...MATTER_STATUS_VALUES],
      },
      parties: {
        type: "array",
        description:
          "当事人列表：[{name, role: client/counterparty/agent/counsel/other, standing?, service_address?}]。传入即整体替换当事人。",
        items: { type: "object" },
      },
      case_no: { type: "string", description: "案号" },
      court: { type: "string", description: "法院" },
      instance: { type: "string", description: "审级" },
      standing: { type: "string", description: "诉讼地位" },
      hearing_at: { type: "string", description: "开庭时间 ISO" },
    },
    requiresApproval: false,
    riskLevel: "medium",
  },
  async execute(params, ctx) {
    const matterId = resolveMatterId(params, ctx.matterId);
    if (!matterId) {
      return matterRequiredResult(ctx.workspaceDir);
    }
    const docket = parseMatterDocket({
      caseNo: params.case_no,
      court: params.court,
      instance: params.instance,
      standing: params.standing,
      hearingAt: params.hearing_at,
    });
    const status =
      typeof params.status === "string" &&
      (MATTER_STATUS_VALUES as readonly string[]).includes(params.status)
        ? (params.status as (typeof MATTER_STATUS_VALUES)[number])
        : undefined;
    const parties = asPartiesArray(params.parties)?.map((p) => ({
      partyId: "",
      name: p.name,
      role: p.role,
      standing: p.standing,
      serviceAddress: p.serviceAddress,
    }));
    const result = await applyMatterProfile(ctx.workspaceDir, {
      matterId,
      title: typeof params.title === "string" ? params.title : undefined,
      clientId: typeof params.client_id === "string" ? params.client_id : undefined,
      counterparty: typeof params.counterparty === "string" ? params.counterparty : undefined,
      causeOfAction:
        typeof params.cause_of_action === "string" ? params.cause_of_action : undefined,
      matterKind:
        params.matter_kind !== undefined ? parseMatterKind(params.matter_kind) : undefined,
      status,
      parties,
      docket,
    });
    if (!result.ok) {
      return { ok: false, error: result.error };
    }
    return {
      ok: true,
      data: {
        writeId: result.writeId,
        matterId: result.matterId,
        message: "卷宗已更新。写错可用 revert_desk_write。",
      },
    };
  },
};

export const revertDeskWriteTool: AgentTool = {
  definition: {
    name: "revert_desk_write",
    description: "按 apply_* / update_matter_profile 返回的 writeId 撤销刚才那次写入。",
    category: "matter",
    parameters: {
      matter_id: { type: "string", description: "案件 ID（默认当前会话）" },
      write_id: { type: "string", description: "写入返回的 writeId", required: true },
    },
    requiresApproval: false,
    riskLevel: "medium",
  },
  async execute(params, ctx) {
    const matterId = resolveMatterId(params, ctx.matterId);
    if (!matterId) {
      return matterRequiredResult(ctx.workspaceDir);
    }
    const writeId = typeof params.write_id === "string" ? params.write_id.trim() : "";
    if (!writeId) {
      return { ok: false, error: "缺少 write_id。" };
    }
    const result = await revertDeskWrite(ctx.workspaceDir, matterId, writeId);
    if (!result.ok) {
      return { ok: false, error: result.error };
    }
    return {
      ok: true,
      data: {
        writeId: result.writeId,
        kind: result.kind,
        message: "已撤销刚才那次写入。",
      },
    };
  },
};

export const createMatterTool: AgentTool = {
  definition: {
    name: "create_matter",
    description: "仅在当前对话未关联案件时新建卷宗。已有 matterId 时必须失败，不得另造一卷。",
    category: "matter",
    parameters: {
      title: { type: "string", description: "案件标题", required: true },
      matter_kind: {
        type: "string",
        description: "门类",
        enum: ["contract", "litigation", "general"],
      },
    },
    requiresApproval: false,
    riskLevel: "medium",
  },
  async execute(params, ctx) {
    if (ctx.matterId?.trim()) {
      return {
        ok: false,
        error: `当前已关联案件 ${ctx.matterId}，不能再新建。请在该案上补档案。`,
      };
    }
    const title = typeof params.title === "string" ? params.title.trim() : "";
    if (!title) {
      return { ok: false, error: "新建案件需要标题。" };
    }
    const result = await createMatterFromIntake({
      workspaceDir: ctx.workspaceDir,
      title,
      matterKind:
        params.matter_kind !== undefined ? parseMatterKind(params.matter_kind) : undefined,
    });
    if (!result.ok) {
      return { ok: false, error: result.error };
    }
    return {
      ok: true,
      data: {
        writeId: result.writeId,
        matterId: result.matterId,
        message:
          `已新建案件「${title}」（matter_id: ${result.matterId}）。` +
          `请直接继续：后续 update_matter_profile / apply_legal_events / add_case_note 等调用传 matter_id="${result.matterId}" 即可写入该案，无需律师手动关联。`,
      },
    };
  },
};

export const deskTools: AgentTool[] = [
  extractLegalEventsTool,
  applyLegalEventsTool,
  compileIntakeBriefTool,
  applyIntakeBriefTool,
  updateMatterProfileTool,
  revertDeskWriteTool,
  createMatterTool,
];
