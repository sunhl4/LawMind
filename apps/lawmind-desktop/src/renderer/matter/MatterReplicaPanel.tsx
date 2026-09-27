/**
 * 成员协作面板 — 邀请同事进同一案件、签出材料、接受邀请码。
 * 独立律师版默认可用；仅当功能键关闭且策略未打开时不渲染。
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

type MaterialFile = {
  relPath: string;
  fileName: string;
  sha256: string;
  size: number;
  updatedAt: string;
};

type FeedItem = {
  opId: string;
  kind: string;
  actorName: string;
  createdAt: string;
  title: string;
  relPath?: string;
};

type RoleLabels = Record<string, string>;

type SchedulerStatus = {
  enabled?: boolean;
  autoSync?: boolean;
  running?: boolean;
  watchingRelay?: boolean;
  relayDir?: string | null;
  matters?: number;
  syncs?: number;
  lastRunAt?: string | null;
  lastError?: string | null;
};

type CloudStatus = {
  configured?: boolean;
  endpoint?: string | null;
  hasToken?: boolean;
  inviteAuthority?: "cloud" | "local";
};

type Props = {
  apiBase: string;
  matterId: string;
  /** 嵌在概览折叠行里时不再重复标题。 */
  embedded?: boolean;
};

const INVITE_ROLES = [
  { value: "associate", label: "协办" },
  { value: "paralegal", label: "助理" },
  { value: "readonly", label: "只读" },
  { value: "external", label: "外协" },
  { value: "lead", label: "主办（共同）" },
] as const;

function cloudHost(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return endpoint;
  }
}

function folderLabel(dir: string): string {
  const parts = dir.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] || dir;
}

