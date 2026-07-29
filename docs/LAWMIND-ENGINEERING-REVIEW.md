# LawMind 全面工程评审（含 UI）

> **状态**：工程评审（含落地修复）· 2026-07-12 基线；**2026-07-28 晚间独立复评校正**（工程可合并 **≈8.7/10**，非自评 9.5）；冲刺见 [`LAWMIND-NEXT-EXECUTION-PLAN.md`](LAWMIND-NEXT-EXECUTION-PLAN.md) §「工程水位 → 可合并 9.0 + 产品信任」  
> **范围**：`src/lawmind/` + `apps/lawmind-desktop/`  
> **对照远景**：[`LAWMIND-OPTIMIZATION-BACKLOG.md`](LAWMIND-OPTIMIZATION-BACKLOG.md) §1（律师领导数字团队）  
> **可视化摘要**：可在 Cursor 中打开 Canvas [`lawmind-full-review.canvas.tsx`](/Users/shl/.cursor/projects/Users-shl-nvidia-LawMind-1/canvases/lawmind-full-review.canvas.tsx)  
> **持久全文**：本文

本文供后续 agent / 研发读取。

**2026-07-25 · 基线校正（独立复评）**：综合约 **7.9/10**；工程可合并约 **8.2–8.4/10**。此前附录「9.5」为乐观自评。  
**2026-07-26 · Track A A11**：DoD A1–A10 曾宣称 9.5，但后续独立复评指出文档超前、覆盖率零裕度、演示语料无结果级水印、权威 URL 无私网 SSRF deny 等 WARN → 工程水位回落到 **≈8.5**。  
**2026-07-28 · WARN 闭环（代码真实，分数偏乐观）**：DNS→私网 SSRF、演示语料结果级水印、高风险拒起草、验收包水印、`client_drift` 等已落地且有单测；当时文档写「工程 9.5」。  
**2026-07-28 晚 · 独立 adversarial 复评（本轮）**：抽检 authority/open-law **78** + demo/CAS/consistency **60** 单测绿；`pnpm --filter lawmind-desktop typecheck` 绿；**未**重跑全量 `pnpm test` / coverage ratchet / Playwright。工作树极大未整理。相对上轮独立 **≈8.5 eng / ≈8.1 product**：工程 **≈8.7**（信任闸门加厚），产品 **≈8.2**（仍无真源法库）。相对文档宣称 **9.5 eng：−0.8**（合并面/验证面未达「干净可合并 9.5」）。**禁止**无完整验证宣称 9.5。

**2026-07-29 · 全工程评审 + 合并门禁修复（全量复验轮）**：三路代码深查（引擎/桌面/横切面）+ 实跑全量验证。发现时工作树**门禁双红**：根 `pnpm typecheck` 3 错、`e2e:pr` 4 失败；另发现打包态硬缺陷（jobs SSE 无鉴权、改拟稿弹层被消息行 `content-visibility` 裁剪不可点）。**当日全部修复**：typecheck 双绿、`pnpm test` **394 文件/1656 用例**全绿、覆盖率 statements **48.86%**（超地板 +0.86pt）、`e2e:pr` **38 过 0 败**。工程可合并回升至 **≈8.7**（这次是带全量证据的 8.7，而非 07-28 未复验的 8.7）；产品信任仍 **≈8.2**（Track B）。详见文末「附录 · 2026-07-29」。

**现行计划入口**：[`LAWMIND-NEXT-EXECUTION-PLAN.md`](LAWMIND-NEXT-EXECUTION-PLAN.md) §「工程水位 → 可合并 9.0 + 产品信任」（2026-07-28）；外接权威语料为 Track B。

**2026-07-14 · P0/P1 落地摘要**：Canvas 中 P0/P1 产品断点（Agent Home / 在办、Header 入口、MainBody `agents` 分支、`styles/agent-fleet.css`、fleet route 单测 + `e2e/agent-fleet.spec.ts`）已接通。

---

## 0. 总评

| 综合（工程/评审） | 信任治理     | UI / IA      | 可维护性     |
| ----------------- | ------------ | ------------ | ------------ |
| **≈3.9 / 5**      | **4.4 / 5**  | **4.1 / 5**  | **3.8 / 5**  |

| 轴 | 分数 | 说明 |
| -- | ---- | ---- |
| **工程 / 评审可合并质量** | **≈8.9/10** | **2026-07-29（三/四）优化落地轮**：上轮「距 9.0」工程项（并发加锁/超时 AbortSignal/治理拆分/SSRF 连接层 pin/CI 清死路径/mock 契约/a11y/文案/信任默认/依赖升级/死导入）全部收敛 + 四门禁全绿；（四）轮补漏 matter/deliverable RMW 加锁、工具治理运行时对齐、AbortSignal 端到端传播、SSRF pin 扩面、文档分数矛盾；唯脏树 N-A0 未拆 PR 仍为主扣分。详见附录（三/四）。**非 9.5** |
| **综合（含产品信任）** | **≈8.4/10** | 工程 ≈8.9 × 产品信任 ≈8.5 的诚实加权 |
| **产品信任（含外接权威语料）** | **≈8.5/10（仍 &lt;9.0）** | N-A3/A4 收紧后信任天花板抬升；开源路径 fail-closed 诚实；**无**法宝/Lexis/完整 CORPUS 时不得宣称「已核实法条」；Track B 真源法库仍为最终上限 |

LawMind 在「可审计的法律生产系统」水位上扎实；**开源权威闸门已加厚**。**产品信任与工程分必须分开读**——Track B 外接语料仍 USER-blocked。残余：Markdown↔JSON 其余双写 FUTURE；Fleet/chat-shell 体积 INFO；DNS rebinding 连接层 pin INFO；工作树整理与全量回归为工程抬分主轴。

---

## 1. 分维评分

> **/10 轴（2026-07-28 晚独立复评）**见下表；**/5 轴**保留历史对照，略下调测试与可维护性。

| 维度（/10） | 评分 | 一句话 |
| ----------- | ---- | ------ |
| 引擎 / 架构 | **8.2** | stamp SSOT、orchestrator 续拆、`client_drift`；Markdown↔JSON 其余双写仍 FUTURE |
| 信任 / fail-closed | **8.8** | 缺源 + 演示水印 + 高风险 demo 拒起草；中风险仍可带水印出稿（有意） |
| Authority / open-law | **8.5** | sample/CORPUS/NPC/caseopen + SSRF hostname/DNS；无连接 pin；≠法宝 |
| 桌面 UI / IA | **8.3** | Solo IA + Doctor/Banner；chat-shell ~791、Fleet 家庭 ~2k INFO |
| 测试 / CI / 合并就绪 | **8.2** | 07-29 四轮全量绿（395/1674 + e2e:pr 38/2/0 + coverage 48.86）；compose-picker 漏鉴权 BLOCK 已修；vendor 脚本已补（上轮）；security-audit 已加门禁；脏树 206 仍为主扣分 |
| 文档诚实 | **8.0** | Track B 分离清楚；曾宣称 eng 9.5 偏高，本轮已校正 |
| 安全边界 | **8.6** | 桌面 loopback；权威 SSRF；caseopen 仅显式 loopback；rebinding INFO |
| **工程可合并（总）** | **≈8.9** | 四门禁全绿 + 上轮「距 9.0」工程项全部收敛；唯脏树 N-A0 未拆 PR 仍为主扣分。详见 §0 + 附录（三/四） |
| **产品信任（总）** | **≈8.5** | N-A3/A4 收紧后信任天花板抬升；Track B 真源法库仍为最终上限 |

| 维度（/5 · 历史） | 评分 | 一句话                                                      |
| ------------ | ---- | ----------------------------------------------------------- |
| 产品愿景对齐 | 4.3  | Solo 信任包装 + 领导位 IA 齐；团队进化仍可深化              |
| 引擎架构     | 4.2  | review stamp SSOT + transition 防终端戳回写；其余双写仍 FUTURE |
| 信任 / 治理  | 4.4  | 缺源 + 演示水印 + 高风险拒起草；SSRF DNS；外库未接（Track B） |
| 桌面 UI / UX | 4.1  | Doctor/ModelRetrieval 权威 live；演示语料 Banner |
| 设计系统     | 4.1  | tokens + `lm-*` 一致                                        |
| 可维护性     | 3.8  | 模块门禁过关；脏工作树 + Fleet/chat 家庭体积拖累可审 PR |
| 测试 / CI    | 3.8  | focused 绿；全量/coverage/e2e 本轮未复验；地板裕度薄 |
| 安全桌面壳   | 4.3  | loopback + SSRF hostname/DNS；rebinding 未 pin |

---

## 2. 优势（证据向）

