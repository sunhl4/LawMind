# 合同修订积累（Contract revision accumulation）

律师大量工作是对合同的**多轮修改**。本能力把一次完整闭环沉淀为**可审计、可复用的数据包**：保留**初始稿**、**律师定稿**与**关键修改点**，统一落在工作区目录中，作为事务所与律师个人的**风格与任务经验资产**；后续可接入助手记忆（如 `LAWYER_PROFILE.md` 第八节）、检索与微调管线，使通用模型上的 Agent **更贴合本律师的改稿习惯与法律任务语境**。

---

## 主路径（推荐）：沿用「交付审核」流程

**产品原则**：不在桌面额外堆一层「合同专页」或复杂设置；律师的把关动作仍在 **审核台** 完成（与交付物 DFA 一致）。

1. **准备素材**：初始稿与定稿均为工作区内的文件（相对工作区根的路径）。
2. **在草稿上声明捕获**（由 Agent / 引擎工具 / 运维写 `workspace/drafts/<taskId>.json`，而非新 UI）：在对应 `ArtifactDraft` 上设置 `contractRevisionCapture`：
   - `initialRelativePath`、`revisedRelativePath`（必填，相对工作区根）
   - 可选 `stableDocumentKey`（同一逻辑合同链式索引，写入 `learning/contract-revisions/_index/by-key/`）
   - 可选 `keyModifications[]`（字符串数组；若缺省可用审核备注填充要点）
3. **律师在审核台签批「通过」**：`POST /api/drafts/:taskId/review`，`status: "approved"`（与现有审核流相同）。
4. **服务端挂钩**（`apps/lawmind-desktop/server/lawmind-server-route-review.ts`）：在引擎 `review` 已成功、且状态为 `approved` 之后，调用 `applyContractRevisionAccumulationAfterApprovedReview`（`src/lawmind/learning/contract-revision-on-review-approved.ts`）：
   - 若存在 `contractRevisionCapture` 且尚无 `contractRevisionAccumulatedId`，则调用 `finalizeContractRevisionPack` 落盘积累包；
   - 成功后从草稿中**移除** `contractRevisionCapture`，写入 `contractRevisionAccumulatedId`（防重复落盘）并 `persistDraft`；
   - 失败**不阻断**审核成功：返回体可带 `contractRevisionAccumulationWarning`，并向 `workspace/audit` 写入 `contract_revision_accumulation_failed`。
5. **成功时的 HTTP 响应**（除既有 `draft` 等字段外）：可能包含 `contractRevisionAccumulatedId`（与 `draft.contractRevisionAccumulatedId` 一致）。

类型定义见 `src/lawmind/types.ts`（`ContractRevisionCapture`、`ArtifactDraft.contractRevisionCapture` / `contractRevisionAccumulatedId`）。

**自动化测试**：`apps/lawmind-desktop/server/lawmind-server-route-review.test.ts` 中含「带 capture 审核通过 → 积累包与索引落盘」用例。

---

## 磁盘布局

每条记录一个子目录（`revisionId` 形如 `cr_YYYYMMDD_xxxxxx`）：

```text
workspace/learning/contract-revisions/<revisionId>/
  manifest.json           # 元数据：案件、助手、时间、文件 SHA-256 等
  initial/<文件名>        # 初始合同副本（落盘时快照）
  final/<文件名>          # 定稿副本
  KEY_MODIFICATIONS.md    # 修改要求摘要 + 关键修改点列表（Markdown）
```

- 运行期数据默认由 `workspace/.gitignore` 排除，勿将客户合同推送到公开仓库。
- `manifest.json` 的 `schemaVersion` 当前为 **1**，便于以后演进字段而不破坏旧包。

---

## 工作区桌面设置（可选：对话索引前缀）

文件：`workspace/lawmind/desk-settings.json`（勿提交仓库，见 `workspace/.gitignore`）。

| 方法   | 路径                           | 说明                                                                               |
| ------ | ------------------------------ | ---------------------------------------------------------------------------------- |
| `GET`  | `/api/workspace/desk-settings` | 读取设置（含 `contractBatchRelativeDir`）                                          |
| `POST` | `/api/workspace/desk-settings` | 保存；JSON `{ "contractBatchRelativeDir": "相对路径" \| null }`，`null` 或空串清除 |

**用途**：配置「批量合同材料」所在目录（相对工作区根）。桌面壳在启动时会拉取该值；当对话引用为**整目录**或路径落在该目录下时，**发送消息**可在发往模型的正文前附加 **「合同修订积累索引」**（来自 `GET /api/learning/contract-revisions`），便于 Agent 对照历史定稿与要点（用户气泡仍显示原文）。

