/**
 * 在办左栏：停在你这里 / 正在办 / 今天办完。
 */
import type { ReactNode } from "react";
import type { AgentRunSummary } from "./lawmind-agent-fleet-api";
import { sanitizeLawyerFacingText } from "../../../../src/lawmind/platform/requires-action.ts";
import {
  docketBandLabel,
  docketRowStatusLabel,
  docketRowTitle,
  docketRowTone,
  docketSourceLabel,
  docketWhenLabel,
  type DocketBandId,
  type FleetDocket,
} from "./lawmind-fleet-docket";
import { lawyerFacingQueueScopeHint, useRequireSignoffReview } from "./lawmind-review-prefs";

export type LawmindAgentFleetListAsideProps = {
  docket: FleetDocket;
  hiddenInFlight: number;
  hiddenSettled: number;
  matterChoices: string[];
  matterLabelById?: Record<string, string>;
  matterFilter: string;
  onMatterFilter: (matterId: string) => void;
  onlyNeedsYou: boolean;
  onOnlyNeedsYou: (next: boolean) => void;
  selectedId: string | null;
  onSelectRun: (id: string) => void;
  inFlightOpen: boolean;
  settledOpen: boolean;
  onToggleBand: (band: "inFlight" | "settled") => void;
  pendingTeachCount: number;
  onOpenMemoryInspector?: () => void;
  onShowAll?: () => void;
  /** 从某一案进来时，回到工作台这一卷。 */
  onReturnToMatter?: () => void;
  returnMatterLabel?: string;
};

function rowTitle(run: AgentRunSummary): string {
  const sanitized = sanitizeLawyerFacingText(run.title, run.toolName)
    .replace(/^待审定：\s*/, "")
    .replace(/^待批准：\s*/, "");
  return docketRowTitle(run, sanitized);
}

function matterLine(
  run: AgentRunSummary,
  matterLabelById: Record<string, string>,
): string {
  const mid = run.matterId?.trim();
  if (!mid || mid.startsWith("临时")) {
    return "";
  }
  return matterLabelById[mid]?.trim() || mid;
}

