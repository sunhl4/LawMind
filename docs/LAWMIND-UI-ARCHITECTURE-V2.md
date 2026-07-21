# LawMind UI Architecture V2 — Matter-Centric Desk

> **状态**：设计决策稿。§9 意向为全 A，但**实现按页面分步**：先出对照图、确认后再改代码。此前整壳 Wave 0 已退回。  
> **背景**：`docs/assets/skills-epic-ui/` 对照图生成自史诗计划会话（[transcript](9a881e97-f7af-49b0-8e24-1f14d6898cef)），流程为「写史诗计划 → GenerateImage 前后对比 → 落入 `LAWMIND-AGENT-SKILLS-EPIC-PLANS.md`」。视觉方向正确，但落地时变成**功能岛拼装**：双导航、伪视图、入口分裂。  
> **母文档**：[`LAWMIND-DESKTOP-UI.md`](LAWMIND-DESKTOP-UI.md)（将被本文 §7 取代）、[`LAWMIND-AGENT-SKILLS-EPIC-PLANS.md`](LAWMIND-AGENT-SKILLS-EPIC-PLANS.md)  
> **示意**：[`assets/ui-arch-v2/`](assets/ui-arch-v2/)  
> **方法借鉴**：[ui-design-brain](https://github.com/carmahhawwari/ui-design-brain)（组件克制 / 单强调色 / 每区一个主按钮）、[ui-flow-agent-skills](https://github.com/boweneos/ui-flow-agent-skills)（从截图反推流程规格）

---

## 0. 问题诊断（现状）

| 症状     | 工程表现                                                          | 用户感受                         |
| -------- | ----------------------------------------------------------------- | -------------------------------- |
| 双导航   | Header Tab + 条件 `CockpitNav`，文案还不一致（在办≠专案组）       | 「我到底该点上面还是左边？」     |
| 伪视图   | 案件 = `workspace` + `matterCockpitOpen`；会议/自动办件藏溢出菜单 | 找不到、记不住                   |
| 入口分裂 | 待拍板 / Home 列 / Fleet 焦点 / 消息卡 / 曾存在的 sticky          | 同一件事多种路径，无统一心智     |
| 功能堆叠 | Matter 概览塞 Ops+理论+队列+洞察；Agents = Fleet+协作台           | 页很满，但读不出「下一步做什么」 |
| 对话孤岛 | Chat 隐藏驾驶舱导航，侧栏又切另一套                               | 从「今日」进对话像换了个产品     |

**根因**：先实现能力，再贴 UI；缺少「壳层契约」——导航唯一、上下文连续、表面可切换。

---

## 1. 设计原则（硬约束）

来自 epic 视觉语言 + ui-design-brain，结合法律桌面场景：

1. **单一主导航** — 全应用只有一条 Primary Rail；顶栏不再做对等 Tab。
2. **案件即上下文** — 选中 Matter 后，对话 / 文书 / 材料 / 理论都在同一「案件室」内切模式，不跳失上下文。
3. **每区一个主 CTA** — 禁止同屏多个等权金色按钮。
4. **决策不丢页** — 「待我拍板」开右侧 Decision Drawer，不把用户踢去另一个全屏孤岛。
5. **深度工具可沉浸，但可回** — 文书台可全宽；左上保留「← 案件室」与 Matter 标题。
6. **克制装饰** — 暖灰画布 + 单一 brass 强调；无紫渐变、无贴纸徽章墙、无仪表盘卡片通胀。
7. **空态有行动** — 驾驶舱无数据时给「新建交办 / 打开对话 / 导入材料」，禁止空洞 KPI。

---

## 2. 三层信息架构

```
┌─ Layer A · App Shell（始终）─────────────────────────────┐
│  Primary Rail · Top chrome（搜索/外观/设置）· Decision badge │
├─ Layer B · Context Frame ────────────────────────────────┤
│  Global（无案件）  或  Matter Room（有案件：标题+保密+模式条） │
├─ Layer C · Surface（当前模式）───────────────────────────┤
│  desk | chat | matter-home | review | fleet | meeting | auto │
└──────────────────────────────────────────────────────────┘
```

### 2.1 Primary Rail（唯一一级导航，≤6）

| ID        | 标签   | 打开什么                              | 侧栏副内容                                    |
| --------- | ------ | ------------------------------------- | --------------------------------------------- |
| `desk`    | 今日   | 驾驶舱 Desk                           | 无（或最近案件短列表）                        |
| `chat`    | 对话   | 全局/当前案件对话                     | 会话列表 +（可选）材料树                      |
| `matters` | 案件   | 案件列表 → 进入案件室                 | 案件列表                                      |
| `review`  | 文书台 | 签批工作台                            | **保留窄轨**（返回+待审列表），不再整侧栏消失 |
| `fleet`   | 在办   | 专案组 / 交办 / 流程                  | 案件筛选                                      |
| `more`    | 更多   | 弹出：会议室 · 自动办件 · 知识 · 设置 | —                                             |

**删除**：Header 对等 Tab；条件出现的 `CockpitNav` 副本；「会议室·办件」隐藏菜单作为唯一入口。

### 2.2 Context Frame（案件室）

进入任一案件后，主区顶部出现 **Mode Strip**（不是第二套导航，是上下文内模式）：

`概览 · 对话 · 材料 · 文书 · 理论 · 会议`

- 概览：Ops KPI + 下一步 + RAID（密度受控，折叠次要块）
- 对话：绑定 `matterId` 的 chat surface
- 材料：文件树 / 档案（现 FileWorkbench + 案件档案合并语义）
- 文书：本案待审稿列表 → 点开进入 review surface（仍可全宽）
- 理论：Issue / Argument 面板（E3）
- 会议：本案会议室

**全局对话**（未选案件）= 「临时讨论」；发送时可选归因到案件。

### 2.3 Decision Drawer（待我拍板）

- 入口唯一：Rail 底部常驻按钮 + 顶栏角标（侧栏折叠时）
- 交互：右侧 Drawer（360–420px），列表 `awaiting_*` 卡
- 行为：批准/驳回/跳转案件室或文书台；**关闭后回到进入前的 Surface**
- Home「要我拍板」列改为 Desk 主列的摘要，点开仍进同一 Drawer（不复制第三套 UI）

---

## 3. 关键表面布局（目标态）

### 3.1 Desk · 今日（冷启动默认）

三列，但**信息权重不等**：

| 列       | 宽度 | 内容              | 主 CTA               |
| -------- | ---- | ----------------- | -------------------- |
| 要我拍板 | ~40% | 最多 5 张决策卡   | 「全部打开」→ Drawer |
| 今日关注 | ~30% | 期限 + 分诊待确认 | 「新建交办」         |
| 进行中   | ~30% | 专案组/任务进度条 | 「查看在办」         |

右下 **单一 FAB**：「打开对话」（brass）。

### 3.2 Chat · 对话

- Rail 仍在；副栏 = 会话列表（案件模式时顶部显示 Matter chip）
- 主列 = 消息 + 干净 compose（无 sticky 待审条、无恢复草稿横幅）
- 交办：compose 工具条「下达」→ Intake/Triage **全页或大模态**（保留绿黄红）
- 产出后：消息内 commitment 卡 + 「去文书台」链接；不在输入区上方再挂横条

### 3.3 Matter Room · 概览

- 顶：Matter 标题 · 保密 · Mode Strip
- 首屏只保留：**下一步一条** + KPI 一行（4 枚）+ 待审/待批摘要
- RAID / 计划 / 理论入口用「展开」或 Mode 切换，禁止首屏六宫格墙

### 3.4 Review · 文书台

- 顶条：Safety Score · 风险计数 · 必核进度（E2/E6）
- 三列：正文（红线）· 角色结论 Tab · 必核+谈判优先级
- 左窄轨：← 返回案件室 · 待审列表（解决「无侧栏失联」）

### 3.5 Fleet · 在办

- 顶：分段 `进行中 | 交出去的 | 按流程`
- 主 CTA：生成专案组 / 用审查专案组
- 与 Desk「进行中」数据同源，避免两套卡片组件

---

## 4. 切换逻辑（状态机）

```
cold start → desk
desk → chat | matters | review | fleet | decision-drawer
matters → pick matter → matter-room(mode=overview)
matter-room.mode ↔ overview|chat|files|review-list|theory|meeting
matter-room.review-list → open draft → review(immersive) → back → matter-room
decision-drawer → approve → stay | jump(review|matter-room) then close
more → meeting|automations|knowledge|settings  (settings 覆盖主区，Rail 保留)
```

**规则**：

- `mainView` 收敛为：`desk | chat | matters | review | fleet | meeting | automations`（去掉伪 `matterCockpitOpen`；案件室用 `activeMatterId + matterMode`）
- 路由深链：`?matter=&mode=` 可书签
- 经典布局偏好：仅把 cold start 从 `desk` 改为 `chat`，**不恢复双导航**

---

## 5. 视觉系统（在现有 tokens 上收紧）

保留 `tokens.css` brass 体系，增加架构级约束：

| Token 用途       | 规则                                                       |
| ---------------- | ---------------------------------------------------------- |
| Canvas `#f4f2ee` | 大面；Surface 白卡片仅用于**可操作实体**                   |
| Accent brass     | 仅：Primary Rail active、唯一主 CTA、关键进度              |
| 间距             | 8px 网格；Desk 列 gap ≥ 24px                               |
| 字阶             | 页标题 1 个；卡片标题 ≤ 正文 +2 级                         |
| 动效             | 模式切换 180ms ease-out；Drawer slide；尊重 reduced-motion |

反模式（禁止回归）：

- 顶栏 + 侧栏重复同一组目的地
- 对话区堆状态条（待审 / 草稿恢复 / 待你处理）
- 彩虹徽章墙、等权多按钮、卡片嵌卡片

---

## 6. 与现有功能的映射（不砍能力，改挂载点）

| 现有能力                               | V2 挂载                                           |
| -------------------------------------- | ------------------------------------------------- |
| HomeView KPI/列                        | Desk                                              |
| Chat shell / compose / intake          | Chat + Intake modal                               |
| MatterWorkbench tabs                   | Matter Room modes                                 |
| ReviewWorkbench + campaign + checklist | Review immersive                                  |
| AgentFleet + CollaborationDesk         | Fleet                                             |
| MeetingView                            | More → 会议；或 Matter mode=meeting               |
| AutomationsPanel                       | More → 自动办件                                   |
| 待我拍板 / needsDecisionFocus          | Decision Drawer（取代 agents 焦点整页切换为默认） |
| 知识 / memory settings                 | More → 知识                                       |
| Command palette ⌘K                     | 保留；命令与 Rail 同名                            |

---

## 7. 实施波次（建议）

### Wave 0 — 壳契约（3–5 日）

- 删除 Header 一级 Tab；CockpitNav 升级为**唯一** Primary Rail（含「对话」「更多」）
- 引入 `activeMatterId` + `matterMode`；废除 `matterCockpitOpen` 伪视图
- Review 恢复窄左轨；Decision Drawer MVP
- e2e：smoke / workspace-layout / golden-path 改选择器

### Wave 1 — Desk + Chat 美感（1 周）

- Desk 三列权重与空态 CTA
- Chat 去噪（已部分完成）；compose 工具条视觉收束
- Intake/Triage 作为大模态对齐 epic-triage-after

### Wave 2 — Matter Room + Review（1–2 周）

- Mode Strip；概览减脂
- Review 三列 + Score/必核（已有组件，重排）
- 理论作 mode，不塞概览

### Wave 3 — Fleet / Meeting / Auto 收敛（1 周）

- 数据同源卡片；More 菜单信息架构
- 文档：重写 `LAWMIND-DESKTOP-UI.md` §1.1

---

## 8. 验收（体验，非仅 testid）

1. 新人 30 秒内能说出「今日 / 对话 / 案件 / 文书台」各自干什么。
2. 从 Desk 处理 1 个待批 → Drawer 完成 → 仍停在 Desk。
3. 在案件室对话产出草稿 → Mode「文书」或「去文书台」→ 必核签批 → ← 回到同一案件。
4. 全应用找不到第二套重复主导航。
5. 截图对比 epic-shell-after：气质接近，但导航更干净（单轨 + 案件模式条）。

---

## 9. 决策区（已锁定 · 全 A）

| 项            | 锁定                                    |
| ------------- | --------------------------------------- |
| 冷启动        | Desk 今日                               |
| 待拍板        | Drawer                                  |
| 文书台侧栏    | 窄轨保留                                |
| 会议/自动办件 | 「更多」                                |
| 案件模式条    | 6 mode（概览/对话/材料/文书/理论/会议） |

Wave 0 起按本文改壳。
