/**
 * 本案团队条 — roster + 开放委派（Wave D / T4.3）
 */
import { useEffect, useState, type ReactNode } from "react";
import { apiGetJson, errorMessage } from "../api-client";

type Roster = {
  participantAssistantIds: string[];
  synthesizerAssistantId?: string;
};

type DelegationRow = {
  delegationId: string;
  fromAssistant: string;
  toAssistant: string;
  status: string;
  task: string;
};

type Props = {
  apiBase: string;
  matterId: string;
  onOpenMeeting?: () => void;
  onOpenNeedsDecisionDesk?: () => void;
};

function label(id: string, map: Record<string, string>): string {
  return map[id]?.trim() || id;
}

export function MatterTeamRosterStrip({
  apiBase,
  matterId,
  onOpenMeeting,
  onOpenNeedsDecisionDesk,
}: Props): ReactNode {
  const [roster, setRoster] = useState<Roster | null>(null);
  const [openDelegations, setOpenDelegations] = useState<DelegationRow[]>([]);
  const [nameById, setNameById] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!apiBase?.trim() || !matterId?.trim()) {
      return;
    }
    let cancelled = false;
    setRoster(null);
    setOpenDelegations([]);
    setErr(null);
    void (async () => {
      try {
        const [r, d, a] = await Promise.all([
          apiGetJson<{ ok?: boolean; roster?: Roster | null }>(
            apiBase,
            `/api/matters/team-roster?matterId=${encodeURIComponent(matterId)}`,
          ),
          apiGetJson<{ ok?: boolean; delegations?: DelegationRow[] }>(
            apiBase,
            `/api/delegations?matterId=${encodeURIComponent(matterId)}`,
          ),
          apiGetJson<{
            ok?: boolean;
            assistants?: Array<{ assistantId: string; displayName?: string }>;
          }>(apiBase, "/api/assistants"),
        ]);
        if (cancelled) {
          return;
        }
        setRoster(r.roster ?? null);
        const open = (d.delegations ?? []).filter(
          (x) => x.status === "pending" || x.status === "running",
        );
        setOpenDelegations(open.slice(0, 8));
        const map: Record<string, string> = {};
        for (const row of a.assistants ?? []) {
          if (row.assistantId) {
            map[row.assistantId] = row.displayName?.trim() || row.assistantId;
          }
        }
        setNameById(map);
      } catch (e) {
        if (!cancelled) {
          setErr(errorMessage(e, "无法加载本案团队"));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase, matterId]);

  const names = (roster?.participantAssistantIds ?? []).map((id) => label(id, nameById));
  const synth = roster?.synthesizerAssistantId
    ? label(roster.synthesizerAssistantId, nameById)
    : null;

  return (
    <section
      className="lm-matter-team-strip"
      aria-label="本案团队"
      data-testid="lm-matter-team-strip"
    >
      <div className="lm-matter-team-strip-copy">
        <strong>本案团队</strong>
        <span className="lm-meta">
          {names.length > 0
            ? `编制 ${names.join("、")}${synth ? ` · 结论：${synth}` : ""}`
            : "尚未记住会议编制 — 可在会议室勾选后点「记住本案编制」"}
          {openDelegations.length > 0
            ? ` · ${openDelegations.length} 项未闭环委派`
            : ""}
        </span>
        {err ? <span className="lm-meta lm-danger">{err}</span> : null}
        {openDelegations.length > 0 ? (
          <ul className="lm-matter-team-strip-dels">
            {openDelegations.map((d) => (
              <li key={d.delegationId}>
                {label(d.fromAssistant, nameById)} → {label(d.toAssistant, nameById)}：
                {d.task.slice(0, 48)}
                {d.task.length > 48 ? "…" : ""}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className="lm-matter-team-strip-actions">
        {onOpenMeeting ? (
          <button
            type="button"
            className="lm-btn lm-btn-sm"
            data-testid="lm-matter-team-open-meeting"
            onClick={() => onOpenMeeting()}
          >
            开会议室
          </button>
        ) : null}
        {onOpenNeedsDecisionDesk ? (
          <button
            type="button"
            className="lm-btn lm-btn-secondary lm-btn-sm"
            onClick={() => onOpenNeedsDecisionDesk()}
          >
            看在办
          </button>
        ) : null}
      </div>
    </section>
  );
}
