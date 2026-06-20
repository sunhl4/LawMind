import type { ReactNode } from "react";
import { LawmindModelPicker } from "./LawmindModelPicker";
import { composeModelHintCalloutClass } from "./lawmind-compose-model-hint";
import type { ModelCatalogEntry } from "./lawmind-models-api";

export type LawmindCollabComposeModelProps = {
  modelCatalog: ModelCatalogEntry[];
  selectedModelId: string;
  onModelSelect: (id: string) => void | Promise<void>;
  onOpenComposeSettings?: () => void;
  onOpenApiWizard?: () => void;
  onComposeModelQuickTest?: () => void | Promise<void>;
  composeModelHint: string | null;
  composeModelQuickTestBusy: boolean;
  composeModelConfigured?: boolean;
  chatLoading?: boolean;
};

export function LawmindCollaborationComposeModelRail(props: LawmindCollabComposeModelProps): ReactNode {
  const {
    modelCatalog,
    selectedModelId,
    onModelSelect,
    onOpenComposeSettings,
    onOpenApiWizard,
    onComposeModelQuickTest,
    composeModelHint,
    composeModelQuickTestBusy,
    composeModelConfigured,
    chatLoading,
  } = props;

  return (
    <section className="lm-collab-model-rail" aria-label="协作区与后台任务共用模型">
      <div className="lm-collab-model-rail-top">
        <div className="lm-collab-model-rail-copy-block">
          <div className="lm-collab-model-rail-title">多任务共用模型</div>
          <p className="lm-collab-model-rail-lead lm-meta">
            主对话、委派打开的会话与团队工作流后台任务共用此处所选模型；切换助手会恢复该助手上次使用的模型。
          </p>
        </div>
        <label className="lm-compose-bar-field lm-collab-model-rail-picker">
          <span className="lm-compose-bar-label">模型</span>
          <LawmindModelPicker
            catalog={modelCatalog}
            selectedModelId={selectedModelId}
            onSelect={(id) => onModelSelect(id)}
            onOpenSettings={onOpenComposeSettings}
            onOpenApiWizard={onOpenApiWizard}
            onTestCurrent={onComposeModelQuickTest}
            quickTestBusy={composeModelQuickTestBusy}
            disabled={chatLoading ?? false}
            disabledTitle={chatLoading ? "对话进行中，请稍后再切换模型" : undefined}
          />
        </label>
      </div>
      {(composeModelHint?.trim() || composeModelQuickTestBusy) ? (
        <div
          className={composeModelHintCalloutClass(
            composeModelHint,
            composeModelQuickTestBusy,
            "lm-collab-model-rail-hint",
          )}
          role="status"
        >
          {composeModelQuickTestBusy && !(composeModelHint ?? "").trim()
            ? "正在测试模型连接…"
            : (composeModelHint ?? "").trim()}
        </div>
      ) : null}
      {composeModelConfigured === false && (onOpenApiWizard || onOpenComposeSettings) ? (
        <div className="lm-callout lm-callout-warn lm-collab-model-rail-warn" role="status">
          <p className="lm-callout-body lm-collab-model-rail-warn-text">
            尚未配置可用的主模型 API：委派与工作流无法在模型侧执行，请先完成向导或添加自定义模型。
          </p>
          <div className="lm-collab-model-rail-warn-actions">
            {onOpenApiWizard ? (
              <button type="button" className="lm-btn lm-btn-secondary lm-btn-small" onClick={() => onOpenApiWizard()}>
                API 配置向导…
              </button>
            ) : null}
            {onOpenComposeSettings ? (
              <button type="button" className="lm-btn lm-btn-small" onClick={() => onOpenComposeSettings()}>
                模型设置…
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
