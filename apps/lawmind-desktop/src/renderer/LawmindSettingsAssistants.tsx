import type { ReactNode } from "react";
import { DEFAULT_ASSISTANT_ID } from "../../../../src/lawmind/assistants/constants.ts";
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
  return (
    <div className="lm-settings-section">
      <div className="lm-settings-section-title">助手</div>
      <div className="lm-settings-group">
        <div className="lm-settings-row">
          <span className="lm-settings-key">当前助手</span>
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
        <div className="lm-settings-actions">
          <button type="button" className="lm-btn lm-btn-secondary lm-btn-sm" onClick={onOpenNew}>
            新建助手
          </button>
          <button type="button" className="lm-btn lm-btn-secondary lm-btn-sm" onClick={onOpenEdit}>
            编辑
          </button>
          {selectedAssistantId !== DEFAULT_ASSISTANT_ID && (
            <button type="button" className="lm-btn lm-btn-secondary lm-btn-sm" onClick={onRemove}>
              删除
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
