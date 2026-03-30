# LawMind task checkpoints

LawMind engine tasks move through a linear lifecycle persisted on `TaskRecord.status` (`src/lawmind/types.ts`). Checkpoints are **derived** from that field (no separate checkpoint file).

## Pipeline order

1. **任务已创建** — `created` after `plan` / `ensureTaskRecord`.
2. **律师已确认** — `confirmed` when `requiresConfirmation` is true; skipped in the UI label when confirmation is not required.
3. **检索完成** — `researched` after `retrieve` completes.
4. **草稿已生成** — `drafted` after `draft` / `draftAsync` and `persistDraft`.
5. **草稿已审核** — `reviewed` or **审核已驳回** when `rejected`.
6. **已渲染交付** — `rendered` or `completed` when applicable.

Agent-only chat turns (`kind: agent.instruction`) use a shorter list: 对话指令已记录 → 回合已完成.

## API

- `GET /api/tasks/:id` includes `checkpoints: TaskCheckpoint[]` (`id`, `label`, `reached`).

## Code

- `listTaskCheckpoints` — `src/lawmind/tasks/checkpoints.ts`
- Re-exported from `src/lawmind/index.ts` and `src/lawmind/tasks/index.js`

## Research snapshot for citations

When a draft is generated, the engine writes `drafts/<taskId>.research.json` next to `drafts/<taskId>.json` so the desktop API can recompute **citation integrity** against the original `ResearchBundle`. Older drafts without this sidecar report `citationIntegrity.checked === false`.

## Audit

- On `engine.review`, if a research snapshot exists and section citations reference unknown source IDs, the engine emits **`draft.citation_integrity`** (system actor) before **`draft.reviewed`**. This is non-blocking; approval still proceeds.
- `GET /api/health` includes `doctor.researchSnapshotCount` (count of `*.research.json` under `drafts/`).
