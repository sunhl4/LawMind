# LawMind 私有化与内网部署指引

面向律所 IT 与运维：在**不依赖公有 SaaS**的前提下部署 LawMind 桌面与本地工作区。本文档为**检查清单**，与 [LawMind 交付](/LAWMIND-DELIVERY)、[使用手册](/LAWMIND-USER-MANUAL) 配合使用。

## 1. 架构边界

- **数据默认落盘**：Electron 用户数据目录下的 `LawMind/workspace`（开发态可为仓库 `workspace/`）。
- **本地 API**：`127.0.0.1` 回环绑定，不对外监听；模型调用走配置的 HTTPS 出站。
- **密钥**：`.env.lawmind` 与助手配置与 workspace 并列在用户数据目录；勿将真实密钥提交版本库。

## 2. 部署前检查

1. **Node**：打包后的桌面应用已内置 Node；源码开发需 Node 22+。
2. **模型与检索**：在目标环境预填 `LAWMIND_*` / `LAWMIND_CHATLAW_*` 等变量；运行 `GET /api/health` 确认 `modelConfigured`、`retrievalMode`、`doctor` 统计合理。
3. **备份**：定期备份整个 `LawMind` 用户数据目录（含 `workspace/`、`assistants.json`、`.env.lawmind`）。可用仓库脚本 `scripts/lawmind/lawmind-backup.sh`（设置 `LAWMIND_WORKSPACE_DIR`）打包 workspace；密钥排除策略见脚本注释。
4. **更新**：通过官方安装包或受控渠道升级；升级后复核 `pnpm lawmind:bundle:desktop-server` 对应产物或安装器说明。

## 3. 网络与合规

- **出站白名单**：按需放行模型 API、法律检索端点、可选 Brave Search（联网检索）。
- **日志**：统一日志与审计见 `workspace/audit/*.jsonl`；合规向汇总可导出 `GET /api/audit/export?compliance=true`（见使用手册）。
- **多助手协作**：启用协作后，委派状态由内存 + `workspace/delegations/` 持久化；`GET /api/collaboration/summary` 可查看近期委派与 `collaboration-audit.jsonl` 片段。

## 4. 模板与包签名校验

- 内置模板带 **category**（contracts / litigation / client / internal），`GET /api/templates/built-in` 可拉清单。
- 所内下发的模板/文档包可使用 **bundle manifest**（`schemaVersion: 1` + 每条 `path` + `sha256`），在集成层调用 `verifyLawMindBundleManifest`（见 [LawMind 包清单与校验](/LAWMIND-BUNDLES)）。

## 5. 不支持项（需单独方案）

- 多租户集中数据库、跨所共享 workspace、无加密的远程桌面直连生产密钥等，不在本文档范围内；需单独架构评审。

---

与本文档相关的公开文档入口：

- https://docs.lawmind.ai/LAWMIND-PRIVATE-DEPLOY
- https://docs.lawmind.ai/LAWMIND-DELIVERY
- https://docs.lawmind.ai/LAWMIND-USER-MANUAL
- https://docs.lawmind.ai/LAWMIND-BUNDLES