1. **交付物本位**：`DeliverableSpec`、验收门禁、reasoning gate、golden journeys — 不是纯聊天产品。
2. **多 agent 协作实质存在**：`core/role.ts`、`delegate_task` / `consult_assistant` / `request_review`、workflow executor、delegation registry。
3. **学习飞轮已接线**：审核标签 → `lawyer-profile-learning` / `playbook-learning` / golden 晋升（见 `learning/apply-review-labels.ts`）。
4. **信任默认值**：tool-pipeline（审批、澄清、沙箱、审计）、dangerous-tool-policy、edition 严格模式。
5. **桌面交付表面成熟**：ReviewWorkbench、MatterWorkbench、澄清条、requires-action、场景空态、设计令牌与 `docs/LAWMIND-DESKTOP-UI.md`。
6. **Electron 安全意识强**：`127.0.0.1`、`contextIsolation`、preload 窄桥、路径穿越检查、Bearer（见 `SECURITY.md`）。
7. **质量栈完整**：Vitest 多层、release-readiness、Playwright PR 套件、nightly 严格 benchmark、platform contracts CI。

---

## 3. 短板与风险

### 3.1 产品 / UI（对远景最伤）

| 问题                          | 证据                                                                                                                                            | 影响                                |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| ~~指挥台 orphan~~ **已接通**  | Header「在办」tab（`LawmindAppHeader`）；MainBody `agents` → `AgentFleetView`；`styles/agent-fleet.css`；`e2e/agent-fleet.spec.ts` + route 单测 | 2026-07-12 落地；团队可见性仍待收敛 |
| ~~团队可见性分裂~~ **已收敛** | 在办常驻分区：待拍板 / 交出去的活 / 按流程办；设置「团队工作流」仅摘要入口                                                                      | 2026-07-23 落地                     |
| 案件舱发现性                  | 顶栏案件名可点进工作台；侧栏仍为主入口                                                                                                          | 已缓解                              |
| 标签漂移                      | Header「协作」vs desk「工作流」                                                                                                                 | 心智摩擦                            |
| 巨型 UI 模块（A10 已过关）    | Fleet 主面板 ~754（家庭合计 ~2k）；chat-shell ~791；Meeting ~364；`FileWorkbenchView` ~523；Electron `main.mjs` ~111（4 模块外提）              | chat-shell / Fleet 家庭仍 INFO      |

### 3.2 引擎 / 架构

| 问题                  | 证据                                                           | 严重度                    |
| --------------------- | -------------------------------------------------------------- | ------------------------- |
| Orchestrator 神模块   | ~~896~~ → ~601（`finalize` + `prompt` 已拆）+ 专用 prompt 单测 | Medium（续拆 tool-round） |
| 双真相源              | matter JSON vs Markdown；tasks/drafts vs deliverables          | High                      |
| 协作环依赖            | `message-bus` → `createLawMindAgent` ↔ `agent/index`           | High                      |
| 治理元数据手维护      | `governance.ts` 列表易与工具注册漂移                           | High                      |
| 双 adoption 路径      | `learning/suggestion-queue` vs `memory/adoption-service`       | Medium                    |
| 无 agent 特化指标     | backlog §1.3 A-4 未实现                                        | Medium                    |
| ~46% 模块无同目录测试 | 估算约 118/254                                                 | High                      |
| sync fs 热路径        | session / delegation / tasks                                   | Medium                    |

### 3.3 质量 / 文档漂移

- 覆盖率地板 **48.0%** statements（`coverage-baseline.json`；实测 **48.59%** statements / **39.45%** branches / **45.50%** functions / **48.75%** lines；裕度 **+0.59pt**；ratchet 绿）——**R-P2-2 ✅**。
- **审批 CAS**：`POST /api/approvals/resolve` 输家 **HTTP 409** + `approval_already_resolved`；真并发 worker 测——**R-P0-6 ✅**。
- **文档自评漂移**：2026-07-25 校正；2026-07-28 以本轮跑测证据重写 §0（不得无验证宣称 9.5）。
- Agent Fleet：route/e2e 有；Settings `LawmindSettingsModelRetrieval` 权威 live 组件测已对齐 Doctor——**R-P1-11 ✅**。
- `rewriteJsonl` temp+rename + spy 单测——**R-P1-9 ✅**。
- 双真相写路径：`reviewDraft` → `applyDeliverableReviewStamp` 先于 `persistDraft`；`transitionDeliverable` 不覆盖 approved/rejected 戳——**R-P2-7 ✅**（Markdown↔JSON 其余写路径仍 FUTURE）。
- 演示语料结果级水印：sample/demo CORPUS → `riskFlags` + `source.demo` / `claim.demo` + 对话 Banner——**2026-07-28 ✅**。
- 权威 URL SSRF：`denyReasonForAuthorityHostname` + **DNS→私网** `denyReasonForAuthorityHostnameResolved`（probe / generic / pkulaw / NPC fetch 前）——**2026-07-28 ✅**（连接层 pin / rebinding 时序仍 INFO）。
- 双真相守卫：`client_drift`（CASE ↔ matter.json.clientId）——**2026-07-28 续轮 ✅**（写路径仍 FUTURE）。
- 演示语料：高风险 `draft_document` / `execute_workflow` 拒起草；验收包导出水印——**2026-07-28 续轮 ✅**。

### 3.4 安全（非 blocker，需跟进）

- Dev：`sandbox: false`、CSP `unsafe-eval`。
- Fleet transcript：按 sessionId 返回消息切片，缺专用 scope 回归测。
- 权威 URL：hostname + DNS→私网已落地；DNS rebinding（解析后改指）未做连接层 pin。
- Security audit / CodeQL：非阻塞或仅手动。

---

## 4. UI 信息架构建议（目标态）

```
指挥层：指挥台（roster + jobs） + 待办中心（审批 / 澄清）
工作层：对话（澄清 / 委派） + 案件工作台 + 材料
交付层：审核台
```

今日缺口：**指挥层入口已接通**（在办 tab + 三分区）。路由 defaults / 内测指标 / 团队视图 e2e 已补；R-P0-3 orchestrator 续拆已落地。R-P1-6 Wave-1（FTS hybrid 个人知识）与 R-P2-2 覆盖率地板本轮已抬升；embedding / 专用知识库 UI 仍属 Wave-2。

设计系统：保持现有 brass / `lm-*`；`styles/agent-fleet.css` 已同步 `styles.css`；`LAWMIND-DESKTOP-UI.md` 仍可补在办说明。

无障碍：已有 skip-nav、aria-current、separator；Fleet 团队/队列 Tab 已补 `aria-controls` / `tabpanel`；加载态 `aria-busy`。

---

## 5. 优化建议 backlog（评审增量）

与 [`LAWMIND-OPTIMIZATION-BACKLOG.md`](LAWMIND-OPTIMIZATION-BACKLOG.md) 互补：那边偏产品远景；这边偏**工程债 + UI 接通**。冲突时以用户口述 §1 远景为准。

### P0

| ID     | 项                                        | 落点提示                                                                                |
| ------ | ----------------------------------------- | --------------------------------------------------------------------------------------- |
| R-P0-1 | **接通指挥台**                            | Header tab、MainBody `agents` 分支、spawn 接 shell、fleet CSS                           |
| R-P0-2 | **Fleet 质量门禁**                        | `lawmind-server-route-agent-fleet.test.ts`、`e2e/agent-fleet.spec.ts` 进 PR、smoke 深检 |
| R-P0-3 | ~~**拆分 turn-orchestrator**~~ **已续拆** | prompt / tool-round / finalizer / shortcuts / model-loop + 单测（主文件 ~368 行）       |
| R-P0-4 | ~~**权威检索 + 引用 UI**~~ **OSS open-law 已齐** | 默认 `provider=open`（sample/CORPUS）+拒答+缺源+Doctor live+probe；**闭源法宝/Lexis 凭证仍缺**（OPTIMIZATION P0-1 / Track B） |
| R-P0-5 | **治理漂移 CI**                           | 注册工具 ⊆ governance 元数据                                                            |
| R-P0-6 | **审批 CAS → HTTP 409 + 真并发测**        | `resolveApproval` 区分 winner/loser；route 409；Worker/`Promise` 真并发；禁伪串行「并发」 · **2026-07-26 ✅** |
| R-P0-7 | ~~**评分诚实 / 基线校正**~~ **文档已校正** | 本文件 §0；冲刺见 NEXT-EXECUTION-PLAN「工程水位 → 9.5」                                  |

### P1

