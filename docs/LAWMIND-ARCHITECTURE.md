# LawMind 架构文档

本文档定义 LawMind 的第一版系统架构，目标是：**先搭一个易扩展、可审计、面向律师工作的底座**，再在其上逐步增加功能。

---

## 一、设计原则

1. **Markdown 是记忆真相源**
2. **模板化交付优先于自由生成**
3. **结构化中间层优先于直接出文书**
4. **高风险动作默认需要确认**
5. **功能可扩展，但边界必须稳定**

---

## 二、总体架构

LawMind 分为五个核心模块：

1. **Instruction Router**
2. **Memory Layer**
3. **Retrieval Layer**
4. **Reasoning Layer**
5. **Artifact Layer**

数据主链路如下：

`用户指令 -> 路由分类 -> 记忆加载 -> 检索 -> 结构化整理 -> 人工审核 -> 文书渲染 -> 审计记录`

---

## 三、目录与工作区约定

建议的工作区布局如下：

```text
workspace/
  MEMORY.md
  LAWYER_PROFILE.md
  memory/
    YYYY-MM-DD.md
  cases/
    <matter-id>/
      CASE.md
      research/
      drafts/
      artifacts/
  templates/
    word/
    ppt/
  artifacts/
  audit/
```

说明：

- `MEMORY.md`：通用长期记忆。
- `LAWYER_PROFILE.md`：律师个人偏好与习惯记忆。
- `memory/YYYY-MM-DD.md`：运行日志与日常上下文。
- `cases/<matter-id>/CASE.md`：案件级记忆，第二阶段引入。
- `templates/`：交付模板。
- `artifacts/`：最终产物。
- `audit/`：审计事件和回放数据。

---

## 四、双记忆文档设计

### 1. `MEMORY.md`

用于记录稳定、通用、可复用的信息：

- 通用法律工作流规则
- 通用写作规范
- 风险红线
- 模板使用原则
- 系统级业务判断

### 2. `LAWYER_PROFILE.md`

用于记录某位律师的个性化偏好：

- 写作风格
- 常用措辞
- 法条和案例引用偏好
- 结论组织方式
- 客户沟通口吻
- 审稿习惯

### 3. `memory/YYYY-MM-DD.md`

用于记录：

- 当日任务进展
- 当前会话上下文
- 阶段性决策
- 临时问题和后续待办

### 4. 读取规则

第一阶段固定读取：

1. `MEMORY.md`
2. `LAWYER_PROFILE.md`
3. 今天的 `memory/YYYY-MM-DD.md`
4. 昨天的 `memory/YYYY-MM-DD.md`

第二阶段再按案件引入 `cases/<matter-id>/CASE.md`。

### 5. 与「多助手 / 岗位」的关系（实现现状与长期方向）

**已实现（工作区级，所有助手共享）**

- `MEMORY.md`：**通用**长期记忆（工作流规则、写作规范、风险红线等）。
- `LAWYER_PROFILE.md`：**律师个人**偏好与习惯（风格、措辞、引用习惯等）；提供 `appendLawyerProfile()` 仅向该文件**追加**条目，便于偏好缓慢积累。
- 有 `matterId` 时额外加载 `cases/<matter-id>/CASE.md` 作为案件记忆。

**岗位助手（`assistants.json`）当前角色**

- 助手档案保存的是**静态配置**：显示名、简介、岗位预设、自定义岗位说明等，经 `buildSystemPrompt()` 注入为「当前岗位与职责」区块。
- **没有**为每个 `assistantId` 单独维护一份 Markdown 记忆文件；「专职工作方式」主要来自预设 + 用户写的说明，**不会**自动分文件进化。

**代码中的注入差异（避免误解「两个记忆是否都进主对话 system prompt」）**

- **Agent 主对话**（`runTurn`）：system prompt 中显式拼接的是 **`LAWYER_PROFILE.md` 全文**（以及岗位说明、案件 CASE、今日日志片段等）；`MEMORY.md` **不**整段拼进同一条 system 字符串。
- **`MEMORY.md` 仍会被加载**：用于检索管线（例如 `ModelRetrievalInput.memory.general`）、引擎桥接、以及 `search_workspace` 等工具对 `MEMORY.md` / `LAWYER_PROFILE.md` 的聚合搜索，模型通过工具与检索间接使用通用记忆。
- 若希望「通用规则」也像偏好一样**每条对话必显式出现**，需要另行调整 prompt 组装策略（当前架构刻意区分：偏好更贴近人设，通用更偏可检索知识）。

**长期需求（偏好进化 + 岗位专职记忆）——部分落地**

