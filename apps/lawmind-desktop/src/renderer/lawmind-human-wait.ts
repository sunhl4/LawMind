/**
 * 律师能读的等待文案：不报工具名、不报 token，只说正在干什么。
 */

import { useEffect, useState } from "react";
import { inferDeskVerb } from "../../../../src/lawmind/desk/verbs.ts";

export type WaitIntent = "draft" | "review" | "research" | "general";

const TOOL_LABELS: Record<string, string> = {
  plan_task: "理清任务",
  research_task: "检索材料",
  draft_document: "起草文书",
  render_document: "生成可下载文件",
  execute_workflow: "走完整流程",
  register_template: "登记模板",
  list_templates: "查看模板",
  open_work_queue_item: "打开待办",
  request_approval: "请求审批",
  record_deadline: "记下期限",
  search_matter: "查本案材料",
  search_workspace: "查工作区材料",
  read_project_file: "读项目文件",
  search_statute: "查法条",
  search_case_law: "查类案",
  check_conflict_of_interest: "核利益冲突",
  get_matter_summary: "看案件摘要",
  list_matters: "列出案件",
  read_case_file: "读案件档案",
  add_case_note: "记下案件备忘",
  analyze_document: "分析文件",
  write_document: "写文件",
  list_tasks: "查看任务",
  list_drafts: "查看草稿",
  get_audit_trail: "查看操作记录",
  web_search: "上网检索",
  delegate_task: "交办给同事",
  delegate_to_role: "按岗位交办",
  list_delegations: "查看交办",
  get_delegation_result: "查看交办结果",
  notify_assistant: "通知其他助手",
  consult_assistant: "咨询其他助手",
  request_review: "请人复核",
};

export function inferWaitIntent(text: string): WaitIntent {
  const verb = inferDeskVerb(text);
  if (verb === "review") {
    return "review";
  }
  if (verb === "draft") {
    return "draft";
  }
  if (verb === "research") {
    return "research";
  }
  const t = text.replace(/\s+/g, "");
  if (!t) {
    return "general";
  }
  const reviewish = /(审查|审核|风险点|逐条)/.test(t);
  const draftish = /(起草|律师函|诉状|写一封|合同草案|公函)/.test(t);
  if (reviewish && !draftish) {
    return "review";
  }
  if (draftish) {
    return "draft";
  }
  if (/(检索|法条|判例|查一下|查这个问题|法规|裁判要旨)/.test(t)) {
    return "research";
  }
  return "general";
}

export function humanWaitCopy(params: { intent: WaitIntent; elapsedMs: number }): string {
  const { intent, elapsedMs } = params;
  if (elapsedMs < 8_000) {
    return "正在读你的要求…";
  }
  if (elapsedMs < 20_000) {
    if (intent === "draft") {
      return "正在写这封文书，请稍候。";
    }
    if (intent === "review") {
      return "正在审这份材料。";
    }
    if (intent === "research") {
      return "正在查这个问题。";
    }
    return "正在处理你的要求。";
  }
  if (intent === "draft") {
    return "还在写正文。复杂任务可能再等一会儿。";
  }
  if (intent === "review") {
    return "还在对照条款与风险，请稍候。";
  }
  if (intent === "research") {
    return "还在检索法规与类案，请稍候。";
  }
  return "还在处理。复杂任务可能再等一会儿。";
}

export function humanWaitCopyFromUserText(text: string, elapsedMs: number): string {
  return humanWaitCopy({ intent: inferWaitIntent(text), elapsedMs });
}

export function humanToolLabel(name: string): string {
  const key = name.trim();
  if (!key) {
    return "处理材料";
  }
  return TOOL_LABELS[key] ?? "处理材料";
}

export function humanToolSequenceLabel(names: string[]): string {
  const labels = names.map(humanToolLabel).filter((label, i, all) => i === 0 || label !== all[i - 1]);
  if (labels.length === 0) {
    return "";
  }
  return labels.join(" → ");
}

/** 发送中按秒切换人话，避免一直停在「加载中」。 */
export function useHumanWaitLine(loading: boolean, lastUserText: string): string {
  const [elapsedMs, setElapsedMs] = useState(0);
  useEffect(() => {
    if (!loading) {
      setElapsedMs(0);
      return;
    }
    const started = Date.now();
    setElapsedMs(0);
    const id = window.setInterval(() => {
      setElapsedMs(Date.now() - started);
    }, 1_000);
    return () => window.clearInterval(id);
  }, [loading, lastUserText]);
  return humanWaitCopyFromUserText(lastUserText, elapsedMs);
}
