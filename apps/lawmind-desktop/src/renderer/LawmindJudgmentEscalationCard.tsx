/**
 * G3：待定夺卡（`tier: "lawyer"` 的检查项）。
 *
 * 这些是**商业取舍 / 办案策略**类事项——系统的口径是「不判，只升级」
 * （`LAWMIND-LEGAL-COMPILER-ROADMAP.md` §2.3：主观裁量项永不编译）。
 * 卡片只把它们摆出来，**不替律师决定**。
 *
 * ## 两种 variant：为什么要分（G3 欠账二）
 *
 * 同一个列表，在两种场合下的正确行为**不一样**：
 *
 * | variant | 谁挂的 | 空的时候 | 读不到的时候 |
 * | --------- | ---------------------- | ---------------------- | -------------------- |
 * | `card` | 显式入口（律师主动来看） | 说「本件没有需要定夺的事项」 | 说「读不到」 |
 * | `inline` | 改稿台**旁路展示**（顺带看见） | **整块不出现** | 说「读不到」 |
 *
 * `inline` 是 `advisory`（单人执业缺省）能看见这张卡的唯一出路：`block` 姿态下引擎会把卡
 * 并进 `requiresAction`、在对话里停下等确认；`advisory` **刻意不打断**，
 * 于是必须有第二个展示点——否则律师永远看不到系统「没替他决定」的那几项。
 * 挂在改稿台上是对的：那正是他要签批、要看见「还有哪几处没定」的地方。
 *
 * 「空则不出现」**只适用于 inline**：改稿台不该每份稿子都多出一句「没有事项」的噪声。
 * 但**读不到时两种 variant 都必须说话**——把故障显示成「没有」正是本仓反复批评的失败模式。
 *
 * 文案纪律：不出现内部 id、模型名、概率数字、工程师术语。
 * 文案口径（是否打断）来自服务端返回的 `escalationPosture`，**界面不自己推断**。
 */
import { useEffect, useState, type ReactNode } from "react";
import { apiGetJson } from "./api-client";

export type JudgmentEscalationItem = {
  label: string;
  reason: string;
};

/** 升级卡的展示形态。 */
export type JudgmentEscalationVariant = "card" | "inline";

export type LawmindJudgmentEscalationCardProps = {
  apiBase?: string;
  /** 传则只看该任务；不传则看全工作区。 */
  taskId?: string;
  /**
   * `card`（默认）：显式入口，空 / 错 / 有内容三态都显示。
   * `inline`：改稿台旁路展示，**没有待定夺项时整块不出现**。
   */
  variant?: JudgmentEscalationVariant;
  onDismiss?: () => void;
  /** 律师点「已确认口径」时回调（不传则不显示该按钮）。 */
  onAcknowledge?: () => void;
};

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; items: JudgmentEscalationItem[]; posture: "advisory" | "block" }
  | { kind: "error"; message: string };

/** 服务端未表态时的缺省口径：按「已经停下等确认」说（更保守，不会让律师以为无人处理）。 */
const DEFAULT_POSTURE: "advisory" | "block" = "block";

