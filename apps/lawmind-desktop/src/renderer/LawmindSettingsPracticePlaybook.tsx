import { useEffect, useState, type ReactNode } from "react";
import {
  PRACTICE_STANCE_DEFAULTS,
  PRACTICE_STANCE_LABELS,
  type PracticeStanceDefault,
} from "../../../../src/lawmind/practice/practice-playbook-constants.ts";
import { apiGetJson, apiSendJson, errorMessage } from "./api-client";

type PlaybookPayload = {
  stanceDefault?: PracticeStanceDefault;
  disputeForum?: string;
  neverAccept?: string[];
  notes?: string;
  source?: "default" | "workspace";
};

type Props = {
  apiBase: string;
};

export function LawmindSettingsPracticePlaybook(props: Props): ReactNode {
  const { apiBase } = props;
  const [stance, setStance] = useState<PracticeStanceDefault>("protect_instructing");
  const [disputeForum, setDisputeForum] = useState("");
  const [neverAccept, setNeverAccept] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void apiGetJson<{ ok?: boolean; playbook?: PlaybookPayload }>(
      apiBase,
      "/api/workspace/practice-playbook",
    )
      .then((j) => {
        if (cancelled || !j.ok || !j.playbook) {
          return;
        }
        const nextStance = j.playbook.stanceDefault;
        if (nextStance && (PRACTICE_STANCE_DEFAULTS as readonly string[]).includes(nextStance)) {
          setStance(nextStance);
        }
        setDisputeForum(j.playbook.disputeForum ?? "");
        setNeverAccept((j.playbook.neverAccept ?? []).join("\n"));
        setNotes(j.playbook.notes ?? "");
      })
      .catch(() => {
        /* ignore */
      });
    return () => {
      cancelled = true;
    };
  }, [apiBase]);

  async function save(): Promise<void> {
    setBusy(true);
    setHint(null);
    try {
      const j = await apiSendJson<
        { ok?: boolean; playbook?: PlaybookPayload; message?: string; error?: string },
        {
          stanceDefault: PracticeStanceDefault;
          disputeForum: string;
          neverAccept: string[];
          notes: string;
        }
      >(apiBase, "/api/workspace/practice-playbook", "POST", {
        stanceDefault: stance,
        disputeForum: disputeForum.trim(),
        neverAccept: neverAccept
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line.length > 0),
        notes: notes.trim(),
      });
      if (!j.ok) {
        setHint(j.message ?? j.error ?? "保存失败");
        return;
      }
      if (j.playbook?.stanceDefault) {
        setStance(j.playbook.stanceDefault);
      }
      setDisputeForum(j.playbook?.disputeForum ?? disputeForum.trim());
      setNeverAccept((j.playbook?.neverAccept ?? []).join("\n"));
      setNotes(j.playbook?.notes ?? notes.trim());
      setHint("已保存。只影响之后的办件，已生成草稿不会重算。");
    } catch (e) {
      setHint(errorMessage(e, "保存失败"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="lm-settings-advanced" data-testid="lm-practice-playbook">
      <summary>
        <span className="lm-settings-advanced__label">执业口径</span>
        <span className="lm-settings-advanced__hint">改完只影响之后的办件</span>
      </summary>
      <div className="lm-settings-advanced-body">
        <p className="lm-settings-caption">
          没有自定义时用开箱默认即可审查、起草、检索。改这里不会拦住当前任务，也不会重算旧草稿。
        </p>
        <label className="lm-settings-field">
          <span className="lm-settings-key">默认立场</span>
          <select
            className="lm-input"
            value={stance}
            data-testid="lm-practice-playbook-stance"
            onChange={(e) => setStance(e.target.value as PracticeStanceDefault)}
          >
            {PRACTICE_STANCE_DEFAULTS.map((id) => (
              <option key={id} value={id}>
                {PRACTICE_STANCE_LABELS[id]}
              </option>
            ))}
          </select>
        </label>
        <label className="lm-settings-field">
          <span className="lm-settings-key">争议解决</span>
          <textarea
            className="lm-input"
            rows={2}
            value={disputeForum}
            data-testid="lm-practice-playbook-forum"
            onChange={(e) => setDisputeForum(e.target.value)}
          />
        </label>
        <label className="lm-settings-field">
          <span className="lm-settings-key">原则上不接受</span>
          <textarea
            className="lm-input"
            rows={3}
            value={neverAccept}
            data-testid="lm-practice-playbook-never"
            placeholder="一行一条"
            onChange={(e) => setNeverAccept(e.target.value)}
          />
        </label>
        <label className="lm-settings-field">
          <span className="lm-settings-key">备注</span>
          <textarea
            className="lm-input"
            rows={2}
            value={notes}
            data-testid="lm-practice-playbook-notes"
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
        <div className="lm-settings-actions">
          <button
            type="button"
            className="lm-btn lm-btn-secondary lm-btn-sm"
            disabled={busy}
            data-testid="lm-practice-playbook-save"
            onClick={() => void save()}
          >
            {busy ? "保存中…" : "保存"}
          </button>
        </div>
        {hint ? (
          <p className="lm-settings-caption" role="status">
            {hint}
          </p>
        ) : null}
      </div>
    </details>
  );
}
