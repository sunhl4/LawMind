import type { ReactNode } from "react";
import {
  MAIL_CLOSING_STYLE_OPTIONS,
  previewMailSendFormat,
  type MailSendFormat,
} from "../../../../src/lawmind/mail/mail-send-format.ts";

type Props = {
  value: MailSendFormat;
  onChange: (next: MailSendFormat) => void;
  disabled?: boolean;
};

export function LawmindMailSendFormatFields(props: Props): ReactNode {
  const { value, onChange, disabled } = props;
  const closingStyle = value.closingStyle ?? "none";
  const preview = previewMailSendFormat(value);

  return (
    <div className="lm-mail-send-format" data-testid="lm-mail-send-format">
      <h4 className="lm-settings-subtitle">发送格式 / 落款</h4>
      <p className="lm-meta">
        批准发送时自动带上。助手起草外发邮件时也会按这里写。正文里已经有同样落款则不会再加一遍。
      </p>

      <label className="lm-compose-bar-field">
        <span className="lm-compose-bar-label">发件显示名</span>
        <input
          className="lm-input"
          value={value.fromName ?? ""}
          onChange={(e) => onChange({ ...value, fromName: e.target.value })}
          placeholder="如：张三律师"
          aria-label="发件显示名"
          disabled={disabled}
        />
      </label>

      <label className="lm-compose-bar-field">
        <span className="lm-compose-bar-label">结束语</span>
        <select
          className="lm-compose-select"
          value={closingStyle}
          onChange={(e) =>
            onChange({
              ...value,
              closingStyle: e.target.value as MailSendFormat["closingStyle"],
            })
          }
          aria-label="结束语"
          disabled={disabled}
        >
          {MAIL_CLOSING_STYLE_OPTIONS.map((opt) => (
            <option key={opt.id} value={opt.id}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>

      {closingStyle === "custom" ? (
        <label className="lm-compose-bar-field">
          <span className="lm-compose-bar-label">自定义结束语</span>
          <input
            className="lm-input"
            value={value.customClosing ?? ""}
            onChange={(e) => onChange({ ...value, customClosing: e.target.value })}
            placeholder="如：专此奉达"
            aria-label="自定义结束语"
            disabled={disabled}
          />
        </label>
      ) : null}

      <label className="lm-compose-bar-field">
        <span className="lm-compose-bar-label">落款</span>
        <textarea
          className="lm-input lm-mail-send-signature"
          rows={5}
          value={value.signature ?? ""}
          onChange={(e) => onChange({ ...value, signature: e.target.value })}
          placeholder={"某某律师事务所\n张三 律师\n电话：138xxxx"}
          aria-label="落款"
          data-testid="lm-mail-signature"
          disabled={disabled}
        />
      </label>

      <label className="lm-settings-row lm-settings-row-check">
        <span className="lm-settings-key">正文未含落款时自动附加</span>
        <input
          type="checkbox"
          checked={value.appendIfMissing !== false}
          aria-label="正文未含落款时自动附加"
          data-testid="lm-mail-append-signature"
          disabled={disabled}
          onChange={(e) => onChange({ ...value, appendIfMissing: e.target.checked })}
        />
      </label>

      <div className="lm-mail-send-preview-wrap">
        <span className="lm-compose-bar-label">预览</span>
        <pre className="lm-mail-send-preview" data-testid="lm-mail-send-preview">
          {preview}
        </pre>
      </div>
    </div>
  );
}
