import { useEffect, useState, type ReactNode } from "react";
import {
  getMailIntentPending,
  resolveMailIntent,
  subscribeMailIntentPending,
} from "./lawmind-mail-intent-bus";
import { requestOpenAutomationsSettings } from "./lawmind-automations-nav-bus";

type Props = {
  matterId?: string | null;
};

/** Confirm strip when chat text matches mail short-path or product-meta intercept. */
export function LawmindMailIntentBanner(props: Props): ReactNode {
  const { matterId } = props;
  const [pending, setPending] = useState(getMailIntentPending);

  useEffect(() => subscribeMailIntentPending(() => setPending(getMailIntentPending())), []);

  if (!pending) {
    return null;
  }

  const needsMatter =
    pending.kind === "mail-contract-review" || pending.kind === "mail-inbox-digest";
  const matterOk = Boolean(matterId?.trim());

  return (
    <div
      className="lm-workflow-suggest-banner"
      role="status"
      data-testid="lm-mail-intent-banner"
    >
      <div>
        <strong>{pending.title}</strong>
        <p className="lm-meta" style={{ margin: "4px 0 0" }}>
          {pending.summary}
        </p>
        {needsMatter && !matterOk ? (
          <p className="lm-meta lm-text-danger" role="alert">
            请先选择案件，再点「一键审邮件合同」。
          </p>
        ) : null}
      </div>
      <div className="lm-workflow-suggest-actions">
        {pending.kind === "meta" ? (
          <button
            type="button"
            className="lm-btn lm-btn-small"
            data-testid="lm-mail-intent-open-automations"
            onClick={() => {
              requestOpenAutomationsSettings();
              resolveMailIntent("open-settings");
            }}
          >
            打开自动办件
          </button>
        ) : (
          <button
            type="button"
            className="lm-btn lm-btn-small"
            data-testid="lm-mail-intent-run"
            disabled={needsMatter && !matterOk}
            title={!matterOk ? "请先选择案件" : undefined}
            onClick={() => resolveMailIntent("run")}
          >
            一键审邮件合同
          </button>
        )}
        <button
          type="button"
          className="lm-btn lm-btn-ghost lm-btn-small"
          data-testid="lm-mail-intent-continue"
          onClick={() => resolveMailIntent("continue")}
        >
          仍用对话
        </button>
        <button
          type="button"
          className="lm-btn lm-btn-ghost lm-btn-small"
          data-testid="lm-mail-intent-dismiss"
          onClick={() => resolveMailIntent("dismiss")}
        >
          取消
        </button>
      </div>
    </div>
  );
}
