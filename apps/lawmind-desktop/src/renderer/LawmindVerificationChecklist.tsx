import type { ReactNode } from "react";
import type { VerificationChecklistView } from "../../../../src/lawmind/deliverables/verification-checklist.ts";

type Props = {
  view: VerificationChecklistView | null | undefined;
  checked: Record<string, boolean>;
  onToggle: (itemId: string, value: boolean) => void;
  /** When true, primary approve should be disabled by host */
  disableApproveHint?: boolean;
};

/**
 * Skills E6 — attorney verification checklist (epic-checklist-after right rail).
 */
export function LawmindVerificationChecklist(props: Props): ReactNode {
  const { view, checked, onToggle } = props;
  if (!view?.spec) {
    return null;
  }
  const items = Array.isArray(view.spec.items) ? view.spec.items : [];
  const requiredDone = items.filter((i) => i.required && checked?.[i.id]).length;
  const requiredTotal = view.requiredTotal ?? items.filter((i) => i.required).length;
  const complete = requiredDone >= requiredTotal;
  const pct = requiredTotal > 0 ? Math.round((requiredDone / requiredTotal) * 100) : 100;

  return (
    <section
      className="lm-verification-checklist"
      aria-label="律师必核清单"
      data-complete={complete ? "true" : "false"}
      data-testid="lm-verification-checklist"
    >
      <header className="lm-verification-checklist-head">
        <strong>律师必核清单</strong>
        <span className="lm-verification-checklist-progress" data-testid="lm-verification-progress">
          {requiredDone}/{requiredTotal}
        </span>
      </header>
      <div className="lm-verification-checklist-bar" aria-hidden="true">
        <span style={{ width: `${pct}%` }} />
      </div>
      <p className="lm-meta">完成必核后方可通过签批。可选项目供记录，不阻断。</p>
      <ul className="lm-verification-checklist-list">
        {items.map((item) => (
          <li key={item.id}>
            <label className="lm-verification-checklist-item">
              <input
                type="checkbox"
                checked={Boolean(checked[item.id])}
                onChange={(e) => onToggle(item.id, e.target.checked)}
              />
              <span>
                {item.label}
                {item.required ? <abbr title="必核">*</abbr> : null}
              </span>
            </label>
          </li>
        ))}
      </ul>
      {!complete ? (
        <p className="lm-text-warn lm-verification-checklist-gate" role="status">
          完成必核后方可签批
        </p>
      ) : (
        <p className="lm-meta lm-verification-checklist-gate" role="status">
          必核已完成，可以签批。
        </p>
      )}
    </section>
  );
}
