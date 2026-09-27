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
  onOpenNeedsDecisionDesk?: () => void;
};

function label(id: string, map: Record<string, string>): string {
  return map[id]?.trim() || id;
}

export function MatterTeamRosterStrip({
  apiBase,
  matterId,
  onOpenNeedsDecisionDesk,
}: Props): ReactNode {
  const [roster, setRoster] = useState<Roster | null>(null);
  const [openDelegations, setOpenDelegations] = useState<DelegationRow[]>([]);
  const [nameById, setNameById] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!apiBase?.trim() || !matterId?.trim()) {
      return undefined;
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
          (x) =>
            x.status === "pending" || x.status === "running" || x.status === "awaiting_lawyer",
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

  return (
    <section
      className="lm-matter-team-strip"
      aria-label="本案团队"
      data-testid="lm-matter-team-strip"
    >
      <div className="lm-matter-team-strip-copy">
        <strong>本案团队</strong>
        <span className="lm-meta">
          {names.length > 0 ? `编制 ${names.join("、")}` : "未设编制"}
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
