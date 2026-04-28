import type { ReactNode } from "react";
import type { TaskCheckpoint } from "../../../../src/lawmind/tasks/checkpoints.ts";

type Props = {
  checkpoints: TaskCheckpoint[] | null | undefined;
};

export function LawmindTaskCheckpoints(props: Props): ReactNode {
  const { checkpoints } = props;
  if (!checkpoints?.length) {
    return null;
  }
  return (
    <div className="lm-checkpoints" aria-label="任务进度">
      <div className="lm-meta lm-checkpoints-intro">
        流程节点（由任务状态推导）
      </div>
      <ol className="lm-checkpoints-list">
        {checkpoints.map((c) => (
          <li
            key={c.id}
            className={c.reached ? "lm-checkpoint-reached" : "lm-checkpoint-pending"}
            data-testid={`checkpoint-${c.id}`}
          >
            {c.reached ? "✓ " : "○ "}
            {c.label}
          </li>
        ))}
      </ol>
    </div>
  );
}
