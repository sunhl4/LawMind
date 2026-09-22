# LawMind 数据处理说明

本文档说明 LawMind 桌面端在典型部署下的**数据流与子处理方**，供法务与 IT 评估。与 [私有化部署](/LAWMIND-PRIVATE-DEPLOY) 配合阅读。

## 1. 默认部署：数据在本地

- **工作区**（任务、草稿、审计 JSONL、案件 `CASE.md` 等）默认位于用户设备上的 LawMind 用户数据目录。
- **本地 HTTP API** 仅监听回环地址，不对外暴露服务端口（见使用手册）。

## 2. 客户配置的「出站」子处理方

以下能力仅在用户或运维配置相应 API Key / 端点后生效；未配置则不调用。

| 能力                  | 典型环境变量 / 配置                                                | 说明                                                     |
| --------------------- | ------------------------------------------------------------------ | -------------------------------------------------------- |
| 通用与 Agent 对话模型 | `LAWMIND_QWEN_API_KEY`、`LAWMIND_AGENT_*`、`QWEN_*` 等             | OpenAI-compatible HTTPS 调用，具体服务商由 Base URL 决定 |
| 法律检索（可选）      | `LAWMIND_CHATLAW_*`、`LAWMIND_LAWGPT_*`、`LAWMIND_PARTNER_LEGAL_*` | 由 `.env.lawmind` 指向客户选定的法律检索服务             |
| 联网检索（可选）      | `LAWMIND_WEB_SEARCH_API_KEY` / `BRAVE_API_KEY`                     | Brave Search 等，仅在用户勾选「允许联网检索」等路径启用  |

**清单维护责任**：实际合同主体与数据跨境条款以客户与**各模型/检索服务商**的协议为准；请在正式 DPA 中列出最终子处理方名称与处理地。

## 3. 日志与健康检查

- `GET /api/health` 返回环境文件**是否存在**等提示，**不包含**密钥明文。
- 支持人员不应要求用户粘贴完整 API Key；排障以状态码、`code` 与脱敏日志为主。

## 4. 与条款模板的关系

英文草案见 [Terms of Service](/legal/terms-of-service)、[Privacy Policy](/legal/privacy-policy)；正式对外前须经 **执业律师** 定稿。

---

- https://docs.lawmind.ai/LAWMIND-DATA-PROCESSING
- https://docs.lawmind.ai/LAWMIND-PRIVATE-DEPLOY
- https://docs.lawmind.ai/legal/terms-of-service
- https://docs.lawmind.ai/legal/privacy-policy
