/**
 * <MatterReasoningBoard /> — W11 视图组件 4/6（IRAC 推理 / 权威冲突）。
 */

import type { ReactNode } from "react";
import type { ReasoningReport } from "../../../../../src/lawmind/deliverables/index.ts";

type Props = {
  matterId: string;
  reasoning?: ReasoningReport | null;
};

export function MatterReasoningBoard({ matterId, reasoning }: Props): ReactNode {
  return (
    <section
      className="lm-matter-reasoning-board"
      data-testid="lm-matter-reasoning-board"
      data-matter-id={matterId}
    >
      <h3>推理图谱</h3>
      {!reasoning ? (
        <div className="lm-callout lm-callout-muted">
          尚无推理快照。
        </div>
      ) : (
        <div className="lm-callout">
          <div>
            <strong>依据检查：{reasoning.ready ? "通过" : "未通过"}</strong>
            <span className="lm-meta">
              {" "}
              · {reasoning.required ? "必过" : "可选"} · 阻断 {reasoning.blockerCount} · 警告{" "}
              {reasoning.warningCount}
            </span>
          </div>
          <ul style={{ paddingLeft: 18, marginTop: 8 }}>
            {reasoning.checks.map((c) => (
              <li key={c.key}>
                {c.passed ? "✓" : c.severity === "blocker" ? "✗" : "△"} {c.label}
                {c.hint ? <span className="lm-meta"> — {c.hint}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

export default MatterReasoningBoard;
