/**
 * Deterministic reply when the lawyer asks which model powers this chat.
 * Uses non-secret `AgentRuntimeModelIdentity` from desktop config (no API keys).
 */

import type { AgentRuntimeModelIdentity } from "./types.js";

/** Pull the user's actual question out of meeting prefixes / long wrappers. */
export function extractModelIdentityQueryText(instruction: string): string {
  let text = instruction.trim();
  const theme = text.match(/【本会发言主题】\s*([\s\S]*)$/);
  if (theme?.[1]) {
    text = theme[1].trim();
  }
  const lines = text
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length > 0) {
    const last = lines[lines.length - 1] ?? text;
    if (last.length <= 120) {
      return last;
    }
  }
  return text.length > 200 ? text.slice(0, 200) : text;
}

const MODEL_IDENTITY_PATTERNS: RegExp[] = [
  /^(你|您)(现在|当前)?(用|使用|背后|底层|接入)?(的)?(是)?(什么|哪个|哪一种)(大)?(语言)?模型/,
  /^(你|您)(现在|当前)?是(什么|哪个)(大)?(语言)?模型/,
  /^(你|您)(现在|当前)?(用|使用).{0,12}(什么|哪个|哪一种).{0,8}(大)?模型/,
  /^(what|which)\s+(llm|language\s+)?model(\s+are\s+you|\s+do\s+you\s+use)?/i,
  /^what\s+(llm|model)\s+is\s+this/i,
  /(模型|大模型)(的)?(名字|名称|型号).*(是什么|哪个|哪一种)/,
  /(底层|背后|实际)(用|使用|接)?(的)?(是)?(什么|哪个|哪一种)(大)?(语言)?模型/,
  /^你是什么模型$/,
];

/** True when the message is a short meta question about the inference backend. */
export function isModelIdentityQuestion(instruction: string): boolean {
  const core = extractModelIdentityQueryText(instruction).replace(/[？?！!。．\s]+$/g, "");
  if (!core || core.length > 120) {
    return false;
  }
  if (core.length > 30 && /(合同|起诉|律师函|审查|起草|案件|法规|条款|违约|租赁)/.test(core)) {
    return false;
  }
  return MODEL_IDENTITY_PATTERNS.some((re) => re.test(core));
}

export function buildModelIdentityReply(identity: AgentRuntimeModelIdentity): string {
  const idLine = identity.catalogId ? `\n- **工作台模型 ID**：\`${identity.catalogId}\`` : "";
  return `律师您好，我是 **LawMind** 法律智能助理。

本对话当前配置的推理模型为（与桌面端「设置 → 模型与 API」及对话栏所选一致）：
- **显示名称**：${identity.catalogLabel}
- **服务商**：${identity.providerLabel}
- **上游模型 ID**：\`${identity.upstreamModel}\`${idLine}

我在此模型之上运行法律岗位工具与案件工作流。API Key、完整 API 地址等部署机密不在对话中展示；如需调整模型，请在桌面端设置中切换。

若要**实测**能否连通（非凭记忆），可再问：「请测试当前模型 API 连接」。`;
}

export function tryBuildModelIdentityReply(
  instruction: string,
  identity: AgentRuntimeModelIdentity | undefined,
): string | null {
  if (!identity?.catalogLabel?.trim() || !identity.upstreamModel?.trim()) {
    return null;
  }
  if (!isModelIdentityQuestion(instruction)) {
    return null;
  }
  return buildModelIdentityReply(identity);
}
