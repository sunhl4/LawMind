/**
 * 交付运行（delivery run）：把「等后台工作流 → 收集草稿 → 补渲染 → 准备外发」拆成
 * MatterRun 的可恢复步骤。
 *
 * 边界：
 * - 只存执行状态，案件真相源仍是 `cases/<matterId>/` 与 `drafts/`。
 * - 外发步骤只写待发信 / 待拍板，绝不调用 `send_email`。
 * - job 的终态由桌面进程唤醒；本模块不轮询 job，也不猜步骤结果。
 */

import { loadMatterRun, createMatterRunOnDisk } from "./matter-run-store.js";
import type { MatterRun, MatterRunStepInput } from "./matter-run.js";

export const DELIVERY_RUN_STEP_KINDS = {
  waitJob: "delivery_wait_job",
  collect: "delivery_collect",
  render: "delivery_render",
  outboundPrepare: "delivery_outbound_prepare",
} as const;

export const DELIVERY_RUN_JOB_REF_PREFIX = "job:";
export const DELIVERY_RUN_AUTOMATION_REF_PREFIX = "automation:";

/**
 * 是否为这次自动办件创建 delivery run。
 *
 * 只要求「有模板、已入队 job」；没有模板的纯收件箱/自定义交办不建 run。
 * `LAWMIND_DELIVERY_RUN=0` 是唯一回滚开关。
 */
export function shouldCreateDeliveryRun(
  templateId: string | undefined,
  envValue: string | undefined = process.env.LAWMIND_DELIVERY_RUN,
): boolean {
  return Boolean(templateId?.trim()) && envValue !== "0";
}

export type CreateDeliveryRunInput = {
  matterId: string;
  jobId: string;
  automationId?: string;
  title?: string;
  at?: string;
};

/** 同一个 job 只对应一个 delivery run；重放时复用，不产生第二条。 */
export function deliveryRunId(jobId: string): string {
  const safe = jobId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 96);
  return `run_delivery_${safe}`;
}

export function buildDeliveryRunSteps(input: CreateDeliveryRunInput): MatterRunStepInput[] {
  const jobRef = `${DELIVERY_RUN_JOB_REF_PREFIX}${input.jobId}`;
  const automationRefs = input.automationId
    ? [`${DELIVERY_RUN_AUTOMATION_REF_PREFIX}${input.automationId}`]
    : [];
  return [
    {
      stepId: "wait_job",
      kind: DELIVERY_RUN_STEP_KINDS.waitJob,
      title: "等待后台工作流完成",
      // 每次「等待 → 唤醒」会消耗一次尝试；等待本身不是失败，上限只防空转。
      maxAttempts: 20,
      inputRefs: [jobRef, ...automationRefs],
    },
    {
      stepId: "collect",
      kind: DELIVERY_RUN_STEP_KINDS.collect,
      title: "收集本次产出的草稿",
      maxAttempts: 2,
      inputRefs: [jobRef],
    },
    {
      stepId: "render",
      kind: DELIVERY_RUN_STEP_KINDS.render,
      title: "补齐未导出的稿子",
      maxAttempts: 2,
      inputRefs: [jobRef],
    },
    {
      stepId: "outbound",
      kind: DELIVERY_RUN_STEP_KINDS.outboundPrepare,
      title: "准备待发信或待拍板",
      maxAttempts: 2,
      inputRefs: [jobRef, ...automationRefs],
    },
  ];
}

/**
 * 幂等创建 delivery run。
 *
 * 自动办件重试、进程重启、同一 job 被再次唤醒都复用同一个 runId；
 * 已有 run 时不覆盖它的游标与步骤状态。
 */
export function createDeliveryRunOnDisk(
  workspaceDir: string,
  input: CreateDeliveryRunInput,
): MatterRun {
  const runId = deliveryRunId(input.jobId);
  const existing = loadMatterRun(workspaceDir, input.matterId, runId, { tolerateCorrupt: true });
  if (existing) {
    return existing;
  }
  return createMatterRunOnDisk(workspaceDir, {
    matterId: input.matterId,
    runId,
    ...(input.title?.trim() ? { title: input.title.trim() } : {}),
    steps: buildDeliveryRunSteps(input),
    ...(input.at ? { at: input.at } : {}),
  });
}

/** 把 step 的 `inputRefs` 里的 job / automation 引用取出来。 */
export function deliveryRunRefs(step: { inputRefs?: readonly string[] }): {
  jobId?: string;
  automationId?: string;
} {
  let jobId: string | undefined;
  let automationId: string | undefined;
  for (const ref of step.inputRefs ?? []) {
    if (ref.startsWith(DELIVERY_RUN_JOB_REF_PREFIX)) {
      jobId = ref.slice(DELIVERY_RUN_JOB_REF_PREFIX.length) || undefined;
    } else if (ref.startsWith(DELIVERY_RUN_AUTOMATION_REF_PREFIX)) {
      automationId = ref.slice(DELIVERY_RUN_AUTOMATION_REF_PREFIX.length) || undefined;
    }
  }
  return {
    ...(jobId ? { jobId } : {}),
    ...(automationId ? { automationId } : {}),
  };
}
