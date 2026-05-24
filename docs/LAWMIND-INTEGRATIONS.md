# LawMind integrations

LawMind today focuses on **local workspace workflows** (tasks, drafts, Word/PPT export, audit). It does **not** ship embedded connectors to commercial DMS, billing, or practice-management systems in the default Solo build.

## Supported integration pattern (today)

- **Filesystem**: work lives under the configured **workspace**; artifacts land under `artifacts/` as documented in the [user manual](LAWMIND-USER-MANUAL.md).
- **Export**: download rendered **`.docx` / `.pptx`** and upload or file into your DMS manually, or sync the workspace folder with firm-approved tooling.
- **API**: the desktop **local HTTP API** (loopback) can be used by scripts on the same machine for automation; keep binding to `127.0.0.1` unless your security team approves otherwise.
- **Read-only MCP**: `pnpm lawmind:mcp:readonly` exposes matters, drafts, sources, annotations, review matrix, and per-draft acceptance packs to Cursor/Claude Desktop (no write tools).

## What is not built-in (default)

- Live DMS sync (iManage, NetDocuments, OpenText, Worldox, …)
- Time tracking / billing system write-back
- E-discovery platform connectors
- Unattended MCP write to workspace

Treat those as **phased** integrations below or **custom** IT projects via export + approved sync.

---

## Connector catalog（Claude for Legal 对齐）

| 类别              | 示例系统                                      | LawMind 阶段     | 默认能力                       |
| ----------------- | --------------------------------------------- | ---------------- | ------------------------------ |
| **工作区只读**    | LawMind workspace                             | **M1（已提供）** | MCP + loopback API             |
| **研究**          | CourtListener、官方法规库、Brave 检索         | **M1**           | Agent 工具 + 来源锚点          |
| **邮件/日历**     | Microsoft 365, Gmail                          | **M2**           | 按 `matterId` 只读索引（规划） |
| **DMS**           | iManage, NetDocuments, OpenText, Worldox      | **M2–M3**        | 导出包人工回写 → 可选 API      |
| **电子签**        | DocuSign, Adobe Sign                          | **M3**           | 验收包外链 + 状态回写（规划）  |
| **计费/案件管理** | Clio, PracticePanther, Time Matters, Elite 3E | **M3**           | 任务/工时 CSV 导出（规划）     |
| **E-discovery**   | Relativity, Everlaw, Nuix                     | **M3+**          | 证据索引导出，非实时 ingest    |

---

## 三阶段集成路线图

### 阶段 1 — 只读上下文（M1，当前主力）

**目标**：外部 AI 助手（Cursor、Claude Desktop、所内脚本）能**读** LawMind 交付上下文，不能改工作区。

| 能力            | 状态     | 入口                                                |
| --------------- | -------- | --------------------------------------------------- |
| 列出案件 / 草稿 | 已实现   | MCP `list_matters`, `list_drafts`                   |
| 来源预览与标注  | 已实现   | MCP `get_source_preview`, `list_source_annotations` |
| 审查矩阵        | 已实现   | MCP `get_review_matrix`                             |
| 草稿验收包      | 已实现   | MCP `get_draft_acceptance_pack`                     |
| 法规/网页检索   | 已实现   | Agent `search_statute_web` 等（policy 控制）        |
| MCP 写入        | **禁止** | 无 `write_*` 工具                                   |

**安全前置**：`LAWMIND_WORKSPACE_DIR` 仅本机；API 绑定 `127.0.0.1`；Firm/Private 可启用审计 hash-chain 导出。

### 阶段 2 — 案件绑定只读（M2，POC 已实现）

**目标**：连接器按 **`matterId`** 拉取 DMS/邮件索引，与 `matterScopeMiddleware` 一致——无案件上下文不调用。

| 连接器类型 | 典型 API 模式           | LawMind 映射                            |
| ---------- | ----------------------- | --------------------------------------- |
| DMS 索引   | REST/Graph 列文档元数据 | `cases/<matterId>/` 镜像 + 来源 id      |
| 邮件       | M365 Graph read-only    | 时间线条目 → `team-meeting` / CASE 进展 |
| 日历       | iCal/Graph 只读         | 任务看板提醒（非自动立案）              |

