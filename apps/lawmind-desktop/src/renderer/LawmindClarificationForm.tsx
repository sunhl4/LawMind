import { useEffect, useState, type ReactNode } from "react";
import type { ClarificationQuestion } from "../../../../src/lawmind/types.ts";
import { formatClarificationPromptSummary, formatClarificationReply } from "./lawmind-chat";

export function LawmindClarificationForm({
  formKey,
  questions,
  loading,
  onApplyToInput,
  onSend,
}: {
  formKey: string;
  questions: ClarificationQuestion[];
  loading: boolean;
  onApplyToInput: (text: string) => void;
  onSend: (text: string) => void | Promise<void>;
}): ReactNode {
  const [answers, setAnswers] = useState<Record<string, string>>(() =>
    Object.fromEntries(questions.map((q) => [q.key, ""])),
  );

  useEffect(() => {
    setAnswers(Object.fromEntries(questions.map((q) => [q.key, ""])));
  }, [formKey]);

  const payload = formatClarificationReply(questions, answers);
  const canSubmit = payload.length > 0;
  const answeredCount = questions.filter(
    (q) => (typeof answers[q.key] === "string" ? answers[q.key].trim() : "") !== "",
  ).length;
  const totalCount = questions.length;
  const promptSummary = formatClarificationPromptSummary(questions);

  return (
    <>
      {totalCount > 0 ? (
        <p className="lm-clarify-form-progress" role="status" aria-label="填写进度">
          已答 {answeredCount} / {totalCount} 项
        </p>
      ) : null}
      <div className="lm-clarify-form-fields">
        {questions.map((item) => (
          <label key={item.key} className="lm-clarify-field">
            <span className="lm-clarify-field-label">{item.question}</span>
            {item.reason ? <span className="lm-clarify-field-reason">{item.reason}</span> : null}
            <textarea
              className="lm-clarify-field-input"
              rows={2}
              value={answers[item.key] ?? ""}
              placeholder="在此输入…"
              onChange={(e) => {
                const v = e.target.value;
                setAnswers((prev) => ({ ...prev, [item.key]: v }));
              }}
            />
          </label>
        ))}
      </div>
      <div className="lm-clarify-form-actions">
        {promptSummary ? (
          <button
            type="button"
            className="lm-btn lm-btn-ghost lm-clarify-btn"
            disabled={loading}
            title="只把问题列表放到下面大框，方便您用习惯的方式写"
            onClick={() => onApplyToInput(promptSummary)}
          >
            只把问题列到下面
          </button>
        ) : null}
        <button
          type="button"
          className="lm-btn lm-btn-secondary lm-clarify-btn"
          disabled={!canSubmit || loading}
          title={!canSubmit ? "请先填至少一项" : undefined}
          onClick={() => onApplyToInput(payload)}
        >
          已填的放到下面
        </button>
        <button
          type="button"
          className="lm-btn lm-clarify-btn"
          disabled={!canSubmit || loading}
          title={!canSubmit ? "请先填至少一项" : undefined}
          onClick={() => void onSend(payload)}
        >
          填好并发送
        </button>
        <button
          type="button"
          className="lm-btn lm-btn-ghost lm-clarify-btn"
          disabled={loading}
          onClick={() => setAnswers(Object.fromEntries(questions.map((q) => [q.key, ""])))}
        >
          清空
        </button>
      </div>
    </>
  );
}
