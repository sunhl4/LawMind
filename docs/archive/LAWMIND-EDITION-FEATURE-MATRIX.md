# Edition 功能矩阵（Skills G6）

真相源：`src/lawmind/policy/edition.ts` → `EDITION_FEATURES`。下表与代码同步（2026-07-24）。

| Feature                        | Solo | Firm | Private Deploy | 说明                          |
| ------------------------------ | ---- | ---- | -------------- | ----------------------------- |
| acceptanceGateStrict           | ✅   | ✅   | ✅             | 出稿前验收更严                |
| citationGateStrict             | ✅   | ✅   | ✅             | 引用完整性硬门禁              |
| crossMatterRoadmap             | —    | ✅   | ✅             | 跨案件路线图                  |
| crossMatterAcceptanceDashboard | —    | ✅   | ✅             | 跨案件验收概览                |
| collaborationSummary           | —    | ✅   | ✅             | 协作摘要                      |
| complianceAuditExport          | —    | —    | ✅             | 合规审计导出                  |
| auditIntegrityExport           | ✅   | ✅   | ✅             | 审计 hash-chain               |
| securitySbomPanel              | —    | —    | ✅             | SBOM 面板                     |
| qualityDashboardJsonExport     | —    | ✅   | ✅             | 质量 JSON 导出                |
| customDeliverableSpec          | —    | ✅   | ✅             | 本所文书类型                  |
| acceptancePackExport           | ✅   | ✅   | ✅             | 验收包导出                    |
| strictDangerousToolApproval    | —    | ✅   | ✅             | 危险工具须显式批准            |
| reviewCampaignParallel         | ✅   | ✅   | ✅             | 专案组 parallel（本机启发式） |
| forcePeerReview                | —    | ✅   | ✅             | 签批前强制互审委派            |

## Solo-first

- 默认 edition = `solo`：打开即对话；文书台与在办不被 Firm 密度淹没。
- Solo 亦可导出审计完整性摘要与验收包（轻量信任包装）；合规批量审计仍仅 Private。
- 专案组 Solo 默认亦可 parallel（与 Firm 对齐本机启发式吞吐；见 `edition.ts`）。

## 私有化

见 [LAWMIND-PRIVATE-DEPLOY.md](LAWMIND-PRIVATE-DEPLOY.md)；Doctor `privateDeployChecklist` 自动核对若干项。
