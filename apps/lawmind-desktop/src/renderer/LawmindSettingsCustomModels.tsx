import { useCallback, useState, type FormEvent, type ReactNode } from "react";
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
  const [label, setLabel] = useState("");
  const [baseUrl, setBaseUrl] = useState("https://api.openai.com/v1");
  const [model, setModel] = useState("gpt-4o");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setBusy(true);
      setError(null);
      try {
        const trimmedModel = model.trim();
        // Client-side guard: common mistake is pasting LawMind internal id or raw uuid into the upstream model field.
        if (/^(custom|builtin|platform|env):/i.test(trimmedModel) || /^[0-9a-f-]{20,}$/i.test(trimmedModel)) {
          setError("模型 ID 看起来像 LawMind 内部标识（custom:xxx 或一串 hex/uuid），请填写该 Base URL 实际接受的模型名称，例如 gpt-4o、qwen-plus 或你本地模型的名字。");
          setBusy(false);
          return;
        }
        const trimmedKey = apiKey.trim();
        const desktop = window.lawmindDesktop;
        const keychainAvailable = Boolean(desktop?.saveCustomModelKey);
        let usedKeychain = false;
        if (keychainAvailable && desktop) {
          const status = await desktop.keychainStatus();
          if (status?.available) {
            const added = await addCustomModel(apiBase, {
              label: label.trim(),
              baseUrl: baseUrl.trim(),
              model: trimmedModel,
              apiKey: trimmedKey,
              setAsDefault: true,
            });
            const saved = await desktop.saveCustomModelKey({
              id: added.id,
              apiKey: trimmedKey,
            });
            if (saved.ok) {
              usedKeychain = true;
            }
          }
        }
        if (!usedKeychain) {
          await addCustomModel(apiBase, {
            label: label.trim(),
            baseUrl: baseUrl.trim(),
            model: trimmedModel,
            apiKey: trimmedKey,
            setAsDefault: true,
          });
        }
        setLabel("");
        setApiKey("");
        await onChanged();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(false);
      }
    },
    [apiBase, apiKey, baseUrl, label, model, onChanged],
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

  return (
    <div className="lm-settings-subsection">
      <div className="lm-settings-subsection-title">自定义模型（自带 API Key）</div>
      <p className="lm-meta lm-settings-hint">
        与 Cursor 类似：内置模型使用各服务商在向导/env 中的 Key；此处可添加任意 OpenAI 兼容端点。
        「模型 ID」请填写该端点实际接受的模型名称（会直接作为 chat/completions 的 model 参数发出），不要填 LawMind 内部 ID。
      </p>
      {customModels.length > 0 ? (
        <ul className="lm-custom-model-list">
          {customModels.map((m) => (
            <li key={m.id} className="lm-custom-model-row">
              <span className="lm-custom-model-name">{m.label}</span>
              <span className="lm-meta">{m.model}</span>
              {m.verifiedAt ? (
                <span className="lm-pill lm-pill-success" title={`最后验证：${m.verifiedAt}`}>
                  已验证{typeof m.verifiedLatencyMs === "number" ? ` · ${m.verifiedLatencyMs}ms` : ""}
                </span>
              ) : (
                <span className="lm-pill lm-pill-warn">待验证</span>
              )}
              <button
                type="button"
                className="lm-btn lm-btn-secondary lm-btn-sm"
                disabled={busy}
                onClick={() => void onRemove(m.id)}
              >
                删除
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <form className="lm-custom-model-form" onSubmit={(e) => void onSubmit(e)}>
        <label className="lm-field">
          <span>显示名称</span>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="例如：我的 GPT-4o" />
        </label>
        <label className="lm-field">
          <span>Base URL</span>
          <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
        </label>
        <label className="lm-field">
          <span>模型 ID（上游实际模型名）</span>
          <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="gpt-4o 或 qwen-plus" />
          <span className="lm-meta" style={{ marginTop: 2 }}>必须是该 Base URL 认识的模型名称（会直接发给 /chat/completions 的 model 参数）。不要填 custom:xxx 之类的内部 ID。</span>
        </label>
        <label className="lm-field">
          <span>API Key</span>
          <input
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
        </label>
        {error ? (
          <div className="lm-callout lm-callout-danger" role="alert">
            <p className="lm-callout-body">{error}</p>
          </div>
        ) : null}
        <button type="submit" className="lm-btn lm-btn-sm" disabled={busy || !label.trim() || !model.trim() || !apiKey.trim()}>
          {busy ? "保存中…" : "添加并设为默认"}
        </button>
      </form>
    </div>
  );
}