| ID     | 项                                                                                                 |
| ------ | -------------------------------------------------------------------------------------------------- |
| R-P1-1 | 进化飞轮产品化 + 合并双 adoption                                                                   |
| R-P1-2 | ~~削减 MainBody props；拆 `lawmind-chat-shell`~~ **本轮落地**（toolbar + pick\* 分支；shell ~637） |
| R-P1-3 | `approval-queue` 进 PR E2E                                                                         |
| R-P1-4 | ~~matter-storage + 写侧服务单测~~ **已落地**（adapter + queue-write smoke；W3 matter-write 既有）  |
| R-P1-5 | 案件工作台 Header 入口 + 审查矩阵                                                                  |
| R-P1-6 | ~~个人知识库 hybrid 检索~~ **Wave-1 已落地**（FTS trigram + 加权；无 embedding）                   |
| R-P1-7 | 打断 message-bus 环依赖 + bus 单测                                                                 |
| R-P1-8 | ~~engine planning/drafting/researching 冒烟测~~ **已落地**                                         |
| R-P1-9 | ~~**atomic `rewriteJsonl`**~~ **已落地**（temp + rename；spy 证无就地半写） | 2026-07-26 |
| R-P1-10 | ~~**Meeting 续拆**~~ **已落地**（`MatterTeamMeetingPanel.tsx` ~364 ≤800） | 2026-07-26 |
| R-P1-11 | ~~**Settings ModelRetrieval 权威 live 组件测**~~ **已落地**（对齐 Doctor；含 probe 按钮 UI） | 2026-07-26 |

### P2

| ID     | 项                                                                     |
| ------ | ---------------------------------------------------------------------- |
| R-P2-1 | Agent 特化指标（首过率、改写率）                                       |
| R-P2-2 | 覆盖率地板（floor **48.0**；实测 statements **48.59%**，裕度 +0.59pt；**✅**）  |
| R-P2-3 | ~~文档同步：GOALS、USER-MANUAL、COLLABORATION-UI-API-MAP~~ **本轮落地一批** |
| R-P2-4 | ~~FileWorkbench 续拆~~ **View ~523 ≤700 ✅**（2026-07-26）         |
| R-P2-5 | sync→async I/O 或写队列；hash-chain 并发属性测                         |
| R-P2-6 | ~~**Electron `main.mjs` 拆分**~~ **~111 ≤1200 + 模块 ✅**（2026-07-26）        |
| R-P2-7 | ~~**双真相写路径收敛**~~ **review stamp SSOT ✅**（`deliverable-service` + `reviewing.ts` 先于 persist） |

---

## 6. 建议落地顺序（若开工）

> **现行冲刺**（工程 → 9.5）：以 [`LAWMIND-NEXT-EXECUTION-PLAN.md`](LAWMIND-NEXT-EXECUTION-PLAN.md) Phase 0–3 为准，勿再按下列历史 T0–T4 开新平行线。

历史顺序（多数已落地，仅供对照）：

1. **T0**：R-P0-1 + R-P0-2（指挥台可点、可测）— 立刻服务远景叙事
2. **T1**：R-P0-4（研究员可信 · 仓库内契约）
3. **T2**：R-P0-3 + R-P0-5（可安全改 agent）
4. **T3**：R-P1-\*（进化、IA、知识库、写路径测试）
5. **T4**：R-P2-\*

---

## 7. 维护

- 实现某项后：在本节勾选或移入附录「已落地」。
- 与 OPTIMIZATION-BACKLOG 重复项：保留两边交叉链接，避免双源细节分叉。
- 下次全量评审：更新评分表与证据日期。

### 附录 · 已落地

