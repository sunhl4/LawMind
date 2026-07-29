/**
 * LexisNexis adapter placeholder (C4-3 / Firm SKU).
 *
 * USER: obtain Lexis API credentials via Lexis Developer Portal, then
 * set LAWMIND_AUTHORITY_PROVIDER=lexis and endpoint/key.
 * Until then this module only documents the seam — retrieve returns unset/fail-closed
 * via the shared authority router (no fabricated corpus).
 */

export const LEXIS_PROVIDER_STATUS = {
  implemented: false as const,
  /** Manual steps for operator */
  userActions: [
    "向 LexisNexis 申请 API / 沙箱（Developer Portal）",
    "签署嵌入/转授权合同",
    "配置 LAWMIND_AUTHORITY_PROVIDER=lexis",
    "配置 LAWMIND_AUTHORITY_ENDPOINT 与 LAWMIND_AUTHORITY_API_KEY",
    "联调后补 `providers/lexis/client.ts` 真实协议（当前未实现）",
  ],
};

export function lexisAdapterMessage(): string {
  return "Lexis 适配器尚未实现：请使用 generic/pkulaw，或完成商务凭证后按 EXTERNAL-INTEGRATIONS C4-3 接线。";
}
