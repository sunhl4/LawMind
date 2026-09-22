import { lazy, Suspense, type ComponentProps } from "react";
import { LawmindErrorBoundary } from "../LawmindErrorBoundary";

const LawmindSettingsPage = lazy(async () => {
  const mod = await import("../lawmind-settings-shell");
  return { default: mod.LawmindSettingsPage };
});

export type LawmindAppSettingsPanelProps = ComponentProps<typeof LawmindSettingsPage>;

export function LawmindAppSettingsPanel(props: LawmindAppSettingsPanelProps) {
  return (
    <LawmindErrorBoundary label="设置">
      <Suspense
        fallback={
          <div className="lm-settings-page" role="status" aria-label="设置加载中">
            正在打开设置…
          </div>
        }
      >
        <LawmindSettingsPage {...props} />
      </Suspense>
    </LawmindErrorBoundary>
  );
}
