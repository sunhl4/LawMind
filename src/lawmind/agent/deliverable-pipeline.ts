/**
 * Formal deliverable requests (ESG report, contracts, etc.) must use engine tools
 * and the review workbench — not chat-only prose or fake "saved to workspace".
 */

import { route } from "../router/keyword-route.js";
import type { DeliverableType, TaskIntent } from "../types.js";
import { isModelConnectivityCheckQuestion } from "./model-connectivity-check.js";
import { isModelIdentityQuestion } from "./model-identity-reply.js";

/** Auto-run engine workflow for long-form reports (ESG etc.), not contracts that need fact gathering. */
const DELIVERABLE_TYPES_AUTO_WORKFLOW = new Set<DeliverableType>([
  "report.esg",
  "report.general",
  "report.compliance",
  "report.learning",
]);

const DRAFT_VERB_RE = /(写|起草|撰写|生成|拟写|拟定|制作|输出|编写)/;
const DRAFT_NOUN_RE = /(报告|合同|律师函|文书|ESG|可持续|意见|起诉|答辩|租赁|协议|白皮书|备忘录)/i;

export function routeInstructionForDeliverable(instruction: string): TaskIntent {
  return route({ instruction: instruction.trim() });
}

/**
 * Opt-in auto execute_workflow shortcut (D1).
 * Default on for ESG/report heuristics; disable via policy `autoDeliverableWorkflow: false`
 * or `LAWMIND_AUTO_DELIVERABLE_WF=0`.
 */
export function isAutoDeliverableWorkflowEnabled(
  policy?: { autoDeliverableWorkflow?: boolean } | null,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (policy?.autoDeliverableWorkflow === false) {
    return false;
  }
  const raw = env.LAWMIND_AUTO_DELIVERABLE_WF?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off" || raw === "no") {
    return false;
  }
  return true;
}

/** True when the lawyer clearly wants a formal docx-bound deliverable, not Q&A. */
export function shouldAutoRunDeliverableWorkflow(
  instruction: string,
  opts?: { policy?: { autoDeliverableWorkflow?: boolean } | null },
): boolean {
  if (!isAutoDeliverableWorkflowEnabled(opts?.policy)) {
    return false;
  }
  const core = instruction.trim();
  if (!core || core.length > 2500) {
    return false;
  }
  if (isModelIdentityQuestion(core) || isModelConnectivityCheckQuestion(core)) {
    return false;
  }
  if (!DRAFT_VERB_RE.test(core) || !DRAFT_NOUN_RE.test(core)) {
    return false;
  }
  const intent = routeInstructionForDeliverable(core);
  if (intent.kind !== "draft.word") {
    return false;
  }
  const dt = intent.deliverableType;
  if (!dt || !DELIVERABLE_TYPES_AUTO_WORKFLOW.has(dt)) {
    return false;
  }
  return true;
}

export function buildDeliverablePipelineSystemNote(instruction: string): string | undefined {
  if (!shouldAutoRunDeliverableWorkflow(instruction)) {
    return undefined;
  }
  return `## 本条指令：正式交付物（原则指针）

律师本条要求产出**可审阅的正式文稿**（非聊天摘要）。按交付用语 Skill：

1. **优先** \`execute_workflow\`（或 \`plan_task\` → \`draft_document\`）写入工作区；未成功调用工具不得声称已保存。
2. 检索为空仍应降级起草（【待补充】+ 框架），待律师审核；勿因空检索放弃工具链。
3. 指引律师打开 **「审核」**；通过前不得声称可对外或已导出 Word。
4. 审核通过（或本条对话且策略允许 \`approve=true\`）后再 \`render_document\`。

安全硬红线不变：未批准外发、空修订、密钥与假完成。`;
}

export function formatDeliverableWorkflowReply(data: {
  taskId?: string;
  title?: string;
  deliverableType?: string;
  status?: string;
  sectionsCount?: number;
  steps?: string[];
  outputPath?: string;
  researchDegraded?: boolean;
  error?: string;
}): string {
  const lines: string[] = [];
  lines.push("律师您好，已按**正式交付流程**处理您的指令（非仅在对话中生成摘要）。");
  if (data.researchDegraded) {
    lines.push("");
    lines.push(
      "说明：法规/案例检索结果为空或超时，已按「可交付物优先」继续生成**带章节框架与待补充项**的草稿，请您在审核台补全事实与引用。",
    );
  }
  if (data.taskId) {
    lines.push("");
    lines.push(`- **任务 ID**：\`${data.taskId}\``);
  }
  if (data.title) {
    lines.push(`- **草稿标题**：《${data.title}》`);
  }
  if (data.deliverableType) {
    lines.push(`- **交付类型**：${data.deliverableType}`);
  }
  if (typeof data.sectionsCount === "number") {
    lines.push(`- **章节数**：${data.sectionsCount}`);
  }
  if (data.status === "delivered" && data.outputPath) {
    lines.push(`- **状态**：已渲染 Word（低风险自动路径）`);
    lines.push(`- **路径**：\`${data.outputPath}\``);
  } else {
    lines.push(`- **状态**：待您在 **审核台** 审阅（${data.status ?? "awaiting_lawyer_review"}）`);
    lines.push("");
    lines.push("### 下一步");
    lines.push("1. 打开顶部 **「审核」**，找到上述任务 ID 的草稿；");
    lines.push("2. 修改、补充后点击 **通过**；");
    lines.push("3. 再点击 **导出 Word**（或让我调用 `render_document`）生成正式 .docx。");
  }
  if (data.steps && data.steps.length > 0) {
    lines.push("");
    lines.push("### 执行步骤");
    for (const s of data.steps.slice(-8)) {
      lines.push(`- ${s}`);
    }
  }
  if (data.error) {
    lines.push("");
    lines.push(`⚠ 工作流未完全成功：${data.error}`);
    lines.push(
      "您仍可在审核台查看是否已有部分草稿，或修正模型/检索配置后让我重试 `execute_workflow`。",
    );
  }
  return lines.join("\n");
}