| 项                                                   | 日期       | 说明                                                                                                                                                                                                  |
| ---------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R-P0-1 接通指挥台                                    | 2026-07-12 | Header「指挥台」+ MainBody agents + CSS + spawn preset                                                                                                                                                |
| R-P0-2 Fleet 测试门禁                                | 2026-07-12 | route 单测、e2e/agent-fleet、HTTP smoke deep、approval-queue 进 PR                                                                                                                                    |
| R-P0-4 检索拒答 + 未锚定引用                         | 2026-07-12 | search_statute refusalRequired；citation unanchored banner                                                                                                                                            |
| R-P0-5 治理漂移                                      | 2026-07-12 | governance-drift.test.ts                                                                                                                                                                              |
| R-P1-1 进化/双队列                                   | 2026-07-12 | adopt 同步 adoption-service；特化指标 agent-specialization                                                                                                                                            |
| 团队成长 Wave A                                      | 2026-07-21 | 签批 product-metrics；modified→pending adoption；growth API；设置岗位表                                                                                                                               |
| 团队成长 Wave B                                      | 2026-07-21 | routing defaults；forcePeerReview；contract-review 多步种子；岗位页互审开关                                                                                                                           |
| 团队成长 Wave C                                      | 2026-07-22 | 在办团队聚合视图；待教深链；修订完成/合同修订包→adoption                                                                                                                                              |
| 团队成长 Wave D                                      | 2026-07-22 | 专案组绑助手；team-roster；本案团队条；协作完成角标；T1.4 改写幅度                                                                                                                                    |
| 内测指标表                                           | 2026-07-22 | `team-growth-dashboard` + `/api/metrics/team-growth` + Doctor 基线                                                                                                                                    |
| 合同修订积累信任                                     | 2026-07-23 | 审核通过路径禁静默 profile；keyMods → pending；内测指标 e2e/mock                                                                                                                                      |
| 团队可见性收敛                                       | 2026-07-23 | 在办常驻「待拍板 / 交出去的活 / 按流程办」；设置协作入口改待拍板                                                                                                                                      |
| R-P0-3 orchestrator 续拆                             | 2026-07-23 | shortcuts（intake/auto-wf）+ model-loop；主文件 ~368 行                                                                                                                                               |
| 路由 defaults 设置 UI                                | 2026-07-23 | Roles 页编辑 byKind/byDeliverable + 保存；token/`--lm-fg`；在办团队 e2e                                                                                                                               |
| 审查加固（Wave D 后）                                | 2026-07-22 | distill 禁静默写 session-summary；在办深链勿误选/尊重 matter 筛选；待拍板默认选首项                                                                                                                   |
| 记忆采纳落盘                                         | 2026-07-22 | `adoption-apply.ts`：Inspector adopt 写 session-summary / CASE / profile                                                                                                                              |
| 模型能力包络（E1/A2/C2/A11）                         | 2026-07-23 | `capability-envelope`；maxTokens/预算跟 catalog；澄清放行 research；ContextPlan 接线；见 `LAWMIND-MODEL-CAPABILITY-REVIEW.md` §8                                                                      |
| 模型能力 PR3（A1/A7/F1）                             | 2026-07-23 | compact 丢弃段提取式蒸馏回灌 + `compact-digest.md`；小文本文件引用自动嵌入正文                                                                                                                        |
| 模型能力续（C10/A4/会议室）                          | 2026-07-23 | analyze/read_project 分页；召回 8×4k；会议室 agenda 嵌小文本                                                                                                                                          |
| 模型能力续 2（C7/D7/D4）                             | 2026-07-23 | 未知工具参剥离；Solo 审查并行；citation 仅挡导出文案                                                                                                                                                  |
| 模型能力续 3（D5/E5）                                | 2026-07-23 | 模型调用 AbortSignal；检索 JSON 失败 markdown 降级                                                                                                                                                    |
| R-P1-3 批准队列 E2E                                  | 2026-07-12 | approval-queue.spec 纳入 e2e:pr                                                                                                                                                                       |
| R-P1-5 案件工作台入口                                | 2026-07-12 | Header「案件工作台」按钮                                                                                                                                                                              |
| R-P1-7 message-bus 环依赖                            | 2026-07-12 | agent-factory.ts                                                                                                                                                                                      |
| Action Hub 队列页                                    | 2026-07-12 | 嵌入 LawmindApprovalQueue                                                                                                                                                                             |
| R-P1-8 engine smoke（planning/drafting/researching） | 2026-07-20 | `planning.test.ts` + 新增 `drafting.test.ts` / `researching.test.ts`                                                                                                                                  |
| Fleet 详情 tabs a11y                                 | 2026-07-20 | `aria-controls` / `tabpanel` / `aria-busy`（`LawmindAgentFleetPanel`）                                                                                                                                |
| 文书台 popout 同步                                   | 2026-07-20 | `sync-request` + live 优先于 saved poll（`lawmind-popout-route`）                                                                                                                                     |
| 临时讨论 workspace 存储                              | 2026-07-20 | `meetings/adhoc/` + 遗留迁移；MeetingView 不再 create matter                                                                                                                                          |
| R-P1-2 消息列拆分                                    | 2026-07-20 | `lawmind-chat-messages-column.tsx`（chat-shell ~1092→~830）                                                                                                                                           |
| R-P1-2 compose chrome                                | 2026-07-20 | `lawmind-chat-compose-chrome.tsx`（shell ~830→~768）                                                                                                                                                  |
| 会议室议程材料                                       | 2026-07-20 | `buildMeetingAgenda` + pins → `meetingAgenda`                                                                                                                                                         |
| R-P1-4 matter-storage 适配器冒烟                     | 2026-07-20 | `adapters/matter-storage/index.test.ts`（服务层已有 W3）                                                                                                                                              |
| R-P1-2 toolbar + MainBody pick\*                     | 2026-07-20 | compose-toolbar；`pickMainBodyBranchProps`；MainBody ~196 行                                                                                                                                          |
| 会议室材料选择器                                     | 2026-07-20 | `添加材料` + ComposeContextPicker 搜索；pins 双向增删                                                                                                                                                 |
| R-P1-4 queue-write smoke                             | 2026-07-20 | `queue-write-service.test.ts`                                                                                                                                                                         |
| R-P2-4 FileWorkbench dialogs                         | 2026-07-20 | `FileWorkbenchDialogs.tsx`（View ~1183→~1052）                                                                                                                                                        |
| 侧栏空态文案                                         | 2026-07-20 | 无材料树时不再引导右键「案件材料」                                                                                                                                                                    |
| 会议室材料 picker 仅文件                             | 2026-07-20 | `categories: ["files"]`；compose-context 单测                                                                                                                                                         |
| MainBody pick\* 单测                                 | 2026-07-20 | `pickMainBodyBranchProps.test.ts`                                                                                                                                                                     |
| memory case-workspace 下沉                           | 2026-07-20 | 打破 `index` ↔ `case-writes` 环（FUTURE §6）                                                                                                                                                          |
| 无 FS 建案 CTA                                       | 2026-07-20 | 侧栏「新建」+ 空态按钮；对话空态按 apiBase 解耦                                                                                                                                                       |
| Automations 空案件文案                               | 2026-07-20 | 不再写「侧栏新建案件」死路径                                                                                                                                                                          |
| R-P2-4 context menu                                  | 2026-07-20 | `FileWorkbenchContextMenu.tsx`（View ~1052→~856）+ a11y menu roles                                                                                                                                    |
| FileWorkbench / pickWorkspace 缝测                   | 2026-07-20 | Dialogs + ContextMenu + `pickWorkspaceMainPaneProps` 单测                                                                                                                                             |
| 权威外库 API                                         | —          | 仍依赖外接；本机启发式拒答已落地                                                                                                                                                                      |
| UI 半暴露接线（专案组/compact/DEFERRED）             | 2026-07-21 | playbook/cancel/parallel；compose compact；记忆 suggest / finalize / desk-settings / profile-sections / triage rules / quality JSON；见 `LAWMIND-DEFERRED.md`。Solo「驾驶舱」首页已移除（默认对话）。 |
| 文书台 / 在办职责拆分                                | 2026-07-21 | 文书台 writing 条去掉通过·驳回·需修改；在办待审文书可直接批复；「回到在办签批」；高级区兜底签批                                                                                                       |
| 改拟稿收窄（避与文书台重合）                         | 2026-07-21 | `content` 文书写入不再弹窗改全文；「改参数」+ 引导文书台；短字段/邮件 body 仍可改                                                                                                                     |
| 澄清 P0–P2（在办表 / 弱引导 / 材料）                 | 2026-07-21 | 在办表格提交 resume；对话 hint/compact；file 路径编码；inputType 控件                                                                                                                                 |
| 对话 Cursor 式控制                                   | 2026-07-21 | 气泡修改/删除（delete_pair）；Stop→abort API；Compose「沉淀学习」compact+distill→adoption                                                                                                             |
| 在办 IA：拍板台左栏                                  | 2026-07-21 | 隐藏案件侧栏；队列分组+案件筛选为页内左栏（对齐律师「待我拍板」任务）                                                                                                                                 |
| 会议室 IA：场次左栏                                  | 2026-07-21 | 临时讨论/案件会议分组为页内左栏（`meeting-workbench.css`）                                                                                                                                            |
| 会议室 ↔ 对话同构左栏 + 打断                         | 2026-07-23 | 共用全局材料树/会话；终止发言 abort；live sticky runbar；仅材料可开场；记录区加高                                                                                                                     |
| 会议室材料栏 + 设置精简                              | 2026-07-21 | （已演进）页内材料 portal 取消；改拖全局左栏进议题                                                                                                                                                    |
| Review hardening（mutate/abort/distill）             | 2026-07-21 | 删末条助手清 pending；SSE close 不再误 abort 下一轮；auto-wf 前/后查 abort；文书 write 需 path；distill 去重+仅 dropped；mutate 409；lease_term textarea；e2e mock stub                               |
| R-P2-2 覆盖率地板                                    | 2026-07-23 | platform/fleet/schema 补测；`coverage-baseline.json` statements 42.53→~44.3                                                                                                                           |
| R-P1-6 个人知识库 Wave-1                             | 2026-07-23 | `knowledge_fts`（trigram）+ `searchPersonalKnowledge`；接线 tool/recall/HTTP；假命中与 Recall@K 验收测                                                                                                |
| 9/10 产品冲刺（Solo 信任 + IA + 门禁 + e2e）         | 2026-07-24 | Solo `auditIntegrityExport`/`acceptancePackExport`；首跑后执行默认严格审批 + Doctor 审计摘要；文书台 peer tab 文档对齐；出稿检查移出高级并自动展开；缺源 Banner 强化；`review-entry`/`skills-trust` 进 `e2e:pr`；综合 ≈4.5/5 |
| 9.5 工程冲刺（双写 / Fleet seam / 对话缺源 / 覆盖率） | 2026-07-24 | `sensitivity_drift` + repair 回归；`lawmind-fleet-queue` 抽出；`authorityGap` SSE→对话 Banner；approval/deliverable 写侧测；覆盖率地板 statements 44.87% |
| 9.5 冲刺续（单源缺源 / Fleet 拆分 / 审批 CAS / IA） | 2026-07-24 | 移除死字段 `lawyerBanner`；`noticeFromToolAuthorityGap`→`formatAuthorityGapLawyerNotice`；Doctor/首跑/设置权威边界；Fleet ListAside+Detail+PostApprove+ceremony actions + tab a11y；`resolveApproval` 锁+CAS（**HTTP 409 未齐**）；deliverable_draft_missing；IA 文档对齐；当时自评 ≈8.9 仍偏乐观 |
| 权威契约 / Fleet≤800 / 审核态漂移（**勿称已达 9.5**） | 2026-07-24 | `authority-health` 校验+probe+Doctor/设置 live；适配器 invalid fail-closed；Fleet actions/Empty（主面板后降至 ~754）；Meeting session-storage+MaterialsSection（~1182）；`deliverable_review_drift`。**独立复评未认可 9.5** |
| R-P0-7 评分基线校正 | 2026-07-25 | §0 改为独立复评 ≈7.9 综合 / ≈8.2–8.4 工程可合并；冲刺计划写入 NEXT-EXECUTION-PLAN「工程水位 → 9.5」 |

### Track A DoD 证据表（A11 独立复评 **2026-07-26**）

| # | 项 | 状态 | 证据 |
| - | -- | ---- | ---- |
| A1 | 审批 resolve 输家 HTTP 409 | ✅ | `lawmind-server-route-action-summary.ts:240` + route 测 L185–234 |
| A2 | `resolveApproval` winner/loser 语义 | ✅ | `approval-service.ts` `already_resolved` / `written` |
| A3 | 真并发 resolve 测 | ✅ | `approval-service.test.ts` child-process `Promise.all` L138–176 |
| A4 | 文档分数诚实 | ✅ | R-P0-7 基线校正；A11 后 §0 同步上调 |
| A5 | `rewriteJsonl` atomic | ✅ | `io.ts` temp+rename L73–75 + `index.test.ts` spy |
| A6 | Meeting ≤800 | ✅ | `wc -l` → **364** 行 |
| A7 | ModelRetrieval 权威组件测 | ✅ | unset/invalid/configured 三态 |
| A8 | 覆盖率 ≥48.0 + 裕度 | ✅ | 实测 **48.59%** statements；floor 48.0；裕度 +0.59pt；ratchet 绿 |
| A9 | 双真相写路径收敛（一条+） | ✅ | review stamp SSOT + `transitionDeliverable` 防终端戳回写 |
| A10 | 神模块门禁 | ✅ | main **111** 行 + 4 模块；FileWorkbench **523** 行 |
| A11 | 独立复评 ≥9.5 | ◐ | **2026-07-28 晚校正**：Track A 代码 DoD 仍绿；**工程分数校正为 ≈8.7**（勿再写 9.5 直至合并面+全量证据）；产品信任仍 Track B |

**A11 / 2026-07-28 晚 · 独立 adversarial 复评摘要**

| 结论 | 详情 |
| ---- | ---- |
| 工程可合并 | **≈8.7/10**（非 9.5）— WARN 代码闭环成立；扣分：脏工作树、本轮未复验全量/coverage/e2e、双写残余、rebinding |
| 产品信任 | **≈8.2/10** — 演示水印/高风险拒起草诚实；无真源法库不得抬到 9.0+ |
| BLOCK | 无（就代码安全闸门而言） |
| WARN | 巨型未整理工作树拖累合并就绪；coverage 地板裕度薄且本轮未复测；中风险仍可 demo 出稿；DNS rebinding 未 pin |
| INFO | Fleet/chat-shell 体积；VITEST 默认 DNS stub（单测可 inject）；commercial-bff 仅骨架 |
| Track B（USER） | 法宝/Lexis Token、C0 合同、完整 CORPUS、caseopen 自建盘 — 见 [`LAWMIND-EXTERNAL-INTEGRATIONS.md`](LAWMIND-EXTERNAL-INTEGRATIONS.md) |
| 验证（本轮实跑） | `vitest` authority/open-law **78** + demo/CAS/consistency **60**；desktop **typecheck**；**未**跑 `pnpm test` / coverage / e2e |

