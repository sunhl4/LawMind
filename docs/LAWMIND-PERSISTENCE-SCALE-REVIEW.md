# 持久化膨胀 / Token / 运行性能审查（2026-07-18）

> **状态**：P0–P2 缓解已落地（见下文「已实施」）  
> **动机**：案件与任务增多、长时间使用后，持续写入的 Markdown/JSONL 可能拖慢列表与对话，并显著抬高每轮 token。  
> **回看入口**：本文 + [LAWMIND-FUTURE-ISSUES.md](./LAWMIND-FUTURE-ISSUES.md)（「未来问题」总册）

## 1. 结论摘要

| 风险       | 是否会发生       | 优先症状                                                |
| ---------- | ---------------- | ------------------------------------------------------- |
| 磁盘膨胀   | 会（通常可接受） | CASE §8、audit、sessions、协作日志                      |
| 运行变慢   | **会，且更早**   | 案件列表/详情扫审计、相似案全量读 CASE                  |
| Token 变贵 | **会，且最伤**   | 每轮把整份 CASE / 律师画像 / 今日日志塞进 system prompt |

`matter.json` 不是主矛盾；主矛盾是 **append-only 记忆被整读、整注入**。

## 2. 已实施缓解（本次）

### P0

| 项                 | 实现                                                                                                                              |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| Prompt 窗口        | `src/lawmind/memory/prompt-windows.ts`：CASE / 画像 / 客户 / 日日志 / 助手 PROFILE 注入前截断；CASE §8 进 prompt 时只保留最近进展 |
| 避免 CASE 双注入   | `turn-orchestrator-prompt.ts` 将 `cases/<id>/CASE.md` 记入 `alreadySurfaced`                                                      |
| CASE §8 轮转       | `appendCaseProgress` 保留最近 80 条，超额写入 `cases/<id>/progress-archive.md`                                                    |
| 列表不扫全量 audit | `listMatterOverviews` → `buildMatterOverviewLite`（仅 CASE + tasks）                                                              |
| 详情 audit 限窗    | `buildMatterIndex` 使用 `readRecentAuditLogs`（默认最近 120 天 / 最多 8000 条）                                                   |
| 交互 rollup        | 一次读近期 audit + task→matter 映射，避免 N× `buildMatterIndex`                                                                   |

### P1

| 项              | 实现                                                                   |
| --------------- | ---------------------------------------------------------------------- |
| 相似案读入上限  | `similar-case-recall.ts` 评分时最多读约 64KB（头尾拼接）               |
| 检索适配器截断  | `retrieval/openai-compatible.ts` 对 MEMORY/画像/日志做窗口截断         |
| 协作 audit 按天 | `collaboration-audit/YYYY-MM-DD.jsonl`；读侧兼容旧单文件 + 最近 120 天 |

### P2（部分）

| 项                 | 实现                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------- |
| 可观测性读协作日志 | `multitask-observability.ts` 走统一 `readCollaborationEvents`                                     |
| 常量集中           | `PROMPT_WINDOW` 便于后续调参                                                                      |
| CASE.md 写串行     | `case-md-lock.ts`：`appendCase*` / 展示名 / matter→CASE 投影共用 per-matter 锁，避免并发 RMW 撕档 |

## 3. 关键路径（实施后）

```
每轮对话
  └─ loadMemoryContext（仍可读全文）
       └─ prepareTurnPromptContext
            └─ prompt-windows 截断后再 buildSystemPrompt   ← 控 token

案件列表 /api/matters/overviews
  └─ buildMatterOverviewLite（不读 audit）               ← 控延迟

案件详情 buildMatterIndex
  └─ readRecentAuditLogs(maxDays/maxEvents)              ← 控扫盘
```

## 4. 仍须关注（未完全消除）

见 [LAWMIND-FUTURE-ISSUES.md](./LAWMIND-FUTURE-ISSUES.md) **§ 持久化与扩展性**，主要包括：

- `sessions/*.json` / `.turns.jsonl` / transcript 长期增长与磁盘 compact
- queue/approvals JSONL 整文件重写 → 将来可 SQLite
- `LAWYER_PROFILE` §八学习段仍可能变长（已有 prompt 截断，缺写侧轮转）
- `model-usage/ledger.jsonl`、adoption JSONL
- 真正的 matter 级 audit 索引（而非按天窗口）
- FTS 重建仍可能扫大量历史

## 5. 验证

```bash
pnpm exec vitest run \
  src/lawmind/memory/prompt-windows.test.ts \
  src/lawmind/memory/index.test.ts \
  src/lawmind/cases/index.test.ts \
  apps/lawmind-desktop/server/lawmind-server-route-matters.test.ts
```

## 6. 调参

编辑 `PROMPT_WINDOW`（`src/lawmind/memory/prompt-windows.ts`）：

- `matterContextChars` / `lawyerProfileChars` / `dayLogChars`
- `caseProgressMaxBullets`
- `similarCaseReadChars`

Audit 窗口在 `buildMatterIndex` / interaction rollup 调用 `readRecentAuditLogs` 处调整。
