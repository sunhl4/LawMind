/**
 * G3：判定项明细面板。
 *
 * 显示「本次每项由谁判的、结果如何」。用途是**可解释性**：律师能看见
 * 哪些项是确定性规则判的（零方差）、哪些是模型判的、哪些还需他定夺。
 *
 * 口径（与 `lint/types.ts` 一致）：**通过核对 ≠ 法律正确**。
 * 面板只报覆盖与结论，不报任何"正确率"。
 */
import { useEffect, useState, type ReactNode } from "react";
import { apiGetJson } from "./api-client";

type TaskJudgment = {
  present?: boolean;
  coverageNote?: string;
  counts?: {
    total: number;
    machine: number;
    judged: number;
    decidedByLawyer: number;
    notCovered: number;
    unavailable: number;
  };
  notCovered?: Array<{ label: string; tier: string }>;
  unavailable?: Array<{ label: string }>;
  escalation?: Array<{ label: string; reason: string }>;
};

const TIER_LABEL: Record<string, string> = {
  machine: "确定性规则判定",
  judge: "独立审稿判断",
  lawyer: "待您定夺",
};

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; data: TaskJudgment }
  | { kind: "error"; message: string };

export type LawmindJudgmentItemsPanelProps = {
  apiBase?: string;
  taskId: string;
};

export function LawmindJudgmentItemsPanel(
  props: LawmindJudgmentItemsPanelProps,
): ReactNode {
  const { apiBase, taskId } = props;
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    if (!apiBase) {
      setState({ kind: "error", message: "未连接本地服务，暂时读不到核对明细。" });
      // 显式 `undefined`（而不是裸 `return`）：本 effect 在正常路径返回清理函数，
      // 两种返回形态必须一致，否则 lint 的 `consistent-return` 会红。
      return undefined;
    }
    let cancelled = false;
    setState({ kind: "loading" });
    void apiGetJson<TaskJudgment>(
      apiBase,
      `/api/judgment/task?taskId=${encodeURIComponent(taskId)}`,
    )
      .then((body) => {
        if (!cancelled) {
          setState({ kind: "ready", data: body });
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState({
            kind: "error",
            message: err instanceof Error && err.message ? err.message : "读取失败。",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [apiBase, taskId]);

  if (state.kind === "loading") {
    return (
      <section className="lm-callout lm-callout-info" data-testid="lm-judgment-items">
        <p className="lm-callout-body">正在读取核对明细…</p>
      </section>
    );
  }

  if (state.kind === "error") {
    return (
      <section className="lm-callout lm-callout-warn" data-testid="lm-judgment-items">
        <p className="lm-callout-body">暂时读不到核对明细：{state.message}</p>
      </section>
    );
  }

  const { data } = state;
  if (!data.present) {
    return (
      <section className="lm-callout lm-callout-info" data-testid="lm-judgment-items">
        <p className="lm-callout-title">核对明细</p>
        <p className="lm-callout-body">本件暂无逐项核对记录。</p>
      </section>
    );
  }

  const counts = data.counts;

  return (
    <section className="lm-callout lm-callout-info" data-testid="lm-judgment-items">
      <p className="lm-callout-title">核对明细</p>
      {counts ? (
        <ul className="lm-list" data-testid="lm-judgment-counts">
          <li>
            共核对 {counts.total} 项
          </li>
          {counts.machine > 0 ? <li>{TIER_LABEL.machine}：{counts.machine} 项</li> : null}
          {counts.judged > 0 ? <li>{TIER_LABEL.judge}：{counts.judged} 项</li> : null}
          {counts.decidedByLawyer > 0 ? (
            <li>{TIER_LABEL.lawyer}：{counts.decidedByLawyer} 项</li>
          ) : null}
        </ul>
      ) : null}

      {(data.notCovered ?? []).length > 0 ? (
        <div data-testid="lm-judgment-not-covered">
          <p className="lm-callout-body">以下 {data.notCovered!.length} 项本次未覆盖：</p>
          <ul className="lm-list">
            {data.notCovered!.map((row, idx) => (
              <li key={`${idx}-${row.label}`}>{row.label}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {(data.unavailable ?? []).length > 0 ? (
        <div data-testid="lm-judgment-unavailable">
          {/* 不可用 ≠ 未覆盖：前者是"没判出来"，后者是"判出问题"。 */}
          <p className="lm-callout-body">
            以下 {data.unavailable!.length} 项未能自动核对，需人工确认：
          </p>
          <ul className="lm-list">
            {data.unavailable!.map((row, idx) => (
              <li key={`${idx}-${row.label}`}>{row.label}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {data.coverageNote ? (
        <p className="lm-callout-body" data-testid="lm-judgment-coverage-note">
          {data.coverageNote}
        </p>
      ) : null}
    </section>
  );
}