- **已实现**：`assistants/<assistantId>/PROFILE.md`（位于 LawMind 根目录，与 `assistants.json` 同级父目录下的 `assistants/` 文件夹）。Agent `runTurn` 会将其全文并入 system prompt（与 `LAWYER_PROFILE.md` 并存）。提供 `appendAssistantProfileMarkdown()` 供后续「显式采纳」写入。
- **待产品化**：桌面 UI 一键「写入偏好」、与审核通过联动、合并冲突策略。
- 演进期仍配合工作区 `LAWYER_PROFILE.md` + 会话持久化使用。

---

## 五、Instruction Router

Router 的职责是把自然语言任务映射为稳定工作流。

第一阶段至少支持以下任务类型：

- `research.general`
- `research.legal`
- `research.hybrid`
- `draft.word`
- `draft.ppt`
- `summarize.case`

Router 输出一个结构化任务对象：

```ts
type TaskIntent = {
  kind: string;
  output: "markdown" | "docx" | "pptx";
  audience?: string;
  matterId?: string;
  templateId?: string;
  riskLevel: "low" | "medium" | "high";
};
```

---

## 六、Retrieval Layer

Retrieval Layer 负责把“找资料”变成标准流程，而不是让模型自由发挥。

### 检索来源

- 本地知识库
- 律师工作区文件
- 案件材料
- 通用网络资料
- 法律专用检索源

### 统一输出结构

```ts
type ResearchBundle = {
  query: string;
  sources: Array<{
    id: string;
    title: string;
    url?: string;
    citation?: string;
    kind: "statute" | "case" | "memo" | "web" | "workspace";
  }>;
  claims: Array<{
    text: string;
    sourceIds: string[];
    confidence: number;
  }>;
  riskFlags: string[];
  missingItems: string[];
};
```

约束：

- 所有结论必须能回溯到来源
- 来源不足时，必须明确标记不确定性
- 法律判断不能只来自通用模型自由生成

---

## 七、Reasoning Layer

LawMind 不绑定单一模型，而采用**路由 + 汇合**策略。

### 模型角色

- **通用大模型**：负责背景信息整理、语言优化、结构压缩。
- **专用法律模型**：负责法律术语理解、法条与类案提取、风险识别。

### 编排规则

1. Router 判断任务类型
2. 通用模型给出背景框架和初步整理
3. 专用法律模型校正法律口径和引用
4. 合并器生成统一草稿
5. 进入人工审核点

### 模型路由原则

- 简单整理优先低成本模型
- 高风险法律分析优先法律专用模型
- 输出前必须标记来源和风险

---

## 八、Artifact Layer

Artifact Layer 负责把结构化草稿渲染为可交付成果。

### 第一阶段支持

- `docx`：法律检索报告、律师函、备忘录
- `markdown`：中间草稿与审阅稿

### 第二阶段支持

- `pptx`：客户汇报、案件复盘、方案汇报

### 输出流程

1. 生成 `ArtifactDraft`
2. 律师审阅并确认
3. 依据模板渲染
4. 写入 `artifacts/`

建议的中间结构：

```ts
type ArtifactDraft = {
  title: string;
  output: "docx" | "pptx";
  templateId: string;
  summary: string;
  sections: Array<{
    heading: string;
    body: string;
    citations?: string[];
  }>;
  reviewNotes: string[];
};
```

---

## 九、人工审核与审批点

LawMind 的核心不是“自动执行更多”，而是“在正确的地方停下来”。

第一阶段必须设置两个审核点：

1. **检索整理后审核**
   确认结构、来源、风险提示是否合理。

2. **文书渲染前审核**
   确认口吻、结论强度、引用和模板是否正确。

高风险动作默认不能跳过人工确认。

---

## 十、审计日志

每次任务至少记录以下事件：

- 谁发起任务
- 任务类型
- 使用了哪些模型
- 使用了哪些来源
- 生成了哪些草稿
- 谁确认了最终输出
- 最终产物存放位置

审计文件可先用 JSONL 或 Markdown 落地，后续再演进到更严格的事件存储。

---

## 十一、第一阶段 MVP

第一阶段只做一个最小闭环：

1. 双记忆文档
2. 指令路由
3. 通用模型 + 法律模型联合检索
4. `ResearchBundle` 标准化
5. Word 文档输出
6. 人工审核
7. 审计日志

明确不做：

- 大规模多渠道接入
- 全自动外发
- 完整技能市场
- 深度案件协作
- PPT 自动生成主链路

---

## 十一b、桌面应用架构（M3 Electron）

### 整体结构

桌面端采用 Electron + Vite + React 架构，分为三层：

