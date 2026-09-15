/**
 * 成员协作面板 — Firm 门控：邀请同事进同一案件、签出材料、接受邀请码。
 * Solo 默认不渲染（edition.features.matterReplicaCollab === false）。
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { apiGetJson, apiSendJson, errorMessage } from "../api-client";
import { useEdition } from "../use-edition";

type Identity = {
  lawyerId: string;
  displayName: string;
  email?: string;
};

type Member = {
  lawyerId: string;
  displayName: string;
  email?: string;
  role: string;
  status: string;
};

type Invite = {
  inviteId: string;
  email: string;
  role: string;
  token: string;
  status: string;
  expiresAt: string;
  invitedByName: string;
};

type Lock = {
  lockId: string;
  relPath: string;
  holderDisplayName: string;
  expiresAt: string;
};

type RoleLabels = Record<string, string>;

type Props = {
  apiBase: string;
  matterId: string;
};

const INVITE_ROLES = [
  { value: "associate", label: "协办" },
  { value: "paralegal", label: "助理" },
  { value: "readonly", label: "只读" },
  { value: "external", label: "外协" },
  { value: "lead", label: "主办（共同）" },
] as const;

export function MatterReplicaPanel({ apiBase, matterId }: Props): ReactNode {
  const edition = useEdition(apiBase);
  const [enabled, setEnabled] = useState(false);
  const [roleLabels, setRoleLabels] = useState<RoleLabels>({});
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [locks, setLocks] = useState<Lock[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [nameDraft, setNameDraft] = useState("");
  const [emailDraft, setEmailDraft] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<string>("associate");
  const [acceptToken, setAcceptToken] = useState("");
  const [lockPath, setLockPath] = useState("materials/");
  const [lastShare, setLastShare] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!apiBase?.trim() || !matterId?.trim()) {
      return;
    }
    setErr(null);
    try {
      const status = await apiGetJson<{
        ok?: boolean;
        enabled?: boolean;
        roleLabels?: RoleLabels;
        identity?: Identity | null;
      }>(apiBase, "/api/matter-replica/status");
      setEnabled(status.enabled === true);
      setRoleLabels(status.roleLabels ?? {});
      setIdentity(status.identity ?? null);
      if (status.identity) {
        setNameDraft(status.identity.displayName);
        setEmailDraft(status.identity.email ?? "");
      }
      if (!status.enabled) {
        setMembers([]);
        setInvites([]);
        setLocks([]);
        return;
      }
      const mem = await apiGetJson<{
        ok?: boolean;
        members?: Member[];
        invites?: Invite[];
        locks?: Lock[];
      }>(
        apiBase,
        `/api/matter-replica/membership?matterId=${encodeURIComponent(matterId)}`,
      );
      setMembers(mem.members ?? []);
      setInvites(mem.invites ?? []);
      setLocks(mem.locks ?? []);
    } catch (e) {
      setErr(errorMessage(e, "无法加载成员协作"));
    }
  }, [apiBase, matterId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Solo edition: hide entirely unless somehow enabled via policy (status.enabled)
  if (!edition.loading && !edition.features.matterReplicaCollab && !enabled) {
    return null;
  }

  async function saveIdentity(): Promise<void> {
    setBusy(true);
    setErr(null);
    setHint(null);
    try {
      await apiSendJson(apiBase, "/api/matter-replica/identity", "PUT", {
        displayName: nameDraft.trim(),
        email: emailDraft.trim() || undefined,
      });
      setHint("已保存你的协作身份");
      await refresh();
    } catch (e) {
      setErr(errorMessage(e, "保存失败"));
    } finally {
      setBusy(false);
    }
  }

  async function sendInvite(): Promise<void> {
    setBusy(true);
    setErr(null);
    setHint(null);
    setLastShare(null);
    try {
      const r = await apiSendJson<{
        ok?: boolean;
        invite?: Invite;
        shareText?: string;
        error?: string;
      }>(apiBase, "/api/matter-replica/invites", "POST", {
        matterId,
        email: inviteEmail.trim(),
        role: inviteRole,
      });
      if (r.shareText) {
        setLastShare(r.shareText);
        try {
          await navigator.clipboard.writeText(r.shareText);
          setHint("邀请已创建，分享文案已复制到剪贴板");
        } catch {
          setHint("邀请已创建，请复制下方分享文案发给同事");
        }
      } else {
        setHint("邀请已创建");
      }
      setInviteEmail("");
      await refresh();
    } catch (e) {
      setErr(errorMessage(e, "邀请失败"));
    } finally {
      setBusy(false);
    }
  }

  async function acceptInvite(): Promise<void> {
    setBusy(true);
    setErr(null);
    setHint(null);
    try {
      await apiSendJson(apiBase, "/api/matter-replica/invites/accept", "POST", {
        token: acceptToken.trim(),
      });
      setHint("已加入案件");
      setAcceptToken("");
      await refresh();
    } catch (e) {
      setErr(errorMessage(e, "接受邀请失败"));
    } finally {
      setBusy(false);
    }
  }

  async function acquireLock(): Promise<void> {
    setBusy(true);
    setErr(null);
    setHint(null);
    try {
      await apiSendJson(apiBase, "/api/matter-replica/locks/acquire", "POST", {
        matterId,
        relPath: lockPath.trim(),
      });
      setHint("已签出，同事将看到你正在修改");
      await refresh();
    } catch (e) {
      setErr(errorMessage(e, "签出失败"));
    } finally {
      setBusy(false);
    }
  }

  async function releaseLock(relPath: string): Promise<void> {
    setBusy(true);
    setErr(null);
    try {
      await apiSendJson(apiBase, "/api/matter-replica/locks/release", "POST", {
        matterId,
        relPath,
      });
      setHint("已释放签出");
      await refresh();
    } catch (e) {
      setErr(errorMessage(e, "释放失败"));
    } finally {
      setBusy(false);
    }
  }

  async function syncOps(): Promise<void> {
    setBusy(true);
    setErr(null);
    try {
      const r = await apiSendJson<{ published?: number; pulled?: number }>(
        apiBase,
        `/api/matter-replica/sync?matterId=${encodeURIComponent(matterId)}`,
        "POST",
        {},
      );
      setHint(`已同步记录管（发布 ${r.published ?? 0} · 拉取 ${r.pulled ?? 0}）`);
    } catch (e) {
      setErr(errorMessage(e, "同步失败（未配置共享中继时仅本机）"));
    } finally {
      setBusy(false);
    }
  }

  if (!enabled && edition.features.matterReplicaCollab) {
    // Feature flag on but gate off — rare; still show nothing noisy
  }

  if (!enabled) {
    return null;
  }

  return (
    <section
      className="lm-matter-replica"
      aria-label="成员协作"
      data-testid="lm-matter-replica-panel"
    >
      <div className="lm-matter-replica-head">
        <div>
          <strong>成员协作</strong>
          <p className="lm-meta">
            邀请同事用各自的 LawMind 共同办理本案。材料签出避免互相覆盖；不登录则路径与个人版相同。
          </p>
        </div>
        <button
          type="button"
          className="lm-btn lm-btn-secondary lm-btn-sm"
          disabled={busy}
          onClick={() => void syncOps()}
        >
          同步记录
        </button>
      </div>

      {err ? <p className="lm-meta lm-danger">{err}</p> : null}
      {hint ? <p className="lm-meta lm-ok">{hint}</p> : null}

      <div className="lm-matter-replica-block">
        <h4 className="lm-matter-replica-h">你的身份</h4>
        <div className="lm-matter-replica-row">
          <label className="lm-field">
            <span>姓名</span>
            <input
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              placeholder="例如：张三"
              data-testid="lm-replica-display-name"
            />
          </label>
          <label className="lm-field">
            <span>邮箱</span>
            <input
              value={emailDraft}
              onChange={(e) => setEmailDraft(e.target.value)}
              placeholder="用于邀请识别"
              data-testid="lm-replica-email"
            />
          </label>
          <button
            type="button"
            className="lm-btn lm-btn-sm"
            disabled={busy || !nameDraft.trim()}
            onClick={() => void saveIdentity()}
            data-testid="lm-replica-save-identity"
          >
            保存
          </button>
        </div>
        {identity ? (
          <p className="lm-meta">
            当前：{identity.displayName}
            {identity.email ? ` · ${identity.email}` : ""}
          </p>
        ) : (
          <p className="lm-meta">邀请同事前请先保存姓名。</p>
        )}
      </div>

      <div className="lm-matter-replica-block">
        <h4 className="lm-matter-replica-h">本案成员</h4>
        {members.length === 0 ? (
          <p className="lm-meta">尚无成员名册。保存身份后将自动登记你为主办。</p>
        ) : (
          <ul className="lm-matter-replica-list">
            {members.map((m) => (
              <li key={m.lawyerId}>
                <span>{m.displayName}</span>
                <span className="lm-meta">
                  {roleLabels[m.role] ?? m.role}
                  {m.email ? ` · ${m.email}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="lm-matter-replica-block">
        <h4 className="lm-matter-replica-h">邀请同事</h4>
        <div className="lm-matter-replica-row">
          <label className="lm-field">
            <span>同事邮箱</span>
            <input
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="colleague@firm.com"
              data-testid="lm-replica-invite-email"
            />
          </label>
          <label className="lm-field">
            <span>角色</span>
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value)}
              data-testid="lm-replica-invite-role"
            >
              {INVITE_ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="lm-btn lm-btn-sm"
            disabled={busy || !inviteEmail.trim() || !identity}
            onClick={() => void sendInvite()}
            data-testid="lm-replica-send-invite"
          >
            生成邀请码
          </button>
        </div>
        {lastShare ? (
          <pre className="lm-matter-replica-share" data-testid="lm-replica-share-text">
            {lastShare}
          </pre>
        ) : null}
        {invites.length > 0 ? (
          <ul className="lm-matter-replica-list">
            {invites.map((i) => (
              <li key={i.inviteId}>
                <span>
                  {i.email} · {roleLabels[i.role] ?? i.role}
                </span>
                <code className="lm-matter-replica-token">{i.token}</code>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="lm-matter-replica-block">
        <h4 className="lm-matter-replica-h">接受邀请</h4>
        <div className="lm-matter-replica-row">
          <label className="lm-field lm-field-grow">
            <span>邀请码</span>
            <input
              value={acceptToken}
              onChange={(e) => setAcceptToken(e.target.value)}
              placeholder="LM-XXXX-XXXX-XXXX-XXXX"
              data-testid="lm-replica-accept-token"
            />
          </label>
          <button
            type="button"
            className="lm-btn lm-btn-secondary lm-btn-sm"
            disabled={busy || !acceptToken.trim() || !identity}
            onClick={() => void acceptInvite()}
            data-testid="lm-replica-accept"
          >
            加入本案
          </button>
        </div>
      </div>

      <div className="lm-matter-replica-block">
        <h4 className="lm-matter-replica-h">材料签出</h4>
        <p className="lm-meta">改 Word / 关键材料前先签出，避免两人同时保存产生冲突副本。</p>
        <div className="lm-matter-replica-row">
          <label className="lm-field lm-field-grow">
            <span>相对路径（本案 materials 下）</span>
            <input
              value={lockPath}
              onChange={(e) => setLockPath(e.target.value)}
              placeholder="materials/合同初稿.docx"
              data-testid="lm-replica-lock-path"
            />
          </label>
          <button
            type="button"
            className="lm-btn lm-btn-sm"
            disabled={busy || !lockPath.trim() || !identity}
            onClick={() => void acquireLock()}
            data-testid="lm-replica-acquire-lock"
          >
            我来改
          </button>
        </div>
        {locks.length > 0 ? (
          <ul className="lm-matter-replica-list">
            {locks.map((l) => (
              <li key={l.lockId}>
                <span>
                  {l.relPath} · {l.holderDisplayName}
                </span>
                <button
                  type="button"
                  className="lm-btn lm-btn-ghost lm-btn-sm"
                  disabled={busy}
                  onClick={() => void releaseLock(l.relPath)}
                >
                  释放
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="lm-meta">当前无签出。</p>
        )}
      </div>
    </section>
  );
}
