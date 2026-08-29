import type { ReactNode } from "react";
import type { HealthPayload } from "./lawmind-app-data";
import type { ModelCatalogEntry } from "./lawmind-models-api";
import { buildReadinessSnapshot, type ReadinessPill } from "./lawmind-readiness";

type Props = {
  health: HealthPayload | null | undefined;
  workspaceDir: string | undefined;
  apiReachable: boolean;
  modelCatalog?: ModelCatalogEntry[];
  selectedModelId?: string;
  onOpenApiWizard: () => void;
  onOpenSettings?: () => void;
  /** 打开设置并滚动到系统体检区块 */
  onOpenDoctor?: () => void;
  onVerifyModel?: () => void | Promise<void>;
};

function pillClass(state: ReadinessPill["state"]): string {
  switch (state) {
    case "ok":
      return "lm-readiness-pill lm-readiness-pill-ok";
    case "warn":
      return "lm-readiness-pill lm-readiness-pill-warn";
    case "off":
      return "lm-readiness-pill lm-readiness-pill-off";
    default:
      return "lm-readiness-pill lm-readiness-pill-unknown";
  }
}

export function LawmindReadinessStrip(props: Props): ReactNode {
  const {
    health,
    workspaceDir,
    apiReachable,
    modelCatalog,
    selectedModelId,
    onOpenApiWizard,
    onOpenSettings,
    onOpenDoctor,
    onVerifyModel,
  } = props;
  const wsOk = health?.doctor?.workspaceStandard?.ok !== false;
  const snapshot = buildReadinessSnapshot({
    health,
    workspaceDir,
    apiReachable,
    modelCatalog,
    selectedModelId,
  });

  /** 全部就绪时不占顶栏：避免重复展示「本地服务已连接 / 模型可用 / 工作区」等状态。 */
  if (snapshot.allReady) {
    return null;
  }

  const pills = (
    <div className="lm-readiness-pills">
      {snapshot.pills.map((pill) => (
        <span key={pill.id} className={pillClass(pill.state)} title={pill.title}>
          {pill.label}
        </span>
      ))}
    </div>
  );

  return (
    <div className="lm-readiness-strip lm-readiness-strip-attention" role="status" aria-live="polite">
      {pills}
      <div className="lm-readiness-actions">
        {snapshot.needsApiWizard ? (
          <button type="button" className="lm-btn lm-btn-sm" onClick={() => onOpenApiWizard()}>
            配置 API
          </button>
        ) : !snapshot.modelVerified && onVerifyModel ? (
          <button type="button" className="lm-btn lm-btn-sm" onClick={() => void onVerifyModel()}>
            验证模型
          </button>
        ) : null}
        {!apiReachable && onOpenSettings ? (
          <button type="button" className="lm-btn lm-btn-secondary lm-btn-sm" onClick={() => onOpenSettings()}>
            打开设置
          </button>
        ) : null}
        {onOpenDoctor && !wsOk ? (
          <button type="button" className="lm-btn lm-btn-secondary lm-btn-sm" onClick={() => onOpenDoctor()}>
            系统体检
          </button>
        ) : null}
      </div>
    </div>
  );
}
