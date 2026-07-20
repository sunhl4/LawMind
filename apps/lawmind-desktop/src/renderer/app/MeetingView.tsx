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

  useEffect(() => {
    if (preferred && preferred !== scope && !isAdhocMeetingMatterId(preferred)) {
      setScope(preferred);
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

  if (!config?.apiBase) {
    return (
      <div className="lm-desk-page lm-meeting-page" data-testid="lm-meeting-view">
        <p className="lm-meta">本地服务未就绪，无法打开会议室。</p>
      </div>
    );
  }

  return (
    <div className="lm-main-workbench lm-desk-page lm-meeting-page" data-testid="lm-meeting-view">
      <div className="lm-side-scroll lm-desk-page-scroll">
        <header className="lm-meeting-page-header">
          <div>
            <h2 className="lm-agent-fleet-title">会议室</h2>
            <p className="lm-meta">
              多位助手轮流讨论；可绑定案件，也可直接开临时讨论。可用「添加材料」挂工作区文件进议题上下文。
            </p>
          </div>
          <label className="lm-field lm-meeting-scope-field">
            <span>会议范围</span>
            <select
              data-testid="lm-meeting-scope"
              value={scope}
              onChange={(e) => {
                const next = e.target.value;
                setScope(next);
                if (next === "adhoc") {
                  onSelectMatterScope?.(null);
                } else {
                  onSelectMatterScope?.(next);
                }
              }}
            >
              <option value="adhoc">不绑定案件 · 临时讨论</option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  案件 · {o.title}
                </option>
              ))}
            </select>
          </label>
        </header>

        <section className="lm-matter-cockpit-card lm-matter-meeting-card">
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
        </section>
      </div>
    </div>
  );
}

export const MeetingView = React.memo(MeetingViewImpl);
