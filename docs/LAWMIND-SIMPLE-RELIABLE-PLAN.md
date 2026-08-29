# 易上手 + 交付可靠 — 执行计划

> **律师产品三条铁律（最高优先级）**：**上手简单** · **交付结果质量高** · **交付结果稳定性高**。  
> 历史简称「易上手 + 交付可靠」仍有效；现将「可靠」拆为**质量**与**稳定性**两条，避免只谈门禁而忽略结果一致性。  
> 不做通用 coding-agent 扩面。权威摘录入 `GOALS.md` §二、[愿景 · 三条铁律](LAWMIND-VISION.md#律师产品三条铁律)。

## 0. 三条铁律 · 工程翻译

| 铁律             | DoD（产品）                                                    | 工程落点（示例）                                                |
| ---------------- | -------------------------------------------------------------- | --------------------------------------------------------------- |
| **上手简单**     | Day-1 / Solo：引用材料 → 交办 →「去签批」→ 导出，≤2 次关键跳转 | 首跑、合同快车道、Solo IA（对话/在办）、计划交接条              |
| **交付质量高**   | 交件通过验收 spec、必核、引用可核；律师敢外发前仍可改          | DFA `validateDraftAgainstSpec`、严格 render、来源预览、自检摘要 |
| **交付稳定性高** | 同口径交办结构可预期；失败可续跑/可解释；无静默绕过门禁        | 黄金路径 e2e、审批 CAS、双写巡检、禁 bypass 默认路径            |

**取舍规则**：新入口 / 自动化 / 深度能力若削弱任一条，必须改设计或降级为进阶，不得进 Solo 默认主路径。

## 0.1 当前改动清单（对照工作区 · 2026-08-08）

> 按三条铁律审当前未合并方向（合同快车道、邮件意图/自动办件、交付红线、会议流等）。勾选表示「应对齐铁律再合入/加固」；完成一项则勾掉并在工程评审附录记一笔。

### A. 上手简单

- [x] **A1** Solo 合同快车道保持同一套立场/深度文案（见 `LAWMIND-SOLO-FIVE-MIN-CONTRACT.md`）：文件台「送审本合同」、拖入、输入栏「办件 → 合同审查」。空对话：先附材料再选流程，不必记激活词（2026-08-19）。
- [x] **A2** 邮件意图确认（`lawmind-mail-intent-bus`）默认一句确认 +「去自动办件」，不打断已在跑的合同审查主路径；设置页自动办件保持次要入口。主按钮改为「一键审邮件合同」（2026-08-18）。
- [x] **A3** 深链 / Header / 侧栏入口用语统一为律师词（对话、在办、改稿）；工程师词（fleet、automation run id）不得出现在主按钮。INSTALL / 手册 / Electron 菜单已对齐（2026-08-18）。
- [x] **A4** 首跑与 API 向导失败时给出「下一步只做一件事」的恢复文案，避免堆并列设置项。Compose 未配置模型只留主按钮「配置模型」（2026-08-18）。

### B. 交付结果质量高

- [x] **B1** 快车道「快速 / 标准 / 深度」均落到 `contract.review` 验收门禁；「快速」只缩短正文范围，**不得**跳过必核或严格导出。快速芯片旁提示「过门不等于已审透」；一键勾选必核在验收未过时禁用（2026-08-18）。
- [x] **B2** 签批→导出 / 审阅稿（红线）路径：自检摘要（验收 + 引用 + 交付类型）在「去签批」前后均可见。就绪条纳入推理门（2026-08-18）。
- [x] **B3** 邮件/自动办件产出的草稿走同一套 `acceptance` + review 路由；演示 seed（`mail/seed`）默认关闭，不得在生产默认放行半成品。自动办件失败写入 inbox（2026-08-18）。
- [x] **B4** 深度审查升专案组时保留立场/重点字段，避免质量口径在跳转时丢失（2026-08-20：`reviewBrief` 写入专案组，角色按【审查口径】复核）。

### C. 交付结果稳定性高

- [x] **C1** 黄金路径 e2e 进 PR 门禁：`solo-contract-fast-lane` / `solo-research-fast-lane` / 交付红线 / 会议 / 自动办件深链已列入 `lawmind:desktop:e2e:pr`（2026-08-13）。
- [x] **C2** 同立场×深度 → 交办 prompt 字段稳定（单测锁 `buildContractFastLanePrompt`）；模型漂移用门禁拦，不靠 UI 再解释。9 档结构行快照已锁（2026-08-18）。
- [x] **C3** 通过后自动导出：失败条可重试且不丢 `taskId`；禁止「看似导出成功、文件未落盘」。`outputPath` 为空视为失败；条写入 sessionStorage（2026-08-18）。
- [x] **C4** 在办队列合并 / 审批并发：保持 CAS 409 与必核落盘；新增 fleet merge 逻辑必须有单测防丢待办。`POST /api/drafts/:id/review` 接受 `expectedReviewStatus`（2026-08-18）。
- [x] **C5** 自动化定时/邮件触发：失败进 inbox 可点回，不静默吞错；与对话交办共用审计事件类型。标题「自动办件失败」（2026-08-18）。

### D. 文档与优先级（本轮文档已做）

- [x] **D1** `GOALS.md` §二写入三条铁律。
- [x] **D2** `LAWMIND-VISION.md` 增加「律师产品三条铁律」。
- [x] **D3** 本文件 §0 / §0.1；`VISION.md`、OPTIMIZATION、FUTURE-ISSUES、DFA 交叉引用。

---

## 1. 验收标准

| 标准         | DoD                                                                   |
| ------------ | --------------------------------------------------------------------- |
| 上手简单     | 首跑 ≤4 步；Solo 合同快车道 ≤2 次关键跳转；Compose 可恢复计划交接     |
| 交付质量高   | 必核未齐不可签批；验收 spec 通过；引用可核；严格导出再验              |
| 交付稳定性高 | 黄金路径 e2e 绿；同口径交办结构稳定；失败可续跑/可解释；无默认 bypass |

---

## 2. 第一波（已完成）

| ID    | 项                                       | 落点                       |
| ----- | ---------------------------------------- | -------------------------- |
| E1–E3 | 首跑捷径 / 先计划默认 / Compose 权限     | FirstRun + compose toolbar |
| R1–R6 | 就绪一览 / 必核落盘 / 导出闸 / bypass 禁 | deliverables + review 路由 |

## 3. 第二波（已完成）

| ID  | 项                               | 落点                     |
| --- | -------------------------------- | ------------------------ |
| E4  | 在办内嵌必核 + 一键勾选          | `LawmindAgentFleetPanel` |
| E5  | 开始执行注入【确认执行】         | `lawmind-plan-handoff`   |
| R7  | `checkAllRequiredChecklistItems` | verification-checklist   |

---

## 4. 第三波 — 详细计划（本轮执行）

### 目标故事

1. 律师在「先计划」下拿到计划 → 刷新页面后仍能看见并一键填入「确认执行」。
2. 律师在「在办」勾完必核并「通过」→ 立刻能导出 Word 或去文书台，不必再找入口。

### W3-A · 在办通过后导出引导

| 字段         | 内容                                                                       |
| ------------ | -------------------------------------------------------------------------- |
| **用户价值** | 签批闭环接到交付，少一次迷路                                               |
| **行为**     | `approved` 成功后展示条：`导出 Word`（strict render）/ `去文书台` / `关闭` |
| **落点**     | `LawmindAgentFleetPanel.tsx`；render `POST /api/drafts/:id/render`         |
| **失败**     | 验收/引用/必核 422 → 条内展示错误 +「去文书台」                            |
| **DoD**      | 通过后不点关闭则条常驻；导出成功显示文件名并可「文件夹」                   |
| **测试**     | 面板逻辑尽量用纯函数拆出 `post-approve-export` 状态；至少单测状态机        |

### W3-B · Plan 交接会话持久化

| 字段         | 内容                                                                                     |
| ------------ | ---------------------------------------------------------------------------------------- |
| **用户价值** | 刷新/切会话不丢「刚谈好的计划」                                                          |
| **存储**     | `localStorage` key `lawmind.planHandoff.v1` → `{ [sessionId]: { planText, updatedAt } }` |
| **写入时机** | ①「开始执行」抽取计划时；② `readonly` 下助手新消息到达且像计划时自动 upsert              |
| **清除**     | 用户点「清除」；或发送以【确认执行】开头的交办后自动清                                   |
| **落点**     | 扩展 `lawmind-plan-handoff.ts`                                                           |
| **DoD**      | 同 sessionId 刷新后仍可读到上次计划文本                                                  |
| **测试**     | vitest 覆盖 read/write/clear（jsdom localStorage）                                       |

### W3-C · 交接条 UI

| 字段     | 内容                                                                                     |
| -------- | ---------------------------------------------------------------------------------------- |
| **位置** | Compose chrome（输入框上方）                                                             |
| **文案** | 「已保存执行计划」+ 摘要一行                                                             |
| **操作** | `填入交办`（切标准 + 注入 confirm）/ `清除`                                              |
| **可见** | 当前 `chatSessionId` 有持久化计划时                                                      |
| **落点** | `lawmind-chat-compose-chrome.tsx` + `lawmind-chat-shell.tsx`                             |
| **DoD**  | data-testid：`lm-plan-handoff-banner` / `lm-plan-handoff-fill` / `lm-plan-handoff-clear` |

### 本波不做

- 服务端 session.json 写 plan（本地 localStorage 足够；Firm 同步另议）
- Solo 默认 grounded
- 子 agent 隔离重写

### 回归命令

```bash
pnpm exec vitest run \
  src/lawmind/deliverables/ \
  apps/lawmind-desktop/src/renderer/lawmind-plan-handoff.test.ts \
  apps/lawmind-desktop/src/renderer/lawmind-post-approve-export.test.ts
pnpm --filter lawmind-desktop typecheck
```

---

## 5. 第三波完成勾选

| ID   | 状态 | 落点                                                        |
| ---- | ---- | ----------------------------------------------------------- |
| W3-A | ✅   | `lawmind-post-approve-export.ts` + `LawmindAgentFleetPanel` |
| W3-B | ✅   | `lawmind-plan-handoff.ts` localStorage sync                 |
| W3-C | ✅   | compose chrome banner + shell fill/clear                    |

## 6. 第四波（已完成 · 2026-07-23）

| ID   | 项                           | 落点                                                                                                     |
| ---- | ---------------------------- | -------------------------------------------------------------------------------------------------------- |
| W4-A | Plan 交接写入 `session.json` | `AgentSession.planHandoff` + `GET/PUT/DELETE /api/sessions/:id/plan-handoff`；桌面 reconcile 本地↔服务端 |
| W4-B | 导出成功「用 Word 打开」     | 在办通过后条 + `openWithSystem` + `toWorkspaceRelativePath`                                              |

```bash
pnpm exec vitest run \
  src/lawmind/agent/session.test.ts \
  apps/lawmind-desktop/server/lawmind-server-route-sessions.test.ts \
  apps/lawmind-desktop/src/renderer/lawmind-plan-handoff.test.ts \
  apps/lawmind-desktop/src/renderer/lawmind-workspace-relpath.test.ts
```

## 7. 收尾加固（已完成 · 2026-07-23）

| ID  | 项                                    | 落点                                                        |
| --- | ------------------------------------- | ----------------------------------------------------------- |
| S1  | mock-api：plan-handoff + 签批落盘必核 | `e2e/mock-api.mjs`                                          |
| S2  | e2e：在办必核→通过→导出条             | `e2e/agent-fleet.spec.ts`                                   |
| S3  | e2e：plan-handoff API round-trip      | `e2e/skills-trust.spec.ts`                                  |
| S4  | 渲染进程勿拉 Node `workspace-loader`  | `deliverables/index.ts` 不再 re-export；engine/CLI 直引模块 |

主闭环到此为止。明确不做：Solo 默认 `grounded`、子 agent 隔离重写、权威法规 API、Firm 远程同步。
