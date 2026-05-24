import type { ReactNode } from "react";
import { DEFAULT_ASSISTANT_ID } from "../../../../src/lawmind/assistants/constants.ts";
import { PRACTICE_PERSONAS } from "../../../../src/lawmind/core/practice-personas.ts";
import type { AssistantRow } from "./lawmind-settings-models.ts";

type Props = {
  assistants: AssistantRow[];
  selectedAssistantId: string;
  onSelectAssistantId: (id: string) => void;
  selectedAssistant: AssistantRow | undefined;
  selectedAssistantStats: AssistantRow["stats"] | undefined;
  onOpenNew: () => void;
  onOpenEdit: () => void;
  onRemove: () => void;
};

export function LawmindSettingsAssistants(props: Props): ReactNode {
  const {
    assistants,
    selectedAssistantId,
    onSelectAssistantId,
    selectedAssistant,
    selectedAssistantStats,
    onOpenNew,
    onOpenEdit,
    onRemove,
  } = props;
  const empty = assistants.length === 0;
  return (
    <div className="lm-settings-section">
      <div className="lm-settings-section-title">智能体</div>
      <p className="lm-meta lm-settings-hint">
        业务领域岗位（诉讼、商事、尽调、知产等）可在「快速新建」中选择对应模板；与工作流库领域标签一致。
      </p>
      <ul className="lm-practice-persona-chips" aria-label="业务领域岗位">
        {PRACTICE_PERSONAS.map((p) => (
          <li key={p.id}>
            <span className="lm-tag" title={p.description}>
              {p.label}
            </span>
          </li>
        ))}
      </ul>
      <div className="lm-settings-group lm-settings-surface">
        {empty ? (
          <div className="lm-settings-empty" role="status">
            <div className="lm-collab-empty-title">还没有智能体</div>
            <p className="lm-collab-empty-body">
              可按岗位建多个（例如研究 / 起草 / 复核）；对话里随时切换。复杂事项还可在「协作」里跑多智能体工作流，交付前仍由您在审核台把关。
            </p>
          </div>
        ) : (
          <>
            <div className="lm-settings-row">
              <span className="lm-settings-key">当前智能体</span>
              <select
                className="lm-asst-select"
                value={selectedAssistantId}
                onChange={(e) => onSelectAssistantId(e.target.value)}
              >
                {assistants.map((a) => (
                  <option key={a.assistantId} value={a.assistantId}>
                    {a.displayName}
                  </option>
                ))}
              </select>
            </div>
            {selectedAssistant && (
              <div className="lm-settings-row">
                <span className="lm-settings-key">岗位</span>
                <span className="lm-settings-val">
                  {selectedAssistant.customRoleTitle || selectedAssistant.presetKey || "通用法律助理"}
                </span>
              </div>
            )}
            {selectedAssistantStats && (
              <div className="lm-settings-row">
                <span className="lm-settings-key">统计</span>
                <span className="lm-settings-val">
                  {selectedAssistantStats.turnCount} 轮对话 · {selectedAssistantStats.sessionCount} 会话
                </span>
              </div>
            )}
          </>
        )}
        <div className="lm-settings-actions">
          <button type="button" className="lm-btn lm-btn-accent lm-btn-sm" onClick={onOpenNew}>
            快速新建
          </button>
          <button
            type="button"
            className="lm-btn lm-btn-secondary lm-btn-sm"
            onClick={onOpenEdit}
            disabled={empty}
          >
            高级编辑
          </button>
          {selectedAssistantId !== DEFAULT_ASSISTANT_ID && (
            <button
              type="button"
              className="lm-btn lm-btn-ghost lm-btn-sm"
              onClick={onRemove}
              disabled={empty}
            >
              删除
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