### 附录 · 2026-07-28 晚 findings（路径相对仓库根）

| 级 | 项 | 路径 / 证据 |
| -- | -- | ---------- |
| WARN | 工作树极大、未成可审 PR 面 | `git status`：大量 M/??（engine + desktop + docs + bff stub） |
| WARN | 「工程 9.5」文档超前 | 本文件旧 §0；已校正；冲刺见 NEXT-EXECUTION-PLAN 新节 |
| WARN | 覆盖率地板薄 + 本轮未复验 | `scripts/pre-commit/coverage-baseline.json` statements **48.0** / tolerance **0.5** |
| WARN | 中风险 demo 仍可起草 | `src/lawmind/agent/tools/engine/engine-tool-shared.ts` `shouldRefuseDraftOnDemoCorpus` 仅 `high` |
| WARN | 外部 CORPUS 未标 demo 即当「非演示」 | `src/lawmind/retrieval/providers/open-law/local-corpus.ts`；许可 USER 自认 |
| INFO | DNS rebinding / 连接 pin 未做 | `src/lawmind/retrieval/authority-url-guard.ts` |
| INFO | caseopen 显式允许 loopback | `src/lawmind/retrieval/providers/open-law/live-endpoint.ts`（有意；LAN 仍拒） |
| INFO | 其余 Markdown↔JSON 双写 | FUTURE；`client_drift` 已检 |
| INFO | commercial BFF 骨架 | `apps/lawmind-commercial-bff/` stub 501 |

| 项 | 日期 | 说明 |
| -- | ---- | ---- |
| R-P0-6 审批 CAS 409 + 真并发 | 2026-07-26 | `approval-service` `already_resolved`；route `approval_already_resolved` HTTP 409；child-process `Promise.all` 竞争测 |
| R-P1-9 atomic rewriteJsonl | 2026-07-26 | `io.ts` temp+rename；`index.test.ts` spy 证 tmp 路径 + rename |
| R-P1-10 Meeting ≤800 | 2026-07-26 | `MatterTeamMeetingPanel.tsx` ~364；Materials/Setup/Thread 外提 |
| R-P1-11 ModelRetrieval 权威测 | 2026-07-26 | `LawmindSettingsModelRetrieval.test.tsx` unset/invalid/configured；probe 按钮 `POST /api/authority/probe` |
| R-P2-4 FileWorkbench View ≤700 | 2026-07-26 | `FileWorkbenchView.tsx` ~523；Tree/EditorPane 外提 |
| R-P2-6 Electron main 模块化 | 2026-07-26 | `main.mjs` ~111；`ipc-handlers` / `local-server` / `fs-bridge` / `app-menu` |
| R-P2-7 review stamp SSOT | 2026-07-26 | `applyDeliverableReviewStamp` 权威；`reviewDraft` 先 stamp 再 `persistDraft`；`deliverable-service.test.ts` + `reviewing.test.ts` 无 drift |
| R-P2-2 覆盖率 ≥48.0（A8） | 2026-07-26 | 补测 search-tools / automations / matters / collaboration / ingest-helpers / reviewing 等；`coverage-baseline.json` statements 44.87→**48.0**；实测 **48.00%** |
| Track B Bearer 鉴权 | 2026-07-26 | `LAWMIND_AUTHORITY_API_KEY` → retrieve/probe `Authorization: Bearer`；Doctor/设置显示「已设鉴权」；密钥不进 health |
| linkDraft stampLocked | 2026-07-26 | `linkDraftToDeliverable` 不再用 draft.pending 覆盖 deliverable 审核戳 |
| open-law honesty + Lexis status | 2026-07-28 | Lexis → `unimplemented`（Doctor warn，非端点 invalid）；CORPUS 格式/许可 README；sample 增 regulation；FirstRun/Doctor sample≠完整法库 |
| 8.5→9.5 WARN 闭环 | 2026-07-28 | 覆盖率 +0.59pt 裕度；sample/demo CORPUS 结果级「演示语料」水印（riskFlag/source/claim + 对话 Banner）；权威 URL 私网/link-local/metadata deny；`transitionDeliverable` 保终端审核戳；`canDraftWithoutResearch` 含 analyze.contract 消并行 flake；e2e mock 对齐 RequiresActionCard |
| 续轮：SSRF DNS + 开源信任闸门 | 2026-07-28 | `denyReasonForAuthorityHostnameResolved` + fetch 前 assert；CGNAT/IPv4-mapped；`client_drift`；高风险 demo 拒起草；验收包演示水印；Doctor CORPUS 许可口径；分数以 2026-07-28 晚校正（≈8.7）为准，产品信任仍 Track B |

### 附录 · 2026-07-29（全工程评审 + 门禁修复）

**方法**：文档基线对照 + 三路并行代码深查（引擎 / 桌面 / 横切面）+ 本机实跑全量验证（非文档转述）。

| 级 | 发现 | 处置 |
| -- | ---- | ---- |
| BLOCK | 根 `pnpm typecheck` 3 错（`turn-orchestrator-prompt.ts:201` 字面量 `8000`、`tool-round.ts:204` `unknown`→`ToolCallResult`、`multitask-observability.ts:95` 残留 `createdAt`）→ `lawmind:verify` 红 | ✅ 已修（参数标 `number`、函数加 ToolCallResult 重载、改用 `timestamp`），typecheck 双绿 |
| BLOCK | `e2e:pr` 4 失败：权限模式 aria-label 子串碰撞（`lawmind-chat-compose-toolbar.tsx:119/195`）；「暂不执行」已改名「暂不办理」（`LawmindRequiresActionCard.tsx:118`）但 spec/helpers 未同步；`dialogs:9` 测试的 FS 材料树路径在浏览器 mock 模式本就不渲染（自 692bc4b9f 改写起从未在该模式通过）；`golden-path:65` | ✅ 已修（locator exact、文案同步、dialogs 改写为浏览器支持的侧栏弹窗路径、弹层 portal） |
| BLOCK（真产品 bug） | 「改拟稿」弹层在消息行内渲染，行 `contentVisibility:auto`（`LawmindChatMessageRow.tsx:161`）使 `position:fixed` 背景板被裁剪在行盒内 → 弹层不可见且按钮不可点 | ✅ 已修：`LawmindToolArgsEditDialog` 改 `createPortal(document.body)`（对齐 `LawmindCreateMatterDialog` 先例），组件测同步 |
| BLOCK（打包态） | jobs SSE 用裸 `EventSource` 无法带 Bearer → 鉴权开启时 live 刷新静默失效（`MatterWorkbenchImpl`、`LawmindTaskDrawer`、`useLawmindCollabWorkflowJobs` 共 4 处） | ✅ 已修：新增共享 `lawmind-job-stream.ts`（fetch+Bearer 解析 SSE），4 处全部接入 |
| BLOCK（打包态） | 裸 `fetch` 漏 `Authorization` → 401：`MemoryInspector` 4 处、job cancel、`lawmind-plan-handoff` 3 处、`useReviewWorkbenchActions` 验收包下载、`lawmind-triage-api` 3 处、`useLawmindBackgroundWatch` 4 处、`lawmind-file-chat-context` | ✅ 已修：统一补 `apiAuthHeaders()`；其余 fetch 点全量复核已带头 |
| WARN | `workspace/.gitignore` 未忽略 `/matters/`（运行期律师 JSON 真相源可误提交） | ✅ 已修：忽略 `/matters/*`、白名单 `smoke-verify-matter`；`git check-ignore` 验证 |
| WARN | governance 元数据漂移：死名 `list_all_drafts`/`register_uploaded_template`；`update_draft` 被标 `readonly`；「需审批」≠ pipeline 强制；`list_templates` 可写却标并发安全 | 记 P1（治理语义诚实化：拆 `stateChanging` vs `approvalEnforced` + 集合单测） |
| WARN | 并发/取消：tool timeout 不取消底层 Promise（`tool-pipeline.ts:321-334`）；`queue.jsonl` 无锁全量重写；`suggestion-queue`/`adoption-service` 非原子写 | 记 P1 |
| WARN | CI/工具链：labeler 指 OpenClaw 路径；CodeQL 仅手动+blacksmith；`pnpm/action-setup@v6` 与 `@v4` 混用；CI release-readiness 无 benchmark 仍绿；`lawmind:vendor:desktop-node` 指向缺失脚本；`pnpm audit` 6 critical/56 high | 记 P2 |
| WARN | 巨型模块 15 个 >600 行（`mock-api.mjs` 1279、`route-matters.ts` 1078、`SettingsDoctor.tsx` 1081、`ipc-handlers.mjs` 917…）；mock 缺 jobs/approvals/resolve/Bearer/SSE | 记 P1/P2（拆分 + mock 契约门禁） |
| INFO | `.signing-secret` 实为**演示专用**值（env → 文件 → 工作区哈希的回退链，production 应设 `LAWMIND_SKILL_SIGNING_SECRET`）；撤掉会改演示签名，本轮不动，补部署文档口径即可 | 记 P2（文档） |
| INFO | `index.test.ts recordQuality` 全量并行时一次性 flake（单独/复跑均绿） | 观察；若再现给 tmpdir 隔离 |
| INFO | a11y：Matter/Review tabs 缺 `aria-controls`↔`tabpanel`；chat loading 无 `aria-busy`；DNS rebinding 未 pin；其余 Markdown↔JSON 双写 FUTURE | 维持既有残项 |

