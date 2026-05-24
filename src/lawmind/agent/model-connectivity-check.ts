/**
 * Live model API probe when the lawyer asks to verify the inference chain.
 */

import { readModelsStore } from "../models/custom-store.js";
import { probeAgentModel } from "../models/probe.js";
import { extractModelIdentityQueryText } from "./model-identity-reply.js";
import type { AgentModelConfig, AgentRuntimeModelIdentity } from "./types.js";

const CONNECTIVITY_PATTERNS: RegExp[] = [
  /(完整)?检查.{0,24}(调用)?链路/,
  /(检查|验证|测试|确认).{0,20}(模型)?(API|连接|连通|链路)/,
  /(能否|可以|能不能|确定).{0,30}(调用|使用|访问).{0,20}(API|模型|qwen|gpt|claude)/i,
  /(API|模型).{0,12}(能否|可以).{0,12}(调用|使用|连上)/,
  /test\s+(the\s+)?(model\s+)?(api\s+)?connection/i,
  /verify\s+(model|api)\s+(chain|connectivity)/i,
];

export function isModelConnectivityCheckQuestion(instruction: string): boolean {
  const core = extractModelIdentityQueryText(instruction).replace(/[？?！!。．\s]+$/g, "");
  if (!core || core.length > 220) {
    return false;
  }
  if (/^你是什么模型$/.test(core)) {
    return false;
  }
  return CONNECTIVITY_PATTERNS.some((re) => re.test(core));
}

function safeApiHost(baseUrl: string): string {
  try {
    const u = new URL(baseUrl);
    return u.host || baseUrl.replace(/\/$/, "");
  } catch {
    return baseUrl.replace(/\/$/, "").slice(0, 80);
  }
}

export async function buildModelConnectivityCheckReply(opts: {
  identity: AgentRuntimeModelIdentity;
  modelConfig: AgentModelConfig;
  lawMindRoot: string;
}): Promise<string> {
  const { identity, modelConfig, lawMindRoot } = opts;
  const host = safeApiHost(modelConfig.baseUrl);
  const timeoutMs = modelConfig.timeoutMs ?? 120_000;
  const keyOk = Boolean(modelConfig.apiKey?.trim());

  let verificationLine = "";
  const catalogId = identity.catalogId?.trim();
  if (catalogId) {
    const v = readModelsStore(lawMindRoot).verifications?.[catalogId];
    if (v?.verifiedAt) {
      verificationLine = `\n- **设置内上次验证成功**：${v.verifiedAt}（约 ${v.latencyMs}ms，模型 \`${v.model}\`）`;
    }
  }

  const header = `律师您好，已对**本对话当前模型**做一次实时 API 探测（向 \`${host}\` 发送最短 completion，非根据历史任务推测）：

- **显示名称**：${identity.catalogLabel}
- **上游模型 ID**：\`${identity.upstreamModel}\`
- **工作台模型 ID**：\`${catalogId ?? "—"}\`
- **API Key**：${keyOk ? "已配置（值不在对话中展示）" : "未配置"}
- **请求超时上限**：${timeoutMs}ms${verificationLine}
`;

  if (!keyOk) {
    return `${header}
### 结论：无法调用

未检测到有效 API Key。请在桌面端「设置 → 模型与 API」填写密钥后，点击「测试模型连接」或重新提问以再次探测。`;
  }

  const probe = await probeAgentModel(modelConfig);
  if (probe.ok) {
    return `${header}
### 结论：可以调用

刚刚实测成功（往返约 **${probe.latencyMs}ms**），上游接受模型名 \`${probe.model}\`。

若此前对话/工作流里出现 \`AbortError\` 或「操作已中止」，常见原因与 Key 无效不同：
1. **您发送了新消息**，上一轮流式请求被桌面端主动取消；
2. **工具链耗时过长**（检索 + 多轮工具 + 长文起草）超过 ${timeoutMs}ms 被服务端中止；
3. 个别步骤失败后的**历史摘要**，不代表当前 instant 探测失败。

建议：复杂任务可稍等上一轮完成；或在设置中适当增大 \`LAWMIND_AGENT_TIMEOUT_MS\` 后重启应用。`;
  }

  return `${header}
### 结论：当前无法稳定调用

探测失败（${probe.code}）：${probe.error}

请按提示检查 Base URL、模型名（须与服务商控制台一致，如 DashScope 上的 \`qwen3.6-plus\`）、API Key 权限与网络/代理；在「设置 → 模型与 API」中点击**测试模型连接**后重试。`;
}

export async function tryBuildModelConnectivityCheckReply(opts: {
  instruction: string;
  identity: AgentRuntimeModelIdentity | undefined;
  modelConfig: AgentModelConfig;
  lawMindRoot: string;
}): Promise<string | null> {
  if (!opts.identity?.upstreamModel?.trim()) {
    return null;
  }
  if (!isModelConnectivityCheckQuestion(opts.instruction)) {
    return null;
  }
  return buildModelConnectivityCheckReply({
    identity: opts.identity,
    modelConfig: opts.modelConfig,
    lawMindRoot: opts.lawMindRoot,
  });
}
