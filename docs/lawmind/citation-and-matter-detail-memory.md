# LawMind citation and matter detail (handoff memory)

本文供后续迭代或新会话快速对齐：**草稿引用完整性**在引擎、桌面 API、案件详情 UI、审计与文档中的落点。产品面向说明仍以 [LawMind 用户手册](/LAWMIND-USER-MANUAL) 为准。

## Objective

- 在**不阻断审核**的前提下，让律师在桌面端能看到草稿是否存在研究快照、引用是否与快照一致。
- 合规导出中能统计并展示 **`draft.citation_integrity`** 审计事件（通常早于同任务的 **`draft.reviewed`**）。

## What shipped

1. **引擎**：`engine.review` 在存在研究快照且正文引用与 bundle 不一致时，写入审计 **`draft.citation_integrity`**（system），再继续审核流程。逻辑与测试见 `src/lawmind/index.ts`、`src/lawmind/index.test.ts`。
2. **解析与视图**：`resolveDraftCitationIntegrity(workspaceDir, draft)` 与类型 **`DraftCitationIntegrityView`** 在 `src/lawmind/drafts/citation-resolve.ts`、`src/lawmind/drafts/citation-integrity.ts`；单测 `src/lawmind/drafts/citation-resolve.test.ts`。
3. **LawMind Desktop API**：单草稿 GET/POST 等路径响应中带 **`citationIntegrity`**；**`GET /api/matters/detail`** 在构建案件索引后填充 **`draftCitationIntegrity`**（`taskId` → 视图）。实现：`apps/lawmind-desktop/server/lawmind-server-dispatch.ts`。
4. **桌面 UI**：案件详情「任务」列表中草稿行旁 **`DraftCitationBadge`**（无快照 / 引用 OK / 引用待核）。实现：`apps/lawmind-desktop/src/renderer/MatterWorkbench.tsx`；样式类名 `lm-matter-cit*` 在 `apps/lawmind-desktop/src/renderer/styles.css`。审核台等处的横幅/状态复用 `LawmindCitationBanner.tsx`、`ReviewWorkbench.tsx` 等，类型均从 `src/lawmind/drafts/citation-integrity.ts` 引用。
5. **Health**：`doctor.researchSnapshotCount`（`drafts/` 下 `*.research.json` 数量）见 `apps/lawmind-desktop/server/lawmind-health-payload.ts` 与手册说明。
6. **文档**：`docs/LAWMIND-USER-MANUAL.md`（`draftCitationIntegrity`、`researchSnapshotCount`、合规导出与 **`draft.citation_integrity`**）；任务检查点叙事见 [LawMind task checkpoints](/lawmind/task-checkpoints)。
7. **合规导出测试**：`src/lawmind/audit/export-report.test.ts` 中含 **`draft.citation_integrity`** 的聚合计数/表格断言。

## Key files (quick index)

| Area                         | Path                                                     |
| ---------------------------- | -------------------------------------------------------- |
| Resolve + export from engine | `src/lawmind/index.ts`                                   |
| Citation resolve             | `src/lawmind/drafts/citation-resolve.ts`                 |
| View type                    | `src/lawmind/drafts/citation-integrity.ts`               |
| Audit kind union             | `src/lawmind/types.ts` (`draft.citation_integrity`)      |
| Desktop dispatch             | `apps/lawmind-desktop/server/lawmind-server-dispatch.ts` |
| Matter UI badge              | `apps/lawmind-desktop/src/renderer/MatterWorkbench.tsx`  |

## Follow-ups (optional)

- Playwright / 桌面 E2E：若尚无覆盖，可为「打开案件详情 → 草稿行显示引用徽章」加一条稳定选择器用例。
- 与 `engine-tools` 工具描述对齐：若工具层有 **`citationIntegrity`** 字段说明，变更视图字段时记得同步描述与快照测试（`src/lawmind/agent/tools/engine-tools.ts` 等）。

## Related docs

- [LawMind user manual](/LAWMIND-USER-MANUAL)
- [LawMind task checkpoints](/lawmind/task-checkpoints)
- [Agent Workbench Memory](/lawmind/agent-workbench-memory)
