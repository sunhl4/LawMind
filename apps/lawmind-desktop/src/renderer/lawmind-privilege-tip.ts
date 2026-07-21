/**
 * Compose-side privilege tip (Skills E10). Mirrors engine scanPrivilegeTip for renderer.
 */

export type PrivilegeTip = {
  level: "info" | "warn";
  code: string;
  message: string;
};

const PREF_KEY = "lm.privilegeSentinel";

export function isPrivilegeTipUiEnabled(): boolean {
  try {
    const v = localStorage.getItem(PREF_KEY);
    if (v === "0" || v === "false") {
      return false;
    }
  } catch {
    /* ignore */
  }
  return true;
}

export function setPrivilegeTipUiEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(PREF_KEY, enabled ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export function scanPrivilegeTip(text: string): PrivilegeTip | null {
  const t = text.trim();
  if (!t) {
    return null;
  }
  if (/attorney[- ]client|律师[- ]?客户|特权通信|privileged\s+and\s+confidential/i.test(t)) {
    return {
      level: "warn",
      code: "privilege_marker",
      message: "文本含特权/保密标记：发送前请确认收件人与渠道符合所内 privilege 政策。",
    };
  }
  if (/工作成果|work\s*product|诉讼策略|内部备忘/i.test(t)) {
    return {
      level: "info",
      code: "work_product",
      message: "可能含工作成果/诉讼策略表述：对外发送前建议脱敏或改走所内审批。",
    };
  }
  return null;
}
