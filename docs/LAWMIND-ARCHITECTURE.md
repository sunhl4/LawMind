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

**长期需求（偏好进化 + 岗位专职记忆）——尚未作为独立子系统落地**

- 产品愿景中的「按助手维护记忆、随交互进化」需要额外设计，例如：`assistants/<assistantId>/PROFILE.md` 或与 `LAWYER_PROFILE.md` 分节约定、以及写入时机与合并策略；**当前仓库未实现 per-assistant 记忆文件**。
- 演进期可继续用工作区两级文档 + 会话持久化（`sessions/*.json` / `*.turns.jsonl`）承载大部分「记得我说过什么」；分助手长期记忆可作为后续里程碑单独立项。

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

## 十二、后续扩展方向

第二阶段：

- `cases/<matter-id>` 案件级记忆
- PPT 生成
- 律师偏好学习
- 更细粒度模板体系

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
