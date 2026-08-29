import React, { useEffect, useMemo, useState } from "react";
import { MatterTeamMeetingPanel } from "../MatterTeamMeetingPanel";
import type { AppConfig } from "../lawmind-app-bootstrap";
import { isValidMatterId } from "../../../../../src/lawmind/cases/matter-id.ts";
import { ADHOC_MEETING_MATTER_ID, isAdhocMeetingMatterId } from "../lawmind-meeting-scope";
import type { FileChatContextItem } from "../lawmind-file-chat-context";

export type MeetingViewProps = {
  config: AppConfig | null;
  /** Preferred case scope from shell context / sidebar. */
  matterId?: string | null;
  matterOptions?: Array<{ id: string; title: string }>;
  shellAssistantId: string;
  projectDir?: string | null;
  /** File pins from 对话「引用到对话」— injected into meetingAgenda. */
  agendaFilePins?: FileChatContextItem[];
  onAddAgendaFile?: (payload: Pick<FileChatContextItem, "root" | "relPath" | "kind">) => void;
  onRemoveAgendaFile?: (id: string) => void;
  /** @deprecated Prefer agendaFilePins */
  linkedFileLabels?: string[];
  onSelectMatterScope?: (matterId: string | null) => void;
};

type ScopeChoice = string;
type MeetingGroupId = "adhoc" | "matter";

function MeetingViewImpl(props: MeetingViewProps) {
  const {
    config,
    matterId,
    matterOptions = [],
    shellAssistantId,
    projectDir,
    agendaFilePins = [],
    onAddAgendaFile,
    onRemoveAgendaFile,
    onSelectMatterScope,
  } = props;

  const preferred = matterId?.trim() && isValidMatterId(matterId.trim()) ? matterId.trim() : null;
  const [scope, setScope] = useState<ScopeChoice>(() => preferred ?? "adhoc");
  const [openGroups, setOpenGroups] = useState<Record<MeetingGroupId, boolean>>(() => ({
    adhoc: !preferred,
    matter: Boolean(preferred),
  }));

  useEffect(() => {
    if (preferred && preferred !== scope && !isAdhocMeetingMatterId(preferred)) {
      setScope(preferred);
      setOpenGroups((prev) => ({ ...prev, matter: true, adhoc: false }));
    }
  }, [preferred]); // eslint-disable-line react-hooks/exhaustive-deps -- only sync when shell matter changes

  const effectiveMatterId = scope === "adhoc" ? ADHOC_MEETING_MATTER_ID : scope;

  const options = useMemo(() => {
    const seen = new Set<string>();
    const rows: Array<{ id: string; title: string }> = [];
    for (const o of matterOptions) {
      const id = o.id.trim();
      if (!id || !isValidMatterId(id) || isAdhocMeetingMatterId(id) || seen.has(id)) {
        continue;
      }
      seen.add(id);
      rows.push({ id, title: o.title.trim() || id });
    }
    if (preferred && !seen.has(preferred) && !isAdhocMeetingMatterId(preferred)) {
      rows.unshift({ id: preferred, title: preferred });
    }
    return rows;
  }, [matterOptions, preferred]);

  const selectScope = (next: ScopeChoice) => {
    setScope(next);
    if (next === "adhoc") {
      onSelectMatterScope?.(null);
      setOpenGroups((prev) => ({ ...prev, adhoc: true }));
    } else {
      onSelectMatterScope?.(next);
      setOpenGroups((prev) => ({ ...prev, matter: true }));
    }
  };

  const toggleGroup = (id: MeetingGroupId) => {
    setOpenGroups((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  if (!config?.apiBase) {
    return (
      <div className="lm-meeting-wb" data-testid="lm-meeting-view">
        <p className="lm-meeting-wb-empty">本地服务未就绪，无法打开会议室。</p>
      </div>
    );
  }

  return (
    <div className="lm-meeting-wb" data-testid="lm-meeting-view">
      <div className="lm-meeting-wb-split">
        <aside className="lm-meeting-wb-list" aria-label="会议场次">
          <div className="lm-meeting-wb-list-scroll">
            <section
              className={`lm-meeting-wb-group${openGroups.adhoc ? " lm-meeting-wb-group--open" : ""}`}
            >
              <button
                type="button"
                className="lm-meeting-wb-group-toggle"
                data-kind="adhoc"
                data-testid="lm-meeting-group-adhoc"
                aria-expanded={openGroups.adhoc}
                onClick={() => toggleGroup("adhoc")}
              >
                <span className="lm-meeting-wb-group-label-text">临时讨论</span>
                <span className="lm-meeting-wb-group-count">1</span>
                <span className="lm-meeting-wb-group-chevron" aria-hidden />
              </button>
              {openGroups.adhoc ? (
                <div className="lm-meeting-wb-group-panel">
                  <button
                    type="button"
                    className="lm-meeting-wb-row"
                    data-testid="lm-meeting-scope-adhoc"
                    aria-selected={scope === "adhoc"}
                    onClick={() => selectScope("adhoc")}
                  >
                    <span className="lm-meeting-wb-row-title">不绑定案件</span>
                    <span className="lm-meeting-wb-row-meta">快速开一场多助手讨论</span>
                  </button>
                </div>
              ) : null}
            </section>

            <section
              className={`lm-meeting-wb-group${openGroups.matter ? " lm-meeting-wb-group--open" : ""}`}
            >
              <button
                type="button"
                className="lm-meeting-wb-group-toggle"
                data-kind="matter"
                data-testid="lm-meeting-group-matter"
                aria-expanded={openGroups.matter}
                onClick={() => toggleGroup("matter")}
              >
                <span className="lm-meeting-wb-group-label-text">案件会议</span>
                <span className="lm-meeting-wb-group-count">{options.length}</span>
                <span className="lm-meeting-wb-group-chevron" aria-hidden />
              </button>
              {openGroups.matter ? (
                <div className="lm-meeting-wb-group-panel">
                  {options.length === 0 ? (
                    <p className="lm-meeting-wb-empty">暂无案件</p>
                  ) : (
                    options.map((o) => (
                      <button
                        key={o.id}
                        type="button"
                        className="lm-meeting-wb-row"
                        data-testid={`lm-meeting-scope-matter-${o.id}`}
                        aria-selected={scope === o.id}
                        onClick={() => selectScope(o.id)}
                      >
                        <span className="lm-meeting-wb-row-title">{o.title}</span>
                        <span className="lm-meeting-wb-row-meta">记录写入本案</span>
                      </button>
                    ))
                  )}
                </div>
              ) : null}
            </section>
          </div>
        </aside>

        <section className="lm-meeting-wb-detail" aria-label="会议办理">
          <div className="lm-meeting-wb-detail-scroll">
            <div className="lm-meeting-wb-detail-inner">
              <div className="lm-matter-cockpit-card lm-matter-meeting-card">
                <MatterTeamMeetingPanel
                  key={effectiveMatterId}
                  apiBase={config.apiBase}
                  matterId={effectiveMatterId}
                  shellAssistantId={shellAssistantId.trim() || "default"}
                  projectDir={projectDir}
                  agendaFilePins={agendaFilePins}
                  onAddAgendaFile={onAddAgendaFile}
                  onRemoveAgendaFile={onRemoveAgendaFile}
                />
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

export const MeetingView = React.memo(MeetingViewImpl);