function formatBytes(n: number): string {
  if (n < 1024) {
    return `${n} B`;
  }
  if (n < 1024 * 1024) {
    return `${(n / 1024).toFixed(1)} KB`;
  }
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export const LAWMIND_REPLICA_JOINED_EVENT = "lawmind-replica-joined";

export function MatterReplicaPanel({ apiBase, matterId, embedded = false }: Props): ReactNode {
  const edition = useEdition(apiBase);
  const [enabled, setEnabled] = useState(false);
  const [statusReady, setStatusReady] = useState(false);
  const [roleLabels, setRoleLabels] = useState<RoleLabels>({});
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [locks, setLocks] = useState<Lock[]>([]);
  const [materials, setMaterials] = useState<MaterialFile[]>([]);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [scheduler, setScheduler] = useState<SchedulerStatus | null>(null);
  const [cloud, setCloud] = useState<CloudStatus | null>(null);
  const [relayDir, setRelayDir] = useState<string | null>(null);
  const [relayReady, setRelayReady] = useState(false);
  const [endpointDraft, setEndpointDraft] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [nameDraft, setNameDraft] = useState("");
  const [emailDraft, setEmailDraft] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<string>("associate");
  const [acceptToken, setAcceptToken] = useState("");
  const [editingIdentity, setEditingIdentity] = useState(false);
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
        cloud?: CloudStatus;
        sharedRelayDir?: string | null;
        relayReady?: boolean;
      }>(apiBase, "/api/matter-replica/status");
      setEnabled(status.enabled === true);
      setStatusReady(true);
      setRelayDir(status.sharedRelayDir ?? null);
      setRelayReady(status.relayReady === true || status.cloud?.configured === true);
      setRoleLabels(status.roleLabels ?? {});
      setIdentity(status.identity ?? null);
      setCloud(status.cloud ?? null);
      if (status.identity) {
        setNameDraft(status.identity.displayName);
        setEmailDraft(status.identity.email ?? "");
      }
      if (!status.enabled) {
        setMembers([]);
        setInvites([]);
        setLocks([]);
        setMaterials([]);
        setFeed([]);
        return;
      }
      const mem = await apiGetJson<{
        ok?: boolean;
        members?: Member[];
        invites?: Invite[];
        locks?: Lock[];
        materials?: MaterialFile[];
        feed?: FeedItem[];
      }>(
        apiBase,
        `/api/matter-replica/membership?matterId=${encodeURIComponent(matterId)}`,
      );
      setMembers(mem.members ?? []);
      setInvites(mem.invites ?? []);
      setLocks(mem.locks ?? []);
      setMaterials(mem.materials ?? []);
      setFeed(mem.feed ?? []);
      try {
        const sched = await apiGetJson<{ scheduler?: SchedulerStatus }>(
          apiBase,
          "/api/matter-replica/scheduler",
        );
        setScheduler(sched.scheduler ?? null);
      } catch {
        setScheduler(null);
      }
    } catch (e) {
      setErr(errorMessage(e, "无法加载成员协作"));
      setStatusReady(true);
    }
  }, [apiBase, matterId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Hidden only when the edition turns the feature off and policy has not opted in.
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
      setHint("已保存姓名");
      setEditingIdentity(false);
      await refresh();
    } catch (e) {
      setErr(errorMessage(e, "保存失败"));
    } finally {
      setBusy(false);
    }
  }

  async function connectCloud(): Promise<void> {
    const endpoint = endpointDraft.trim();
    if (!endpoint) {
      return;
    }
    setBusy(true);
    setErr(null);
    setHint(null);
    try {
      await apiSendJson(apiBase, "/api/matter-replica/cloud", "PUT", { endpoint });
      setHint("已连接案件云。同事连接同一个地址后，粘贴邀请码就能看到这桩案子。");
      await refresh();
    } catch (e) {
      setErr(errorMessage(e, "连接案件云失败"));
    } finally {
      setBusy(false);
    }
  }

  async function chooseRelay(): Promise<void> {
    const picked = await window.lawmindDesktop?.pickFolder?.();
    if (!picked?.ok || !picked.path) {
      return;
    }
    setBusy(true);
    setErr(null);
    setHint(null);
    try {
      await apiSendJson(apiBase, "/api/matter-replica/relay", "PUT", {
        sharedRelayDir: picked.path,
      });
      setHint("已记住这个共享文件夹。同事也要在自己的 LawMind 里选择同一个文件夹。");
      await refresh();
    } catch (e) {
      setErr(errorMessage(e, "没能记住共享文件夹"));
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
      const joined = await apiSendJson<{
        invite?: { matterId?: string; matterTitle?: string };
      }>(apiBase, "/api/matter-replica/invites/accept", "POST", {
        token: acceptToken.trim(),
      });
      const joinedTitle = joined.invite?.matterTitle?.trim() || "案件";
      setHint(`已加入「${joinedTitle}」。它会出现在左侧案件列表里。`);
      if (joined.invite?.matterId) {
        window.dispatchEvent(
          new CustomEvent(LAWMIND_REPLICA_JOINED_EVENT, {
            detail: { matterId: joined.invite.matterId },
          }),
        );
      }
      setAcceptToken("");
      await refresh();
    } catch (e) {
      setErr(errorMessage(e, "接受邀请失败"));
    } finally {
      setBusy(false);
    }
  }

  async function acquireLock(relPath: string): Promise<void> {
    setBusy(true);
    setErr(null);
    setHint(null);
    try {
      await apiSendJson(apiBase, "/api/matter-replica/locks/acquire", "POST", {
        matterId,
        relPath,
      });
      setHint("你正在改这份文件，同事那边会先避开");
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

  async function revokeInviteRow(inviteId: string): Promise<void> {
    setBusy(true);
    setErr(null);
    setHint(null);
    try {
      await apiSendJson(apiBase, "/api/matter-replica/invites/revoke", "POST", {
        matterId,
        inviteId,
      });
      setHint("已撤销邀请");
      await refresh();
    } catch (e) {
      setErr(errorMessage(e, "撤销失败"));
    } finally {
      setBusy(false);
    }
  }

  async function syncOps(): Promise<void> {
    setBusy(true);
    setErr(null);
    try {
      const r = await apiSendJson<{
        published?: number;
        pulled?: number;
        applied?: { locks?: number; members?: number; matterFields?: number; keyRotated?: boolean };
        materials?: {
          publishedFiles?: number;
          uploadedBlobs?: number;
          downloadedFiles?: number;
          skippedLocked?: number;
          deletedLocally?: string[];
        };
      }>(apiBase, `/api/matter-replica/sync?matterId=${encodeURIComponent(matterId)}`, "POST", {});
      const pulled = r.pulled ?? 0;
      const downloaded = r.materials?.downloadedFiles ?? 0;
      setHint(
        pulled > 0 || downloaded > 0
          ? "已从同事那边更新"
          : "已同步，对方那边稍后会看到",
      );
      await refresh();
    } catch (e) {
      setErr(errorMessage(e, "同步没有完成。请确认双方选的是同一个文件夹。"));
    } finally {
      setBusy(false);
    }
  }

  if (!enabled) {
    return (
      <section className="lm-matter-replica" aria-label="协作" data-testid="lm-matter-replica-panel">
        <h3>协作</h3>
        <p className="lm-meta">
          {err ??
            (!statusReady || edition.loading ? "正在打开协作。" : "协作还没连上本机服务。请重新打开 LawMind。")}
        </p>
      </section>
    );
  }

  const showIdentityForm = !identity || editingIdentity;
  const lockByPath = new Map(locks.map((lock) => [lock.relPath, lock]));

  return (
    <section className="lm-matter-replica" aria-label="协作" data-testid="lm-matter-replica-panel">
      <div className="lm-matter-replica-head">
        <div>
          {embedded ? null : <h3>协作</h3>}
          <p className="lm-meta">连接案件云后邀请同事。改同一份文件前，先点「我来改」。</p>
        </div>
        <button
          type="button"
          className="lm-btn lm-btn-secondary lm-btn-sm"
          disabled={busy}
          onClick={() => void syncOps()}
          data-testid="lm-replica-sync"
        >
          同步
        </button>
      </div>

      {cloud?.configured && cloud.endpoint ? (
        <div className="lm-lawyer-deadline-row" data-testid="lm-replica-invite-authority">
          <span className="lm-lawyer-deadline-copy">
            <strong>已连接案件云</strong>
            <span className="lm-lawyer-today-meta">{cloudHost(cloud.endpoint)}</span>
          </span>
        </div>
      ) : (
        <div className="lm-matter-replica-block" data-testid="lm-replica-cloud">
          <h4 className="lm-matter-replica-h">案件云</h4>
          <div className="lm-matter-replica-row">
            <label className="lm-field lm-field-grow">
              <span>地址</span>
              <input
                className="lm-input"
                value={endpointDraft}
                onChange={(e) => setEndpointDraft(e.target.value)}
                placeholder="https://cloud.example"
                data-testid="lm-replica-cloud-endpoint"
              />
            </label>
            <button
              type="button"
              className="lm-btn lm-btn-sm"
              disabled={busy || !endpointDraft.trim() || !identity}
              onClick={() => void connectCloud()}
              data-testid="lm-replica-cloud-connect"
            >
              连接
            </button>
          </div>
          <p className="lm-meta">
            {identity ? "同事也连接这个地址。" : "先保存下方的姓名，再连接。"}
            本机文件夹对方看不到。
          </p>
        </div>
      )}
      {cloud?.configured ? null : (
        <details className="lm-matter-replica-entry">
          <summary>改用共享文件夹</summary>
          <div className="lm-lawyer-deadline-row" data-testid="lm-replica-relay">
            <span className="lm-lawyer-deadline-copy">
              <strong data-testid="lm-replica-relay-path">
                {relayDir ? folderLabel(relayDir) : "尚未选择"}
              </strong>
              <span className="lm-lawyer-today-meta">仅当两边已经有同一个网盘目录时使用。</span>
            </span>
            <button
              type="button"
              className="lm-btn lm-btn-ghost lm-btn-sm"
              disabled={busy}
              onClick={() => void chooseRelay()}
              data-testid="lm-replica-pick-relay"
            >
              {relayDir ? "更换" : "选择文件夹"}
            </button>
          </div>
        </details>
      )}
      {scheduler?.lastError ? <p className="lm-meta lm-danger">上次同步没有完成：{scheduler.lastError}</p> : null}
      {err ? <p className="lm-meta lm-danger">{err}</p> : null}
      {hint ? <p className="lm-meta lm-ok">{hint}</p> : null}

      {feed.length > 0 ? (
        <ul className="lm-lawyer-deadline-list" data-testid="lm-replica-feed">
          {feed.slice(0, 5).map((item) => (
            <li key={item.opId} className="lm-lawyer-deadline-row">
              <span className="lm-lawyer-deadline-copy">
                <strong>{item.title}</strong>
                <span className="lm-lawyer-today-meta">
                  {item.actorName} · {item.createdAt.slice(0, 16).replace("T", " ")}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="lm-matter-replica-block">
        <h4 className="lm-matter-replica-h">你的姓名</h4>
        {showIdentityForm ? (
          <div className="lm-matter-replica-row">
            <label className="lm-field">
              <span>姓名</span>
              <input
                className="lm-input"
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                placeholder="例如：张三"
                data-testid="lm-replica-display-name"
              />
            </label>
            <label className="lm-field">
              <span>邮箱</span>
              <input
                className="lm-input"
                value={emailDraft}
                onChange={(e) => setEmailDraft(e.target.value)}
                placeholder="同事用来认出你"
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
        ) : (
          <div className="lm-lawyer-deadline-row">
            <span className="lm-lawyer-deadline-copy">
              <strong>{identity?.displayName}</strong>
              {identity?.email ? <span className="lm-lawyer-today-meta">{identity.email}</span> : null}
            </span>
            <button
              type="button"
              className="lm-btn lm-btn-ghost lm-btn-sm"
              onClick={() => setEditingIdentity(true)}
            >
              修改
            </button>
          </div>
        )}
      </div>

      <div className="lm-matter-replica-block">
        <h4 className="lm-matter-replica-h">本案成员</h4>
        {members.length === 0 ? (
          <p className="lm-meta">保存姓名后，你会作为主办出现在这里。</p>
        ) : (
          <ul className="lm-lawyer-deadline-list">
            {members.map((m) => (
              <li key={m.lawyerId} className="lm-lawyer-deadline-row">
                <span className="lm-lawyer-deadline-copy">
                  <strong>{m.displayName}</strong>
                  <span className="lm-lawyer-today-meta">
                    {roleLabels[m.role] ?? m.role}
                    {m.email ? ` · ${m.email}` : ""}
                  </span>
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
              className="lm-input"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="colleague@example.com"
              data-testid="lm-replica-invite-email"
            />
          </label>
          <label className="lm-field">
            <span>角色</span>
            <select
              className="lm-input"
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
            disabled={busy || !relayReady || !inviteEmail.trim() || !identity}
            onClick={() => void sendInvite()}
            data-testid="lm-replica-send-invite"
          >
            邀请
          </button>
        </div>
        {lastShare ? (
          <p className="lm-meta lm-matter-replica-share" data-testid="lm-replica-share-text">
            {lastShare}
          </p>
        ) : null}
        {invites.length > 0 ? (
          <ul className="lm-lawyer-deadline-list">
            {invites.map((i) => (
              <li key={i.inviteId} className="lm-lawyer-deadline-row">
                <span className="lm-lawyer-deadline-copy">
                  <strong>{i.email}</strong>
                  <span className="lm-lawyer-today-meta">
                    {roleLabels[i.role] ?? i.role} · <span className="lm-matter-replica-token">{i.token}</span>
                  </span>
                </span>
                <button
                  type="button"
                  className="lm-btn lm-btn-ghost lm-btn-sm"
                  disabled={busy}
                  onClick={() => void revokeInviteRow(i.inviteId)}
                  data-testid={`lm-replica-revoke-${i.inviteId}`}
                >
                  撤销
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="lm-matter-replica-block">
        <h4 className="lm-matter-replica-h">加入同事的案子</h4>
        <div className="lm-matter-replica-row">
          <label className="lm-field lm-field-grow">
            <span>邀请码</span>
            <input
              className="lm-input"
              value={acceptToken}
              onChange={(e) => setAcceptToken(e.target.value)}
              placeholder="粘贴邀请码"
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
            加入
          </button>
        </div>
      </div>

      <div className="lm-matter-replica-block">
        <h4 className="lm-matter-replica-h">正在一起改的文件</h4>
        {materials.length === 0 && locks.length === 0 ? (
          <p className="lm-meta">材料放进本案后会出现在这里。点「我来改」再打开 Word。</p>
        ) : (
          <ul className="lm-lawyer-deadline-list" data-testid="lm-replica-materials">
            {materials.slice(0, 20).map((file) => {
              const held = lockByPath.get(file.relPath);
              return (
                <li key={file.relPath} className="lm-lawyer-deadline-row">
                  <span className="lm-lawyer-deadline-copy">
                    <strong>{file.fileName}</strong>
                    <span className="lm-lawyer-today-meta">
                      {formatBytes(file.size)}
                      {held ? ` · ${held.holderDisplayName} 正在改` : ""}
                    </span>
                  </span>
                  {held ? (
                    <button
                      type="button"
                      className="lm-btn lm-btn-ghost lm-btn-sm"
                      disabled={busy}
                      onClick={() => void releaseLock(file.relPath)}
                    >
                      改完了
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="lm-btn lm-btn-sm"
                      disabled={busy || !identity}
                      onClick={() => void acquireLock(file.relPath)}
                      data-testid="lm-replica-acquire-lock"
                    >
                      我来改
                    </button>
                  )}
                </li>
              );
            })}
            {locks
              .filter((lock) => !materials.some((file) => file.relPath === lock.relPath))
              .map((lock) => (
                <li key={lock.lockId} className="lm-lawyer-deadline-row">
                  <span className="lm-lawyer-deadline-copy">
                    <strong>{lock.relPath.split("/").pop()}</strong>
                    <span className="lm-lawyer-today-meta">{lock.holderDisplayName} 正在改</span>
                  </span>
                  <button
                    type="button"
                    className="lm-btn lm-btn-ghost lm-btn-sm"
                    disabled={busy}
                    onClick={() => void releaseLock(lock.relPath)}
                  >
                    改完了
                  </button>
                </li>
              ))}
          </ul>
        )}
      </div>
    </section>
  );
}