**刻意不做**：在 **设置 → 工作区与项目** 或文件树右键提供「批量合同目录」编辑器（避免功能堆叠；与 [LawMind 工程记忆](/LAWMIND-PROJECT-MEMORY) 中「合同修订积累与 UI 克制」一致）。需要该能力时由运维/脚本调用 `POST /api/workspace/desk-settings`，或直接编辑上述 JSON。

---

## 验收前草稿与「验收后入库」（脚本 / 进阶 API）

| 方法   | 路径                                          | 说明                                                                                                                          |
| ------ | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `POST` | `/api/learning/contract-review/drafts`        | 保存/更新待验收草稿（初始路径、候选终稿路径、律师批注、要点草稿）                                                             |
| `GET`  | `/api/learning/contract-review/drafts`        | 列出 `status: open` 的草稿                                                                                                    |
| `POST` | `/api/learning/contract-review/drafts/accept` | 验收通过后：与 finalize 相同逻辑写入 `contract-revisions`，草稿标为 `accepted`；可选 `stableDocumentKey` 更新 `_index/by-key` |

草稿目录：`workspace/learning/contract-reviews/drafts/*.json`（运行期数据，勿提交）。

**与主路径关系**：日常律师交互以 **审核台 + 交付草稿 JSON** 为主；本组 API 适合自动化、集成或尚未挂任务的修订流水线。

---

## HTTP API（LawMind 桌面本地服务）

| 方法   | 路径                                        | 说明                                                                         |
| ------ | ------------------------------------------- | ---------------------------------------------------------------------------- |
| `POST` | `/api/learning/contract-revision/finalize`  | 从工作区内路径读取初始稿与定稿，写入上述包（亦可不经草稿、不经审核直接定稿） |
| `GET`  | `/api/learning/contract-revisions?limit=50` | 列出最近若干条摘要（`revisionId`、`finalizedAt`、`title`、`matterId`）       |

### `POST …/finalize` JSON 体

| 字段                        | 必填 | 说明                                                                                             |
| --------------------------- | ---- | ------------------------------------------------------------------------------------------------ |
| `initialPath`               | 是   | 初始合同路径（相对工作区根，或已落在工作区下的绝对路径）                                         |
| `finalPath`                 | 是   | 定稿路径（同上）                                                                                 |
| `keyModifications`          | 否   | 字符串数组，每项一条「关键修改」叙述                                                             |
| `title`                     | 否   | 本条修订标题（默认取初始文件名）                                                                 |
| `requirementsSummary`       | 否   | 律师对本次修改要求的文字摘要                                                                     |
| `matterId`                  | 否   | 关联案件 ID（须符合既有 matter id 规则）                                                         |
| `assistantId`               | 否   | 关联助手 ID                                                                                      |
| `appendLawyerProfileBullet` | 否   | 为 `true` 时在 `LAWYER_PROFILE.md`「八、个人积累」追加一条指向本包的摘要（显式学习）             |
| `stableDocumentKey`         | 否   | 稳定业务键；写入 `_index/by-key/<slug>.json`，后续同键定稿会更新 `latestRevisionId` 与 `history` |
| `lawyerReviewNotes`         | 否   | 写入 `KEY_MODIFICATIONS.md` 的「律师批注（验收前）」一节                                         |

路径**必须**位于当前工作区根之下，否则返回 `403` / `path_outside_workspace`。

### 成功响应示例

```json
{
  "ok": true,
  "revisionId": "cr_20260427_a1b2c3",
  "packRelativeDir": "learning/contract-revisions/cr_20260427_a1b2c3",
  "manifest": { "schemaVersion": 1, "...": "..." }
}
```

---

## 引擎 API（TypeScript）

见 `src/lawmind/learning/contract-revision-pack.ts`，并由 `src/lawmind/index.ts` 导出：

- `finalizeContractRevisionPack(...)`
- `listContractRevisionPacks(workspaceDir, limit?)`
- `resolvePathStrictlyUnderWorkspace(workspaceDir, userPath)` — 路径校验

审核挂钩：`applyContractRevisionAccumulationAfterApprovedReview`（`contract-revision-on-review-approved.ts`）供桌面路由与测试使用。

---

## 与产品 UI 的衔接

- **主交互**：审核台签批通过即可触发积累（前提为草稿上已有 `contractRevisionCapture`）。
- **辅助**：若已配置 `desk-settings.json` 的 `contractBatchRelativeDir`，对话发送时可自动附加修订索引前缀（见 `lawmind-app-shell.ts` 与 `lawmind-contract-chat-context.ts`）。
- **不设**：单独的「定稿并记入修订积累」向导为可选未来能力；当前优先 API + 审核主路径，避免与审核台、验收门禁两套心智冲突。
