/**
 * Compose-side「邮件合同审阅」快车道：同步/选附件 → 入队短路径。
 */

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { apiGetJson, apiSendJson, errorMessage } from "./api-client";
import { runMailAutomationNow } from "./lawmind-mail-automation-run";
import { requestOpenAutomationsSettings } from "./lawmind-automations-nav-bus";
import { buildMailContractShortPathInstruction } from "../../../../src/lawmind/platform/mail-contract-short-path-instruction.ts";

type MailAccount = { id: string; label?: string; email?: string; enabled?: boolean };

type MailAttachmentRow = {
  messageId: string;
  subject: string;
  name: string;
  workspaceRelativePath: string;
};

type Props = {
  apiBase: string;
  matterId: string | null;
  onFillComposer: (prompt: string) => void;
  /** Optional: dispatch the short-path instruction as a chat turn (already path-bearing). */
  onDispatch?: (prompt: string) => void;
  onDismiss?: () => void;
  compact?: boolean;
};

export function LawmindMailContractFastLaneCard(props: Props): ReactNode {
  const { apiBase, matterId, onFillComposer, onDispatch, onDismiss, compact } = props;
  const [accounts, setAccounts] = useState<MailAccount[]>([]);
  const [accountId, setAccountId] = useState("");
  const [attachments, setAttachments] = useState<MailAttachmentRow[]>([]);
  const [selectedPath, setSelectedPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadAccounts = useCallback(async () => {
    try {
      const r = await apiGetJson<{ ok?: boolean; accounts?: MailAccount[] }>(
        apiBase,
        "/api/mail/accounts",
      );
      const list = Array.isArray(r.accounts) ? r.accounts.filter((a) => a.enabled !== false) : [];
      setAccounts(list);
      if (!accountId && list[0]?.id) {
        setAccountId(list[0].id);
      }
    } catch {
      setAccounts([]);
    }
  }, [apiBase, accountId]);

  const loadAttachments = useCallback(async () => {
    const mid = matterId?.trim();
    if (!mid) {
      setAttachments([]);
      return;
    }
    try {
      const r = await apiGetJson<{
        ok?: boolean;
        attachments?: MailAttachmentRow[];
      }>(apiBase, `/api/mail/matters/${encodeURIComponent(mid)}/attachments`);
      const rows = Array.isArray(r.attachments) ? r.attachments : [];
      setAttachments(rows);
      if (!selectedPath && rows[0]?.workspaceRelativePath) {
        setSelectedPath(rows[0].workspaceRelativePath);
      }
    } catch {
      setAttachments([]);
    }
  }, [apiBase, matterId, selectedPath]);

  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);

  useEffect(() => {
    void loadAttachments();
  }, [loadAttachments]);

  const syncNow = async () => {
    const mid = matterId?.trim();
    if (!mid) {
      setError("请先选择案件。");
      return;
    }
    if (!accountId) {
      setError("请先配置邮箱账号（设置 → 自动办件）。");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiSendJson(apiBase, `/api/mail/accounts/${encodeURIComponent(accountId)}/sync`, "POST", {
        matterId: mid,
      });
      await loadAttachments();
      setSuccess("已同步邮件匣。");
    } catch (e) {
      setError(errorMessage(e, "同步失败"));
    } finally {
      setBusy(false);
    }
  };

  const buildPrompt = (): string | null => {
    const mid = matterId?.trim();
    if (!mid) {
      setError("请先选择案件。");
      return null;
    }
    if (!selectedPath.trim()) {
      setError("请选择合同附件，或先同步邮箱。");
      return null;
    }
    setError(null);
    return buildMailContractShortPathInstruction({
      matterId: mid,
      preferredBaselinePath: selectedPath.trim(),
    });
  };

  const runAutomation = async () => {
    const mid = matterId?.trim();
    if (!mid) {
      setError("请先选择案件。");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await runMailAutomationNow({
        apiBase,
        matterId: mid,
        presetId: "mail-contract-review",
      });
      setSuccess("已启动邮件合同审阅短路径，结果进「待我拍板」。");
      window.setTimeout(() => onDismiss?.(), 1200);
    } catch (e) {
      setError(errorMessage(e, "启动失败"));
    } finally {
      setBusy(false);
    }
  };

  const fillOrDispatch = (mode: "fill" | "dispatch") => {
    const prompt = buildPrompt();
    if (!prompt) {
      return;
    }
    if (mode === "dispatch" && onDispatch) {
      onDispatch(prompt);
    } else {
      onFillComposer(prompt);
    }
    onDismiss?.();
  };

  return (
    <div
      className={`lm-contract-fast-lane${compact ? " lm-contract-fast-lane--compact" : ""}`}
      role="region"
      aria-label="邮件合同审阅"
      data-testid="lm-mail-contract-fast-lane"
    >
      <header className="lm-contract-fast-lane-head">
        <div>
          <strong>邮件合同审阅</strong>
          <p className="lm-meta">取信 → 选附件 → 短路径改稿</p>
        </div>
        {onDismiss ? (
          <button type="button" className="lm-btn lm-btn-ghost lm-btn-sm" onClick={onDismiss}>
            收起
          </button>
        ) : null}
      </header>

      {!matterId?.trim() ? (
        <p className="lm-meta lm-text-danger" role="status">
          请先在对话上下文选择案件。
        </p>
      ) : null}

      <label className="lm-job-intake-field">
        <span>邮箱账号</span>
        <select
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          data-testid="lm-mail-fast-lane-account"
          disabled={busy || accounts.length === 0}
        >
          {accounts.length === 0 ? (
            <option value="">未配置账号</option>
          ) : (
            accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label || a.email || a.id}
              </option>
            ))
          )}
        </select>
      </label>

      <label className="lm-job-intake-field">
        <span>合同附件</span>
        <select
          value={selectedPath}
          onChange={(e) => setSelectedPath(e.target.value)}
          data-testid="lm-mail-fast-lane-attachment"
          disabled={busy || attachments.length === 0}
        >
          {attachments.length === 0 ? (
            <option value="">暂无附件（请先同步）</option>
          ) : (
            attachments.map((a) => (
              <option key={`${a.messageId}-${a.workspaceRelativePath}`} value={a.workspaceRelativePath}>
                {a.name} · {a.subject}
              </option>
            ))
          )}
        </select>
      </label>

      {error ? (
        <p className="lm-meta lm-text-danger" role="alert">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="lm-meta" role="status">
          {success}
        </p>
      ) : null}

      <div className="lm-contract-fast-lane-actions">
        <button
          type="button"
          className="lm-btn lm-btn-secondary lm-btn-sm"
          data-testid="lm-mail-fast-lane-sync"
          disabled={busy || !matterId?.trim() || !accountId}
          onClick={() => void syncNow()}
        >
          {busy ? "处理中…" : "同步邮件"}
        </button>
        <button
          type="button"
          className="lm-btn lm-btn-accent lm-btn-sm"
          data-testid="lm-mail-fast-lane-run"
          disabled={busy || !matterId?.trim()}
          onClick={() => void runAutomation()}
        >
          一键审邮件合同
        </button>
        <button
          type="button"
          className="lm-btn lm-btn-secondary lm-btn-sm"
          data-testid="lm-mail-fast-lane-fill"
          disabled={busy}
          onClick={() => fillOrDispatch(onDispatch ? "dispatch" : "fill")}
        >
          {onDispatch && selectedPath ? "带路径交办" : "填入短路径指令"}
        </button>
        {accounts.length === 0 ? (
          <button
            type="button"
            className="lm-btn lm-btn-ghost lm-btn-sm"
            onClick={() => requestOpenAutomationsSettings()}
          >
            去配置邮箱
          </button>
        ) : null}
      </div>
    </div>
  );
}
