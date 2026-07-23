# 易上手 + 交付可靠 — 执行计划

> 北极星标准：**使用简单易上手** · **交付物可靠**。  
> 不做通用 coding-agent 扩面。

## 1. 验收标准

| 标准     | DoD                                                                  |
| -------- | -------------------------------------------------------------------- |
| 易上手   | 首跑 ≤4 步；默认「先计划」；Compose 可「开始执行」并恢复计划交接     |
| 交付可靠 | 必核未齐不可签批；签批落盘；严格导出再验；通过后可直接导出或进文书台 |

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
