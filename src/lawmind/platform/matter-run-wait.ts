/**
 * 等待超时的展示口径与产品默认值。
 *
 * 单独一个文件是刻意的：桌面渲染进程也要用到原因文案与「再等几天」，
 * 而 `matter-run.ts` / `matter-run-store.ts` 带 node 内置模块，不能被拖进前端包。
 * 这里只放常量与类型引用（`import type` 会被擦除），没有任何运行时依赖。
 */

import type { MatterRunWaitReason } from "./matter-run.js";

/**
 * 律师看得懂的等待原因。只用于展示；判定仍用 `reason` 原值，
 * 展示层改名不能影响唤醒、升级和审计。
 */
export const MATTER_RUN_WAIT_REASON_LABELS_ZH: Record<MatterRunWaitReason, string> = {
  client_documents: "等客户补件",
  counterparty_response: "等对方回函",
  court_filing: "等法院文书",
  lawyer_decision: "等律师决定",
  external_event: "等外部事件",
};

/** 「再等」的默认天数。 */
export const MATTER_RUN_WAIT_EXTEND_DEFAULT_DAYS = 3;

/** 「再等」的上限：一次点按最多往后推一个月，避免把待办往后藏。 */
export const MATTER_RUN_WAIT_EXTEND_MAX_DAYS = 30;
