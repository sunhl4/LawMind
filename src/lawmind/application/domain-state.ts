/**
 * LawMind **领域状态**（可审计的法律工作数据）与 **Agent 运行时状态**（会话、工具轨迹）的边界说明。
 *
 * - **领域**：`tasks/`、`drafts/`、`cases/`、`audit/`、案件级产物等。应通过引擎 API、应用服务或
 *   委托到上述层的 Agent 工具修改；`TaskRecord` / `ArtifactDraft` 为任务与交付进度的真相源。
 * - **运行时**：`sessions/` 元数据与 `.turns.jsonl` 等；用于对话续写与调试，**不**替代草稿与任务记录
 *   中的法律结论与交付状态。
 *
 * @see docs/lawmind/engine-vs-agent.md
 */

/** Placeholder export — see module docblock above. */
export const domainStateModuleMarker = true;
