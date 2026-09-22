/**
 * Bus to open「会议室」from compose「+」or 案件深链
 * (not a peer header tab; not on the 在办 chrome).
 */

type Listener = () => void;

const listeners = new Set<Listener>();

export function subscribeOpenMeetingView(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function requestOpenMeetingView(): void {
  for (const l of listeners) {
    l();
  }
}