```text
Electron 主进程 (main.mjs)
  ├── 启动本地 API 子进程 (lawmind-local-server)
  ├── IPC 桥接 (preload.cjs → contextBridge)
  └── 原生能力 (文件对话框、shell.openExternal 等)

本地 API 子进程 (lawmind-local-server.ts)
  ├── /api/chat — Agent 对话（POST，支持 projectDir / assistantId）
  ├── /api/tasks — 任务列表
  ├── /api/history — 历史与交付记录
  ├── /api/matters/overviews — 案件总览列表
  ├── /api/matters/detail?matterId= — 案件详情（摘要、CASE、任务、草稿、审计）
  ├── /api/matters/search?matterId=&q= — 案件内搜索
  ├── /api/drafts — 草稿列表（GET）
  ├── /api/drafts/:taskId — 单份草稿（GET）
  ├── /api/drafts/:taskId/review — 审核签批（POST）
  ├── /api/drafts/:taskId/render — 渲染交付物（POST，须已通过审核）
  ├── /api/assistants — 助手 CRUD
  ├── /api/assistant-presets — 岗位预设列表
  ├── /api/health — 环境与连接状态
  └── /api/artifact — 产物下载

渲染进程 (App.tsx + styles.css)
  ├── 对话视图（消息列表 + Markdown 渲染 + Chip 栏）
  ├── 文件工作台（FileWorkbench）
  ├── 案件工作台（MatterWorkbench：案件列表、CASE、任务/草稿、审计）
  ├── 审核台（ReviewWorkbench：草稿审阅、签批、渲染）
  ├── 设置面板（模态：助手 / 模型检索 / 工作区项目）
  ├── 侧边栏（助手选择器 / 项目药丸 / 折叠工作记录）
  └── 配置向导（首次启动 API Key 设置流）
```

### UI 设计系统

所有视觉 token 定义在 `styles.css` 的 `:root` 中：

- **色彩**：深色暖调底色（`--c-bg` `#1a1917`），暖铜 accent（`--c-accent` `#b79a67`），浅文字（`--c-text` `#e8e4dd`）
- **排版**：PingFang SC / -apple-system 中文优先，正文 14px，行高 1.7
- **圆角/阴影/间距**：token 化（`--r-sm` / `--r-md` / `--r-lg`，`--shadow-card` / `--shadow-float`）

### 设置面板架构

设置由齿轮图标（`lm-gear-btn`）触发，打开 `lm-settings-panel` 模态，分三个区：

1. **助手管理**：当前助手详情、新建/编辑/删除、使用统计
2. **模型与检索**：模型状态、检索策略切换（统一/双模型）、API 配置向导入口
3. **工作区与项目**：工作区路径、项目目录选择/关闭

### 项目目录（IPC 流）

```text
渲染进程 pickProject()
  → preload.cjs ipcRenderer.invoke("lawmind:pick-project")
  → main.mjs dialog.showOpenDialog({ properties: ["openDirectory"] })
  → 返回 { ok, path } → 渲染进程设置 projectDir state
  → POST /api/chat body 中携带 projectDir 字段
```

### 工作记录折叠与助手过滤

- 侧边栏工作记录区域默认折叠（`recordsExpanded` state），标题栏点击切换展开，显示记录总数 badge。
- 任务和历史列表按 `selectedAssistantId` 过滤（`filteredTasks`、`filteredHistory` useMemo），切换助手时自动更新。

### 案件工作台的“行为观察 -> 产品决策”链路

LawMind 近期在 `MatterWorkbench` 中新增了一条很重要的上层链路：不只展示案件事实，还尝试根据律师的真实使用动作，逐层推导“当前案件最该去哪一步”和“产品下一版最该改哪里”。

这条链路不是为了替代法律判断，而是为了降低律师在多页面之间来回切换的成本，并让产品优化建立在真实使用证据上，而不是只靠主观猜测。

#### 1. 数据来源

桌面端当前会把以下关键动作写入既有 audit 体系，事件种类为 `ui.matter_action`：

- 从案件工作台进入审核台
- 将认知升级建议写入 `LAWYER_PROFILE.md`
- 将认知升级建议写入当前助手 `PROFILE.md`
- 将 CASE 焦点建议写回案件档案对应 section

这里复用已有审计体系，而不是单独再造一套埋点系统，有两个原因：

1. 同一条律师动作既可用于产品观察，也可进入案件审计时间线。
2. 对律师和交付方来说，排查时只需要看一套证据源，不会出现“业务日志”和“产品日志”两套口径不一致。

#### 2. 推导层级

这条链路目前按以下顺序逐层上探：

