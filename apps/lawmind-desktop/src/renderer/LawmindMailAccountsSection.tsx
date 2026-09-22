import { useCallback, useEffect, useState, type ReactNode } from "react";
import { apiGetJson, apiSendJson, errorMessage } from "./api-client";
import { LawmindMailSendFormatFields } from "./LawmindMailSendFormatFields";
import {
  hasMailSendFormat,
  type MailSendFormat,
} from "../../../../src/lawmind/mail/mail-send-format.ts";

type Provider = {
  id: string;
  label: string;
  description: string;
  authKinds: string[];
  defaultAuthKind: string;
  credentialHint: string;
  imapHost: string;
  smtpHost: string;
};

type WatchContact = {
  email: string;
  label: string;
  note?: string;
};

type Account = {
  id: string;
  label: string;
  provider: string;
  providerLabel: string;
  email: string;
  authKind: string;
  matterId?: string;
  enabled: boolean;
  hasSecret: boolean;
  watchContacts?: WatchContact[];
  sendFormat?: MailSendFormat;
  lastTestOk?: boolean;
  lastTestAt?: string;
  lastSyncAt?: string;
  lastSyncError?: string;
  tenantId?: string;
  clientId?: string;
  imapHost?: string;
  smtpHost?: string;
};

type Props = {
  apiBase: string;
  matterId?: string | null;
  matterOptions?: Array<{ id: string; title: string }>;
};

type TestAccountResponse = {
  ok: boolean;
  hint?: string;
  error?: string;
  mailbox?: string;
  messageCount?: number;
};

type SyncAccountResponse = {
  ok: boolean;
  hint?: string;
  error?: string;
  written?: number;
  fetched?: number;
  filteredOut?: number;
  watchMode?: "all" | "contacts";
};

