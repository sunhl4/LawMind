# Cursor / Claude Code 借鉴 — 执行计划（提案改稿 · @钉源 · 隔离 · 检查点 · Rules）

> 北极星不变：**易上手 + 交付可靠**；不做通用 coding IDE / 无界 Shell。  
> 对应先前对照结论条目 1–5。

## 0. 验收总表

| ID  | 项           | DoD（律师可感知）                                                               |
| --- | ------------ | ------------------------------------------------------------------------------- |
| L1  | 提案式改稿   | Agent 改稿后出现待决红线；Accept 写入 / Reject **回滚**；可一键全接受/全拒绝    |
| L2  | `@` 钉源     | Compose 可选证据/条款/playbook/本案理论；发送后进 ContextPlan，非仅自然语言前缀 |
| L3  | 子任务隔离   | 委派会话 ID=登记 ID；depth 生效；取消/超时 abort 子会话；子任务继承权限模式     |
| L4  | 长任务检查点 | Stop 后 turn=`paused` 可续跑（非重开黑盒）；委派超时自动收口                    |
| L5  | 律师 Rules   | 工作区强制规则 + 本案 `RULES.md` 每轮硬注入；设置页可查看/开关路径              |

---

## 1. L1 · 提案式改稿（Wave 1）

| 字段     | 内容                                                                                                                                |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **落点** | `drafts/redline-proposal.ts`；`engine-pipeline-tools` `update_draft`；`lawmind-server-route-draft-revision`；`LawmindRedlinePanel`  |
| **行为** | ① reject → 草稿正文回 `before`；② agent `update_draft` / 修订 job 成功后 auto baseline（若无）+ generate；③ Accept all / Reject all |
| **不做** | 行级 Myers 内联编辑器（保留 section hunk；`line-diff` 可二期嵌套）                                                                  |
| **测试** | `redline-proposal.test.ts`；修订路由或 update_draft 单测                                                                            |

## 2. L2 · `@` 钉源（Wave 2）

| 字段     | 内容                                                                                                                                                       |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **落点** | `lawmind-compose-context.ts`；`lawmind-file-chat-context.ts`（或新 `compose-context-pin.ts`）；chat 路由；`context-plan.ts`；`turn-orchestrator-prompt.ts` |
| **种类** | `file`（已有）· `evidence`（matter 材料路径）· `clause`（CLAUSE_PLAYBOOK 片段/整册）· `playbook`（fleet/标准审查剧本）· `theory`（MATTER_STRATEGY）        |
| **行为** | `@` 面板分类；chip；`contextPins` schema 校验；服务端解析并写入 ContextPlan `pinned_context` 层                                                            |
| **不做** | 消息正文永久保留 `@token` 语法（chip + 结构化 pins 即可）                                                                                                  |
| **测试** | pin 编码/解码单测；context-plan 含 pinned 层；mock-api 可选                                                                                                |

## 3. L3 · 子任务隔离（Wave 3）

| 字段     | 内容                                                                                                                                                                          |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **落点** | `message-bus.ts` `fireAndForget`；`delegate.ts`；`agent-factory.ts`；协作取消路由                                                                                             |
| **行为** | registry `delegationId` = 子 session `collaborationDelegationId`；`collaborationDepth` 传入工具注册；cancel → `requestTurnAbort`；超时 timer；父 `permissionMode` 传子 `chat` |
| **测试** | `delegate.test.ts` / registry 测试                                                                                                                                            |

## 4. L4 · 长任务检查点（Wave 4）

| 字段     | 内容                                                                                                    |
| -------- | ------------------------------------------------------------------------------------------------------- |
| **落点** | `turn-abort.ts` / finalize；`runtime-resume.ts`；session turn 状态；桌面 Stop 文案                      |
| **行为** | 用户 Stop → `paused` + 保存已完成 tool 轮次摘要；`resumeTurn` 或下一轮带「从检查点继续」；委派超时接 L3 |
| **不做** | 任意工具中途字节级回放（只保证「停得住、接得上」）                                                      |
| **测试** | abort→paused→resume 单测                                                                                |

## 5. L5 · 律师 Rules（Wave 5）

| 字段     | 内容                                                                                                             |
| -------- | ---------------------------------------------------------------------------------------------------------------- |
| **落点** | `workspace-policy.ts`；`system-prompt.ts`；`turn-orchestrator-prompt.ts`；设置 Doctor/治理页                     |
| **行为** | `matters/<id>/RULES.md`（存在则）追加「本案强制规则」；工作区 `agentMandatoryRulesPath` 设置页可见路径与截断提示 |
| **测试** | `workspace-policy.test.ts`；system-prompt 含本案块                                                               |

---

## 6. 回归命令

```bash
pnpm exec vitest run \
  src/lawmind/drafts/redline-proposal.test.ts \
  src/lawmind/policy/workspace-policy.test.ts \
  src/lawmind/agent/tools/coordination/delegate.test.ts \
  src/lawmind/runtime/context-plan.test.ts \
  src/lawmind/agent/runtime-resume.test.ts \
  apps/lawmind-desktop/src/renderer/lawmind-compose-context.test.ts
pnpm --filter lawmind-desktop typecheck
```

## 7. 进度（2026-07-23）

| Wave | 状态 | 备注                                                           |
| ---- | ---- | -------------------------------------------------------------- |
| L1   | ✅   | reject 回滚；`update_draft`/修订 job → 红线；Accept/Reject all |
| L2   | ✅   | typed `contextPins` + `@` 分类 + ContextPlan `pinned_context`  |
| L3   | ✅   | delegationId 统一；depth；cancel/timeout abort；权限继承       |
| L4   | ✅   | Stop→`paused` 检查点；`resumePausedTurn` + `/resume-paused`    |
| L5   | ✅   | 本案 `RULES.md` 硬注入；Doctor 提示路径                        |