export function LawmindAgentFleetListAside(props: LawmindAgentFleetListAsideProps): ReactNode {
  const {
    docket,
    hiddenInFlight,
    hiddenSettled,
    matterChoices,
    matterLabelById = {},
    matterFilter,
    onMatterFilter,
    onlyNeedsYou,
    onOnlyNeedsYou,
    selectedId,
    onSelectRun,
    inFlightOpen,
    settledOpen,
    onToggleBand,
    pendingTeachCount,
    onOpenMemoryInspector,
    onShowAll,
    onReturnToMatter,
    returnMatterLabel,
  } = props;
  const requireSignoffReview = useRequireSignoffReview();
  const needsCount = docket.needsYou.length;

  return (
    <aside className="lm-agents-wb-list" aria-label="在办">
      <div className="lm-agents-wb-list-toolbar">
        <button
          type="button"
          className="lm-agents-wb-pill"
          data-tone={onlyNeedsYou ? "warn" : undefined}
          data-testid="lm-fleet-decision-focus-lead"
          aria-pressed={onlyNeedsYou}
          title={lawyerFacingQueueScopeHint(requireSignoffReview)}
          onClick={() => onOnlyNeedsYou(!onlyNeedsYou)}
        >
          只看要我处理{needsCount > 0 ? ` ${needsCount}` : ""}
        </button>
        {matterChoices.length > 0 ? (
          <label className="lm-agents-wb-matter-filter">
            <span className="lm-sr-only">按案件筛选</span>
            <select
              className="lm-input lm-agents-wb-matter-select"
              data-testid="lm-fleet-matter-filter"
              value={matterFilter}
              onChange={(e) => onMatterFilter(e.target.value)}
            >
              <option value="all">全部案件</option>
              {matterChoices.map((mid) => (
                <option key={mid} value={mid}>
                  {matterLabelById[mid]?.trim() || mid}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {onReturnToMatter ? (
          <button
            type="button"
            className="lm-agents-wb-pill lm-agents-wb-pill-btn"
            data-testid="lm-fleet-return-matter"
            onClick={() => onReturnToMatter()}
          >
            回这卷{returnMatterLabel ? ` · ${returnMatterLabel}` : ""}
          </button>
        ) : null}
        {pendingTeachCount > 0 ? (
          onOpenMemoryInspector ? (
            <button
              type="button"
              className="lm-agents-wb-pill lm-agents-wb-pill-btn"
              data-tone="info"
              data-testid="lm-fleet-pending-teach"
              title="打开设置里的记忆，确认要记住的做法"
              onClick={() => onOpenMemoryInspector()}
            >
              待教 {pendingTeachCount}
            </button>
          ) : (
            <span className="lm-agents-wb-pill" data-tone="info" data-testid="lm-fleet-pending-teach">
              待教 {pendingTeachCount}
            </span>
          )
        ) : null}
      </div>
      <div className="lm-agents-wb-list-scroll">
        {onlyNeedsYou && needsCount === 0 && (hiddenInFlight > 0 || hiddenSettled > 0) ? (
          <div className="lm-agents-wb-band-note" data-testid="lm-fleet-needs-clear">
            <p>没有要你处理的。</p>
            <button type="button" className="lm-btn lm-btn-secondary lm-btn-sm" onClick={() => onShowAll?.()}>
              看正在办的和今天办完的
            </button>
          </div>
        ) : null}
        {needsCount > 0 ? (
          <DocketBand
            id="needsYou"
            items={docket.needsYou}
            open
            matterLabelById={matterLabelById}
            selectedId={selectedId}
            onSelectRun={onSelectRun}
          />
        ) : null}
        {docket.inFlight.length > 0 ? (
          <DocketBand
            id="inFlight"
            items={docket.inFlight}
            open={inFlightOpen}
            onToggle={() => onToggleBand("inFlight")}
            matterLabelById={matterLabelById}
            selectedId={selectedId}
            onSelectRun={onSelectRun}
          />
        ) : null}
        {docket.settled.length > 0 ? (
          <DocketBand
            id="settled"
            items={docket.settled}
            open={settledOpen}
            onToggle={() => onToggleBand("settled")}
            matterLabelById={matterLabelById}
            selectedId={selectedId}
            onSelectRun={onSelectRun}
          />
        ) : null}
      </div>
    </aside>
  );
}

function DocketBand(props: {
  id: DocketBandId;
  items: AgentRunSummary[];
  open: boolean;
  onToggle?: () => void;
  matterLabelById: Record<string, string>;
  selectedId: string | null;
  onSelectRun: (id: string) => void;
}): ReactNode {
  const label = docketBandLabel(props.id);
  const panelId = `lm-fleet-band-panel-${props.id}`;
  return (
    <div
      className={`lm-agents-wb-group${props.open ? " lm-agents-wb-group--open" : ""}`}
      data-kind={props.id}
      data-testid={`lm-fleet-band-${props.id}`}
    >
      {props.onToggle ? (
        <button
          type="button"
          className="lm-agents-wb-group-toggle"
          data-kind={props.id}
          data-testid={`lm-fleet-band-toggle-${props.id}`}
          aria-expanded={props.open}
          aria-controls={panelId}
          onClick={props.onToggle}
        >
          <span className="lm-agents-wb-group-label-text">{label}</span>
          <span className="lm-agents-wb-group-count" aria-label={`${props.items.length} 件`}>
            {props.items.length}
          </span>
          <span className="lm-agents-wb-group-chevron" aria-hidden />
        </button>
      ) : (
        <div className="lm-agents-wb-group-toggle" data-kind={props.id}>
          <span className="lm-agents-wb-group-label-text">{label}</span>
          <span className="lm-agents-wb-group-count" aria-label={`${props.items.length} 件`}>
            {props.items.length}
          </span>
        </div>
      )}
      {props.open ? (
        <div id={panelId} className="lm-agents-wb-group-panel" role="region" aria-label={label}>
          {props.items.map((run) => (
            <DocketRow
              key={run.id}
              run={run}
              matterLabel={matterLine(run, props.matterLabelById)}
              selected={run.id === props.selectedId}
              onSelect={() => props.onSelectRun(run.id)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function DocketRow(props: {
  run: AgentRunSummary;
  matterLabel: string;
  selected: boolean;
  onSelect: () => void;
}): ReactNode {
  const { run } = props;
  const tone = docketRowTone(run);
  const title = rowTitle(run);
  const status = docketRowStatusLabel(run);
  const source = docketSourceLabel(run);
  const when = docketWhenLabel(run.updatedAt);
  const meta = [props.matterLabel, when, source].filter(Boolean).join(" · ");
  const progress =
    run.status === "running" && run.progress && run.progress.total > 0
      ? `${run.progress.completed}/${run.progress.total} 步`
      : "";
  return (
    <button
      type="button"
      className="lm-agents-wb-row"
      data-kind={tone}
      data-fleet-run-id={run.id}
      aria-selected={props.selected}
      aria-label={`${status} ${title}`}
      data-testid={`lm-agent-fleet-card-${run.kind}`}
      onClick={props.onSelect}
    >
      <span className="lm-agents-wb-row-kind" data-kind={tone}>
        {status}
      </span>
      <span className="lm-agents-wb-row-body">
        <span className="lm-agents-wb-row-title">{title}</span>
        {meta || progress ? (
          <span className="lm-agents-wb-row-matter">
            {meta}
            {progress ? `${meta ? " · " : ""}${progress}` : ""}
          </span>
        ) : null}
      </span>
    </button>
  );
}