```text
ui.matter_action 原始动作
  → 最近律师动作
  → 律师行为摘要
  → 交互收敛建议
  → 产品改造建议
  → 产品实验清单
  → 跨案件实验累积板
  → Roadmap 候选池
  → 路线图决策卡
```

各层含义如下：

1. **最近律师动作**
   只回答“发生了什么”，不做解释。

2. **律师行为摘要**
   将动作汇总为案件层面的行为特征，例如审核打开次数、CASE 写回次数、记忆沉淀次数、主入口和高频主题。

3. **交互收敛建议**
   根据当前案件的行为特征，给出更像“下一步操作”的入口建议。

4. **产品改造建议**
   将单案中的重复动作翻译为对产品界面本身的改进方向。

5. **产品实验清单**
   把改造方向拆成可验证的实验项，增加假设、验证方式、当前信号和优先级。

6. **跨案件实验累积板**
   将多个案件里的相似模式聚合，判断某个问题是否已经跨案件重复出现。

7. **Roadmap 候选池**
   按覆盖案件数、累计事件数、当前案件是否命中等信号做粗粒度排序。

8. **路线图决策卡**
   在候选池之上补充产品决策语义，例如节奏、成熟度、预期收益、主要风险和建议 owner。

#### 3. 为什么要做成多层，而不是一步到位

因为律师和技术团队关注的层次不同：

- 律师更关心“我现在下一步去哪”。
- 产品和技术更关心“这个问题是不是已经值得排期解决”。
- 管理和交付方更关心“这是不是共性问题，还是某一案件的偶发路径”。

如果一开始直接展示路线图层，律师会觉得抽象；如果只停留在最近动作层，技术团队又拿不到足够清晰的产品信号。分层后，不同角色可以停留在自己需要的抽象层。

#### 4. 当前排序信号

当前 `Roadmap 候选池` 和 `路线图决策卡` 主要依赖以下信号：

- 覆盖案件数
- 累计出现次数
- 当前选中案件是否也命中该模式
- 某些关键方向的人工偏置分（例如审核前置、CASE 结构化、记忆快捷沉淀）

这是一套**粗粒度排序**，其目标不是做精确打分，而是先把“明显更值得优先解决”的方向放到前面。

#### 5. 当前输出的产品决策语义

在路线图决策卡层，系统会补充以下产品语义：

- **节奏**：现在做 / 下一波 / 后续观察
- **成熟度**：已验证 / 正在成形 / 继续观察
- **预期收益**：为什么做它
- **主要风险**：做错时最可能出现的副作用
- **建议 owner**：更像由哪个产品面或工作台区域牵头推进

这意味着 LawMind 当前已经不只是“记录律师怎么用”，而是在尝试形成接近产品排期语言的内部决策面板。

#### 6. 关键接口

与这条链路直接相关的本地 API 包括：

- `POST /api/matters/interaction`
  记录案件工作台里的关键律师动作，并写入 audit。

- `GET /api/matters/interaction-rollup`
  聚合全工作区多个案件中的 `ui.matter_action`，形成跨案件累积信号。

- `GET /api/matters/detail?matterId=...`
  返回当前案件详情，其中包含构建案件工作台所需的任务、草稿、CASE、审计等基础数据。

#### 7. 架构边界

这条链路当前仍然有明确边界：

- 它观察的是“工作行为”，不是“法律结论是否正确”。
- 它适合帮助识别高频重复路径，不适合替代正式的用户研究或案件复盘。
- 它生成的是产品建议，不会自动修改系统配置、自动重排界面或自动写入长期记忆。

因此，它更像一个“基于真实使用痕迹的产品观察层”，而不是全自动产品经理。

---

## 十二、后续扩展方向

第二阶段（已完成/进行中）：

- [x] `cases/<matter-id>` 案件级记忆
- [x] PPT 生成
- [x] Agent 智能体架构（M2）
- [x] 桌面应用（Electron，M3）
- [x] 项目目录注入 Agent（`read_project_file` / `search_workspace` 扩展）与桌面项目切换后重启 API
- [x] 案件面板 UI（MatterWorkbench）
- [x] 审核台 UI（ReviewWorkbench）
- [ ] 律师偏好学习（per-assistant 记忆进化，UI 显式写入 PROFILE）
- [ ] 更细粒度模板体系

第三阶段：

- 多律师协作
- 私有化部署能力
- 合规报表
- 法律技能市场与签名机制

---

## 十三、实施建议

先做下面这些，再开始大规模编码：

1. 固定目录与文件契约
2. 固定 `TaskIntent` / `ResearchBundle` / `ArtifactDraft`
3. 先打通 Word 输出链路
4. 保证每一步都有审计记录