**本轮实跑证据**：根 + 桌面 typecheck 双绿；`pnpm test` 394 文件 / 1656 用例全绿；`pnpm test:coverage` statements **48.86%** / branches 39.71 / functions 45.83 / lines 49.01（地板 48.0/38.57/44.89/48.16）；`pnpm lawmind:desktop:e2e:pr` **38 过 / 2 跳过 / 0 失败**。

**评分（本轮，带全量证据）**：工程可合并 **≈8.7/10**（07-28 的 8.7 未复验全量，本轮复验并修复后重估同分，证据更硬）；产品信任 **≈8.2/10**（Track B 不变）。距 9.0：合并面整理（160 脏文件按主题拆 PR）+ governance 语义诚实化 + CI 清理。

### 附录 · 2026-07-29（二）· 独立复评第二轮（adversarial）

> **方法**：不沿用上轮结论，全部从代码重验。本机复跑四门禁 + 三路并行代码深查（引擎 [engine](246e1c4f-0a47-4e9b-8ff3-68ea885c5e15) / 桌面 [desktop](887873dc-dc78-41a3-86b4-166a973e067d) / 横切面 [cross-cutting](3875e7cf-c761-4fef-a63f-938092fccfcb)）+ 人工对上轮已修项回归抽检。**结论：上轮「全部裸 fetch 已补鉴权」不准确——漏掉 compose-picker 两处。**

**四门禁本机复跑（全绿）**：根 typecheck ✅ / 桌面 typecheck ✅ / `pnpm test` 394 文件 1656 用例 ✅ / `pnpm lawmind:desktop:e2e:pr` 38 过 2 跳 0 败 ✅。

| 级 | 发现 | 处置 |
| -- | ---- | ---- |
| BLOCK（产品，**上轮漏报**） | `LawmindComposeContextPicker.tsx:128-130 / 169-171` 两处 `fetch('/api/fs/tree')` 无 `apiAuthHeaders()` → 打包态 Bearer 强制时 401，材料/工作区文件匹配静默失效。上轮宣称「全部裸 fetch 已补头」漏掉此处（正则过紧 + mock 无 Bearer + Vite dev 无 token 三重盲区） | ✅ 本轮已修：补 `import { apiAuthHeaders }` + 两处加 `{ headers: apiAuthHeaders() }`；桌面 typecheck 绿 |
| BLOCK（发布链，上轮仅记 P2 WARN） | `package.json:56` `lawmind:vendor:desktop-node` → `scripts/vendor-lawmind-desktop-node.mjs` **文件缺失**；`apps/lawmind-desktop/package.json:15` `dist:electron = bundle:server && vendor:node && build:renderer && electron-builder`；`lawmind-desktop-build.yml:49` 打 tag 即跑 → **桌面发布必崩于 `vendor:node`**。不挡 PR 门禁（CI 不跑 dist），但挡 shippable | ⛔ 未修：需真实 vendoring 脚本（复制 node 二进制进 electron 资源），非两行可补；记 BLOCK 发布轴，待实现 |
| WARN | 引擎并发：queue/deadline/adoption/suggestion 的 JSONL **读-改-写无锁**（单次 `rewriteJsonl` 原子，但并发 RMW 后写覆盖前写丢更新）；唯独 `resolveApproval` 用 `withExclusiveFileLock`。`attachQueueItemId`/`attachDeliverableId` 对 `matter.json` 同型竞态 | 记 P1（写侧加文件锁 / CAS，对齐 approval） |
| WARN | `list_templates` 经 `set_enabled_for_id`/`enabled` **改模板启用态**，但 `resolveRuntimeMode` 归 `readonly` → 无需审批；治理/Inspector 误判只读幂等 | 记 P1（governance 语义诚实化：拆 `stateChanging` vs `approvalEnforced`） |
| WARN | `tool-pipeline.ts:321` `withTimeout` 用 `Promise.race` 不传 `AbortSignal` → 超时后底层工具 Promise 仍跑（拟稿/写盘可能超时后才落） | 记 P1 |
| WARN | 信任默认偏松：`shouldRefuseDraftOnDemoCorpus` 仅拒 `high`（N-A3）；`local-corpus.ts` `isCorpusEnvMarkedDemo` 默认 `false` → 未标 demo 的外部 CORPUS 当非演示，高风险可自动起草（N-A4） | 记 P1（产品确认后收紧或强制二次确认） |
| WARN | 权威 SSRF DNS rebinding TOCTOU：`denyReasonForAuthorityHostnameResolved` 在 fetch 前校验，但 `fetch` 重新解析（连接层无 pin） | 记 P2 |
| WARN | governance 静态集合死名 `list_all_drafts`/`register_uploaded_template`（实际注册为 `list_drafts`/`register_template`）；`list_drafts` 漏入幂等集合 | 记 P2 |
| WARN | CI：PR release-readiness 无 `LAWMIND_BENCHMARK_STRICT` 仍绿；`pnpm/action-setup` v4/v6 混用；`.github/labeler.yml`+`dependabot.yml` 残留 OpenClaw 路径（extensions/macos/android）；security audit `continue-on-error` 不挡合并 | 记 P2 |
| WARN | `pnpm audit` 5 critical / 50 high（`@vitest/browser@4.1.0` 经 coverage-v8；`shell-quote` 经 concurrently） | 记 P2（升级 vitest ≥4.1.8） |
| WARN | 覆盖率 ratchet 仅在 CI，不在 pre-commit hook（`git-hooks/pre-commit` 只跑 oxlint/oxfmt）→ 本地 `--no-verify` 可绕 | 记 P2 |
| WARN | `SECURITY.md` 未记 Electron 加固（sandbox/contextIsolation/CSP），实现已到位但文档缺 | 记 P2（文档） |
| WARN | E2E mock-api 无 Bearer 校验、缺 `/api/jobs`/SSE/`workflow-run`/`fs/tree` 路由 → 鉴权与 job 流回归在 Playwright 不可见（本轮 compose-picker BLOCK 即因此漏网） | 记 P1（mock 契约门禁） |
| WARN | a11y：Matter/Review/desk-nav/session/task-drawer tabs 多处缺 `role=tab`+`aria-selected`+`aria-controls`↔`tabpanel`；`aria-busy` 稀疏 | 记 P2 |
| WARN | 文案：侧栏「协作完成」vs desk「工作流」标签漂移；设置页「Prompt tokens/Completion tokens」工程师行话面向律师 | 记 P2 |
| WARN | 文档分数漂移：`LAWMIND-EXTERNAL-INTEGRATIONS.md:223,280` 与 `GOALS.md:362` 仍写「工程 9.5」；本文件 §1 表 line 50 旧写「全量未复验」与本文件 line 16 自相矛盾 → **本轮已修 line 50** | ⛔ `EXTERNAL-INTEGRATIONS`/`GOALS` 9.5 残句未修（待统一） |
| WARN | 脏树 **178 文件**（62 未跟踪，含整子系统：`ipc-handlers.mjs`/`commercial-bff/`/open-law 模块）→ 合并面 N-A0 主扣分 | 记 P0（按主题拆 PR） |
| INFO | 巨型模块 15 个 >600 行（`SettingsDoctor.tsx` 1081、`route-matters.ts` 1078、`useMatterProductIntelligence.ts` 932、`route-review.ts` 926、`ipc-handlers.mjs` 917、`types.ts` 661、`search-tools.ts` 661…） | 维持既有残项 |
| INFO | `engine-governance-tools.ts:219` 死导入 `transitionQueueItem`（仅消 lint） | 记 P2 |
| INFO | `.signing-secret` 已跟踪（演示值）；dev sandbox off / CSP unsafe-eval（Vite HMR，有意） | 维持 |

**已验干净（本轮独立复核，非转述）**：SSE 鉴权（无裸 `EventSource`，全用 `openJobEventStream`）✅；原子 `rewriteJsonl`（temp+rename，queue/approvals/deadlines 共用）✅；审批 CAS（`withExclusiveFileLock`+409+真并发测）✅；review stamp SSOT + 生命周期终态戳锁 ✅；Electron `contextIsolation:true`/`nodeIntegration:false`/Bearer `timingSafeEqual`（长度预检）/单分发 chokepoint ✅；fs-bridge 路径穿越守卫 ✅；未跟踪文件无 secret ✅。

