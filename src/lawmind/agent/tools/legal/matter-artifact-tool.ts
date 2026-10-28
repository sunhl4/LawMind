/**
 * matter_artifact_update — 案件成果物（时间线 / 大事记 / 思维导图）的结构化写入。
 *
 * 真相源：`cases/<matterId>/project.case-*.json`（桌面板与本案卷宗同读这一份）。
 * 纪律（对照 MeWork 再生 prompt）：
 *   1. 先读再更新：默认 `upsert`，按条目 id 或「日期|标题」合并，不整文件重来；
 *   2. 不另建同类文件：只写这三份，文件名固定；
 *   3. 资料不足先确认、不编造：空载荷拒绝写入；每条事实必须带 `evidence`。
 */

import {
  matterArtifactFileName,
  matterArtifactLabel,
  type MatterArtifactKind,
} from "../../../deliverables/matter-artifact-model.js";
import {
  writeMatterArtifact,
  type MatterArtifactWriteMode,
} from "../../../deliverables/matter-artifact.js";
import type { AgentTool } from "../../types.js";

const KINDS: MatterArtifactKind[] = ["case-timeline", "case-chronology", "case-mindmap"];

function resolveMatterId(params: Record<string, unknown>, fallback?: string): string | undefined {
  const raw = typeof params.matter_id === "string" ? params.matter_id.trim() : "";
  return raw || fallback?.trim() || undefined;
}

function asKind(raw: unknown): MatterArtifactKind | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const name = raw.trim();
  return KINDS.find((kind) => kind === name);
}

export const matterArtifactUpdate: AgentTool = {
  definition: {
    name: "matter_artifact_update",
    description:
      "写入案件成果物（三选一）：case-timeline 时间线 / case-chronology 大事记 / case-mindmap 思维导图。" +
      "写入 cases/<matterId>/project.case-*.json，桌面「案件成果」直接读该文件。" +
      "默认 upsert（按 id 或「日期|标题」合并，先读再更新，不另建同类文件）；replace 才会整份覆盖。" +
      "空内容一律拒绝写入；每条事实必须带 evidence（{filePath, lineRef?, quote?}），没有出处的条目会在桌面标「待补出处」。",
    category: "matter",
    parameters: {
      matter_id: { type: "string", description: "案件 ID（默认当前会话所属案件）" },
      kind: {
        type: "string",
        description: `成果物类型：${KINDS.join(" | ")}`,
        required: true,
      },
      mode: {
        type: "string",
        description: "upsert（默认，合并）｜replace（整份覆盖，仅在律师要求重做时用）",
      },
      title: { type: "string", description: "可选标题（缺省沿用旧标题）" },
      events: {
        type: "array",
        description:
          "case-timeline：[{id?, date:'2026-03-01', title, summary?, kind?:'fact|procedure|dispute|evidence|other', evidence:[{filePath,lineRef?,quote?}]}]",
        items: { type: "object" },
      },
      entries: {
        type: "array",
        description:
          "case-chronology：[{id?, date, fact, people?:string[], evidence:[{filePath,lineRef?,quote?}]}]",
        items: { type: "object" },
      },
      root: {
        type: "object",
        description:
          "case-mindmap 根节点：{id?, label, kind?:'issue|fact|party|evidence|other', children:[…]}（最多 6 层）",
      },
    },
    requiresApproval: false,
    riskLevel: "medium",
  },
  async execute(params, ctx) {
    const kind = asKind(params.kind);
    if (!kind) {
      return {
        ok: false,
        error: `kind 必须是 ${KINDS.join(" / ")} 之一。`,
      };
    }
    const matterId = resolveMatterId(params, ctx.matterId);
    if (!matterId) {
      return {
        ok: false,
        error: "缺少案件上下文：成果物必须归属一个案件。",
        data: {
          lawyerMessage: "这条成果物要放进具体案件。请先打开案件，再让我整理时间线或大事记。",
        },
      };
    }

    const modeRaw = typeof params.mode === "string" ? params.mode.trim() : "";
    const mode: MatterArtifactWriteMode = modeRaw === "replace" ? "replace" : "upsert";

    const payload =
      kind === "case-timeline"
        ? { events: params.events }
        : kind === "case-chronology"
          ? { entries: params.entries }
          : { root: params.root };

    const result = writeMatterArtifact({
      workspaceDir: ctx.workspaceDir,
      matterId,
      kind,
      payload,
      mode,
      ...(typeof params.title === "string" ? { title: params.title } : {}),
    });

    if (!result.ok) {
      return {
        ok: false,
        error: result.errorZh,
        ...(result.issues ? { data: { issues: result.issues } } : {}),
      };
    }

    const label = matterArtifactLabel(kind);
    const file = matterArtifactFileName(kind);
    const { summary, issues } = result;
    const unanchored = kind === "case-mindmap" ? 0 : summary.unanchoredCount;
    const note =
      unanchored > 0
        ? `已写入${label}（${summary.itemCount} 项），其中 ${unanchored} 项没有出处，桌面会标「待补出处」。请补充 evidence 后再次 upsert。`
        : `已写入${label}（${summary.itemCount} 项）。`;
    const droppedBad = issues.filter((issue) => issue.path !== "/");
    return {
      ok: true,
      data: {
        kind,
        file,
        mode,
        itemCount: summary.itemCount,
        anchoredCount: summary.anchoredCount,
        unanchoredCount: summary.unanchoredCount,
        changed: result.changed,
        ...(summary.yearFrom ? { yearFrom: summary.yearFrom, yearTo: summary.yearTo } : {}),
        ...(droppedBad.length > 0 ? { issues: droppedBad } : {}),
        lawyerMessage: note,
      },
    };
  },
};
