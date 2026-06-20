import type { ComponentProps } from "react";
import { LawmindSettingsPage } from "../lawmind-settings-shell";

export type LawmindAppSettingsPanelProps = ComponentProps<typeof LawmindSettingsPage>;

export function LawmindAppSettingsPanel(props: LawmindAppSettingsPanelProps) {
  return <LawmindSettingsPage {...props} />;
}
