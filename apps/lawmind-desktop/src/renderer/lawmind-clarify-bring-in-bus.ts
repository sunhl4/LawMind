/**
 * 在办「待补充」时，全局对话左栏的会话/文件点选写入补充草稿（不跳转对话主视图）。
 * Fleet 在 clarifying 时 register，离开时 unregister。
 */

import type {
  ClarificationFilePin,
  ClarificationSessionRef,
} from "../../../../src/lawmind/platform/clarification-fields.ts";

type Handlers = {
  onAttachFile: (pin: ClarificationFilePin) => void;
  onAttachSession: (ref: ClarificationSessionRef) => void;
};

let handlers: Handlers | null = null;

export function registerClarifyBringInHandlers(next: Handlers | null): void {
  handlers = next;
}

/** @returns true if a clarifying desk consumed the file pin */
export function tryClarifyAttachFile(pin: ClarificationFilePin): boolean {
  if (!handlers) {
    return false;
  }
  handlers.onAttachFile(pin);
  return true;
}

/** @returns true if a clarifying desk consumed the session ref */
export function tryClarifyAttachSession(ref: ClarificationSessionRef): boolean {
  if (!handlers) {
    return false;
  }
  handlers.onAttachSession(ref);
  return true;
}

export function clarifyBringInActive(): boolean {
  return handlers != null;
}
