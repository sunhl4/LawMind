/**
 * 会议室「议题材料」：拖入 / 搜索 / 芯片列表（从 MatterTeamMeetingPanel 抽出）。
 */

import { useState, type ReactNode } from "react";
import { LawmindComposeContextPicker } from "./LawmindComposeContextPicker";
import {
  formatFileChatContextPill,
  type FileChatContextItem,
} from "./lawmind-file-chat-context";
import { LAWMID_FS_DRAG_MIME, readLawmindFsDragFromDataTransfer } from "./lawmind-file-drag";
import { isAdhocMeetingMatterId } from "./lawmind-meeting-scope";

export type MatterTeamMeetingMaterialsSectionProps = {
  apiBase: string;
  matterId: string;
  agendaFilePins: FileChatContextItem[];
  onAddAgendaFile?: (payload: Pick<FileChatContextItem, "root" | "relPath" | "kind">) => void;
  onRemoveAgendaFile?: (id: string) => void;
};

export function MatterTeamMeetingMaterialsSection(
  props: MatterTeamMeetingMaterialsSectionProps,
): ReactNode {
  const { apiBase, matterId, agendaFilePins, onAddAgendaFile, onRemoveAgendaFile } = props;
  const [materialsPickerOpen, setMaterialsPickerOpen] = useState(false);
  const [materialsPickerQuery, setMaterialsPickerQuery] = useState("");
  const [materialsDragOver, setMaterialsDragOver] = useState(false);

  return (
    <>
      <div
        className={`lm-matter-meeting-section lm-matter-meeting-materials${materialsDragOver ? " lm-matter-meeting-materials--drop" : ""}`}
        data-testid="lm-meeting-agenda-pins"
        onDragEnter={(e) => {
          if (!onAddAgendaFile) {
            return;
          }
          if ([...e.dataTransfer.types].includes(LAWMID_FS_DRAG_MIME)) {
            e.preventDefault();
            setMaterialsDragOver(true);
          }
        }}
        onDragOver={(e) => {
          if (!onAddAgendaFile) {
            return;
          }
          if ([...e.dataTransfer.types].includes(LAWMID_FS_DRAG_MIME)) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
            setMaterialsDragOver(true);
          }
        }}
        onDragLeave={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node | null)) {
            return;
          }
          setMaterialsDragOver(false);
        }}
        onDrop={(e) => {
          setMaterialsDragOver(false);
          if (!onAddAgendaFile) {
            return;
          }
          const payload = readLawmindFsDragFromDataTransfer(e.dataTransfer);
          if (!payload) {
            return;
          }
          e.preventDefault();
          onAddAgendaFile(payload);
        }}
      >
        <div className="lm-matter-meeting-section-head">
          <h3 className="lm-matter-meeting-section-title">议题材料</h3>
          <div className="lm-matter-meeting-materials-actions">
            {onAddAgendaFile ? (
              <button
                type="button"
                className="lm-btn lm-btn-ghost lm-btn-sm"
                data-testid="lm-meeting-add-materials"
                onClick={() => {
                  setMaterialsPickerQuery("");
                  setMaterialsPickerOpen(true);
                }}
              >
                搜索
              </button>
            ) : null}
          </div>
        </div>
        {agendaFilePins.length > 0 ? (
          <ul className="lm-meeting-materials-list">
            {agendaFilePins.map((pin) => {
              const pill = formatFileChatContextPill(pin);
              return (
                <li key={pin.id} className="lm-meeting-materials-chip">
                  <span title={pill.title}>{pill.shortLabel}</span>
                  {onRemoveAgendaFile ? (
                    <button
                      type="button"
                      className="lm-meeting-materials-chip-remove"
                      aria-label={`移除 ${pill.title}`}
                      onClick={() => onRemoveAgendaFile(pin.id)}
                    >
                      ×
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="lm-meeting-file-hint">
            {materialsDragOver
              ? "松开以加入议题"
              : "拖入或搜索"}
          </p>
        )}
      </div>

      {onAddAgendaFile ? (
        <LawmindComposeContextPicker
          open={materialsPickerOpen}
          query={materialsPickerQuery}
          onQueryChange={setMaterialsPickerQuery}
          searchPlaceholder="搜索工作区文件名（至少 2 字）"
          apiBase={apiBase}
          contextMatterId={isAdhocMeetingMatterId(matterId) ? null : matterId}
          pinnedFiles={agendaFilePins}
          matters={[]}
          categories={["files"]}
          onSelectFile={(payload) => {
            onAddAgendaFile(payload);
            setMaterialsPickerOpen(false);
            setMaterialsPickerQuery("");
          }}
          onSelectMatter={() => {
            setMaterialsPickerOpen(false);
          }}
          onSelectTemplate={() => {
            setMaterialsPickerOpen(false);
          }}
          onClose={() => {
            setMaterialsPickerOpen(false);
            setMaterialsPickerQuery("");
          }}
        />
      ) : null}
    </>
  );
}
