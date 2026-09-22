/**
 * Bus to open Settings sections from deep UI (failure CTA, mail intent, desk standards).
 */

export type SettingsDeepLinkSection = "automations" | "workspace";

type Listener = (section: SettingsDeepLinkSection) => void;

const listeners = new Set<Listener>();

export function subscribeOpenAutomationsSettings(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function requestOpenSettingsSection(section: SettingsDeepLinkSection): void {
  for (const l of listeners) {
    l(section);
  }
}

export function requestOpenAutomationsSettings(): void {
  requestOpenSettingsSection("automations");
}

/** Settings → 工作区（审查标准 / playbook 口径）. */
export function requestOpenWorkspaceSettings(): void {
  requestOpenSettingsSection("workspace");
}
