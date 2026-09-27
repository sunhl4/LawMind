/**
 * 对话窗口三档，展示和选项与常见桌面助手一致：200K / 500K / 1M。
 *
 * 实际窗口 = min(模型自己的窗口, 所选档)。模型更短时不会假装能记住整档。
 * 旧策略 `daily` 视为 200K，`dossier` 视为 1M。
 */

export const CONVERSATION_LENGTH_IDS = ["200k", "500k", "1m"] as const;

export type ConversationLengthId = (typeof CONVERSATION_LENGTH_IDS)[number];

export type ConversationLengthPreset = {
  id: ConversationLengthId;
  label: string;
  detail: string;
  /** 这一档的上限（tokens）。模型窗口更短时以模型为准。 */
  contextTokens: number;
};

export const CONVERSATION_LENGTH_PRESETS: readonly ConversationLengthPreset[] = [
  {
    id: "200k",
    label: "200K",
    detail: "本轮读一份合同、来回改稿。较早的来回会整理。",
    contextTokens: 200_000,
  },
  {
    id: "500k",
    label: "500K",
    detail: "本轮可以一次读入更长的材料。较早的来回仍会整理。",
    contextTokens: 500_000,
  },
  {
    id: "1m",
    label: "1M",
    detail: "本轮可以一次读入很长的材料。较早的来回仍会整理。",
    contextTokens: 1_000_000,
  },
];

export const DEFAULT_CONVERSATION_LENGTH: ConversationLengthId = "200k";

/** 合法的新档，或可迁移的旧档。未知值返回 undefined，不偷偷当成默认。 */
export function normalizeConversationLength(raw: unknown): ConversationLengthId | undefined {
  if (raw === "200k" || raw === "daily") {
    return "200k";
  }
  if (raw === "500k") {
    return "500k";
  }
  if (raw === "1m" || raw === "dossier") {
    return "1m";
  }
  return undefined;
}

export function resolveConversationLength(raw: unknown): ConversationLengthId {
  return normalizeConversationLength(raw) ?? DEFAULT_CONVERSATION_LENGTH;
}

export function conversationLengthPreset(id: ConversationLengthId): ConversationLengthPreset {
  const found = CONVERSATION_LENGTH_PRESETS.find((preset) => preset.id === id);
  return found ?? CONVERSATION_LENGTH_PRESETS[0];
}

export function conversationLengthLabel(raw: unknown): string {
  return conversationLengthPreset(resolveConversationLength(raw)).label;
}

/**
 * 把模型目录里的窗口收进所选档。
 * 目录没写窗口时，用这一档的上限，而不是再退回一个更小的写死数字。
 */
export function contextTokensForConversation(
  modelContextTokens: number | undefined,
  length: ConversationLengthId,
): number {
  const cap = conversationLengthPreset(length).contextTokens;
  if (
    typeof modelContextTokens === "number" &&
    Number.isFinite(modelContextTokens) &&
    modelContextTokens > 0
  ) {
    return Math.min(Math.floor(modelContextTokens), cap);
  }
  return cap;
}
