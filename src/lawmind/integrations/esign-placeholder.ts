/**
 * E-sign deep-link seam (C3-3 / G9).
 * USER picks 法大大 / e签宝 / DocuSign and supplies API credentials.
 */

export type EsignProviderId = "fadada" | "esign" | "docusign" | "unset";

export const ESIGN_USER_ACTIONS = [
  "选定国内签署厂商（法大大或 e签宝）并签订嵌入合同",
  "配置 LAWMIND_ESIGN_PROVIDER 与 LAWMIND_ESIGN_API_KEY（或厂商规定的多密钥）",
  "提供签署完成回调 URL（桌面侧可轮询）供状态回写 matter/deliverable",
  "联调：导出交付物 → 打开签署页 → 状态变为 signed",
] as const;

export function resolveEsignProvider(): EsignProviderId {
  const raw = (process.env.LAWMIND_ESIGN_PROVIDER ?? "").trim().toLowerCase();
  if (raw === "fadada" || raw === "法大大") {
    return "fadada";
  }
  if (raw === "esign" || raw === "e签宝" || raw === "esignbao") {
    return "esign";
  }
  if (raw === "docusign") {
    return "docusign";
  }
  return "unset";
}

export function getEsignIntegrationStatus(): {
  implemented: false;
  provider: EsignProviderId;
  message: string;
  userActions: readonly string[];
} {
  const provider = resolveEsignProvider();
  return {
    implemented: false,
    provider,
    message:
      provider === "unset"
        ? "电子签未实现：交付物仍可通过外链签署；完整状态回写待 C3-3。"
        : `已选择 provider=${provider}，但深链/回调尚未实现（占位）。`,
    userActions: ESIGN_USER_ACTIONS,
  };
}