**已实现（只读 POC）**：

| 端点                                                   | 说明                                                              |
| ------------------------------------------------------ | ----------------------------------------------------------------- |
| `GET /api/integrations`                                | 连接器目录与各 connector 状态（active / disabled / unconfigured） |
| `GET /api/integrations/filesystem/documents?matterId=` | 列出 `cases/<matterId>/` 下文件元数据（只读）                     |
| `GET /api/health` → `doctor.integrations`              | 系统体检展示连接器状态                                            |

**配置**：`<workspace>/lawmind/integrations.json`（仓库样例见 `workspace/lawmind/integrations.json`）。`filesystem` 默认启用。

**M2.5 DMS OAuth 桩（Phase 5b）**：

| 连接器     | 工作区配置             | Host 密钥（不进 workspace）        | 行为                                                                         |
| ---------- | ---------------------- | ---------------------------------- | ---------------------------------------------------------------------------- |
| iManage    | `baseUrl`, `clientId`  | `LAWMIND_IMANAGE_CLIENT_SECRET`    | 有密钥 → 只读列表（当前为结构化 fixture）；`LAWMIND_IMANAGE_FIXTURE=1` 供 CI |
| SharePoint | `tenantId`, `clientId` | `LAWMIND_SHAREPOINT_CLIENT_SECRET` | 同上；`LAWMIND_SHAREPOINT_FIXTURE=1`                                         |

案件外部 ID 映射：`cases/<matterId>/.lawmind-dms.json`（`imanage.matterKey` / `sharepoint.siteId`）。真实 Graph/iManage REST 调用可在 Firm 环境替换 fixture 分支。

**律师可读说明**：个人版（Solo）默认不连接律所 DMS，案件材料以本机 `cases/` 目录为准；律所版由 IT 在部署主机配置 OAuth 密钥与工作区 `integrations.json` 后，体检页「外部集成」才会显示为已连接（此前为演示桩数据）。

**桌面 UI**：案件工作台「概览」→ **本地文档索引**；设置 → **系统体检** → 外部集成（M2）。

**不做**：双向同步、自动覆盖律师在 CASE.md 的手写记录。

### 阶段 3 — 人工门控写入（M3，规划）

**目标**：对外系统回写须经 **`requiresAction` / 审批队列 / 审核台签批**。

| 场景              | 门控                             | 审计                       |
| ----------------- | -------------------------------- | -------------------------- |
| 导出包上传 DMS    | 律师确认后一键导出               | `artifact.rendered`        |
| 任务状态回写 Clio | `POST /api/approvals/resolve` 后 | `matter.approval_resolved` |
| MCP 写盘          | **默认关闭**；Firm 可白名单      | hash-chain + 工具治理页    |

**不做**：无人值守 MCP 创建/修改草稿；绕过 review gate 的批量写。

---

## DMS 连接器详细路线（按产品）

| 产品               | M2 只读索引           | M3 门控回写                 | 备注                          |
| ------------------ | --------------------- | --------------------------- | ----------------------------- |
| **iManage**        | 文档列表 + 版本元数据 | 导出 .docx 至 matter 文件夹 | 需 Firm API 密钥在 host vault |
| **NetDocuments**   | 同左                  | 验收包 PDF/Word 外链        | 常见 AmLaw 200                |
| **OpenText eDOCS** | 同左                  | 任务完成标记                | 企业合规评审                  |
| **Worldox**        | 文件夹映射            | 手动 sync                   | 中小所                        |
| **SharePoint**     | Graph read-only       | 上传至 matter 库            | 可与 M365 邮件共用 tenant     |

**实施原则**：LawMind 仍是**生产系统**；DMS 是归档与协作边界，不替代审核台与 acceptance gate。

---

## Practice-management 连接器路线