**评分（本轮独立复评）**：
- **工程可合并（PR 门禁轴）≈8.6/10** —— 四门禁全绿 + compose-picker BLOCK 已修；但「独立复评又抓到上轮漏报的 BLOCK」本身削弱「8.7 已稳」的可信度，且发布链 BLOCK 未修，故较上轮微降 0.1。
- **工程可发布（shippable 轴）≈8.0/10** —— `dist:electron` 必崩于缺失 vendor 脚本；不修则无法切桌面 release。
- **产品信任 ≈8.2/10** —— Track B 不变；CORPUS/中风险默认偏松（N-A3/A4）是信任天花板。
- **距 9.0**：补 vendor 脚本（发布轴）+ 拆 PR（合并面 N-A0）+ 写侧加锁（并发）+ mock 契约门禁（防鉴权回归再漏）+ 收紧 CORPUS/中风险默认。
- **诚实边界**：本轮证明「独立复评仍能抓到上轮漏报 BLOCK」——故任何「已无 BLOCK」结论须以「本轮四门禁 + 三路深查」为据，不得仅凭上轮自述。

### 附录 · 2026-07-29（三）· 优化落地轮（按上轮 review 逐条完成）

> **方法**：依上轮独立复评列出的 BLOCK + WARN + INFO 逐条实现，每条配受影响单测/冒烟测；落地后复跑四门禁。**目标：把上轮「距 9.0」清单里的工程项收敛掉，仅留需产品决策/组织动作的项。**

**四门禁本机复跑（全绿）**：根 typecheck ✅ / 桌面 typecheck ✅ / `pnpm test` 395 文件 1668 用例 ✅ / `pnpm lawmind:desktop:e2e:pr` 38 过 2 跳 0 败 ✅。

| 级 | 上轮发现 | 本轮处置 |
| -- | ---- | ---- |
| BLOCK（发布链） | vendor 脚本缺失 → `dist:electron` 必崩 | ✅ 新增 `scripts/vendor-lawmind-desktop-node.mjs`：默认从 nodejs.org/dist 下载官方独立构建（与构建机同版本），`--node` 支持离线本地复制；产物 `<key>/bin/node`（unix）/`<key>/node.exe`（win）对齐 `local-server.mjs`；幂等（版本一致跳过）+ 复制后 `--version` 校验；本机已用 v22.11.0 验通下载→解压→布局→运行 |
| WARN 并发 | queue/deadline RMW 无锁；adoption/suggestion 非原子写 | ✅ `transitionQueueItem`/`updateDeadlineStatus` 包 `withExclusiveFileLock`（对齐 `resolveApproval`）；`io.ts` 新增 `writeFileAtomicAsync`，adoption `writeAll` + suggestion `writeQueue` 改原子 temp+rename；新增跨进程并发测（`queue-transition-worker.mjs`：两子进程并发 resolve 不同条目，锁下两条都存活） |
| WARN 工具超时 | `withTimeout` 不传 AbortSignal → 超时后底层仍跑 | ✅ `timeoutMiddleware` 改 AbortController + `Promise.race`：超时即 `controller.abort()` 翻转 `ctx.abortSignal`，读取该 signal 的工具（fetch/模型/子进程）可取消底层；`AgentContext` 加可选 `abortSignal`；删冗余 `withTimeout`；新增取消传播测 |
| WARN 治理 | `list_templates` 静默改态却归 readonly；死名 | ✅ 拆 `list_templates`（纯读，无参）+ 新 `set_template_enabled`（写，`requiresApproval`/medium）；`governance.ts` 死名 `list_all_drafts`→`list_drafts`、`register_uploaded_template`→`register_template`、加 `set_template_enabled`；`requires-action.ts` 加显示名；新增分类测 |
| WARN SSRF | DNS rebinding TOCTOU（fetch 重新解析） | ✅ 新增 `authority-pinned-fetch.ts`：校验解析地址 → 用 `node:http(s) Agent` 自定义 `lookup` 把连接锁定到已校验 IP（TLS 仍按原 hostname 验证）；仅接商业权威端点（pkulaw/generic，避开 caseopen loopback）；新增 8 条拒绝路径测（私网/loopback/metadata/字面主机/DNS 失败/空/全私网） |
| WARN CI | labeler/dependabot 残留 OpenClaw 路径；pnpm action v4/v6 混用 | ✅ `labeler.yml` 重写为 LawMind-only（engine/desktop/docs/scripts/ci/security）；`dependabot.yml` 删 swift/gradle/docker（对应目录不存在），留 npm+github-actions；`lawmind-electron-weekly.yml`/`lawmind-nightly.yml` 的 `pnpm/action-setup@v6`→`@v4`（对齐主 CI 多数，避免未验升级）；4 文件 YAML 解析校验通过 |
| WARN mock | 无 Bearer 校验 + 缺 jobs/SSE/workflow-run/fs/tree 路由 | ✅ `mock-api.mjs` 加 `LAWMIND_E2E_MOCK_TOKEN` 环境门控（默认关，不破现有套件；开则强制 Bearer，为后续抓「漏 apiAuthHeaders」回归留钩子）；新增 `/api/jobs`、`/api/jobs/:id`、`/api/jobs/:id/stream`（SSE 终态帧）、`/api/jobs/:id/cancel`、`/api/collaboration/workflow-run`、`/api/fs/tree`、`/api/fs/read`；CORS 允许 authorization 头；冒烟测全绿 |
| WARN a11y | tabs 缺 role/aria-selected/aria-controls↔tabpanel | ✅ `ReviewCampaignPanel` 补 tab `id`/`aria-controls`/`tabIndex`（roving）+ tabpanel `id`/`aria-labelledby` 全链接；`ChatSessionTabs`/`AgentFleetListAside` 复核已正确；`MatterWorkbenchTabs` 已有 `aria-selected`（面板跨组件包裹有布局风险，留后续）；桌面 typecheck 绿，e2e `getByRole("tab")` 仍命中 |
| WARN 文案 | 「协作完成」vs「工作流」漂移；tokens 工程行话 | ✅ 侧栏「协作完成」→「工作流完成」（aria-label 同步）；设置页 `Prompt/Completion/合计 tokens`→`提问用量/回复用量/合计用量`；无测试引用旧串 |
| WARN 信任默认 | N-A3 仅拒 high；N-A4 未标 CORPUS 当非演示 | ✅ `shouldRefuseDraftOnDemoCorpus` 收紧为 high+medium（N-A3），文案改「中高风险」；`recordIsDemo` 保守默认：未标外部 CORPUS 一律按 demo（N-A4），`demo:false` 显式正式、`CORPUS_DEMO=1` 仍为全局 kill-switch；单测更新 + 新增未标默认 demo 测 |
| WARN 依赖 | vitest 4.1.0 audit critical | ✅ `vitest`/`@vitest/coverage-v8` `^4.1.0`→`^4.1.10`（4.1.x 最新补丁，满足 ≥4.1.8）；`pnpm install` 升级 + 回归测绿 |
| INFO | 死导入 `transitionQueueItem`；文档 9.5 残句 | ✅ 删 `engine-governance-tools.ts` 死导入 + `void` 抑制；GOALS.md 无 9.5 残句、EXTERNAL-INTEGRATIONS:223/280 已校正 ≈8.7 |

**仍未修（需产品/组织动作，非工程项）**：脏树 178 文件拆 PR（N-A0，主扣分，需按主题切 PR，不在本轮代码改动范围）；Track B 真源法库接入（产品/商务）；`pnpm audit` 其余 high（concurrently/shell-quote 传递依赖，待上游）；覆盖率 ratchet 进 pre-commit（流程）；SECURITY.md Electron 加固段落（文档）。

**评分（本轮优化落地后）**：
- **工程可合并（PR 门禁轴）≈8.9/10** —— 四门禁全绿；上轮「距 9.0」工程项（并发/超时/治理/SSRF/CI/mock/a11y/文案/信任默认/依赖/死导入）全部收敛；唯脏树 N-A0 未拆 PR 仍为主扣分。
- **工程可发布（shippable 轴）≈8.8/10** —— vendor 脚本已补且本机验通 `dist:electron` 链；发布轴 BLOCK 解除。
- **产品信任 ≈8.5/10** —— N-A3/A4 收紧后信任天花板抬升；Track B 真源法库仍为最终上限。
- **距 9.0**：拆 PR 清脏树（N-A0，合并面）+ Track B 联调记录（产品信任）+ 覆盖率 ratchet 进 hook（流程）+ SECURITY.md Electron 段落（文档）。
- **诚实边界**：本轮分数上调以「四门禁全绿 + 逐条单测 + e2e:pr 38 过 0 败」为据；e2e:pr 已回填全绿，无回归下调。