只要这几个基础契约稳住，后面新增功能都只是挂模块，而不是推倒重来。

---

## 十四、LawMind 2.0 架构升级方向

如果 LawMind 的目标是变成“比律师更懂律师的数字助理团队”，下一阶段就不能只继续增强聊天能力，而要把当前底座升级为**法律生产系统**。升级原则如下：

### 1. 从双记忆升级为多层认知记忆

当前的 `MEMORY.md`、`LAWYER_PROFILE.md`、`cases/<matter-id>/CASE.md` 是正确起点，但不足以完整表达律师行业的工作上下文。建议保留 Markdown 真相源，同时扩展为：

- `FIRM_PROFILE.md`：律所级规则、交付标准、审批口径、风险红线。
- `LAWYER_PROFILE.md`：个人写作风格、审稿习惯、风险表达偏好。
- `CLIENT_PROFILE.md`：客户行业、风险偏好、沟通方式、预算敏感度。
- `cases/<matter-id>/MATTER_STRATEGY.md`：案件策略、关键节点、底线、决策记录。
- `playbooks/CLAUSE_PLAYBOOK.md`：条款库、替代措辞、谈判习惯、常见陷阱。
- `playbooks/COURT_AND_OPPONENT_PROFILE.md`：法院、仲裁庭、对方律师的经验画像（若工作区有此类知识）。

设计约束保持不变：

- Markdown 仍是人工可读、可审计的真相源。
- 检索索引、摘要、embedding、统计指标均是派生层。
- 高风险规则仍应进入只读策略层，而不是仅依赖对话上下文。

### 2. 在检索与起草之间增加法律推理层

当前链路已经有 `ResearchBundle` 和 `ArtifactDraft`，但还缺少一层更接近律师真实工作方式的中间对象。建议新增 `LegalReasoningGraph` 一类结构，用于表达：

- 争点树：争点、要件、关键事实、关键证据、待确认问题。
- 论证矩阵：我方观点、支撑依据、对方可能抗辩、反击路径。
- 权威冲突：法条、司法解释、类案、内部备忘录之间的冲突与取舍。
- 交付风险：哪些结论可以写强，哪些只能保守表述。

这样可以把“模型会写”升级为“系统会推理”，也能为后续评测和审核提供稳定抓手。

### 3. 从审计留痕升级为质量学习飞轮

当前 `draft.reviewed`、`draft.citation_integrity`、`artifact.rendered` 已经具备强审计能力。下一步建议把审核行为变成显式学习信号，而不只是状态切换：

- 将审核结果拆分为结构化标签，例如：语气过强、引用不足、争点遗漏、风险等级偏高。
- 写回 `LAWYER_PROFILE.md`、`assistants/<assistantId>/PROFILE.md`、以及未来的 playbook 文档。
- 将高质量草稿升级为“黄金样本”，反哺模板与岗位助手。
- 建立任务级、模板级、助手级质量统计指标。

### 4. 从单助手升级为岗位化编制

LawMind 当前已支持 per-assistant `PROFILE.md`，这是岗位化的好起点。下一步应明确支持岗位型助手，而不是一个泛化的法律助手：

- 合同审查助手
- 法律检索助手
- 诉讼策略助手
- 证据与时间线助手
- 客户沟通助手
- 交付质检助手
- 合规审计助手

每个岗位应有：

- 明确职责边界
- 可用工具与风险阈值
- 默认模板与产物类型
- 专属 checklist 与学习记忆

### 5. 将商业化与评测并入系统设计

LawMind 下一阶段的架构目标不只是“功能更多”，而是“可卖、可验收、可衡量”：

- 商业化：按 `Solo Edition`、`Firm Edition`、`Private Deploy` 分层打包。
- 评测化：建立任务完成率、引用正确率、争点覆盖率、人工改动率、一次通过率、风险召回率等指标。
- 交付化：让部署、验收、回归、审计导出、支持 runbook 都成为产品的一部分，而不是售后附加动作。

### 6. 对现有契约的影响

LawMind 2.0 仍应保留现有主干契约，但建议向下兼容扩展：

- `TaskIntent`：增加任务玩法、客户上下文、质量目标等字段。
- `ResearchBundle`：增加来源时效性、冲突提示、证据充分度。
- `ArtifactDraft`：增加受众语气、交付置信度、质量标签、审核建议。
- `AuditEvent`：增加学习事件、评测事件、模板分发事件。

结论：当前架构仍然成立，但下一阶段的重点应从“把流程打通”转向“把律师的方法论、律所的制度、客户的口径、案件的策略、审核的经验”固化进系统。