| 产品                | 只读              | 写回               | LawMind 字段映射         |
| ------------------- | ----------------- | ------------------ | ------------------------ |
| **Clio**            | Matters, contacts | 时间条目（审批后） | `matterId` ↔ Clio matter |
| **PracticePanther** | 同左              | 任务状态           | `WorkQueueItem`          |
| **Time Matters**    | 文档索引          | 导出包             | CASE.md 镜像             |
| **Elite 3E**        | 客户/案件码       | 计费码（CSV）      | 报表导出                 |

---

## E-discovery 与电子签（M3+）

- **Everlaw / Relativity**：导出 `evidence-index` 工作流产物与来源表；不做 native ingest。
- **DocuSign**：审核通过后发送 envelope；状态 webhook → `jobs` 完成（需 Firm 部署）。

---

## MCP 工具清单（M1 已实现）

仓库脚本 **`pnpm lawmind:mcp:readonly`**（stdio JSON-RPC）：

| 工具                        | 说明                           |
| --------------------------- | ------------------------------ |
| `list_matters`              | 案件 ID 列表                   |
| `list_drafts`               | 草稿 taskId + 标题             |
| `get_source_preview`        | `sourceId` + `taskId` 研究摘录 |
| `list_source_annotations`   | 来源标注（OpenContracts 式）   |
| `get_review_matrix`         | 尽调审查矩阵                   |
| `get_draft_acceptance_pack` | 单份草稿验收包 Markdown        |

**环境变量**：`LAWMIND_WORKSPACE_DIR` = 工作区根目录。

**Cursor 配置**（`.cursor/mcp.json`）：

```json
{
  "mcpServers": {
    "lawmind-readonly": {
      "command": "pnpm",
      "args": ["lawmind:mcp:readonly"],
      "env": {
        "LAWMIND_WORKSPACE_DIR": "/path/to/your/workspace"
      }
    }
  }
}
```

---

## Collaboration

多助手协作见用户手册 **`GET /api/collaboration/summary`**。委派与审计在应用内完成，不依赖外部工单系统。

**命名工作流**（内置种子，首次启动桌面服务时写入 `<workspace>/lawmind/workflows/`）：

| 模板 ID                    | 中文名         | Named agent                 |
| -------------------------- | -------------- | --------------------------- |
| `nda-triage`               | 保密协议初审   | NDA Triager                 |
| `contract-review`          | 合同审查意见   | Contract Review Analyst     |
| `vendor-agreement-review`  | 供应商协议审查 | Vendor Agreement Reviewer   |
| `demand-letter`            | 律师函起草     | Demand Letter Drafter       |
| `matter-chronology`        | 案件时间线     | Chronology Builder          |
| `evidence-index`           | 证据索引       | Evidence Indexer            |
| `due-diligence-review`     | 尽调审查表     | Due Diligence Reviewer      |
| `client-update-memo`       | 客户邮件摘要   | Client Update Writer        |
| `compliance-research-memo` | 合规研究报告   | Regulatory Research Analyst |

预约执行：协作 API `POST /api/collaboration/workflow-run` body 含 `scheduleRunAt`（ISO 时间，本地 tick）。

---

## IT 评估检查清单

- [ ] 工作区目录加密与备份策略
- [ ] loopback API 是否允许本机脚本访问
- [ ] `lawmind.policy.json`：`networkAllowlist`、`allowWebSearch`
- [ ] Firm/Private：`integrityChain` 审计导出
- [ ] MCP 仅 M1 只读工具已列入允许清单
- [ ] DMS 回写流程是否要求律师在审核台签批

---

## Related docs

- [LAWMIND-WORKSPACE-STANDARD.md](LAWMIND-WORKSPACE-STANDARD.md)
- [LAWMIND-INTERRUPT-RESUME.md](LAWMIND-INTERRUPT-RESUME.md)
- [LAWMIND-REFERENCE-PROJECT-LESSONS.md](LAWMIND-REFERENCE-PROJECT-LESSONS.md)
- [LAWMIND-USER-MANUAL.md](LAWMIND-USER-MANUAL.md)
