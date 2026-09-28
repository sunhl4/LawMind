/**
 * 在办左栏：停在你这里 / 正在办 / 今天办完。
 */
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import type { AgentRunSummary } from "./lawmind-agent-fleet-api";
import { chatSessionListKeyAction } from "./lawmind-chat-session-selection";
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
  /** 多选集合。不传时单击仍只打开这一件。 */
  pickedIds?: ReadonlySet<string>;
  onPointerSelect?: (
    event: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean },
    id: string,
  ) => void;
  onListKeyAction?: (action: "select-all" | "collapse" | "delete") => void;
  batch?: {
    count: number;
    canSend: boolean;
    busy: boolean;
    onReject: () => void;
    onApprove: () => void;
    onSnooze: () => void;
  } | null;
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
    pickedIds,
    onPointerSelect,
    onListKeyAction,
    batch = null,
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
      {batch && batch.count > 1 ? (
        <div className="lm-agents-wb-batch" data-testid="lm-fleet-batch">
          <span className="lm-agents-wb-batch-count">已选 {batch.count}</span>
          {batch.canSend ? (
            <>
              <button
                type="button"
                className="lm-btn lm-btn-accent lm-btn-sm"
                data-testid="lm-fleet-batch-approve"
                disabled={batch.busy}
                onClick={() => batch.onApprove()}
              >
                批准发送
              </button>
              <button
                type="button"
                className="lm-btn lm-btn-secondary lm-btn-sm"
                data-testid="lm-fleet-batch-reject"
                disabled={batch.busy}
                onClick={() => batch.onReject()}
              >
                驳回
              </button>
            </>
          ) : (
            <span>不全是待发信，只能一起稍后。</span>
          )}
          <button
            type="button"
            className="lm-btn lm-btn-ghost lm-btn-sm"
            data-testid="lm-fleet-batch-snooze"
            disabled={batch.busy}
            onClick={() => batch.onSnooze()}
          >
            稍后
          </button>
        </div>
      ) : null}
      <div
        className="lm-agents-wb-list-scroll lm-scroll"
        title="Shift 连选，Ctrl 或 ⌘ 加选"
        onKeyDown={(e) => {
          if (!onListKeyAction) {
            return;
          }
          const action = chatSessionListKeyAction(
            {
              key: e.key,
              metaKey: e.metaKey,
              ctrlKey: e.ctrlKey,
              altKey: e.altKey,
              shiftKey: e.shiftKey,
              targetIsField: eventTargetIsField(e.target),
            },
            pickedIds?.size ?? 0,
          );
          if (action === "none") {
            return;
          }
          e.preventDefault();
          onListKeyAction(action);
        }}
      >
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
            pickedIds={pickedIds}
            onSelectRun={onSelectRun}
            onPointerSelect={onPointerSelect}
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
            pickedIds={pickedIds}
            onSelectRun={onSelectRun}
            onPointerSelect={onPointerSelect}
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
            pickedIds={pickedIds}
            onSelectRun={onSelectRun}
            onPointerSelect={onPointerSelect}
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
  pickedIds?: ReadonlySet<string>;
  onSelectRun: (id: string) => void;
  onPointerSelect?: (
    event: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean },
    id: string,
  ) => void;
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
              current={run.id === props.selectedId}
              picked={props.pickedIds ? props.pickedIds.has(run.id) : run.id === props.selectedId}
              onSelect={() => props.onSelectRun(run.id)}
              onPointerSelect={
                props.onPointerSelect
                  ? (event) => props.onPointerSelect?.(event, run.id)
                  : undefined
              }
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function eventTargetIsField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

function DocketRow(props: {
  run: AgentRunSummary;
  matterLabel: string;
  current: boolean;
  picked: boolean;
  onSelect: () => void;
  onPointerSelect?: (event: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) => void;
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
      aria-selected={props.picked}
      aria-current={props.current ? "true" : undefined}
      aria-label={`${status} ${title}`}
      data-testid={`lm-agent-fleet-card-${run.kind}`}
      onClick={(event: ReactMouseEvent<HTMLButtonElement>) => {
        if (event.shiftKey) {
          event.preventDefault();
        }
        if (props.onPointerSelect) {
          props.onPointerSelect({
            shiftKey: event.shiftKey,
            metaKey: event.metaKey,
            ctrlKey: event.ctrlKey,
          });
          return;
        }
        props.onSelect();
      }}
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
