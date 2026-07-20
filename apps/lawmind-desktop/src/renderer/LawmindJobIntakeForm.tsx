import { useMemo, useState, type ReactNode } from "react";
import {
  buildJobIntakeDispatchPrompt,
  defaultIntakeFieldsForDeliverable,
  type JobIntakeFieldDef,
} from "./lawmind-job-intake";

export type JobIntakeTemplate = {
  id: string;
  name: string;
  description?: string;
  deliverableType?: string;
  intakeFields?: JobIntakeFieldDef[];
};

type Props = {
  template: JobIntakeTemplate;
  onCancel: () => void;
  /** Fill composer and close (lawyer may edit before send). Omit when host is not the chat surface. */
  onFillComposer?: (prompt: string) => void;
  /** Preferred: fill + send immediately as a structured job. */
  onDispatch?: (prompt: string) => void;
};

export function LawmindJobIntakeForm(props: Props): ReactNode {
  const { template, onCancel, onFillComposer, onDispatch } = props;
  const fields = useMemo(
    () =>
      template.intakeFields && template.intakeFields.length > 0
        ? template.intakeFields
        : defaultIntakeFieldsForDeliverable(template.deliverableType),
    [template.intakeFields, template.deliverableType],
  );
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.key, ""])),
  );
  const [error, setError] = useState<string | null>(null);

  const missingRequired = fields.filter((f) => f.required && !values[f.key]?.trim());

  const buildPrompt = (): string =>
    buildJobIntakeDispatchPrompt({
      templateName: template.name,
      deliverableType: template.deliverableType,
      fields: fields.map((f) => ({
        key: f.key,
        label: f.label,
        value: values[f.key] ?? "",
      })),
    });

  const tryBuild = (): string | null => {
    if (missingRequired.length > 0) {
      setError(`请先填写：${missingRequired.map((f) => f.label).join("、")}`);
      return null;
    }
    setError(null);
    return buildPrompt();
  };

  return (
    <div className="lm-job-intake" role="region" aria-label={`交办：${template.name}`}>
      <header className="lm-job-intake-head">
        <div>
          <span className="lm-assignment-kicker">填表交办</span>
          <strong>{template.name}</strong>
          {template.description ? <p className="lm-meta">{template.description}</p> : null}
        </div>
        <button type="button" className="lm-btn lm-btn-ghost lm-btn-small" onClick={onCancel}>
          返回
        </button>
      </header>
      <p className="lm-meta lm-job-intake-hint">
        填好关键项后一键交办，无需写提示词。系统会按你的习惯与案件记忆执行。
      </p>
      <div className="lm-job-intake-fields">
        {fields.map((f) => (
          <label key={f.key} className="lm-job-intake-field">
            <span>
              {f.label}
              {f.required ? <abbr title="必填">*</abbr> : null}
            </span>
            {f.multiline ? (
              <textarea
                className="lm-input"
                rows={3}
                placeholder={f.placeholder}
                value={values[f.key] ?? ""}
                onChange={(e) => setValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
              />
            ) : (
              <input
                className="lm-input"
                type="text"
                placeholder={f.placeholder}
                value={values[f.key] ?? ""}
                onChange={(e) => setValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
              />
            )}
          </label>
        ))}
      </div>
      {error ? <p className="lm-error">{error}</p> : null}
      <div className="lm-job-intake-actions">
        {onFillComposer ? (
          <button
            type="button"
            className="lm-btn lm-btn-secondary"
            onClick={() => {
              const prompt = tryBuild();
              if (prompt) {
                onFillComposer(prompt);
              }
            }}
          >
            填入对话（可再改）
          </button>
        ) : null}
        <button
          type="button"
          className="lm-btn"
          disabled={!onDispatch && !onFillComposer}
          onClick={() => {
            const prompt = tryBuild();
            if (!prompt) {
              return;
            }
            if (onDispatch) {
              onDispatch(prompt);
            } else {
              onFillComposer?.(prompt);
            }
          }}
        >
          开始交办
        </button>
      </div>
    </div>
  );
}
