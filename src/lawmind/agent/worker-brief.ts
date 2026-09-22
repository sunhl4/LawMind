/**
 * Self-contained brief for isolated workers (delegate / consult / folder-explorer).
 * The child does not see the parent conversation — the parent model must write the ask.
 */

const VAGUE_ONLY_RE =
  /^(帮我看看|看看|看一下|继续|处理一下|搞一下|弄一下|帮我处理|帮我看一下)[\s。.!！]*$/;

export type WorkerBriefParts = {
  task?: string;
  goal?: string;
  notGoal?: string;
  materials?: string;
  output?: string;
};

function clipLine(raw: unknown, max = 240): string {
  if (typeof raw !== "string") {
    return "";
  }
  return raw.replace(/\s+/g, " ").trim().slice(0, max);
}

export function composeWorkerBrief(parts: WorkerBriefParts): string {
  const task = clipLine(parts.task, 800);
  const lines: string[] = [];
  const goal = clipLine(parts.goal);
  const notGoal = clipLine(parts.notGoal);
  const materials = clipLine(parts.materials);
  const output = clipLine(parts.output);
  if (goal) {
    lines.push(`要做：${goal}`);
  }
  if (notGoal) {
    lines.push(`不要做：${notGoal}`);
  }
  if (materials) {
    lines.push(`材料：${materials}`);
  }
  if (output) {
    lines.push(`回报：${output}`);
  }
  if (lines.length === 0) {
    return task;
  }
  if (!task) {
    return lines.join("\n");
  }
  return `${task}\n\n${lines.join("\n")}`;
}

export function isIncompleteWorkerBrief(text: string): boolean {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) {
    return true;
  }
  return VAGUE_ONLY_RE.test(t);
}

export function validateWorkerBrief(
  parts: WorkerBriefParts,
): { ok: true; brief: string } | { ok: false; error: string } {
  const brief = composeWorkerBrief(parts);
  const core = clipLine(parts.task) || clipLine(parts.goal);
  const extras = clipLine(parts.notGoal) || clipLine(parts.materials) || clipLine(parts.output);
  if (!brief.trim() || (isIncompleteWorkerBrief(core) && !extras)) {
    return {
      ok: false,
      error:
        "任务书不完整。子会话看不到本轮对话，请写清：要做、不要做、材料路径、回报格式。不要只写「帮我看看」。",
    };
  }
  return { ok: true, brief };
}
