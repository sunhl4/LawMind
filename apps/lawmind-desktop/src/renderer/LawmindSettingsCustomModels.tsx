import { useCallback, useId, useState, type FormEvent, type ReactNode } from "react";
import {
  addCustomModel,
  deleteCustomModel,
  type ModelCatalogEntry,
} from "./lawmind-models-api";

type Props = {
  apiBase: string;
  customModels: ModelCatalogEntry[];
  onChanged: () => void | Promise<void>;
};

export function LawmindSettingsCustomModels(props: Props): ReactNode {
  const { apiBase, customModels, onChanged } = props;
  const uid = useId();
  const [label, setLabel] = useState("");
  const [baseUrl, setBaseUrl] = useState("https://api.openai.com/v1");
  const [model, setModel] = useState("gpt-4o");
  const [apiKey, setApiKey] = useState("");
  const [stop, setStop] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setBusy(true);
      setError(null);
      try {
        const trimmedModel = model.trim();
        if (/^(custom|builtin|platform|env):/i.test(trimmedModel) || /^[0-9a-f-]{20,}$/i.test(trimmedModel)) {
          setError("请填写上游实际模型名（如 gpt-4o），不要填 LawMind 内部 ID。");
          setBusy(false);
          return;
        }
        const trimmedKey = apiKey.trim();
        const stopList = stop
          .split(/[,，]/)
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, 8);
        const basePayload = {
          label: label.trim(),
          baseUrl: baseUrl.trim(),
          model: trimmedModel,
          setAsDefault: true as const,
          ...(stopList.length > 0 ? { stop: stopList } : {}),
        };
        const desktop = window.lawmindDesktop;
        const keychainAvailable = Boolean(desktop?.saveCustomModelKey);
        let usedKeychain = false;
        if (keychainAvailable && desktop) {
          const status = await desktop.keychainStatus();
          if (status?.available) {
            const added = await addCustomModel(apiBase, {
              ...basePayload,
              apiKey: "",
              keyStorage: "keychain",
            });
            try {
              const saved = await desktop.saveCustomModelKey({
                id: added.id,
                apiKey: trimmedKey,
              });
              if (!saved.ok) {
                throw new Error(saved.error?.trim() || "钥匙串保存失败");
              }
              usedKeychain = true;
            } catch (keychainErr) {
              try {
                await deleteCustomModel(apiBase, added.id);
              } catch {
                /* best-effort orphan cleanup */
              }
              throw keychainErr instanceof Error
                ? keychainErr
                : new Error(String(keychainErr));
            }
          }
        }
        if (!usedKeychain) {
          await addCustomModel(apiBase, {
            ...basePayload,
            apiKey: trimmedKey,
          });
        }
        setLabel("");
        setApiKey("");
        setStop("");
        await onChanged();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(false);
      }
    },
    [apiBase, apiKey, baseUrl, label, model, onChanged, stop],
  );

  const onRemove = useCallback(
    async (id: string) => {
      setBusy(true);
      setError(null);
      try {
        await deleteCustomModel(apiBase, id);
        try {
          await window.lawmindDesktop?.deleteCustomModelKey?.({ id });
        } catch {
          /* keychain delete is best-effort */
        }
        await onChanged();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(false);
      }
    },
    [apiBase, onChanged],
  );

  const canSubmit = Boolean(label.trim() && model.trim() && apiKey.trim()) && !busy;
  const idLabel = `${uid}-label`;
  const idBaseUrl = `${uid}-base-url`;
  const idModel = `${uid}-model`;
  const idKey = `${uid}-key`;
  const idStop = `${uid}-stop`;

  return (
    <section className="lm-custom-model-panel" data-testid="lm-custom-model-panel">
      <header className="lm-custom-model-panel__head">
        <div className="lm-custom-model-panel__titles">
          <h3 className="lm-custom-model-panel__title">自定义模型</h3>
          <p className="lm-custom-model-panel__caption">添加 OpenAI 兼容端点，并设为当前默认</p>
        </div>
      </header>

      {customModels.length > 0 ? (
        <ul className="lm-custom-model-list" aria-label="已添加的自定义模型">
          {customModels.map((m) => (
            <li key={m.id} className="lm-custom-model-card">
              <div className="lm-custom-model-card__main">
                <span className="lm-custom-model-card__name">{m.label}</span>
                <span className="lm-custom-model-card__meta">
                  <span className="lm-custom-model-card__model">{m.model}</span>
                  <span className="lm-custom-model-card__url" title={m.baseUrl}>
                    {m.baseUrl}
                  </span>
                </span>
              </div>
              <div className="lm-custom-model-card__aside">
                {m.verifiedAt ? (
                  <span className="lm-pill lm-pill-success" title={`最后验证：${m.verifiedAt}`}>
                    已验证
                    {typeof m.verifiedLatencyMs === "number" ? ` · ${m.verifiedLatencyMs}ms` : ""}
                  </span>
                ) : (
                  <span className="lm-pill lm-pill-warn">待验证</span>
                )}
                <button
                  type="button"
                  className="lm-btn lm-btn-ghost lm-btn-sm"
                  disabled={busy}
                  onClick={() => void onRemove(m.id)}
                >
                  删除
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      <form className="lm-custom-model-form" onSubmit={(e) => void onSubmit(e)}>
        <div className="lm-custom-model-field">
          <label className="lm-custom-model-field__label" htmlFor={idLabel}>
            显示名称
          </label>
          <input
            id={idLabel}
            className="lm-custom-model-input"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="例如：我的 GPT-4o"
            autoComplete="off"
          />
        </div>

        <div className="lm-custom-model-field">
          <label className="lm-custom-model-field__label" htmlFor={idBaseUrl}>
            Base URL
          </label>
          <input
            id={idBaseUrl}
            className="lm-custom-model-input lm-custom-model-input--mono"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://api.openai.com/v1"
            spellCheck={false}
            autoComplete="off"
          />
        </div>

        <div className="lm-custom-model-field">
          <label className="lm-custom-model-field__label" htmlFor={idModel}>
            模型 ID
          </label>
          <input
            id={idModel}
            className="lm-custom-model-input lm-custom-model-input--mono"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="gpt-4o 或 qwen-plus"
            spellCheck={false}
            autoComplete="off"
          />
        </div>

        <div className="lm-custom-model-field">
          <label className="lm-custom-model-field__label" htmlFor={idKey}>
            API 密钥
          </label>
          <input
            id={idKey}
            className="lm-custom-model-input lm-custom-model-input--mono"
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-…"
          />
        </div>

        <div className="lm-custom-model-field">
          <label className="lm-custom-model-field__label" htmlFor={idStop}>
            Stop 序列（可选）
          </label>
          <input
            id={idStop}
            className="lm-custom-model-input lm-custom-model-input--mono"
            value={stop}
            onChange={(e) => setStop(e.target.value)}
            placeholder="如：###END###, <|im_end|>"
            spellCheck={false}
            autoComplete="off"
            data-testid="lm-custom-model-stop"
          />
          <p className="lm-settings-caption">逗号分隔，最多 8 个；写入上游 chat/completions 的 stop。</p>
        </div>

        {error ? (
          <p className="lm-custom-model-form__error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="lm-custom-model-form__actions">
          <button
            type="submit"
            className="lm-btn lm-btn-accent lm-custom-model-submit"
            disabled={!canSubmit}
          >
            {busy ? "保存中…" : "添加并设为默认"}
          </button>
        </div>
      </form>
    </section>
  );
}
