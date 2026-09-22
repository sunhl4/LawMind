/**
 * Promise bus: chat send intercepts mail/meta intent and waits for lawyer choice.
 */

import type { MailChatIntent } from "../../../../src/lawmind/platform/mail-chat-intent.ts";

export type MailIntentDecision = "run" | "continue" | "dismiss" | "open-settings";

type Listener = () => void;

let pending: MailChatIntent | null = null;
let resolver: ((d: MailIntentDecision) => void) | null = null;
const listeners = new Set<Listener>();

function notify(): void {
  for (const l of listeners) {
    l();
  }
}

export function getMailIntentPending(): MailChatIntent | null {
  return pending;
}

export function subscribeMailIntentPending(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Show confirm banner; resolves when lawyer picks an action. */
export function promptMailIntentConfirm(intent: MailChatIntent): Promise<MailIntentDecision> {
  if (resolver) {
    resolver("dismiss");
    resolver = null;
  }
  pending = intent;
  notify();
  return new Promise((resolve) => {
    resolver = resolve;
  });
}

export function resolveMailIntent(decision: MailIntentDecision): void {
  const r = resolver;
  pending = null;
  resolver = null;
  notify();
  r?.(decision);
}
