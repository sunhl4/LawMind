import { DRAFT_WORKER_TOOL_NAME, runDraftWorker } from "../../draft-worker.js";
import type { AgentTool } from "../../types.js";

export const draftWorkerTool: AgentTool = {
  definition: {
    name: DRAFT_WORKER_TOOL_NAME,
    description:
      "对话里的子工（对齐 Cursor Task / Codex spawn_agent）。律师提交任务后，由你在同一次回复里决定派不派。只用于一支要自己连读、连查再交结果的长任务；短任务不要调用。子工看不到本对话，goal 必须自包含。role=review 交结论和依据，role=draft 写条款片段，role=explore 只读探查目录。多支互不依赖的长任务在同一次回复里并行调用，section 必须互不相同；拆不开只调用一次。返回的 result 是这一支的结果，汇总时用它，不要重做子工的过程。不要用于改原件、导出或外发。续跑传 resume_id 和 follow_up。父会话只保留有界摘要。",
    category: "draft",
    parameters: {
      goal: {
        type: "string",
        description: "要做的事（自包含，不要只写「帮我看看」）",
        required: true,
      },
      not_goal: {
        type: "string",
        description: "明确不要做的事，例如合同审查、审阅痕迹稿",
      },
      materials: {
        type: "string",
        description: "材料线索（文件夹名、钉选路径）",
      },
      excerpt: {
        type: "string",
        description: "已读材料的摘录正文（父会话写入；有 path 时工自己会再读文件）",
      },
      path: {
        type: "string",
        description: "源文件或文件夹路径。工会自己读 .docx/.pdf/.txt，不要只传文件名却不给正文。",
      },
      section: {
        type: "string",
        description: "这一支的名字，例如「违约金」「开庭时间」。并行时必须互不相同。",
      },
      anchor: {
        type: "string",
        description:
          "这一支要回答的稳定命题锚，例如 clause:解除。同一锚的几支由引擎融合；不传则不参与相消。",
      },
      outcomeId: {
        type: "string",
        description:
          "这一支的读法 id。同一锚上相同 id 的不同措辞合成一条；不同 id 才写成【待核实】。不传则用结论文本当 id。",
      },
      span: {
        type: "string",
        description: "支撑该读法的材料原句。没有原句时，该读法不得写成确定句。",
      },
      binds: {
        type: "array",
        description: "与本锚纠缠的其他锚，例如 amount:wage。子工只带走这些锚的 1-hop。",
      },
      role: {
        type: "string",
        description: "review 交结论和依据；draft 写条款片段；explore 只读探查目录。",
        enum: ["review", "draft", "explore"],
      },
      style: {
        type: "string",
        description: "文风要求，例如「简洁」「正式」",
      },
      resume_id: {
        type: "string",
        description: "续跑上一支子工。用它返回的 workerId，不要另开一工。",
      },
      follow_up: {
        type: "string",
        description: "续跑时要改的点。与 resume_id 一起传。",
      },
    },
    isConcurrencySafe: true,
    riskLevel: "low",
  },
  async execute(params, ctx) {
    const goal = typeof params.goal === "string" ? params.goal : "";
    const notGoal = typeof params.not_goal === "string" ? params.not_goal : undefined;
    const materials = typeof params.materials === "string" ? params.materials : undefined;
    const excerpt = typeof params.excerpt === "string" ? params.excerpt : undefined;
    const path = typeof params.path === "string" ? params.path : undefined;
    const section = typeof params.section === "string" ? params.section : undefined;
    const style = typeof params.style === "string" ? params.style : undefined;
    const resumeId = typeof params.resume_id === "string" ? params.resume_id : undefined;
    const followUp = typeof params.follow_up === "string" ? params.follow_up : undefined;
    const role =
      params.role === "review" || params.role === "draft" || params.role === "explore"
        ? params.role
        : undefined;
    const anchor = typeof params.anchor === "string" ? params.anchor.trim() : "";
    const binds = Array.isArray(params.binds)
      ? params.binds.filter(
          (item): item is string => typeof item === "string" && item.trim().length > 0,
        )
      : [];
    const result = await runDraftWorker(
      {
        goal,
        notGoal,
        materials,
        excerpt,
        path,
        section,
        style,
        resumeId,
        followUp,
        role,
        ...(anchor ? { anchor } : {}),
        ...(binds.length > 0 ? { binds } : {}),
      },
      ctx,
    );
    if (result.ok && result.data && typeof result.data === "object") {
      const data = result.data as Record<string, unknown>;
      const outcomeId = typeof params.outcomeId === "string" ? params.outcomeId.trim() : "";
      const span = typeof params.span === "string" ? params.span.trim() : "";
      if (anchor) {
        data.anchor = anchor;
      }
      if (outcomeId) {
        data.outcomeId = outcomeId;
      }
      if (span) {
        data.span = span;
      }
      if (binds.length > 0) {
        data.binds = binds;
      }
    }
    return result;
  },
};
