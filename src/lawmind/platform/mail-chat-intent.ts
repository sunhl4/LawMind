/**
 * Chat-side detection: free-form asks about mail/contract should not thrash
 * discovery tools — route to automations short path instead.
 *
 * Leaf imports only (no Node fs) — safe for desktop renderer.
 */

import {
  inferAutomationFromInstruction,
  type AutomationPresetId,
} from "./infer-automation-from-instruction.js";

export type MailChatIntentKind = "mail-contract-review" | "mail-inbox-digest" | "meta";

export type MailChatIntent = {
  kind: MailChatIntentKind;
  title: string;
  summary: string;
  /** When kind is mail-* — preset to enqueue / runNow */
  presetId?: Extract<AutomationPresetId, "mail-contract-review" | "mail-inbox-digest">;
  /** Original user text (for continue-as-chat) */
  text: string;
};

/** Product/debug meta asks — not a legal workbench tool job. */
export function isProductMetaAsk(text: string): boolean {
  const t = text.trim();
  if (!t) {
    return false;
  }
  return (
    /修(改)?(我们的)?软件|修产品|改代码|debug\s*(ui|软件)?/i.test(t) ||
    /卡在(了)?哪里|过程卡(住|了)|为什么卡|查找卡点/.test(t) ||
    /界面(有问题|卡住|报错)|产品.*(问题|缺陷)/.test(t)
  );
}

/**
 * Detect chat text that should offer automations short path (or meta intercept)
 * instead of a free-form agent turn.
 */
export function detectMailChatIntent(text: string): MailChatIntent | null {
  const raw = text.trim();
  if (!raw) {
    return null;
  }
  if (isProductMetaAsk(raw)) {
    return {
      kind: "meta",
      title: "这不是办案对话能直接改的",
      summary:
        "「查卡点 / 修软件」属于产品诊断。邮件合同请走「自动办件 → 邮件合同审阅改稿」短路径（取信→改稿→待拍板），不要在对话里反复检索案卷。",
      text: raw,
    };
  }
  const inferred = inferAutomationFromInstruction(raw);
  if (inferred.presetId === "mail-contract-review") {
    return {
      kind: "mail-contract-review",
      title: "建议改走「邮件合同审阅改稿」短路径",
      summary:
        "将同步本案邮件附件并按短路径改稿（约 4–8 步），结果进「待我拍板」。自由对话没有取信工具，容易变成反复检索案卷。",
      presetId: "mail-contract-review",
      text: raw,
    };
  }
  if (inferred.presetId === "mail-inbox-digest") {
    return {
      kind: "mail-inbox-digest",
      title: "建议改走「邮箱收件整理」",
      summary: "将整理本案邮件匣要点与附件清单，推送到待拍板。比在对话里翻文件更稳。",
      presetId: "mail-inbox-digest",
      text: raw,
    };
  }
  return null;
}