export function LawmindJudgmentEscalationCard(
  props: LawmindJudgmentEscalationCardProps,
): ReactNode {
  const { apiBase, taskId, variant = "card", onDismiss, onAcknowledge } = props;
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    if (!apiBase) {
      setState({ kind: "error", message: "未连接本地服务，暂时读不到待定夺事项。" });
      // 显式 `undefined`（而不是裸 `return`）：本 effect 在正常路径返回清理函数，
      // 两种返回形态必须一致，否则 lint 的 `consistent-return` 会红。
      return undefined;
    }
    let cancelled = false;
    setState({ kind: "loading" });
    const path = taskId
      ? `/api/judgment/task?taskId=${encodeURIComponent(taskId)}`
      : "/api/judgment/escalations";
    void apiGetJson<{
      ok?: boolean;
      escalation?: JudgmentEscalationItem[];
      escalationPosture?: unknown;
      tasks?: Array<{ items: JudgmentEscalationItem[] }>;
    }>(apiBase, path)
      .then((body) => {
        if (cancelled) {
          return;
        }
        const items = taskId
          ? (body.escalation ?? [])
          : (body.tasks ?? []).flatMap((t) => t.items ?? []);
        const posture =
          body.escalationPosture === "advisory" || body.escalationPosture === "block"
            ? body.escalationPosture
            : DEFAULT_POSTURE;
        setState({ kind: "ready", items, posture });
      })
      .catch((err: unknown) => {
        if (cancelled) {
          return;
        }
        setState({
          kind: "error",
          message:
            err instanceof Error && err.message
              ? `暂时读不到待定夺事项：${err.message}`
              : "暂时读不到待定夺事项。",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [apiBase, taskId]);

  const isInline = variant === "inline";

  // 读不到时**两种 variant 都要说话**——把故障说成「没有」是本仓最忌的失败模式。
  if (state.kind === "error") {
    return (
      <section
        className="lm-callout lm-callout-warn"
        data-testid="lm-judgment-escalation"
        data-variant={variant}
        data-state="error"
        role="status"
      >
        {isInline ? null : <p className="lm-callout-title">需您定夺</p>}
        <p className="lm-callout-body">{state.message}</p>
      </section>
    );
  }

  // 正在读：inline 不占位（改稿台不该闪一条占位内容）。
  if (state.kind === "loading") {
    if (isInline) {
      return null;
    }
    return (
      <section
        className="lm-callout lm-callout-info"
        data-testid="lm-judgment-escalation"
        data-variant={variant}
        data-state="loading"
      >
        <p className="lm-callout-title">需您定夺</p>
        <p className="lm-callout-body">正在读取…</p>
      </section>
    );
  }

  if (state.items.length === 0) {
    // inline：没有事项就**什么都不说**（不产生噪声）；显式入口则如实说「没有」。
    if (isInline) {
      return null;
    }
    return (
      <section
        className="lm-callout lm-callout-info"
        data-testid="lm-judgment-escalation"
        data-variant={variant}
        data-state="empty"
      >
        <p className="lm-callout-title">需您定夺</p>
        <p className="lm-callout-body">本件没有需要您定夺的取舍事项。</p>
      </section>
    );
  }

  const advisory = state.posture === "advisory";
  const title = isInline
    ? advisory
      ? `本件有 ${state.items.length} 处系统未代为决定`
      : `本件有 ${state.items.length} 处需您定夺`
    : `本件有 ${state.items.length} 处需您定夺`;
  const lead = "这些事项取决于商业取舍或办案策略，不同律师会给出不同答案；系统只把它们摆出来，不代为选择。";
  // 收尾句必须随姿态变：`advisory` **没有**停下流程，说「在此之前不会继续」是假的。
  const closing = advisory
    ? "签批前请确认按哪种口径办理（本提示不打断当前流程）。"
    : "请确认按哪种口径办理；在此之前，系统不会替您选一条路继续。";

  return (
    <section
      className="lm-callout lm-callout-warn"
      data-testid="lm-judgment-escalation"
      data-variant={variant}
      data-state="items"
      data-posture={state.posture}
      role="status"
    >
      <p className="lm-callout-title">{title}</p>
      <p className="lm-callout-body">{lead}</p>
      <ul className="lm-list" data-testid="lm-judgment-escalation-items">
        {state.items.map((item, idx) => (
          <li key={`${idx}-${item.label}`}>
            <span>{item.label}</span>
            {item.reason ? <span className="lm-callout-body">（{item.reason}）</span> : null}
          </li>
        ))}
      </ul>
      <p className="lm-callout-body">{closing}</p>
      <div className="lm-row">
        {onAcknowledge ? (
          <button type="button" className="lm-button" onClick={onAcknowledge}>
            已确认口径
          </button>
        ) : null}
        {onDismiss ? (
          <button type="button" className="lm-button lm-button-ghost" onClick={onDismiss}>
            稍后处理
          </button>
        ) : null}
      </div>
    </section>
  );
}
