# LawMind 交办任务（Lawyer Automations）

> 对标 Cursor Automations：独立入口、到点执行、预埋模板 + 自然语言自定义。面向律师，配置像「交代助理」。

## 入口

**设置 → 自动办件** → `LawmindAutomationsPanel`（顶栏不再有独立「交办 / Automations」一级页）。

页内分区顺序：**待拍板结果** → **我的交办任务** → **创建** → **邮箱配置**。侧栏 **待我拍板** 跳转「在办」处理澄清/批准；交办结果也可在本页「待拍板」直接「已知悉 / 忽略 / 批准发送」。

## 能力对照

| 阶段 | 能力                                        | 状态                                                                |
| ---- | ------------------------------------------- | ------------------------------------------------------------------- |
| P0   | 独立页、列表/开关、每天/每周、立即跑一次    | 已实现                                                              |
| P1   | 合同续签盯梢、客户进展周报 → 运行结果进拍板 | 已实现（走工作流 Job + automation-inbox；周报需真实 `notifyEmail`） |
| P2   | 真实邮箱同步 + 收件整理 / 邮件合同初审      | 已实现（IMAP/SMTP；合同初审入队 `contract-review` 工作流）          |
| P3   | 一句话创建；批准后真实发信                  | 已实现（`approve_send` → SMTP/Graph + 本地 sent 归档）              |

## 邮箱配置（交办页）

支持类型：

| 类型             | 连接方式               | 凭证                        |
| ---------------- | ---------------------- | --------------------------- |
| Gmail            | IMAP/SMTP              | 应用专用密码                |
| Outlook.com      | IMAP/SMTP              | 应用密码（推荐）            |
| Microsoft 365    | IMAP 或 Graph 应用权限 | 应用密码，或租户/客户端密钥 |
| QQ / 163         | IMAP/SMTP              | 邮箱授权码                  |
| 自定义 IMAP/SMTP | 手动主机               | 密码或授权码                |

- 账号元数据：`lawmind/mail-accounts.json`（无密码）
- 授权码/密钥：LawMind 根目录 `mail-secrets.json`（与 `.env.lawmind` 同级，不进案件仓库）
- **对方往来名单**（`watchContacts`）：0 个 = 同步全部来信；1+ 个 = 只同步与这些人相关的邮件（每人可填简称与备注）
- **测试连接** / **立即同步** 写入 `cases/<matterId>/mail/inbox/` 与附件目录
- 邮件类交办任务到期时会先尝试远程同步，再生成拍板摘要

### Mail API

| 方法     | 路径                          | 说明                        |
| -------- | ----------------------------- | --------------------------- |
| GET      | `/api/mail/providers`         | 邮箱类型预设                |
| GET/POST | `/api/mail/accounts`          | 列表 / 创建或更新           |
| DELETE   | `/api/mail/accounts/:id`      | 删除（含密钥）              |
| POST     | `/api/mail/accounts/:id/test` | 测试 IMAP 或 Graph          |
| POST     | `/api/mail/accounts/:id/sync` | `{ matterId }` 拉取到本案匣 |

## Automations API

| 方法         | 路径                                | 说明                                       |
| ------------ | ----------------------------------- | ------------------------------------------ |
| GET          | `/api/automations/presets`          | 预埋模板                                   |
| GET          | `/api/automations`                  | 列表 + 开放 inbox                          |
| POST         | `/api/automations`                  | 按模板创建                                 |
| POST         | `/api/automations/from-instruction` | 自然语言创建                               |
| PATCH/DELETE | `/api/automations/:id`              | 更新/删除；`runNow: true` 立即到期         |
| POST         | `/api/automations/inbox/:id/action` | `acknowledge` / `dismiss` / `approve_send` |
| POST         | `/api/automations/mail/seed`        | 写入演示邮件（无真实邮箱时试跑）           |

持久化：`lawmind/automations/`、`lawmind/automation-inbox/`。本地服务 30s tick 与 Job 调度同环。

## 律师用法（最短路径）

1. 打开 **设置 → 自动办件**。
2. 在 **邮箱配置** 选类型（如 QQ / Gmail）→ 填地址与授权码 → **保存并连接** → **测试连接**。
3. 选案件后 **立即同步**，或创建「邮箱收件整理」等交办任务后点 **立即跑一次**。
4. 结果出现在本页「待拍板」；侧栏 **待我拍板** 进入「在办」处理其它待确认项。
5. 客户周报：创建时填写真实收件邮箱（禁止 `example.com`）；批准发送走已配置账号的 SMTP/Graph，并归档 `mail/sent/`。
6. 邮件合同初审：同步后启动 `contract-review` 工作流；结果行可「查看在办」/有草稿时「打开文书台」。

## 本地匣兜底

未配置远程邮箱时，仍可读 `cases/<matterId>/mail/inbox/<id>.json`（或「写入演示邮件」）。

## 外发门禁

- 交办任务结果：`approve_send` → 本地 sent + 尝试真实发信
- Agent 工具：`send_email`（`requiresApproval: true`），批准后同样走账号 SMTP/Graph
