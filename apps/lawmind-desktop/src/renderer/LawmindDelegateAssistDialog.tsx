import { useMemo, useState, type ReactNode } from "react";
import type { AssistantRow } from "./lawmind-settings-models.ts";
import type { DelegationRow } from "./lawmind-app-data";
import { assistantIdsBusyFromDelegations } from "./lawmind-delegation-status";
import { createDelegation } from "./lawmind-models-api";
import { resolveComposeModelSelectValue } from "./lawmind-model-picker-utils";
import type { ModelCatalogEntry } from "./lawmind-models-api";
import { errorMessage } from "./api-client";

type Props = {
  open: boolean;
  apiBase: string;
  fromAssistantId: string;
  parentSessionId?: string;
  matterId?: string | null;
  taskDefault: string;
  assistants: AssistantRow[];
  delegations: DelegationRow[];
  modelCatalog: ModelCatalogEntry[];
  selectedModelId: string;
  onClose: () => void;
  onDelegated?: (info: { delegationId: string; toDisplayName: string }) => void;
};

export function LawmindDelegateAssistDialog(props: Props): ReactNode {
  const {
    open,
    apiBase,
    fromAssistantId,
    parentSessionId,
    matterId,
    taskDefault,
    assistants,
    delegations,
    modelCatalog,
    selectedModelId,
    onClose,
    onDelegated,
  } = props;

  const [targetId, setTargetId] = useState("");
  const [task, setTask] = useState(taskDefault);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const busyIds = useMemo(() => assistantIdsBusyFromDelegations(delegations), [delegations]);

  const peers = useMemo(() => {
    return assistants
      .filter((a) => a.assistantId !== fromAssistantId)
      .map((a) => ({
        id: a.assistantId,
        name: a.displayName,
        role: a.customRoleTitle ?? "",
        busy: busyIds.has(a.assistantId),
      }))
      .toSorted((a, b) => Number(a.busy) - Number(b.busy));
  }, [assistants, busyIds, fromAssistantId]);

  const availablePeers = peers.filter((p) => !p.busy).slice(0, 3);
  const showPeers = availablePeers.length > 0 ? availablePeers : peers.slice(0, 3);

  if (!open) {
    return null;
  }

  const submit = async () => {
    const to = targetId.trim();
    const t = task.trim();
    if (!to || !t) {
      setError("请选择助手并填写任务说明。");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const modelId = resolveComposeModelSelectValue(modelCatalog, selectedModelId);
      const result = await createDelegation(apiBase, {
        fromAssistantId,
        toAssistantId: to,
        task: t,
        matterId: matterId?.trim() || undefined,
        parentSessionId: parentSessionId?.trim() || undefined,
        modelId,
      });
      const name = assistants.find((a) => a.assistantId === to)?.displayName ?? to;
      onDelegated?.({ delegationId: result.delegationId, toDisplayName: name });
      onClose();
    } catch (e) {
      setError(errorMessage(e, "委派失败"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="lm-wizard-backdrop" role="dialog" aria-modal="true" aria-label="交给其他助手">
      <div className="lm-wizard lm-delegate-dialog">
        <h3>交给其他助手</h3>
        <p className="lm-meta">
          进行中的步骤会显示在本对话上方；完成后会自动插入一条委派结果。
        </p>
        {error ? (
          <div className="lm-callout lm-callout-danger" role="alert">
            <p className="lm-callout-body">{error}</p>
          </div>
        ) : null}
        <div className="lm-delegate-peer-grid">
          {showPeers.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`lm-delegate-peer-card ${targetId === p.id ? "active" : ""} ${p.busy ? "lm-delegate-peer-busy" : ""}`}
              disabled={p.busy || busy}
              onClick={() => setTargetId(p.id)}
            >
              <span className="lm-delegate-peer-name">{p.name}</span>
              {p.role ? <span className="lm-meta">{p.role}</span> : null}
              {p.busy ? <span className="lm-meta">处理其他委派中</span> : null}
            </button>
          ))}
        </div>
        {peers.length === 0 ? (
          <p className="lm-meta">请先新建助手。</p>
        ) : null}
        <label className="lm-delegate-task-label">
          <span>任务说明</span>
          <textarea
            rows={4}
            value={task}
            disabled={busy}
            onChange={(e) => setTask(e.target.value)}
            placeholder="简要说明需要对方完成的工作…"
          />
        </label>
        <div className="lm-wizard-actions">
          <button type="button" className="lm-btn lm-btn-secondary" disabled={busy} onClick={onClose}>
            取消
          </button>
          <button type="button" className="lm-btn" disabled={busy || !targetId.trim()} onClick={() => void submit()}>
            {busy ? "委派中…" : "确认委派"}
          </button>
        </div>
      </div>
    </div>
  );
}
