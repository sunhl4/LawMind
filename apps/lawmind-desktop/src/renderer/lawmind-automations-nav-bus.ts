/**
 * Bus to open Settings → 自动办件 from deep UI (failure CTA, mail intent banner).
 */

type Listener = (section: "automations") => void;

const listeners = new Set<Listener>();

export function subscribeOpenAutomationsSettings(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function requestOpenAutomationsSettings(): void {
  for (const l of listeners) {
    l("automations");
  }
}
