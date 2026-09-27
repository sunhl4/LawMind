import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  DEFAULT_WORD_REVISION_AUTHOR,
  WORD_REVISION_AUTHOR_MAX_CHARS,
} from "../../../../src/lawmind/policy/word-revision-author.ts";
import { apiGetJson, apiSendJson, errorMessage } from "./api-client";
import {
  applyUiDensity,
  applyUiFontScale,
  applyUiTheme,
  readUiDensity,
  readUiFontScale,
  readUiTheme,
  resetDefaultPanelLayout,
  resetSidebarWidthPreference,
  writeUiDensity,
  writeUiFontScale,
  writeUiTheme,
  type UiDensity,
  type UiFontScale,
  type UiTheme,
} from "./lawmind-ui-prefs";
import { WordAddinDoctorGroup } from "./LawmindSettingsDoctorWordAddin";
import {
  readAutoExportOnApprove,
  useRequireSignoffReview,
  writeAutoExportOnApprove,
  writeRequireSignoffReview,
} from "./lawmind-review-prefs";

type Props = {
  apiBase?: string;
  onPrefsChange?: () => void;
};

type SegmentOption<T extends string> = {
  value: T;
  label: string;
};

function SettingsSegment<T extends string>(props: {
  label: string;
  hint?: string;
  hintId?: string;
  ariaLabel: string;
  value: T;
  options: SegmentOption<T>[];
  testId?: string;
  onChange: (value: T) => void;
}): ReactNode {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const forward = event.key === "ArrowRight" || event.key === "ArrowDown";
    const backward = event.key === "ArrowLeft" || event.key === "ArrowUp";
    if (!forward && !backward) {
      return;
    }
    event.preventDefault();
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
    const index = buttons.findIndex((button) => button === document.activeElement);
    const delta = forward ? 1 : -1;
    const next = buttons[(index + delta + buttons.length) % buttons.length];
    next?.focus();
    next?.click();
  };

  return (
    <div className="lm-settings-row">
      <span className={`lm-settings-key${props.hint ? " lm-settings-key-stack" : ""}`}>
        {props.label}
        {props.hint ? (
          <span className="lm-settings-caption" id={props.hintId}>
            {props.hint}
          </span>
        ) : null}
      </span>
      <div
        className={`lm-settings-segment${props.options.length > 2 ? " lm-settings-segment--3" : ""}`}
        role="radiogroup"
        aria-label={props.ariaLabel}
        aria-orientation="horizontal"
        aria-describedby={props.hintId}
        data-testid={props.testId}
        onKeyDown={onKeyDown}
      >
        {props.options.map((option) => {
          const on = props.value === option.value;
          return (
            <button
              key={option.value}
              type="button"
              className={`lm-settings-segment-btn${on ? " is-on" : ""}`}
              role="radio"
              aria-checked={on}
              tabIndex={on ? 0 : -1}
              onClick={() => props.onChange(option.value)}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SettingsSwitch(props: {
  label: string;
  hint: string;
  checked: boolean;
  testId: string;
  onChange: (next: boolean) => void;
}): ReactNode {
  const hintId = `${props.testId}-hint`;
  return (
    <label className="lm-settings-row">
      <span className="lm-settings-key lm-settings-key-stack">
        {props.label}
        <span className="lm-settings-caption" id={hintId}>
          {props.hint}
        </span>
      </span>
      <span className="lm-switch">
        <input
          type="checkbox"
          role="switch"
          aria-label={props.label}
          aria-describedby={hintId}
          aria-checked={props.checked}
          checked={props.checked}
          data-testid={props.testId}
          onChange={(event) => props.onChange(event.target.checked)}
        />
        <span className="lm-switch-ui" aria-hidden="true" />
      </span>
    </label>
  );
}

function WordRevisionAuthorField(props: { apiBase?: string }): ReactNode {
  const { apiBase } = props;
  const [value, setValue] = useState("");
  const [saved, setSaved] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const edited = useRef(false);

  useEffect(() => {
    if (!apiBase) {
      return undefined;
    }
    let cancelled = false;
    void apiGetJson<{ wordRevisionAuthor?: string }>(apiBase, "/api/policy/workspace")
      .then((body) => {
        if (cancelled || edited.current) {
          return;
        }
        const next = typeof body.wordRevisionAuthor === "string" ? body.wordRevisionAuthor : "";
        setValue(next);
        setSaved(next);
      })
      .catch(() => {
        if (!cancelled) {
          setNote("署名暂时读不出来，稍后再试。");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [apiBase]);

  const persist = (raw: string) => {
    const next = raw.trim();
    if (!apiBase || next === saved || busy) {
      return;
    }
    setBusy(true);
    setNote(null);
    void apiSendJson<{ wordRevisionAuthor?: string }>(apiBase, "/api/policy/workspace", "PATCH", {
      wordRevisionAuthor: next,
    })
      .then((body) => {
        const stored = typeof body.wordRevisionAuthor === "string" ? body.wordRevisionAuthor : "";
        setSaved(stored);
        setValue((current) => {
          if (current.trim() === next) {
            edited.current = false;
            return stored;
          }
          return current;
        });
        setNote(stored ? "之后的 Word 修订用这个署名。" : "已改回默认 LawMind。");
      })
      .catch((err: unknown) => {
        setNote(errorMessage(err));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <div className="lm-settings-row">
      <label className="lm-settings-key lm-settings-key-stack" htmlFor="lm-word-revision-author">
        修订署名
        <span className="lm-settings-caption" id="lm-word-revision-author-hint">
          改 Word 时，修订显示这个名字。留空就是 {DEFAULT_WORD_REVISION_AUTHOR}。
          {note ? ` ${note}` : ""}
        </span>
      </label>
      <input
        id="lm-word-revision-author"
        className="lm-input lm-settings-author-input"
        data-testid="lm-word-revision-author"
        aria-describedby="lm-word-revision-author-hint"
        placeholder={DEFAULT_WORD_REVISION_AUTHOR}
        maxLength={WORD_REVISION_AUTHOR_MAX_CHARS}
        value={value}
        disabled={!apiBase || busy}
        onChange={(event) => {
          edited.current = true;
          setValue(event.target.value);
        }}
        onBlur={() => persist(value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.currentTarget.blur();
          }
        }}
      />
    </div>
  );
}

export function LawmindSettingsAppearance({ apiBase, onPrefsChange }: Props): ReactNode {
  const [fontScale, setFontScaleState] = useState(readUiFontScale);
  const [density, setDensityState] = useState(readUiDensity);
  const [theme, setThemeState] = useState(readUiTheme);
  const [autoExport, setAutoExport] = useState(readAutoExportOnApprove);
  const requireSignoffReview = useRequireSignoffReview();

  const notify = () => onPrefsChange?.();

  const setFontScale = (scale: UiFontScale) => {
    writeUiFontScale(scale);
    applyUiFontScale(scale);
    setFontScaleState(scale);
    notify();
  };

  const setDensity = (next: UiDensity) => {
    writeUiDensity(next);
    applyUiDensity(next);
    setDensityState(next);
    notify();
  };

  const setTheme = (next: UiTheme) => {
    writeUiTheme(next);
    applyUiTheme(next);
    setThemeState(next);
    notify();
  };

  const resetLayout = () => {
    resetDefaultPanelLayout();
    resetSidebarWidthPreference();
    notify();
    window.location.reload();
  };

  return (
    <div className="lm-settings-section" id="lawmind-settings-appearance">
      <div className="lm-settings-group lm-settings-surface">
        <SettingsSegment
          label="配色"
          ariaLabel="配色主题"
          testId="lm-ui-theme"
          value={theme}
          options={[
            { value: "light", label: "浅色" },
            { value: "dark", label: "深色" },
          ]}
          onChange={setTheme}
        />
        <SettingsSegment
          label="字号"
          hint="对话、在办、文书和设置都用这一档。"
          hintId="lm-font-scale-hint"
          ariaLabel="界面字号"
          value={fontScale}
          options={[
            { value: "small", label: "小一点" },
            { value: "default", label: "标准" },
            { value: "large", label: "大一点" },
          ]}
          onChange={setFontScale}
        />
        <SettingsSegment
          label="疏密"
          ariaLabel="界面密度"
          value={density}
          options={[
            { value: "default", label: "标准" },
            { value: "compact", label: "紧凑" },
          ]}
          onChange={setDensity}
        />
      </div>

      <div className="lm-settings-group lm-settings-surface" id="lawmind-settings-review-prefs">
        <SettingsSwitch
          label="待审稿进待拍板"
          hint="打开后，内部稿也要您通过或驳回。"
          checked={requireSignoffReview}
          testId="lm-require-signoff-review"
          onChange={(next) => {
            writeRequireSignoffReview(next);
            notify();
          }}
        />
        <SettingsSwitch
          label="通过后生成 Word"
          hint="通过审阅后直接生成，不必再导出一次。"
          checked={autoExport}
          testId="lm-auto-export-on-approve"
          onChange={(next) => {
            writeAutoExportOnApprove(next);
            setAutoExport(next);
            notify();
          }}
        />
        <WordRevisionAuthorField apiBase={apiBase} />
      </div>

      <div className="lm-settings-group lm-settings-surface">
        <div className="lm-settings-row">
          <span className="lm-settings-key lm-settings-key-stack">
            版面
            <span className="lm-settings-caption" id="lm-appearance-layout-hint">
              侧栏和分栏回到最初的样子，窗口会重开一次。
            </span>
          </span>
          <button
            type="button"
            className="lm-btn lm-btn-secondary lm-btn-sm"
            aria-describedby="lm-appearance-layout-hint"
            onClick={resetLayout}
          >
            恢复默认
          </button>
        </div>
      </div>

      <WordAddinDoctorGroup />
    </div>
  );
}