export function LawmindMailAccountsSection(props: Props): ReactNode {
  const { apiBase, matterId, matterOptions = [] } = props;
  const [providers, setProviders] = useState<Provider[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [provider, setProvider] = useState("gmail");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [label, setLabel] = useState("");
  const [bindMatter, setBindMatter] = useState(matterId?.trim() || "");
  const [authKind, setAuthKind] = useState("app_password");
  const [tenantId, setTenantId] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [imapHost, setImapHost] = useState("");
  const [smtpHost, setSmtpHost] = useState("");
  const [watchContacts, setWatchContacts] = useState<WatchContact[]>([]);
  const [sendFormat, setSendFormat] = useState<MailSendFormat>({});
  const [draftEmail, setDraftEmail] = useState("");
  const [draftLabel, setDraftLabel] = useState("");
  const [draftNote, setDraftNote] = useState("");

  useEffect(() => {
    if (matterId?.trim()) {
      setBindMatter(matterId.trim());
    }
  }, [matterId]);

  const selectedPreset = providers.find((p) => p.id === provider);

  useEffect(() => {
    if (selectedPreset && !editingId) {
      setAuthKind(selectedPreset.defaultAuthKind);
      if (provider !== "imap") {
        setImapHost("");
        setSmtpHost("");
      }
    }
  }, [provider, selectedPreset, editingId]);

  const refresh = useCallback(async () => {
    if (!apiBase) {
      return;
    }
    try {
      const [p, a] = await Promise.all([
        apiGetJson<{ providers: Provider[] }>(apiBase, "/api/mail/providers"),
        apiGetJson<{ accounts: Account[] }>(apiBase, "/api/mail/accounts"),
      ]);
      setProviders(p.providers ?? []);
      setAccounts(a.accounts ?? []);
      setError(null);
    } catch (e) {
      setError(errorMessage(e, "无法加载邮箱配置"));
    }
  }, [apiBase]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const resetForm = () => {
    setEditingId(null);
    setPassword("");
    setClientSecret("");
    setEmail("");
    setLabel("");
    setWatchContacts([]);
    setSendFormat({});
    setDraftEmail("");
    setDraftLabel("");
    setDraftNote("");
    setTenantId("");
    setClientId("");
    setImapHost("");
    setSmtpHost("");
  };

  const beginEdit = (a: Account) => {
    setEditingId(a.id);
    setProvider(a.provider);
    setEmail(a.email);
    setLabel(a.label || "");
    setAuthKind(a.authKind);
    setBindMatter(a.matterId || matterId?.trim() || "");
    setTenantId(a.tenantId || "");
    setClientId(a.clientId || "");
    setImapHost(a.imapHost || "");
    setSmtpHost(a.smtpHost || "");
    setWatchContacts(Array.isArray(a.watchContacts) ? a.watchContacts : []);
    setSendFormat(a.sendFormat ?? {});
    setPassword("");
    setClientSecret("");
    setError(null);
  };

  const addWatchContact = () => {
    const e = draftEmail.trim().toLowerCase();
    const l = draftLabel.trim();
    if (!e.includes("@")) {
      setError("对方邮箱格式不正确。");
      return;
    }
    if (!l) {
      setError("请为对方填写简称/备注名，例如「对方法务」「客户联系人」。");
      return;
    }
    if (watchContacts.some((c) => c.email === e)) {
      setError("该对方邮箱已在名单中。");
      return;
    }
    setWatchContacts((prev) => [
      ...prev,
      { email: e, label: l.slice(0, 80), note: draftNote.trim().slice(0, 200) || undefined },
    ]);
    setDraftEmail("");
    setDraftLabel("");
    setDraftNote("");
    setError(null);
  };

  const saveAccount = async () => {
    if (!email.trim()) {
      setError("请填写你自己的邮箱地址。");
      return;
    }
    const isEdit = Boolean(editingId);
    if (!isEdit && !password.trim() && authKind !== "graph_client") {
      setError("请填写授权码/应用专用密码（不会写入案件目录）。");
      return;
    }
    if (
      authKind === "graph_client" &&
      !isEdit &&
      (!tenantId.trim() || !clientId.trim() || !clientSecret.trim())
    ) {
      setError("Graph 方式需填写租户 ID、客户端 ID 与客户端密钥。");
      return;
    }
    if (provider === "imap" && !imapHost.trim()) {
      setError("自定义 IMAP 需填写主机地址。");
      return;
    }
    setBusy(true);
    try {
      await apiSendJson(apiBase, "/api/mail/accounts", "POST", {
        id: editingId || undefined,
        provider,
        email: email.trim(),
        label: label.trim() || undefined,
        authKind,
        matterId: bindMatter.trim() || null,
        password: password.trim() || undefined,
        tenantId: tenantId.trim() || undefined,
        clientId: clientId.trim() || undefined,
        clientSecret: clientSecret.trim() || undefined,
        imapHost: imapHost.trim() || undefined,
        smtpHost: smtpHost.trim() || undefined,
        watchContacts,
        sendFormat,
        enabled: true,
      });
      resetForm();
      await refresh();
    } catch (e) {
      setError(errorMessage(e, "保存失败"));
    } finally {
      setBusy(false);
    }
  };

  const testAccount = async (id: string) => {
    setBusy(true);
    try {
      const res = await apiSendJson<TestAccountResponse, Record<string, never>>(
        apiBase,
        `/api/mail/accounts/${encodeURIComponent(id)}/test`,
        "POST",
        {},
      );
      if (!res.ok) {
        setError(res.hint || res.error || "连接失败");
      } else {
        setError(null);
      }
      await refresh();
    } catch (e) {
      setError(errorMessage(e, "测试连接失败"));
    } finally {
      setBusy(false);
    }
  };

  const syncAccount = async (id: string) => {
    const matter = bindMatter.trim() || matterId?.trim();
    if (!matter) {
      setError("请先选择要同步到的案件。");
      return;
    }
    setBusy(true);
    try {
      const res = await apiSendJson<SyncAccountResponse, { matterId: string }>(
        apiBase,
        `/api/mail/accounts/${encodeURIComponent(id)}/sync`,
        "POST",
        { matterId: matter },
      );
      if (!res.ok) {
        setError(res.hint || res.error || "同步失败");
        setInfo(null);
        await refresh();
        return;
      }
      setError(null);
      const summary =
        res.watchMode === "contacts"
          ? `已同步 ${res.written ?? 0} 封（按对方名单过滤，跳过 ${res.filteredOut ?? 0} 封）。`
          : `已同步 ${res.written ?? 0} 封（未限定对方，全部往来）。`;
      await refresh();
      setInfo(summary);
    } catch (e) {
      setError(errorMessage(e, "同步失败"));
    } finally {
      setBusy(false);
    }
  };

  const removeAccount = async (id: string) => {
    setBusy(true);
    try {
      await apiSendJson(apiBase, `/api/mail/accounts/${encodeURIComponent(id)}`, "DELETE", {});
      if (editingId === id) {
        resetForm();
      }
      await refresh();
    } catch (e) {
      setError(errorMessage(e, "删除失败"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="lm-automations-mail" aria-label="邮箱配置" data-testid="lm-mail-accounts">
      <h3 className="lm-settings-subtitle">邮箱配置</h3>
      <p className="lm-meta">空名单=全部来信；填写=仅这些人。发送格式可设落款，批准发送时自动带上。</p>

      {error ? (
        <div className="lm-callout lm-callout-danger" role="alert">
          <p className="lm-callout-body">{error}</p>
        </div>
      ) : null}
      {info ? (
        <div className="lm-callout" role="status">
          <p className="lm-callout-body">{info}</p>
        </div>
      ) : null}

      <div className="lm-automations-mail-form">
        <h4 className="lm-settings-subtitle">{editingId ? "编辑邮箱账号" : "我的邮箱"}</h4>
        <label className="lm-compose-bar-field">
          <span className="lm-compose-bar-label">邮箱类型</span>
          <select
            className="lm-compose-select"
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            aria-label="邮箱类型"
            disabled={Boolean(editingId)}
          >
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        {selectedPreset ? <p className="lm-meta">{selectedPreset.credentialHint}</p> : null}

        <label className="lm-compose-bar-field">
          <span className="lm-compose-bar-label">显示名称（可选）</span>
          <input className="lm-input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="如：工作邮箱" />
        </label>

        <label className="lm-compose-bar-field">
          <span className="lm-compose-bar-label">我的邮箱地址</span>
          <input
            className="lm-input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="username"
            disabled={Boolean(editingId)}
          />
        </label>

        {authKind !== "graph_client" ? (
          <label className="lm-compose-bar-field">
            <span className="lm-compose-bar-label">
              授权码 / 应用专用密码{editingId ? "（留空则保留原凭证）" : ""}
            </span>
            <input
              className="lm-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="不是登录密码时请用授权码"
              autoComplete="new-password"
            />
          </label>
        ) : (
          <>
            <label className="lm-compose-bar-field">
              <span className="lm-compose-bar-label">租户 ID</span>
              <input className="lm-input" value={tenantId} onChange={(e) => setTenantId(e.target.value)} />
            </label>
            <label className="lm-compose-bar-field">
              <span className="lm-compose-bar-label">客户端 ID</span>
              <input className="lm-input" value={clientId} onChange={(e) => setClientId(e.target.value)} />
            </label>
            <label className="lm-compose-bar-field">
              <span className="lm-compose-bar-label">
                客户端密钥{editingId ? "（留空则保留）" : ""}
              </span>
              <input
                className="lm-input"
                type="password"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                autoComplete="new-password"
              />
            </label>
          </>
        )}

        {selectedPreset && selectedPreset.authKinds.length > 1 ? (
          <label className="lm-compose-bar-field">
            <span className="lm-compose-bar-label">登录方式</span>
            <select
              className="lm-compose-select"
              value={authKind}
              onChange={(e) => setAuthKind(e.target.value)}
            >
              {selectedPreset.authKinds.map((k) => (
                <option key={k} value={k}>
                  {k === "graph_client"
                    ? "Microsoft Graph（应用权限）"
                    : k === "app_password"
                      ? "应用专用密码/授权码"
                      : "密码"}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {provider === "imap" ? (
          <>
            <label className="lm-compose-bar-field">
              <span className="lm-compose-bar-label">IMAP 主机</span>
              <input
                className="lm-input"
                value={imapHost}
                onChange={(e) => setImapHost(e.target.value)}
                placeholder="imap.example.com"
              />
            </label>
            <label className="lm-compose-bar-field">
              <span className="lm-compose-bar-label">SMTP 主机</span>
              <input
                className="lm-input"
                value={smtpHost}
                onChange={(e) => setSmtpHost(e.target.value)}
                placeholder="smtp.example.com"
              />
            </label>
          </>
        ) : null}

        <label className="lm-compose-bar-field">
          <span className="lm-compose-bar-label">默认绑定案件（可选）</span>
          {matterOptions.length > 0 ? (
            <select
              className="lm-compose-select"
              value={bindMatter}
              onChange={(e) => setBindMatter(e.target.value)}
            >
              <option value="">不绑定（同步时选手动案件）</option>
              {matterOptions.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.title}
                </option>
              ))}
            </select>
          ) : (
            <input
              className="lm-input"
              value={bindMatter}
              onChange={(e) => setBindMatter(e.target.value)}
              placeholder="案件 ID"
            />
          )}
        </label>

        <div className="lm-mail-watch-block">
          <h4 className="lm-settings-subtitle">对方往来（可选）</h4>
          <p className="lm-meta">
            不添加任何人 = 同步全部来信。添加后只保留与这些人相关的邮件；每条需填写「是谁/什么角色」。
          </p>
          {watchContacts.length === 0 ? (
            <p className="lm-meta">当前：关注全部往来。</p>
          ) : (
            <ul className="lm-mail-watch-list">
              {watchContacts.map((c) => (
                <li key={c.email} className="lm-mail-watch-item">
                  <div>
                    <strong>{c.label}</strong>
                    <span className="lm-meta"> · {c.email}</span>
                    {c.note ? <div className="lm-meta">{c.note}</div> : null}
                  </div>
                  <button
                    type="button"
                    className="lm-btn lm-btn-ghost lm-btn-sm"
                    disabled={busy}
                    onClick={() => setWatchContacts((prev) => prev.filter((x) => x.email !== c.email))}
                  >
                    移除
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="lm-mail-watch-draft">
            <input
              className="lm-input"
              value={draftEmail}
              onChange={(e) => setDraftEmail(e.target.value)}
              placeholder="对方邮箱"
              aria-label="对方邮箱"
            />
            <input
              className="lm-input"
              value={draftLabel}
              onChange={(e) => setDraftLabel(e.target.value)}
              placeholder="简称（必填，如：对方法务）"
              aria-label="对方简称"
            />
            <input
              className="lm-input"
              value={draftNote}
              onChange={(e) => setDraftNote(e.target.value)}
              placeholder="备注（可选，如：负责合同谈判）"
              aria-label="对方备注"
            />
            <button type="button" className="lm-btn lm-btn-secondary lm-btn-sm" disabled={busy} onClick={addWatchContact}>
              加入名单
            </button>
          </div>
        </div>

        <LawmindMailSendFormatFields value={sendFormat} onChange={setSendFormat} disabled={busy} />

        <div className="lm-automations-create-actions">
          <button type="button" className="lm-btn lm-btn-sm" disabled={busy} onClick={() => void saveAccount()}>
            {editingId ? "保存修改" : "保存并连接邮箱"}
          </button>
          {editingId ? (
            <button type="button" className="lm-btn lm-btn-ghost lm-btn-sm" disabled={busy} onClick={resetForm}>
              取消编辑
            </button>
          ) : null}
        </div>
      </div>

      <ul className="lm-automations-ul">
        {accounts.length === 0 ? (
          <li className="lm-meta">尚未配置邮箱。上方填写你的邮箱与对方名单后保存。</li>
        ) : (
          accounts.map((a) => {
            const contacts = a.watchContacts ?? [];
            return (
              <li key={a.id} className="lm-automations-row">
                <div>
                  <strong>
                    {a.label || a.email} · {a.providerLabel}
                  </strong>
                  <div className="lm-meta">
                    我的邮箱：{a.email}
                    {a.hasSecret ? " · 已保存凭证" : " · 缺少凭证"}
                    {a.matterId ? ` · 绑定 ${a.matterId}` : ""}
                    {a.lastTestOk === true ? " · 最近测试通过" : ""}
                    {a.lastTestOk === false ? " · 最近测试失败" : ""}
                    {a.lastSyncAt ? ` · 上次同步 ${a.lastSyncAt.slice(0, 16).replace("T", " ")}` : ""}
                  </div>
                  <div className="lm-meta">
                    {contacts.length === 0
                      ? "对方名单：未限定（全部往来）"
                      : `对方名单（${contacts.length}）：${contacts
                          .map((c) => `${c.label}<${c.email}>`)
                          .join("；")}`}
                    {hasMailSendFormat(a.sendFormat)
                      ? a.sendFormat?.fromName
                        ? ` · 已设落款（${a.sendFormat.fromName}）`
                        : " · 已设落款"
                      : " · 未设落款"}
                  </div>
                  {a.lastSyncError ? <p className="lm-meta lm-automations-last">{a.lastSyncError}</p> : null}
                </div>
                <div className="lm-automations-row-actions">
                  <button
                    type="button"
                    className="lm-btn lm-btn-ghost lm-btn-sm"
                    disabled={busy}
                    onClick={() => beginEdit(a)}
                  >
                    编辑
                  </button>
                  <button
                    type="button"
                    className="lm-btn lm-btn-secondary lm-btn-sm"
                    disabled={busy}
                    onClick={() => void testAccount(a.id)}
                  >
                    测试连接
                  </button>
                  <button
                    type="button"
                    className="lm-btn lm-btn-sm"
                    disabled={busy}
                    onClick={() => void syncAccount(a.id)}
                  >
                    立即同步
                  </button>
                  <button
                    type="button"
                    className="lm-btn lm-btn-ghost lm-btn-sm"
                    disabled={busy}
                    onClick={() => void removeAccount(a.id)}
                  >
                    删除
                  </button>
                </div>
              </li>
            );
          })
        )}
      </ul>
    </section>
  );
}
