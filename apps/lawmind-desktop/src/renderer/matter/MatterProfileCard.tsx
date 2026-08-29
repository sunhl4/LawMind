import { useEffect, useState, type ReactNode } from "react";
import { errorMessage, messageFromOkFalseBody } from "../api-client";
import { apiPost } from "../lawmind-api-routes.ts";

export type MatterProfilePayload = {
  matterId: string;
  title: string;
  clientId?: string;
  sensitivity: "normal" | "high" | "restricted";
  status: string;
  causeOfAction?: string;
  counterparty?: string;
  needsEnrichment: boolean;
};

type Props = {
  apiBase: string;
  profile: MatterProfilePayload;
  onSaved?: (profile: MatterProfilePayload, statusLine?: string) => void;
};

export function MatterProfileCard(props: Props): ReactNode {
  const { apiBase, profile, onSaved } = props;
  const [open, setOpen] = useState(profile.needsEnrichment);
  const [title, setTitle] = useState(profile.title);
  const [clientId, setClientId] = useState(profile.clientId ?? "");
  const [causeOfAction, setCauseOfAction] = useState(profile.causeOfAction ?? "");
  const [counterparty, setCounterparty] = useState(profile.counterparty ?? "");
  const [sensitivity, setSensitivity] = useState(profile.sensitivity);
  const [conflictCheckConfirmed, setConflictCheckConfirmed] = useState(profile.status !== "intake");
  const [engagementAccepted, setEngagementAccepted] = useState(profile.status !== "intake");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  useEffect(() => {
    setTitle(profile.title);
    setClientId(profile.clientId ?? "");
    setCauseOfAction(profile.causeOfAction ?? "");
    setCounterparty(profile.counterparty ?? "");
    setSensitivity(profile.sensitivity);
    setConflictCheckConfirmed(profile.status !== "intake");
    setEngagementAccepted(profile.status !== "intake");
    if (profile.needsEnrichment) {
      setOpen(true);
    }
  }, [profile]);

  const save = async () => {
    setBusy(true);
    setErr(null);
    setOkMsg(null);
    try {
      const j = await apiPost(apiBase, "/api/matters/profile", {
        matterId: profile.matterId,
        title: title.trim() || profile.matterId,
        clientId: clientId.trim(),
        causeOfAction: causeOfAction.trim(),
        counterparty: counterparty.trim(),
        sensitivity,
        conflictCheckConfirmed,
        engagementAccepted,
      });
      if (!j.ok) {
        throw new Error(messageFromOkFalseBody(j, "保存案件档案失败"));
      }
      const next = j.profile as MatterProfilePayload | undefined;
      if (next) {
        onSaved?.(next, typeof j.statusLine === "string" ? j.statusLine : undefined);
      }
      setOkMsg("已保存。档案会用于记忆、检索与助手上下文。");
    } catch (e) {
      setErr(errorMessage(e, "保存失败"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="lm-matter-cockpit-card lm-matter-profile-card" aria-label="案件档案">
      <div className="lm-matter-profile-card-head">
        <div>
          <h3>案件档案</h3>
          <p className="lm-meta">
            建案只需文件夹；客户、案由、密级与接案确认可在此按需补全，利于记忆与助手偏置。
          </p>
        </div>
        <button
          type="button"
          className="lm-btn lm-btn-ghost lm-btn-sm"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          {open ? "收起" : profile.needsEnrichment ? "补全档案" : "编辑"}
        </button>
      </div>

      {profile.needsEnrichment ? (
        <div className="lm-callout lm-callout-warn" role="status">
          <p className="lm-callout-body">
            {profile.status === "intake"
              ? "接洽中：补全客户/案由并完成接案后可办理。"
              : "请补全客户与案由。"}
          </p>
        </div>
      ) : null}

      {!open ? (
        <dl className="lm-matter-profile-summary">
          <div>
            <dt>名称</dt>
            <dd>{profile.title}</dd>
          </div>
          <div>
            <dt>客户</dt>
            <dd>{profile.clientId?.trim() || "—"}</dd>
          </div>
          <div>
            <dt>案由</dt>
            <dd>{profile.causeOfAction?.trim() || "—"}</dd>
          </div>
          <div>
            <dt>对方</dt>
            <dd>{profile.counterparty?.trim() || "—"}</dd>
          </div>
        </dl>
      ) : (
        <div className="lm-matter-profile-form">
          <label className="lm-field">
            <span>案件名称</span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={busy}
              autoComplete="off"
            />
          </label>
          <div className="lm-matter-profile-grid">
            <label className="lm-field">
              <span>客户 / 委托人编号</span>
              <input
                type="text"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder="可与 clients/ 下档案对应"
                disabled={busy}
                autoComplete="off"
              />
            </label>
            <label className="lm-field">
              <span>对方当事人</span>
              <input
                type="text"
                value={counterparty}
                onChange={(e) => setCounterparty(e.target.value)}
                disabled={busy}
                autoComplete="off"
              />
            </label>
          </div>
          <label className="lm-field">
            <span>案由</span>
            <input
              type="text"
              value={causeOfAction}
              onChange={(e) => setCauseOfAction(e.target.value)}
              placeholder="例如 房屋租赁合同纠纷"
              disabled={busy}
              autoComplete="off"
            />
          </label>
          <label className="lm-field">
            <span>密级</span>
            <select
              value={sensitivity}
              onChange={(e) =>
                setSensitivity(e.target.value as "normal" | "high" | "restricted")
              }
              disabled={busy}
            >
              <option value="normal">普通保密</option>
              <option value="high">高度敏感</option>
              <option value="restricted">严格隔离</option>
            </select>
          </label>
          <fieldset className="lm-matter-profile-checks" disabled={busy}>
            <legend>接案确认</legend>
            <label className="lm-check-row">
              <input
                type="checkbox"
                checked={conflictCheckConfirmed}
                onChange={(e) => setConflictCheckConfirmed(e.target.checked)}
              />
              <span>已完成利益冲突检查</span>
            </label>
            <label className="lm-check-row">
              <input
                type="checkbox"
                checked={engagementAccepted}
                onChange={(e) => setEngagementAccepted(e.target.checked)}
              />
              <span>已正式接受委托（接案）</span>
            </label>
            <p className="lm-meta">
              两项均勾选后，案件阶段将变为「办理中」，并关闭冲突检查待办。
            </p>
          </fieldset>
          {err ? (
            <p className="lm-error" role="alert">
              {err}
            </p>
          ) : null}
          {okMsg ? (
            <p className="lm-meta" role="status">
              {okMsg}
            </p>
          ) : null}
          <div className="lm-matter-profile-actions">
            <button type="button" className="lm-btn lm-btn-sm" disabled={busy} onClick={() => void save()}>
              {busy ? "保存中…" : "保存档案"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
