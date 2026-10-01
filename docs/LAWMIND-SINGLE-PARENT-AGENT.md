# 单父助手 + 子工并行 + 按需记忆（产品决策）

> 日期：2026-10-01  
> 状态：**已采纳**  
> 交叉引用：[第 16 章协作](./lawmind/manual/16-collaboration-and-fleet.md)、[记忆长期复审](./LAWMIND-MEMORY-LONGTERM-REVIEW.md)、[Codex 子工对标](./LAWMIND-CODEX-WORKER-PARITY.md)、[战略总纲](./LAWMIND-STRATEGY-MASTER.md)

---

## 1. 一句话说完

**律师永远只跟一个父助手说话。**  
复杂活由父助手开隔离子工并行；记忆存在一个柜子里，按任务装包取用——**不靠「多个人格」分摊上下文。**

会议室多助手讨论、顶栏来回切助手、为每个岗位先「雇人」，一律退出 Solo 主路径。

---

## 2. 为什么（证据摘要）

### 2.1 多助手「讨论」不值钱

| 文献                                                                                                                                              | 结论                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| [Stop Overvaluing Multi-Agent Debate](https://arxiv.org/html/2502.08788) (2025)                                                                   | MAD 常打不过 CoT / Self-Consistency，还更贵  |
| [Should we be going MAD?](https://arxiv.org/pdf/2311.17371) (ICML 2024)                                                                           | 默认配置下不可靠优于简单集成；对超参极敏感   |
| [Debate or Vote (NeurIPS 2025)](https://proceedings.neurips.cc/paper_files/paper/2025/file/934252acd87f254d5d4672fbde283bd2-Paper-Conference.pdf) | 增益多来自投票/集成，不是辩论过程            |
| [When and Why Does MAD Fail](https://arxiv.org/html/2510.20963v2) (2025)                                                                          | 竞争式易「辩论黑产」；共识式过早抹掉有用分歧 |

产品含义：会议室、互喷式多助手，**不是**质量手段。独立审稿（干净上下文、单向回传）可以留。

### 2.2 主流软件是「父 + 子工」，不是花名册

| 产品        | 形态                                                        |
| ----------- | ----------------------------------------------------------- |
| Claude Code | 主会话派 subagent；干净上下文；只回摘要；agent teams 默认关 |
| Codex       | spawn 并行子线程；`max_threads` / `max_depth`（默认深度 1） |
| Cursor      | Side chat / Background Agents：并行探索，不污染主线程       |
| OpenHands   | DelegateTool 并行；TaskToolSet 阻塞子任务 + resume          |

共同点：用户只跟一个对话；子任务是工具调用；深度与并发有硬帽。

### 2.3 记忆：存厚、取薄

| 来源                 | 学什么                    | 不学什么                           |
| -------------------- | ------------------------- | ---------------------------------- |
| MemGPT / Letta       | agent 用工具自取 archival | 整仓换运行时；模型自改 core 人设   |
| Mem0                 | 混合检索、token 预算      | 每轮静默 add（与「确认再写」冲突） |
| Graphiti / Zep       | 事实时间窗、矛盾失效      | Neo4j 当本机真相源                 |
| A-MEM (NeurIPS 2025) | 笔记演化 + 按查询取       | 自动链接当信任证明                 |
| Harvey Memory        | 先记个人写法；确认；可删  | 第一期不记客户细节                 |

本仓库记忆内核（`memory-kernel.sqlite`）已按「确认后生效 / 读取时过滤」落地。本决策补的是：**人格收敛**与 **子工装包（L2）**，不是再开第二套云端记忆。

---

## 3. 决策表（必须遵守）

| #   | 决策                                                                                | Solo                     | Firm / 私有化                                |
| --- | ----------------------------------------------------------------------------------- | ------------------------ | -------------------------------------------- |
| D1  | 默认一个父助手；顶栏切换仅在名册 >1 时出现                                          | 设置侧栏不挂「助手编制」 | 编制保留为组织能力                           |
| D2  | 岗位 = **工作方式包**（使命、清单、风险、记忆范围），不是「先创建助手」             | 按办件 / 子工 role 套包  | 同左；可选具名第二人格做互审                 |
| D3  | 主协作原语 = **`draft_worker` 等隔离子工**                                          | 强化                     | 同左；`delegate_*` 降为组织委派              |
| D4  | `delegate_to_role` 找不到岗上的人 → **当前助手 + 工作方式包**，不报「请先添加助手」 | 必做                     | 多助手且点名岗位缺失时仍可硬拒（防静默改派） |
| D5  | 记忆三层：L0 短核常驻 / L1 工具按需 / L2 子工按任务装包                             | 必做                     | 同左                                         |
| D6  | 零分召回不注入；跨案摘录跟 `LAWMIND_ALLOW_CROSS_MATTER_SEARCH`                      | 必做                     | 同左                                         |
| D7  | 会议室界面保持不挂载                                                                | 守住                     | 守住                                         |
| D8  | 不把 Mem0/Letta/Graphiti 换掉 Markdown + 本机内核真相源                             | 守住                     | 守住                                         |

---

## 4. 记忆三层（实现合同）

```text
L0  父 prompt 常驻（极短）
    身份 + 仍生效核心写法指纹 + 本案索引指针
    来源：memory kernel → preference_fingerprint / matter index

L1  父 agent 工具按需取
    read_case_file / search_precedents / stance / 记忆库查询
    问到才取；取不到就空着

L2  派 subagent 时按任务装包
    review：审核清单 + 相关偏好键（少灌「你平时怎么写」以防共谋）
    draft：文风偏好 + 交付口径
    explore：本案争点指针，不要整份 LAWYER_PROFILE
```

知识仍沉淀在**一个柜子**；灌入发生在**任务边界**，不是人格边界。

---

## 5. 与现有代码的映射

| 概念       | 代码入口                                                                                       |
| ---------- | ---------------------------------------------------------------------------------------------- |
| 父助手     | 默认 `assistants.json` 一位；会话绑定 `assistantId`                                            |
| 子工       | `draft_worker` / `explore_folder`（sidecar，不嵌套 `runTurn`）                                 |
| 工作方式包 | `src/lawmind/core/work-style-pack.ts` ← Role checklist / mission / risk                        |
| 编制 UI    | Solo 深链；Firm 侧栏「助手编制」                                                               |
| 记忆 L0    | `turn-orchestrator-prompt.ts` + memory kernel                                                  |
| 记忆 L2    | `buildSubagentMemoryPack`（`work-style-pack.ts`）注入 `draft_worker` / `explore_folder` system |
| 跨案门     | `findSimilarCaseMemories` / precedents 共用 env 开关                                           |

---

## 6. 明确不做

1. 救会议室、推多助手辩论当质量手段。
2. Solo Day-1 引导「再建一个合同助手」。
3. 用禁止清单 / 字数配额冒充质量（铁律 5）。
4. 让模型静默改核心人设。
5. 为零分相关记忆「硬塞最近三条」续命。

---

## 7. 验收（给工程师）

- [x] Solo：设置侧栏无「助手编制」；深链仍可开。
- [x] Firm：侧栏仍有编制。
- [x] `delegate_to_role` 无对应助手时：回落到工作方式包，不要求新建。
- [x] `draft_worker` system 含与 role 匹配的工作方式包（可测字符串）。
- [x] `findRelevantMemoriesForTurn` 零分返回 `[]`。
- [x] `findRelevantMemoriesForTurn` 接回 `prepareTurnPromptContext`（`memory_hit` + `alreadySurfacedMemoryPaths`）。
- [x] `findSimilarCaseMemories` 未开跨案开关返回 `[]`（桌面「相关旧案」显式 `allowCrossMatter`）。
- [x] 相关单元测试与设置导航测试绿灯。
- [x] Solo 顶栏永不出现助手切换；API 拒绝再建第二位；委派空态不引导「新建助手」。
- [x] Solo 深链编制页只编辑当前父助手（无新建/复制/业务领域雇人网格）。
- [x] Solo 锁定默认父助手 id；`/delegate` 与「交给其他助手」在无 Firm 编制时不出现。
- [x] `explore_folder` 亦注入 L2 工作方式包；合约测试 `single-parent-agent-contract.test.ts` 覆盖 D1/D2/D6。

---

## 8. 一句话收束

人格收敛到一个父 agent；算力花在隔离并行的子执行上；记忆做成可检索的柜，按任务装包。  
这是对「模型越来越强」的正确吃法——不是把律师做成 AI 团队的人事经理。
