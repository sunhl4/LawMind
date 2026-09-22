import { useEffect, useId, useState, type DragEvent, type ReactNode } from "react";
import type { ClarificationQuestion } from "../../../../src/lawmind/types.ts";
import {
  appendEncodedLine,
  buildClarificationAnswerMap,
  CLARIFY_ATTACHMENTS_KEY,
  CLARIFY_SESSIONS_KEY,
  clarificationAnswersComplete,
  collectClarificationFilePins,
  collectClarificationSessionRefs,
  encodeClarificationFileAnswer,
  encodeClarificationSessionRef,
  normalizeClarificationInputType,
  parseClarificationFileAnswer,
  removeEncodedLine,
  type ClarificationFilePin,
  type ClarificationSessionRef,
} from "../../../../src/lawmind/platform/clarification-fields.ts";
import { outlineAnswerDecision } from "../../../../src/lawmind/research/outline-hitl.ts";
import { readLawmindFsDragFromDataTransfer } from "./lawmind-file-drag";
import { formatClarificationPromptSummary, formatClarificationReply } from "./lawmind-chat";

const OUTLINE_CONFIRM_KEY = "research_outline_confirm";

/** Pull markdown outline body embedded in the clarification question. */
export function extractOutlineSeedFromQuestion(question: ClarificationQuestion): string {
  const text = question.question.replace(/\r\n/g, "\n");
  const hash = text.search(/\n#\s+/);
  if (hash >= 0) {
    return text.slice(hash + 1).trim();
  }
  const h2 = text.search(/\n##\s+/);
  if (h2 >= 0) {
    return text.slice(h2 + 1).trim();
  }
  if (question.reason && /^#+\s+/m.test(question.reason)) {
    return question.reason.trim();
  }
  return "";
}

function OutlineConfirmField(props: {
  question: ClarificationQuestion;
  value: string;
  disabled: boolean;
  onChange: (v: string) => void;
}): ReactNode {
  const { question, value, disabled, onChange } = props;
  const seed = extractOutlineSeedFromQuestion(question);
  const [draft, setDraft] = useState(() => value.trim() || seed);
  const decision = outlineAnswerDecision(value.trim() || draft.trim());

  useEffect(() => {
    if (!value.trim() && seed) {
      setDraft(seed);
    }
  }, [seed, value]);

  const setDecision = (next: "approve" | "revise" | "reject") => {
    if (next === "approve") {
      onChange("大纲已确认");
      return;
    }
    if (next === "reject") {
      onChange("不同意大纲");
      return;
    }
    const body = draft.trim() || seed;
    onChange(body.includes("大纲已确认") ? body : `${body}\n\n大纲已确认`);
  };

  return (
    <div className="lm-outline-confirm" data-testid="lm-outline-confirm">
      <p className="lm-meta lm-outline-confirm-hint">
        确认后按此大纲写正文；可改章节后再确认，或不同意以重建大纲。
      </p>
      <textarea
        className="lm-clarify-field-input lm-clarify-field-input--compact lm-outline-confirm-editor"
        rows={10}
        value={draft}
        disabled={disabled}
        aria-label="研究大纲（可编辑）"
        data-testid="lm-outline-confirm-editor"
        onChange={(e) => {
          setDraft(e.target.value);
          // Keep answer in sync while editing so「按修订确认」可用当前稿。
          if (value && outlineAnswerDecision(value) === "revise") {
            onChange(e.target.value);
          }
        }}
      />
      <div className="lm-outline-confirm-actions" role="group" aria-label="大纲决定">
        <button
          type="button"
          className="lm-btn lm-btn-accent lm-btn-sm"
          data-testid="lm-outline-approve"
          disabled={disabled}
          onClick={() => setDecision("approve")}
        >
          确认大纲
        </button>
        <button
          type="button"
          className="lm-btn lm-btn-secondary lm-btn-sm"
          data-testid="lm-outline-revise"
          disabled={disabled || !(draft.trim() || seed)}
          onClick={() => setDecision("revise")}
        >
          按修订确认
        </button>
        <button
          type="button"
          className="lm-btn lm-btn-ghost lm-btn-sm"
          data-testid="lm-outline-reject"
          disabled={disabled}
          onClick={() => setDecision("reject")}
        >
          不同意重做
        </button>
      </div>
      {value.trim() ? (
        <p className="lm-meta" data-testid="lm-outline-decision" data-decision={decision}>
          {decision === "approved"
            ? "已选择：确认大纲"
            : decision === "revise"
              ? "已选择：按修订确认"
              : decision === "rejected"
                ? "已选择：不同意，将重建大纲"
                : "请点上方按钮明确决定"}
        </p>
      ) : (
        <p className="lm-meta">请点上方按钮完成决定（不可只填空话提交）</p>
      )}
    </div>
  );
}

export type ClarificationFormVariant = "desk" | "compact" | "chat";

export type LawmindClarificationFormProps = {
  formKey: string;
  questions: ClarificationQuestion[];
  loading?: boolean;
  /** desk：在办主表；compact：对话短确认；chat：旧式填后发消息 */
  variant?: ClarificationFormVariant;
  values?: Record<string, string>;
  onValuesChange?: (values: Record<string, string>) => void;
  /** desk / compact：结构化 resume */
  onSubmitAnswers?: (answers: Record<string, string>) => void | Promise<void>;
  /** chat：拼成自然语言发送 */
  onApplyToInput?: (text: string) => void;
  onSend?: (text: string) => void | Promise<void>;
  /** 引导去在办（弱引导） */
  onOpenDesk?: () => void;
};

function applyFsOrOsDrop(
  e: DragEvent,
  onPin: (pin: ClarificationFilePin) => void,
): void {
  const fsPin = readLawmindFsDragFromDataTransfer(e.dataTransfer);
  if (fsPin) {
    onPin({
      root: fsPin.root,
      relPath: fsPin.relPath.replace(/^\/+/, ""),
      kind: fsPin.kind,
    });
    return;
  }
  const file = e.dataTransfer.files?.[0];
  const uri =
    e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain") || "";
  const name = file?.name?.trim() || uri.trim().split(/[/\\]/).pop() || "";
  if (!name) {
    return;
  }
  const relPath =
    name.startsWith("drafts/") || name.includes("/") ? name.replace(/^\/+/, "") : `uploads/${name}`;
  onPin({ root: "workspace", relPath, kind: "file" });
}

function FileField(props: {
  question: ClarificationQuestion;
  value: string;
  disabled: boolean;
  onChange: (v: string) => void;
}): ReactNode {
  const { question, value, disabled, onChange } = props;
  const pin = value ? parseClarificationFileAnswer(value) : null;
  const [pathDraft, setPathDraft] = useState(pin?.relPath ?? "");
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    setPathDraft(pin?.relPath ?? "");
  }, [pin?.relPath]);

  const applyPath = (relPath: string, kind: "file" | "directory" = "file") => {
    const t = relPath.trim().replace(/\\/g, "/");
    if (!t) {
      onChange("");
      return;
    }
    onChange(
      encodeClarificationFileAnswer({
        root: "workspace",
        relPath: t.replace(/^\/+/, ""),
        kind,
      }),
    );
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (disabled) {
      return;
    }
    applyFsOrOsDrop(e, (p) => {
      setPathDraft(p.relPath);
      onChange(encodeClarificationFileAnswer(p));
    });
  };

  return (
    <div
      className={`lm-clarify-file${dragOver ? " lm-clarify-file--drag" : ""}`}
      data-testid={`lm-clarify-file-${question.key}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <p className="lm-meta lm-clarify-file-hint">
        从左侧带入或拖入文件/目录；也可填工作区相对路径。
        {question.accept ? ` 建议：${question.accept}` : ""}
      </p>
      <div className="lm-clarify-file-row">
        <input
          type="text"
          className="lm-input"
          value={pathDraft}
          disabled={disabled}
          placeholder="工作区相对路径"
          aria-label={`${question.question} 路径`}
          onChange={(e) => setPathDraft(e.target.value)}
          onBlur={() => applyPath(pathDraft)}
        />
        <button
          type="button"
          className="lm-btn lm-btn-secondary lm-btn-sm"
          disabled={disabled || !pathDraft.trim()}
          onClick={() => applyPath(pathDraft)}
        >
          挂接
        </button>
        {pin ? (
          <button
            type="button"
            className="lm-btn lm-btn-ghost lm-btn-sm"
            disabled={disabled}
            onClick={() => {
              setPathDraft("");
              onChange("");
            }}
          >
            清除
          </button>
        ) : null}
      </div>
      {pin ? (
        <p className="lm-meta" role="status">
          已挂接：{pin.relPath}
          {pin.kind === "directory" ? "（目录）" : ""}
        </p>
      ) : null}
    </div>
  );
}

function AttachmentsStrip(props: {
  answers: Record<string, string>;
  disabled: boolean;
  onChangeAnswers: (next: Record<string, string>) => void;
}): ReactNode {
  const { answers, disabled, onChangeAnswers } = props;
  const [dragOver, setDragOver] = useState(false);
  const filePins = collectClarificationFilePins({
    [CLARIFY_ATTACHMENTS_KEY]: answers[CLARIFY_ATTACHMENTS_KEY] ?? "",
  });
  const sessionRefs = collectClarificationSessionRefs({
    [CLARIFY_SESSIONS_KEY]: answers[CLARIFY_SESSIONS_KEY] ?? "",
  });

  const addPin = (pin: ClarificationFilePin) => {
    const encoded = encodeClarificationFileAnswer(pin);
    onChangeAnswers({
      ...answers,
      [CLARIFY_ATTACHMENTS_KEY]: appendEncodedLine(answers[CLARIFY_ATTACHMENTS_KEY], encoded),
    });
  };

  const removePin = (pin: ClarificationFilePin) => {
    onChangeAnswers({
      ...answers,
      [CLARIFY_ATTACHMENTS_KEY]: removeEncodedLine(
        answers[CLARIFY_ATTACHMENTS_KEY],
        encodeClarificationFileAnswer(pin),
      ),
    });
  };

  const removeSession = (ref: ClarificationSessionRef) => {
    onChangeAnswers({
      ...answers,
      [CLARIFY_SESSIONS_KEY]: removeEncodedLine(
        answers[CLARIFY_SESSIONS_KEY],
        encodeClarificationSessionRef(ref),
      ),
    });
  };

  return (
    <div
      className={`lm-clarify-attachments${dragOver ? " lm-clarify-attachments--drag" : ""}`}
      data-testid="lm-clarify-attachments"
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (!disabled) {
          applyFsOrOsDrop(e, addPin);
        }
      }}
    >
      <div className="lm-clarify-attachments-head">
        <span className="lm-clarify-attachments-title">附加材料</span>
        <span className="lm-meta">用左侧对话栏选会话/材料，或拖入文件目录</span>
      </div>
      {filePins.length === 0 && sessionRefs.length === 0 ? (
        <p className="lm-meta lm-clarify-attachments-empty">尚未挂接材料或对话</p>
      ) : (
        <ul className="lm-clarify-attachments-chips">
          {filePins.map((pin) => (
            <li key={`${pin.root}:${pin.kind}:${pin.relPath}`}>
              <span className="lm-clarify-chip">
                {pin.kind === "directory" ? "目录" : "文件"} · {pin.relPath || "（根）"}
                <button
                  type="button"
                  className="lm-clarify-chip-remove"
                  disabled={disabled}
                  aria-label={`移除 ${pin.relPath}`}
                  onClick={() => removePin(pin)}
                >
                  ×
                </button>
              </span>
            </li>
          ))}
          {sessionRefs.map((ref) => (
            <li key={ref.sessionId}>
              <span className="lm-clarify-chip lm-clarify-chip--session">
                对话 · {ref.title}
                <button
                  type="button"
                  className="lm-clarify-chip-remove"
                  disabled={disabled}
                  aria-label={`移除对话 ${ref.title}`}
                  onClick={() => removeSession(ref)}
                >
                  ×
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FieldControl(props: {
  question: ClarificationQuestion;
  value: string;
  disabled: boolean;
  onChange: (v: string) => void;
  /** desk：略高的多行；非 desk 保持原逻辑 */
  desk?: boolean;
}): ReactNode {
  const { question, value, disabled, onChange, desk = false } = props;
  if (question.key === OUTLINE_CONFIRM_KEY) {
    return (
      <OutlineConfirmField
        question={question}
        value={value}
        disabled={disabled}
        onChange={onChange}
      />
    );
  }
  const t = normalizeClarificationInputType(question);

  if (t === "file") {
    return (
      <FileField question={question} value={value} disabled={disabled} onChange={onChange} />
    );
  }
  if (t === "bool") {
    return (
      <div className="lm-clarify-bool" role="group" aria-label={question.question}>
        {(
          [
            ["yes", "是"],
            ["no", "否"],
          ] as const
        ).map(([v, label]) => (
          <label key={v} className="lm-clarify-bool-opt">
            <input
              type="radio"
              name={`clarify-${question.key}`}
              checked={value === v || value === label}
              disabled={disabled}
              onChange={() => onChange(v)}
            />
            <span>{label}</span>
          </label>
        ))}
      </div>
    );
  }
  if (t === "enum" && question.options && question.options.length > 0) {
    return (
      <select
        className="lm-input"
        value={value}
        disabled={disabled}
        aria-label={question.question}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">请选择…</option>
        {question.options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    );
  }
  if (t === "date") {
    return (
      <input
        type="date"
        className="lm-input"
        value={value}
        disabled={disabled}
        aria-label={question.question}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  if (t === "textarea" || desk) {
    return (
      <textarea
        className="lm-clarify-field-input lm-clarify-field-input--compact"
        rows={t === "textarea" ? 4 : 3}
        value={value}
        placeholder="在此输入…"
        disabled={disabled}
        aria-label={question.question}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  const preferTextarea =
    question.question.length > 48 || (question.reason?.length ?? 0) > 40;
  if (preferTextarea) {
    return (
      <textarea
        className="lm-clarify-field-input lm-clarify-field-input--compact"
        rows={3}
        value={value}
        placeholder="在此输入…"
        disabled={disabled}
        aria-label={question.question}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  return (
    <input
      type="text"
      className="lm-input lm-clarify-field-input"
      value={value}
      placeholder="在此输入…"
      disabled={disabled}
      aria-label={question.question}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function LawmindClarificationForm(props: LawmindClarificationFormProps): ReactNode {
  const {
    formKey,
    questions,
    loading = false,
    variant = "chat",
    values: controlledValues,
    onValuesChange,
    onSubmitAnswers,
    onApplyToInput,
    onSend,
    onOpenDesk,
  } = props;

  const tableId = useId();
  const [internal, setInternal] = useState<Record<string, string>>(() =>
    Object.fromEntries(questions.map((q) => [q.key, ""])),
  );

  useEffect(() => {
    if (controlledValues) {
      return;
    }
    setInternal(Object.fromEntries(questions.map((q) => [q.key, ""])));
  }, [formKey, questions, controlledValues]);

  const answers = controlledValues ?? internal;
  const setAnswers = (next: Record<string, string>) => {
    if (controlledValues && onValuesChange) {
      onValuesChange(next);
      return;
    }
    setInternal(next);
    onValuesChange?.(next);
  };

  const setOne = (key: string, value: string) => {
    setAnswers({ ...answers, [key]: value });
  };

  const mapped = buildClarificationAnswerMap(questions, answers);
  const complete = clarificationAnswersComplete(questions, answers);
  const answeredCount = questions.filter((q) => (answers[q.key] ?? "").trim() !== "").length;
  const chatPayload = formatClarificationReply(questions, answers);
  const promptSummary = formatClarificationPromptSummary(questions);
  const deskLike = variant === "desk" || variant === "compact";

  return (
    <div
      className={`lm-clarify-form lm-clarify-form--${variant}`}
      data-testid="lm-clarify-form"
      data-variant={variant}
    >
      {questions.length > 0 ? (
        <p className="lm-clarify-form-progress" role="status" aria-label="填写进度">
          已填 {answeredCount} / {questions.length} 项
          {variant === "desk" ? " · 填毕后提交，任务将继续" : null}
        </p>
      ) : (
        <p className="lm-meta">请补充说明后提交继续。</p>
      )}

      {questions.length > 0 ? (
        variant === "desk" ? (
          <div
            className="lm-clarify-stack"
            id={tableId}
            role="group"
            aria-label="待补充信息"
          >
            {questions.map((item) => {
              const t = normalizeClarificationInputType(item);
              const isOutline = item.key === OUTLINE_CONFIRM_KEY;
              const label = isOutline ? "请确认研究大纲" : item.question;
              return (
                <div
                  key={item.key}
                  className="lm-clarify-stack-item"
                  data-input-type={t}
                  data-testid={`lm-clarify-stack-${item.key}`}
                >
                  <div className="lm-clarify-stack-label">
                    <span className="lm-clarify-field-label">
                      {label}
                      {item.required === false ? (
                        <span className="lm-meta"> （选填）</span>
                      ) : (
                        <span className="lm-clarify-required" aria-hidden>
                          *
                        </span>
                      )}
                    </span>
                    {item.reason && !isOutline ? (
                      <span className="lm-clarify-field-reason">{item.reason}</span>
                    ) : isOutline ? (
                      <span className="lm-clarify-field-reason">
                        先确认大纲再写正文；可编辑章节后按修订确认。
                      </span>
                    ) : null}
                  </div>
                  <FieldControl
                    question={item}
                    value={answers[item.key] ?? ""}
                    disabled={loading}
                    desk={t === "text" || t === "textarea"}
                    onChange={(v) => setOne(item.key, v)}
                  />
                </div>
              );
            })}
          </div>
        ) : (
          <table className="lm-clarify-table" aria-labelledby={tableId}>
            <caption id={tableId} className="lm-sr-only">
              待补充信息
            </caption>
            <thead>
              <tr>
                <th scope="col">事项</th>
                <th scope="col">填写</th>
              </tr>
            </thead>
            <tbody>
              {questions.map((item) => {
                const t = normalizeClarificationInputType(item);
                const isOutline = item.key === OUTLINE_CONFIRM_KEY;
                const label = isOutline ? "请确认研究大纲" : item.question;
                return (
                  <tr key={item.key} data-input-type={t}>
                    <th scope="row">
                      <span className="lm-clarify-field-label">
                        {label}
                        {item.required === false ? (
                          <span className="lm-meta"> （选填）</span>
                        ) : (
                          <span className="lm-clarify-required" aria-hidden>
                            *
                          </span>
                        )}
                      </span>
                      {item.reason && !isOutline ? (
                        <span className="lm-clarify-field-reason">{item.reason}</span>
                      ) : isOutline ? (
                        <span className="lm-clarify-field-reason">
                          先确认大纲再写正文；可编辑章节后按修订确认。
                        </span>
                      ) : null}
                    </th>
                    <td>
                      <FieldControl
                        question={item}
                        value={answers[item.key] ?? ""}
                        disabled={loading}
                        onChange={(v) => setOne(item.key, v)}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )
      ) : (
        <textarea
          className="lm-clarify-field-input lm-clarify-field-input--compact"
          rows={variant === "desk" ? 3 : 3}
          value={answers._free ?? ""}
          disabled={loading}
          placeholder="补充说明…"
          aria-label="补充说明"
          onChange={(e) => setOne("_free", e.target.value)}
        />
      )}

      {variant === "desk" ? (
        <AttachmentsStrip
          answers={answers}
          disabled={loading}
          onChangeAnswers={setAnswers}
        />
      ) : null}

      <div className="lm-clarify-form-actions">
        {deskLike && onSubmitAnswers ? (
          <button
            type="button"
            className="lm-btn lm-btn-accent lm-clarify-btn"
            data-testid="lm-clarify-submit"
            disabled={loading || !complete}
            title={!complete ? "请先填完必填项" : "提交后助手继续办理"}
            onClick={() => {
              const payload =
                questions.length > 0
                  ? mapped
                  : answers._free?.trim()
                    ? {
                        note: answers._free.trim(),
                        ...(answers[CLARIFY_ATTACHMENTS_KEY]?.trim()
                          ? { [CLARIFY_ATTACHMENTS_KEY]: answers[CLARIFY_ATTACHMENTS_KEY] }
                          : {}),
                        ...(answers[CLARIFY_SESSIONS_KEY]?.trim()
                          ? { [CLARIFY_SESSIONS_KEY]: answers[CLARIFY_SESSIONS_KEY] }
                          : {}),
                      }
                    : buildClarificationAnswerMap([], answers);
              void onSubmitAnswers(payload);
            }}
          >
            {loading ? "提交中…" : "提交补充并继续"}
          </button>
        ) : null}

        {variant === "chat" ? (
          <>
            {onOpenDesk ? (
              <button
                type="button"
                className="lm-btn lm-btn-secondary lm-clarify-btn"
                data-testid="lm-clarify-open-desk"
                disabled={loading}
                onClick={onOpenDesk}
              >
                去在办补充
              </button>
            ) : null}
            {promptSummary && onApplyToInput ? (
              <button
                type="button"
                className="lm-btn lm-btn-ghost lm-clarify-btn"
                disabled={loading}
                title="只把问题列表放到下面大框"
                onClick={() => onApplyToInput(promptSummary)}
              >
                只把问题列到下面
              </button>
            ) : null}
            {onApplyToInput ? (
              <button
                type="button"
                className="lm-btn lm-btn-secondary lm-clarify-btn"
                disabled={!chatPayload || loading}
                onClick={() => onApplyToInput(chatPayload)}
              >
                已填的放到下面
              </button>
            ) : null}
            {onSend ? (
              <button
                type="button"
                className="lm-btn lm-clarify-btn"
                disabled={!chatPayload || loading}
                onClick={() => void onSend(chatPayload)}
              >
                填好并发送
              </button>
            ) : null}
          </>
        ) : null}

        {variant === "compact" && onOpenDesk ? (
          <button
            type="button"
            className="lm-btn lm-btn-ghost lm-clarify-btn"
            disabled={loading}
            onClick={onOpenDesk}
          >
            改在「在办」填
          </button>
        ) : null}

        <button
          type="button"
          className="lm-btn lm-btn-ghost lm-clarify-btn"
          disabled={loading}
          onClick={() => {
            const keys =
              questions.length > 0
                ? [...questions.map((q) => q.key), CLARIFY_ATTACHMENTS_KEY, CLARIFY_SESSIONS_KEY]
                : ["_free", CLARIFY_ATTACHMENTS_KEY, CLARIFY_SESSIONS_KEY];
            setAnswers(Object.fromEntries(keys.map((k) => [k, ""])));
          }}
        >
          清空
        </button>
      </div>
    </div>
  );
}