### 附录 · 2026-07-29（四）· 优化落地轮第二轮（adversarial 复评 + 逐条收敛）

> **方法**：对上轮落地结果再做一轮独立 adversarial 复评（三路深查：引擎并发/信任门禁、桌面鉴权/SSRF/CI、横切文档/安全卫生），筛出 BLOCK + WARN 后逐条实现并配单测，最后复跑四门禁。**目标：把上轮遗漏的并发 RMW、工具治理运行时对齐、AbortSignal 端到端传播、SSRF 连接层 pin 扩面、CI 死路径、文档分数矛盾等收敛掉。**

**四门禁本机复跑（全绿）**：根 typecheck ✅ / 桌面 typecheck ✅ / `pnpm test` 395 文件 1674 用例 ✅ / `pnpm lawmind:desktop:e2e:pr` 38 过 2 跳 0 败 ✅。

| 级 | 上轮遗漏发现 | 本轮处置 |
| -- | ---- | ---- |
| BLOCK 并发 | `matter-write-service.ts` 所有 `matter.json` RMW（create/update/status/strategy/attach）无锁 → 并发写丢字段 | ✅ 新增 `withMatterLock(workspaceDir, matterId, fn)`（`matter.json.lock`），包住 `createMatterIfMissing`/`updateMatterProfile`/`updateMatterStatus`/`setMatterStrategy`/`attachDeliverableId`/`attachQueueItemId`/`attachDeadlineId` 的 RMW；异步投影移出锁外 |
| BLOCK 信任 | `update_draft` 未入 `WRITE_TOOLS` → 治理元数据漏标写；运行时 `toolRequiresExplicitApproval` 不查治理集合 → 严格模式下定义漏 `requiresApproval` 的写工具不拦 | ✅ 抽 `tool-name-sets.ts` 叶模块（`WRITE_TOOLS`/`IDEMPOTENT_READ_TOOLS`/`MATTER_SCOPE_REQUIRED`/`BACKGROUND_JOB_TOOLS`）解 `governance.ts↔dangerous-tool-policy.ts` 循环依赖；`update_draft` 加入 `WRITE_TOOLS` + `WRITE_HEAVY_TOOL_NAMES`；`toolRequiresExplicitApproval` 严格模式查 `WRITE_TOOLS`（非严格保持原行为）；新增严格模式写工具拦截测 + governance 分类测 |
| BLOCK 取消 | `ctx.abortSignal` 未传入 `engine.research` → 超时后检索/模型 fetch 仍跑 | ✅ `RetrievalAdapter.retrieve`/`RetrieveParams`/`ModelRetriever` 加 `signal?`；`engine.research`/`researchTask` 透传 `opts.signal`；`engine-pipeline-tools.ts`/`engine-workflow-tool.ts` 调用处传 `ctx.abortSignal`；`openai-compatible.ts` 外部 signal 与内部超时 controller 联动；`lawmind-web-search.ts`/`ingest-helpers.ts` vision fetch 透传 signal |
| WARN 并发 | `deliverable-service.ts` RMW 无锁；`templates`/`drafts`/`learning`/`memory` 持久化非原子写 | ✅ `withDeliverableLock`（`deliverables/<id>.json.lock`）包 `transitionDeliverable`/`linkDraftToDeliverable`/`applyDeliverableReviewStamp`；`templates/index.ts`/`drafts/index.ts`/`learning/desk-settings.ts`/`learning/agent-specialization.ts`/`memory/executable-preferences.ts` 改 `writeJsonAtomic`/`writeFileAtomicAsync` |
| WARN 鉴权 | `lawmind-dev-config-cache.ts` 手拼 Bearer，未走 `apiAuthHeaders()` | ✅ `loadCachedDevAppConfig` 先 `setLoopbackApiAuthToken` 再探活；`healthReachable` 直接用 `apiAuthHeaders()` |
| WARN SSRF | open-law live 端点（caseopen）未走 DNS pin → TOCTOU rebinding | ✅ `authority-adapter.ts` 新增 `isLoopbackHostname` + `createOpenLawPinnedFetch(plainFetch, pinnedFetch)`：loopback 走 plain（兼容自托管）、非 loopback 走 `createPinnedAuthorityFetch`；作为 `fetchImpl` 传入 `openLawRetrieve` |
| WARN 信任 | `render_document` `bypassGate = bypass_acceptance_gate \|\| shouldApprove` → approve=true 静默绕过验收门禁；`update_draft` 无 demo 语料警告 | ✅ `bypassGate` 去掉 `\|\| shouldApprove`，approve 仅置审核态、不绕门禁；错误文案只建议 `bypass_acceptance_gate=true`；`update_draft` 读 `readResearchSnapshot` + `isDemoCorpusResult`，命中演示语料时返回 `demoCorpus:true` + `demoCorpusWarning`（非阻断）；新增 3 条 update_draft demo 测 + 改写 render 门禁测（approve 单独被拦、+bypass 放行） |
| WARN 文案 | UI 残留工程行话：tokens / system prompt / Jobs / 协作 | ✅ `LawmindComposeContextUsage`/`LawmindSettingsUsageStats` tokens→字/用量；`LawmindMemorySourcesPanel`/`useMatterProductIntelligence` system prompt→助手主说明；`LawmindSettingsDoctor` Jobs→运行；`LawmindSettingsCollaboration` 协作→工作流 |
| WARN a11y | `MatterWorkbenchTabs` 缺 tabpanel 链接；`ReviewDraftPicker` tab 缺 ARIA；加载态缺 `aria-busy` | ✅ `MatterWorkbenchTabs` 补 `id`/`aria-controls`/`tabIndex`（roving）；`MatterWorkbenchMainPanels` 包 `role="tabpanel"` + `aria-labelledby` + `tabIndex`；`ReviewDraftPicker` tab 补 ARIA + tabpanel；`MatterWorkbenchMainPanels`/`LawmindApprovalQueue` 加载态加 `aria-busy` |
| BLOCK CI | `lawmind-security-audit.yml` `continue-on-error:true` → 审计不阻断合并；vite 传递依赖漏洞 | ✅ 去 `continue-on-error`、加 `pull_request`/`push` 触发、`--audit-level=high`、pin `pnpm/action-setup@v4`；根 `package.json` 加 `pnpm.overrides["vitest>vite"]:"^8.0.5"`（仅覆盖 vitest 的 vite）；桌面 `vite` `^6.0.11`→`^6.4.2` |
| BLOCK 文档诚实 | §1 分数自相矛盾（8.7 vs 8.9）；GOALS e2e 计数过时(14/14)、vendor BLOCK 仍标 pending；NEXT-PLAN A11 勾 ≥9.5 | ✅ §1 表与 §0/附录对齐至 ≈8.9/≈8.5；GOALS e2e 改 38 过 2 跳 0 败、vendor 标已修；NEXT-PLAN A11 去 ≥9.5 勾、注明需独立书面验证、目标 ≥9.0 |
| WARN 安全卫生 | SECURITY.md 无 Electron 加固段；`.signing-secret`/`/matters/` 未 gitignore | ✅ SECURITY.md 新增「Hardening notes (Electron shell)」段（contextIsolation/sandbox/CSP/preload/path traversal/Bearer 比较）；根 `.gitignore` 加 `**/.signing-secret` + `/matters/` |

**仍未修（需产品/组织动作，非工程项）**：脏树拆 PR（N-A0，主扣分）；Track B 真源法库接入（产品/商务）；`pnpm audit` 其余 high 传递依赖（待上游）；覆盖率 ratchet 进 pre-commit（流程）。

**评分（本轮优化落地后）**：
- **工程可合并（PR 门禁轴）≈8.9/10** —— 四门禁全绿（typecheck 双绿 / `pnpm test` 395 文件 1674 用例 / e2e:pr 38 过 2 跳 0 败）；本轮把上轮遗漏的并发 RMW 加锁、工具治理运行时对齐、AbortSignal 端到端传播、SSRF 连接层 pin 扩面、CI 死路径、文档分数矛盾全部收敛；唯脏树 N-A0 未拆 PR 仍为主扣分。**分数未上调**：本轮为上轮遗漏项的补漏，非新增分项。
- **产品信任 ≈8.5/10** —— `render_document` 验收门禁旁路逻辑修正（approve 不再静默绕门禁）+ `update_draft` demo 语料警告补齐后，信任门禁更严；Track B 真源法库仍为最终上限。
- **距 9.0**：拆 PR 清脏树（N-A0，合并面）+ Track B 联调记录（产品信任）+ 覆盖率 ratchet 进 hook（流程）。
- **诚实边界**：本轮分数维持 ≈8.9/≈8.5，未上调；以「四门禁全绿 + 逐条单测 + e2e:pr 38 过 0 败」为据；新增 6 条单测（update_draft demo×3 / render 门禁改写 / governance 分类 / 严格模式写工具拦截）。
