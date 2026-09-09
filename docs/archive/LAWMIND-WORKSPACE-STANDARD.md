# LawMind 工作区标准

LawMind 桌面版将**工作区目录**作为律师数据的唯一本地真相源。本页说明推荐目录树、体检检查项，以及与参考项目（GitAgent / GAP）的对照。

## 推荐目录树（P0）

```text
<workspace>/
  MEMORY.md                 # 通用长期规则（建议）
  LAWYER_PROFILE.md         # 律师偏好（首跑可生成）
  FIRM_PROFILE.md           # 可选：律所级规则
  lawmind/
    policy.json             # 或 workspace 根 lawmind.policy.json
    workflows/*.json        # 工作流模板（仓库含内置中文示例）
    integrations.json       # 可选：M2 连接器开关（filesystem / DMS 占位）
    search-index.sqlite     # 可选：FTS5 只读索引（由服务重建，勿手改）
    deliverables/*.json     # 可选：私有验收规格
  templates/
    word/                   # Word 渲染模板
  cases/<matter-id>/
    CASE.md                 # 案件记忆
  clients/<client-id>/
    CLIENT_PROFILE.md       # 客户档案
  tasks/  drafts/  audit/  sessions/  …
```

## 体检检查项（`GET /api/health` → `doctor.workspaceStandard`）

| ID               | 标签                       | 正常                                           | 说明                                         |
| ---------------- | -------------------------- | ---------------------------------------------- | -------------------------------------------- |
| `memory_md`      | 通用记忆 MEMORY.md         | 文件存在                                       | 缺失时提示建立长期规则文件                   |
| `lawyer_profile` | 律师偏好 LAWYER_PROFILE.md | 文件存在                                       | 首跑向导可生成                               |
| `policy`         | 工作区策略                 | `lawmind/policy.json` 或 `lawmind.policy.json` | 缺失为**建议完善**（warn），不阻断           |
| `workflows`      | 工作流模板                 | `lawmind/workflows/` 下至少一个 `.json`        | 可从仓库 `workspace/lawmind/workflows/` 复制 |
| `word_templates` | Word 模板目录              | `templates/word/` 存在                         | 缺失为 warn；无 docx 渲染需求可暂缓          |

### 策略字段（`lawmind.policy.json` / `lawmind/policy.json`）

| 字段                       | 说明                                                            |
| -------------------------- | --------------------------------------------------------------- |
| `networkAllowlist`         | 允许联网检索的主机名列表（如 `api.search.brave.com`）           |
| `networkAllowlistEnforced` | 为 true 时，Firm/Private 未配置 allowlist 将拒绝 Brave 联网工具 |

实现：`apps/lawmind-desktop/server/lawmind-health-payload.ts` → `buildWorkspaceStandardReport()`。

### 全文检索索引（`doctor.searchIndex`）

| 字段                        | 说明                                   |
| --------------------------- | -------------------------------------- |
| `ready`                     | 是否存在 `lawmind/search-index.sqlite` |
| `auditRows` / `sessionRows` | 上次重建灌入行数                       |
| `lastRebuildAt`             | ISO 时间戳                             |
| `truncated`                 | 巨型工作区是否截断 ingest              |

API：`GET /api/search/workspace?q=`、`POST /api/search/workspace/rebuild`（需 `LAWMIND_ALLOW_INDEX_REBUILD=1`）。案件工作台搜索会并行合并案件索引与 FTS 命中。

## 与参考项目的对照

| 参考能力                               | LawMind 对应                                                                 |
| -------------------------------------- | ---------------------------------------------------------------------------- |
| GitAgent 仓库级 `AGENTS.md` / 规则文件 | `MEMORY.md` + `LAWYER_PROFILE.md` + `lawmind/policy.json`                    |
| Ralph 任务看板                         | Matter 工作台「任务」Tab + `MatterTaskBoard`                                 |
| 工作流模板库                           | `lawmind/workflows/*.json` + `LawmindWorkflowLibrary`                        |
| Doctor / 自检                          | 设置 → **系统体检**（`LawmindSettingsDoctor`）+ 顶栏 `LawmindReadinessStrip` |

## 修复路径（律师可读）

1. **模型未配置** → 设置 → 模型与检索 → 配置 API，或顶栏「配置 API」。
2. **工作流缺失** → 设置 → 协作 → 工作流库，或复制仓库 `workspace/lawmind/workflows/` 到本机工作区。
3. **Word 模板缺失** → 准备 `templates/word/`（可与所内模板包同步）。
4. **策略文件缺失** → 可选；需要红线/联网策略时再添加 `lawmind/policy.json`。

相关文档：[LAWMIND-INTERRUPT-RESUME.md](LAWMIND-INTERRUPT-RESUME.md)、[LAWMIND-REFERENCE-PROJECT-LESSONS.md](LAWMIND-REFERENCE-PROJECT-LESSONS.md)。
