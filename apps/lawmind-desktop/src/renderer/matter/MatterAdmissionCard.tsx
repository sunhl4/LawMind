/**
 * 收案卡（P1.3）：把「扫描冲突 → 确认告知 → 律师接受/婉拒」放进案件页。
 *
 * 这一块取代旧的「已完成利益冲突检查 / 已正式接受委托」两个勾选框：
 * 两个勾选框只是把 matter.status 改成 active，没有扫描记录、没有来源、
 * 没有负责人，也没有 AI 使用告知。收案卡只调用收案 API，服务端仍会再验一遍。
 */

import { useEffect, useState, type ReactNode } from "react";
import { apiGetJson, apiSendJson, errorMessage } from "../api-client";

type CandidateRole = "client" | "counterparty" | "related" | "unknown";

type AdmissionCandidate = {
  name: string;
  role: CandidateRole;
  source: "intake" | "lawyer";
  itemId?: string;
  label?: string;
};

type AdmissionConflictHit = {
  matterId: string;
  matterTitle?: string;
  partyName: string;
  reason: string;
  source: string;
};

type EngagementFile = { name: string; relativePath: string; bytes: number };

type EngagementManifest = {
  generatedAt: string;
  files: EngagementFile[];
  esign: { status: string };
  docx?: { generatedAt: string; files: EngagementFile[] };
};

type ProvenanceEntry = {
  field: string;
  value: string;
  quote: string;
  itemId: string;
  status: "applied" | "same" | "conflict";
  capturedAt: string;
};

type ProvenanceView = {
  entries: ProvenanceEntry[];
  coverage: { missing: Array<{ field: string; value: string }> };
};

type LegalEvent = {
  eventKind: string;
  title: string;
  dueAt?: string;
  notes?: string;
  confidence: "high" | "medium" | "low";
};

type DeadlineView = {
  deadlineId: string;
  title: string;
  dueAt: string;
};

const PROVENANCE_LABELS: Record<string, string> = {
  clientId: "客户",
  counterparty: "对方当事人",
  causeOfAction: "案由",
  matterLabel: "事项名称",
  "docket.caseNo": "案号",
  "docket.court": "法院",
  "docket.instance": "审级",
  "docket.standing": "诉讼地位",
};

export type AdmissionView = {
  admissionId: string;
  matterId: string;
  status: "prospective" | "conflict_pending" | "lawyer_review" | "accepted" | "declined";
  candidates: AdmissionCandidate[];
  sourceItemIds: string[];
  ownerLawyerId?: string;
  conflict: {
    status: "pending" | "clear" | "hit";
    scannedAt?: string;
    hits: AdmissionConflictHit[];
    note?: string;
    overrideReason?: string;
  };
  riskDisclosure: { status: "missing" | "acknowledged" };
  aiDisclosure: { status: "missing" | "acknowledged" };
  decision?: { kind: "accept" | "decline"; by: string; at: string; note?: string };
  timeline?: Array<{ at: string; kind: string; by: "system" | "lawyer"; detail?: string }>;
};

type Props = {
  apiBase: string;
  matterId: string;
  matterStatus: string;
  onAccepted?: () => void;
  onDeclined?: () => void;
};

const STATUS_LABEL: Record<AdmissionView["status"], string> = {
  prospective: "待冲突扫描",
  conflict_pending: "扫描中",
  lawyer_review: "待律师审核",
  accepted: "已接受委托",
  declined: "已婉拒",
};

const STATUS_TONE: Record<AdmissionView["status"], string> = {
  prospective: "lm-pill-warn",
  conflict_pending: "lm-pill-warn",
  lawyer_review: "lm-pill-info",
  accepted: "lm-pill-success",
  declined: "lm-pill-danger",
};

const ROLE_LABEL: Record<CandidateRole, string> = {
  client: "委托人",
  counterparty: "对方",
  related: "关联方",
  unknown: "待定",
};

const TIMELINE_KIND_LABEL: Record<string, string> = {
  created: "建立收案记录",
  owner_assigned: "指定负责人",
  candidates_added: "补登候选当事人",
  scan_started: "开始冲突扫描",
  scan_recorded: "写入扫描结果",
  disclosure_acknowledged: "确认告知",
  accepted: "接受委托",
  declined: "婉拒",
};

const TIMELINE_BY_LABEL: Record<string, string> = {
  system: "系统",
  lawyer: "律师",
};

/** 收案记录自带的时间线：谁在什么时候做了什么，倒序显示。 */
function AdmissionTimeline({
  entries,
}: {
  entries: NonNullable<AdmissionView["timeline"]>;
}): ReactNode {
  if (entries.length === 0) {
    return null;
  }
  const ordered = [...entries].toSorted((a, b) => b.at.localeCompare(a.at));
  return (
    <details className="lm-matter-admission-timeline" data-testid="lm-matter-admission-timeline">
      <summary>操作记录 {ordered.length}</summary>
      <ol className="lm-matter-admission-timeline-list">
        {ordered.map((entry, index) => (
          <li key={`${entry.at}-${entry.kind}-${index}`}>
            <time dateTime={entry.at}>{new Date(entry.at).toLocaleString()}</time>
            <span>{TIMELINE_KIND_LABEL[entry.kind] ?? entry.kind}</span>
            <span className="lm-meta">
              {TIMELINE_BY_LABEL[entry.by] ?? entry.by}
              {entry.detail ? ` · ${entry.detail}` : ""}
            </span>
          </li>
        ))}
      </ol>
    </details>
  );
}

function errorStatus(error: unknown): number | undefined {
  if (typeof error === "object" && error !== null && "status" in error) {
    const status = (error as { status?: unknown }).status;
    return typeof status === "number" ? status : undefined;
  }
  return undefined;
}

function errorCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "body" in error) {
    const body = (error as { body?: unknown }).body;
    if (typeof body === "object" && body !== null && "error" in body) {
      const code = (body as { error?: unknown }).error;
      return typeof code === "string" ? code : undefined;
    }
  }
  return undefined;
}

function admissionErrorMessage(error: unknown): string {
  switch (errorCode(error)) {
    case "conflict_pending":
      return "冲突扫描还没完成，先运行扫描。";
    case "conflict_override_required":
      return "扫描有命中，接受委托前必须填写书面理由。";
    case "disclosures_missing":
      return "先确认风险告知与 AI 使用告知。";
    case "owner_missing":
      return "先指定本案负责人。";
    case "no_candidates":
      return "先添加候选当事人；空扫描不能当作无冲突。";
    case "already_decided":
      return "这条收案记录已经有决定，不能重复操作。";
    case "not_found":
      return "收案记录不存在，请先开始收案。";
    case "exists":
      return "委托包或 DOCX 已存在（可能被律师改过）。确认覆盖后再继续。";
    case "missing_fields":
      return "先填委托人和律师费。";
    case "package_not_found":
      return "先生成委托包草案，再导出 DOCX。";
    case "render_failed":
      return "DOCX 渲染失败，请检查委托包正文是否完整。";
    case "write_failed":
      return "DOCX 写入失败，请检查工作区是否可写。";
    default:
      return errorMessage(error, "收案操作失败");
  }
}

export function MatterAdmissionCard(props: Props): ReactNode {
  const { apiBase, matterId, matterStatus, onAccepted, onDeclined } = props;
  const [admission, setAdmission] = useState<AdmissionView | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [candidateName, setCandidateName] = useState("");
  const [candidateRole, setCandidateRole] = useState<CandidateRole>("client");
  const [ownerId, setOwnerId] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [declineOpen, setDeclineOpen] = useState(false);
  const [declineNote, setDeclineNote] = useState("");
  const [engagement, setEngagement] = useState<EngagementManifest | null>(null);
  const [engagementClient, setEngagementClient] = useState("");
  const [engagementFee, setEngagementFee] = useState("");
  const [engagementBusy, setEngagementBusy] = useState(false);
  const [engagementErr, setEngagementErr] = useState<string | null>(null);
  const [engagementDocxBusy, setEngagementDocxBusy] = useState(false);
  const [engagementDocxErr, setEngagementDocxErr] = useState<string | null>(null);
  const [overwriteOpen, setOverwriteOpen] = useState(false);
  const [docxOverwriteOpen, setDocxOverwriteOpen] = useState(false);
  const [provenance, setProvenance] = useState<ProvenanceView | null>(null);
  const [legalEvents, setLegalEvents] = useState<LegalEvent[] | null>(null);
  const [selectedEvents, setSelectedEvents] = useState<Set<number>>(new Set());
  const [legalEventBusy, setLegalEventBusy] = useState(false);
  const [legalEventErr, setLegalEventErr] = useState<string | null>(null);
  const [createdDeadlines, setCreatedDeadlines] = useState<DeadlineView[]>([]);

  const path = `/api/intake/admissions/${encodeURIComponent(matterId)}`;
  const engagementPath = `${path}/engagement`;

  const loadProvenance = async () => {
    try {
      const j = await apiGetJson<ProvenanceView & { ok: boolean }>(apiBase, `${path}/provenance`);
      setProvenance({ entries: j.entries ?? [], coverage: j.coverage ?? { missing: [] } });
    } catch (e) {
      if (errorStatus(e) === 404) {
        setProvenance(null);
      }
    }
  };

  const loadEngagement = async () => {
    try {
      const j = await apiGetJson<{ ok: boolean; manifest?: EngagementManifest }>(
        apiBase,
        engagementPath,
      );
      setEngagement(j.manifest ?? null);
    } catch (e) {
      if (errorStatus(e) === 404) {
        setEngagement(null);
      }
      // 委托包读不到不阻塞收案卡；生成时会再报具体错误。
    }
  };

  const load = async () => {
    try {
      const j = await apiGetJson<{ ok: boolean; admission?: AdmissionView }>(apiBase, path);
      setAdmission(j.admission ?? null);
    } catch (e) {
      if (errorStatus(e) === 404) {
        setAdmission(null);
        return;
      }
      setErr(admissionErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    setErr(null);
    setMsg(null);
    void load();
    void loadEngagement();
    void loadProvenance();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- matterId 变化时重新拉取
  }, [apiBase, matterId]);

  useEffect(() => {
    if (!engagementClient && admission) {
      const client = admission.candidates.find((row) => row.role === "client")?.name;
      if (client) {
        setEngagementClient(client);
      }
    }
  }, [admission, engagementClient]);

  const act = async (body: Record<string, unknown>, okMessage: string): Promise<boolean> => {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const j = await apiSendJson<{ ok: boolean; admission?: AdmissionView }>(
        apiBase,
        path,
        "POST",
        body,
      );
      if (j.admission) {
        setAdmission(j.admission);
      }
      setMsg(okMessage);
      return true;
    } catch (e) {
      setErr(admissionErrorMessage(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const start = async () => {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const j = await apiSendJson<{ ok: boolean; admission?: AdmissionView }>(
        apiBase,
        "/api/intake/admissions",
        "POST",
        { matterId },
      );
      setAdmission(j.admission ?? null);
      setMsg("收案记录已建立：先补齐当事人，再运行冲突扫描。");
    } catch (e) {
      setErr(admissionErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const addCandidate = async () => {
    const name = candidateName.trim();
    if (!name) {
      setErr("先填当事人姓名或公司名。");
      return;
    }
    await act(
      { action: "add_candidates", candidates: [{ name, role: candidateRole, source: "lawyer" }] },
      "已添加候选当事人。",
    );
    setCandidateName("");
  };

  const generateEngagement = async (overwrite: boolean) => {
    if (!engagementClient.trim() || !engagementFee.trim()) {
      setEngagementErr("先填委托人和律师费。");
      return;
    }
    setEngagementBusy(true);
    setEngagementErr(null);
    setOverwriteOpen(false);
    setMsg(null);
    try {
      const j = await apiSendJson<{ ok: boolean; manifest?: EngagementManifest }>(
        apiBase,
        engagementPath,
        "POST",
        {
          clientName: engagementClient.trim(),
          feeText: engagementFee.trim(),
          ...(admission?.ownerLawyerId ? { lawyerName: admission.ownerLawyerId } : {}),
          ...(overwrite ? { overwrite: true } : {}),
        },
      );
      if (j.manifest) {
        setEngagement(j.manifest);
      }
      setMsg("委托包草案已生成，请律师核对后再对外。");
    } catch (e) {
      if (errorCode(e) === "exists") {
        setOverwriteOpen(true);
      }
      setEngagementErr(admissionErrorMessage(e));
    } finally {
      setEngagementBusy(false);
    }
  };

  const exportEngagementDocx = async (overwrite: boolean) => {
    setEngagementDocxBusy(true);
    setEngagementDocxErr(null);
    setDocxOverwriteOpen(false);
    setMsg(null);
    try {
      const j = await apiSendJson<{
        ok: boolean;
        generatedAt?: string;
        files?: EngagementFile[];
      }>(apiBase, `${engagementPath}/docx`, "POST", overwrite ? { overwrite: true } : {});
      const generatedAt = j.generatedAt;
      const files = j.files;
      if (generatedAt && files) {
        setEngagement((prev) =>
          prev ? { ...prev, docx: { generatedAt, files } } : prev,
        );
      }
      setMsg(`委托包 DOCX 已导出（${files?.length ?? 0} 份）。Markdown 仍是真相源。`);
    } catch (e) {
      if (errorCode(e) === "exists") {
        setDocxOverwriteOpen(true);
      }
      setEngagementDocxErr(admissionErrorMessage(e));
    } finally {
      setEngagementDocxBusy(false);
    }
  };

  const extractDeadlines = async () => {
    const itemId = admission?.sourceItemIds?.[0];
    if (!itemId) {
      setLegalEventErr("没有来源来件，无法抽取期限。");
      return;
    }
    setLegalEventBusy(true);
    setLegalEventErr(null);
    setCreatedDeadlines([]);
    try {
      const j = await apiGetJson<{ ok: boolean; events?: LegalEvent[] }>(
        apiBase,
        `/api/intake/items/${encodeURIComponent(itemId)}/legal-events`,
      );
      const events = j.events ?? [];
      setLegalEvents(events);
      setSelectedEvents(
        new Set(events.flatMap((event, index) => (event.dueAt ? [index] : []))),
      );
      if (events.length === 0) {
        setLegalEventErr("这封来信里没有识别到期限。");
      }
    } catch (e) {
      setLegalEventErr(admissionErrorMessage(e));
    } finally {
      setLegalEventBusy(false);
    }
  };

  const confirmDeadlines = async () => {
    const events = (legalEvents ?? []).filter(
      (event, index): event is LegalEvent & { dueAt: string } =>
        selectedEvents.has(index) && Boolean(event.dueAt),
    );
    if (events.length === 0) {
      setLegalEventErr("先勾选至少一个带日期的期限。");
      return;
    }
    setLegalEventBusy(true);
    setLegalEventErr(null);
    try {
      const j = await apiSendJson<{ ok: boolean; deadlines?: DeadlineView[] }>(
        apiBase,
        `${path}/legal-events`,
        "POST",
        {
          events: events.map((event) => ({
            eventKind: event.eventKind,
            title: event.title,
            dueAt: event.dueAt,
            ...(event.notes ? { notes: event.notes } : {}),
          })),
        },
      );
      setCreatedDeadlines(j.deadlines ?? []);
      setMsg("期限已写入本案期限链。");
    } catch (e) {
      setLegalEventErr(admissionErrorMessage(e));
    } finally {
      setLegalEventBusy(false);
    }
  };

  const accept = async () => {
    const ok = await act(
      {
        action: "accept",
        ...(overrideReason.trim() ? { overrideReason: overrideReason.trim() } : {}),
      },
      "已接受委托，案件进入办理中。",
    );
    if (!ok) {
      return;
    }
    setOverrideReason("");
    onAccepted?.();
  };

  const decline = async () => {
    const ok = await act(
      { action: "decline", ...(declineNote.trim() ? { note: declineNote.trim() } : {}) },
      "已婉拒，案件保持接洽中。",
    );
    if (!ok) {
      return;
    }
    setDeclineOpen(false);
    setDeclineNote("");
    onDeclined?.();
  };

  if (loading) {
    return (
      <section className="lm-matter-cockpit-card lm-matter-admission-card" aria-label="收案">
        <p className="lm-meta">读取收案记录…</p>
      </section>
    );
  }

  if (!admission && matterStatus !== "intake") {
    return null;
  }

  if (!admission) {
    return (
      <section className="lm-matter-cockpit-card lm-matter-admission-card" aria-label="收案">
        <div className="lm-matter-profile-card-head">
          <div>
            <h3>收案</h3>
            <p className="lm-meta">
              先跑利益冲突扫描、确认风险与 AI 使用告知，再由律师接受委托。未接受委托前，本案不能外发。
            </p>
          </div>
        </div>
        {err ? (
          <p className="lm-error" role="alert">
            {err}
          </p>
        ) : null}
        <div className="lm-matter-profile-actions">
          <button type="button" className="lm-btn lm-btn-sm" disabled={busy} onClick={() => void start()}>
            {busy ? "建立中…" : "开始收案"}
          </button>
        </div>
      </section>
    );
  }

  const decided = admission.status === "accepted" || admission.status === "declined";
  const hasHits = admission.conflict.hits.length > 0;
  const disclosuresDone =
    admission.riskDisclosure.status === "acknowledged" &&
    admission.aiDisclosure.status === "acknowledged";
  const canAccept =
    !decided &&
    admission.conflict.status !== "pending" &&
    disclosuresDone &&
    Boolean(admission.ownerLawyerId?.trim()) &&
    (!hasHits || overrideReason.trim().length > 0);

  const latestProvenance = (() => {
    const map = new Map<string, ProvenanceEntry>();
    for (const entry of provenance?.entries ?? []) {
      if (entry.status === "applied" || entry.status === "same") {
        map.set(entry.field, entry);
      }
    }
    return [...map.values()];
  })();
  const provenanceConflicts = (() => {
    const map = new Map<string, ProvenanceEntry>();
    for (const entry of provenance?.entries ?? []) {
      if (entry.status === "conflict") {
        map.set(entry.field, entry);
      }
    }
    return [...map.values()];
  })();

  if (admission.status === "accepted" || admission.status === "declined") {
    return (
      <section className="lm-matter-cockpit-card lm-matter-admission-card" aria-label="收案">
        <div className="lm-matter-profile-card-head">
          <div>
            <h3>收案</h3>
            <p className="lm-meta">
              {admission.status === "accepted"
                ? `已由 ${admission.decision?.by ?? "律师"} 接受委托，冲突扫描与告知记录已归档。`
                : `已婉拒${admission.decision?.note ? `：${admission.decision.note}` : "。"}`}
            </p>
            <p className="lm-meta">
              委托包：
              {engagement
                ? `已生成 ${engagement.files.length} 份草案（须律师核对）`
                : "未生成"}
            </p>
          </div>
          <span className={`lm-pill ${STATUS_TONE[admission.status]}`}>
            {STATUS_LABEL[admission.status]}
          </span>
        </div>
        <AdmissionTimeline entries={admission.timeline ?? []} />
      </section>
    );
  }

  return (
    <section className="lm-matter-cockpit-card lm-matter-admission-card" aria-label="收案">
      <div className="lm-matter-profile-card-head">
        <div>
          <h3>收案</h3>
          <p className="lm-meta">
            扫描是确定性匹配，命中只提示风险；接受或婉拒由律师决定。未接受委托前，本案不能外发。
          </p>
        </div>
        <span className={`lm-pill ${STATUS_TONE[admission.status]}`}>
          {STATUS_LABEL[admission.status]}
        </span>
      </div>

      <div className="lm-matter-profile-form">
        <div className="lm-matter-admission-owner">
          <label className="lm-field">
            <span>负责人</span>
            <input
              type="text"
              value={ownerId || admission.ownerLawyerId || ""}
              onChange={(e) => setOwnerId(e.target.value)}
              placeholder="律师 ID"
              disabled={busy || decided}
              autoComplete="off"
            />
          </label>
          <button
            type="button"
            className="lm-btn lm-btn-ghost lm-btn-sm"
            disabled={busy || decided || !(ownerId || admission.ownerLawyerId)?.trim()}
            onClick={() =>
              void act(
                { action: "assign", ownerLawyerId: (ownerId || admission.ownerLawyerId || "").trim() },
                "已指定负责人。",
              )
            }
          >
            指定
          </button>
        </div>

        <fieldset className="lm-matter-profile-checks" disabled={busy || decided}>
          <legend>候选当事人</legend>
          {admission.candidates.length === 0 ? (
            <p className="lm-meta">还没有候选当事人。扫描前至少添加一个委托人/对方/关联方。</p>
          ) : (
            <ul className="lm-matter-admission-list">
              {admission.candidates.map((row) => (
                <li key={`${row.name}-${row.role}`}>
                  <span>{row.name}</span>
                  <span className="lm-meta">
                    {ROLE_LABEL[row.role]}
                    {row.label ? ` · ${row.label}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="lm-matter-admission-add">
            <input
              type="text"
              className="lm-input"
              value={candidateName}
              onChange={(e) => setCandidateName(e.target.value)}
              placeholder="姓名或公司名"
              disabled={busy || decided}
              autoComplete="off"
            />
            <select
              className="lm-input"
              value={candidateRole}
              onChange={(e) => setCandidateRole(e.target.value as CandidateRole)}
              disabled={busy || decided}
            >
              <option value="client">委托人</option>
              <option value="counterparty">对方</option>
              <option value="related">关联方</option>
            </select>
            <button
              type="button"
              className="lm-btn lm-btn-ghost lm-btn-sm"
              disabled={busy || decided}
              onClick={() => void addCandidate()}
            >
              添加
            </button>
          </div>
        </fieldset>

        <fieldset className="lm-matter-profile-checks" disabled={busy || decided}>
          <legend>利益冲突</legend>
          <div className="lm-matter-admission-scan">
            <button
              type="button"
              className="lm-btn lm-btn-sm"
              disabled={busy || decided}
              onClick={() => void act({ action: "scan_run" }, "冲突扫描已写入收案记录。")}
            >
              {admission.conflict.status === "pending" ? "运行冲突扫描" : "重新扫描"}
            </button>
            <span className="lm-meta">
              {admission.conflict.scannedAt
                ? `上次扫描：${new Date(admission.conflict.scannedAt).toLocaleString()}`
                : "尚未扫描"}
            </span>
          </div>
          {hasHits ? (
            <ul className="lm-matter-admission-hits">
              {admission.conflict.hits.map((hit) => (
                <li key={`${hit.matterId}-${hit.partyName}`}>
                  <strong>{hit.partyName}</strong>
                  <span>
                    {hit.matterTitle ? `${hit.matterTitle}（${hit.matterId}）` : hit.matterId}
                  </span>
                  <span className="lm-meta">
                    {hit.reason} · 来源：{hit.source}
                  </span>
                </li>
              ))}
            </ul>
          ) : admission.conflict.status === "pending" ? (
            <p className="lm-meta">扫描前不能接受委托。</p>
          ) : (
            <p className="lm-meta">未发现命中。字符串/身份匹配不是律师判断，仍须结合所知客户关系确认。</p>
          )}
        </fieldset>

        <fieldset className="lm-matter-profile-checks" disabled={busy || decided}>
          <legend>告知</legend>
          <label className="lm-check-row">
            <input
              type="checkbox"
              checked={admission.riskDisclosure.status === "acknowledged"}
              disabled={busy || decided || admission.riskDisclosure.status === "acknowledged"}
              onChange={(e) =>
                void act({ action: "acknowledge", risk: e.target.checked }, "风险告知已记录。")
              }
            />
            <span>已完成风险告知</span>
          </label>
          <label className="lm-check-row">
            <input
              type="checkbox"
              checked={admission.aiDisclosure.status === "acknowledged"}
              disabled={busy || decided || admission.aiDisclosure.status === "acknowledged"}
              onChange={(e) =>
                void act({ action: "acknowledge", ai: e.target.checked }, "AI 使用告知已记录。")
              }
            />
            <span>已完成 AI 使用告知并取得同意</span>
          </label>
        </fieldset>

        <fieldset
          className="lm-matter-profile-checks"
          disabled={busy || engagementBusy || engagementDocxBusy}
        >
          <legend>委托包（草案）</legend>
          {engagement ? (
            <div className="lm-matter-engagement-summary">
              <p className="lm-meta">
                已生成 {engagement.files.length} 份草案 ·{" "}
                {new Date(engagement.generatedAt).toLocaleString()} · 电子签：占位（未接入）
              </p>
              <ul className="lm-matter-admission-list">
                {engagement.files.map((file) => (
                  <li key={file.relativePath}>
                    <span>{file.name}</span>
                    <span className="lm-meta">{file.relativePath}</span>
                  </li>
                ))}
              </ul>
              {engagement.docx ? (
                <p className="lm-meta">
                  已导出 Word {engagement.docx.files.length} 份 ·{" "}
                  {new Date(engagement.docx.generatedAt).toLocaleString()} · 从当前 Markdown 生成
                </p>
              ) : null}
            </div>
          ) : (
            <p className="lm-meta">
              接受委托前可先生成委托合同、授权委托书、风险告知、AI 使用告知和报价单草案；全部标注「须律师核对」。
            </p>
          )}
          <div className="lm-matter-engagement-form">
            <label className="lm-field">
              <span>委托人</span>
              <input
                type="text"
                value={engagementClient}
                onChange={(e) => setEngagementClient(e.target.value)}
                placeholder="委托人姓名或公司名"
                disabled={busy || engagementBusy}
                autoComplete="off"
              />
            </label>
            <label className="lm-field">
              <span>律师费</span>
              <input
                type="text"
                value={engagementFee}
                onChange={(e) => setEngagementFee(e.target.value)}
                placeholder="例如 按标的额 5% 收取"
                disabled={busy || engagementBusy}
                autoComplete="off"
              />
            </label>
          </div>
          <div className="lm-matter-admission-actions">
            <button
              type="button"
              className="lm-btn lm-btn-sm"
              disabled={busy || engagementBusy || engagementDocxBusy}
              onClick={() => void generateEngagement(false)}
            >
              {engagement ? "重新生成" : "生成委托包"}
            </button>
            {overwriteOpen ? (
              <button
                type="button"
                className="lm-btn lm-btn-sm"
                disabled={busy || engagementBusy || engagementDocxBusy}
                onClick={() => void generateEngagement(true)}
              >
                覆盖并重新生成
              </button>
            ) : null}
            {engagement ? (
              <button
                type="button"
                className="lm-btn lm-btn-sm"
                disabled={busy || engagementBusy || engagementDocxBusy}
                onClick={() => void exportEngagementDocx(false)}
              >
                {engagement.docx ? "重新导出 DOCX" : "导出 DOCX"}
              </button>
            ) : null}
            {docxOverwriteOpen ? (
              <button
                type="button"
                className="lm-btn lm-btn-sm"
                disabled={busy || engagementBusy || engagementDocxBusy}
                onClick={() => void exportEngagementDocx(true)}
              >
                覆盖并重新导出
              </button>
            ) : null}
          </div>
          {engagementErr ? (
            <p className="lm-error" role="alert">
              {engagementErr}
            </p>
          ) : null}
          {engagementDocxErr ? (
            <p className="lm-error" role="alert">
              {engagementDocxErr}
            </p>
          ) : null}
        </fieldset>

        {provenance &&
        (latestProvenance.length > 0 ||
          provenanceConflicts.length > 0 ||
          (provenance.coverage.missing?.length ?? 0) > 0) ? (
          <fieldset className="lm-matter-profile-checks" disabled={busy}>
            <legend>字段出处</legend>
            {latestProvenance.length > 0 ? (
              <ul className="lm-matter-admission-list">
                {latestProvenance.map((entry) => (
                  <li key={entry.field}>
                    <strong>{PROVENANCE_LABELS[entry.field] ?? entry.field}</strong>
                    <span>{entry.value}</span>
                    <span className="lm-meta">
                      来源 {entry.itemId} · 原文：{entry.quote}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            {provenanceConflicts.length > 0 ? (
              <p className="lm-meta">
                待核实（未覆盖卷宗）：
                {provenanceConflicts
                  .map(
                    (entry) => `${PROVENANCE_LABELS[entry.field] ?? entry.field}（来件写「${entry.value}」）`,
                  )
                  .join("、")}
              </p>
            ) : null}
            {provenance.coverage.missing?.length > 0 ? (
              <p className="lm-meta">
                无出处（律师手填）：
                {provenance.coverage.missing
                  .map((row) => PROVENANCE_LABELS[row.field] ?? row.field)
                  .join("、")}
              </p>
            ) : null}
          </fieldset>
        ) : null}

        <fieldset className="lm-matter-profile-checks" disabled={legalEventBusy}>
          <legend>期限</legend>
          <p className="lm-meta">
            从来源来信抽取传票/送达文书的日期；勾选后写入期限链。开庭会同步更新案件开庭日，其他期限会挂在开庭之后。
          </p>
          <div className="lm-matter-admission-actions">
            <button
              type="button"
              className="lm-btn lm-btn-sm"
              disabled={legalEventBusy || !(admission.sourceItemIds?.length > 0)}
              onClick={() => void extractDeadlines()}
            >
              {legalEvents ? "重新抽取" : "抽取期限"}
            </button>
          </div>
          {legalEvents && legalEvents.length > 0 ? (
            <>
              <ul className="lm-matter-admission-list">
                {legalEvents.map((event, index) => (
                  <li key={`${event.eventKind}-${index}`}>
                    <label className="lm-check-row">
                      <input
                        type="checkbox"
                        checked={selectedEvents.has(index)}
                        disabled={!event.dueAt || legalEventBusy}
                        onChange={(e) => {
                          setSelectedEvents((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) {
                              next.add(index);
                            } else {
                              next.delete(index);
                            }
                            return next;
                          });
                        }}
                      />
                      <span>{event.title}</span>
                    </label>
                    <span className="lm-meta">
                      {event.dueAt
                        ? new Date(event.dueAt).toLocaleString()
                        : "未识别到日期"}{" "}
                      · 置信度：{event.confidence}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="lm-matter-admission-actions">
                <button
                  type="button"
                  className="lm-btn lm-btn-sm"
                  disabled={legalEventBusy || selectedEvents.size === 0}
                  onClick={() => void confirmDeadlines()}
                >
                  写入期限
                </button>
              </div>
            </>
          ) : null}
          {createdDeadlines.length > 0 ? (
            <ul className="lm-matter-admission-list">
              {createdDeadlines.map((row) => (
                <li key={row.deadlineId}>
                  <strong>{row.title}</strong>
                  <span>{new Date(row.dueAt).toLocaleString()}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {legalEventErr ? (
            <p className="lm-error" role="alert">
              {legalEventErr}
            </p>
          ) : null}
        </fieldset>

        {hasHits ? (
          <label className="lm-field">
            <span>冲突命中仍接受委托的书面理由</span>
            <textarea
              value={overrideReason}
              onChange={(e) => setOverrideReason(e.target.value)}
              rows={3}
              disabled={busy || decided}
              placeholder="例如：已向双方书面披露并取得同意，或命中为同名不同主体。"
            />
          </label>
        ) : null}

        {err ? (
          <p className="lm-error" role="alert">
            {err}
          </p>
        ) : null}
        {msg ? (
          <p className="lm-meta" role="status">
            {msg}
          </p>
        ) : null}

        <div className="lm-matter-admission-actions">
          <button
            type="button"
            className="lm-btn lm-btn-sm"
            disabled={busy || !canAccept}
            onClick={() => void accept()}
          >
            {busy ? "处理中…" : "接受委托"}
          </button>
          <button
            type="button"
            className="lm-btn lm-btn-ghost lm-btn-sm"
            disabled={busy}
            onClick={() => setDeclineOpen((v) => !v)}
          >
            婉拒
          </button>
        </div>

        {declineOpen ? (
          <div className="lm-matter-admission-decline">
            <label className="lm-field">
              <span>婉拒原因（可选，会写进时间线）</span>
              <textarea
                value={declineNote}
                onChange={(e) => setDeclineNote(e.target.value)}
                rows={2}
                disabled={busy}
                placeholder="例如：超出业务范围 / 存在无法克服的冲突。"
              />
            </label>
            <button
              type="button"
              className="lm-btn lm-btn-sm"
              disabled={busy}
              onClick={() => void decline()}
            >
              确认婉拒
            </button>
          </div>
        ) : null}
      </div>
      <AdmissionTimeline entries={admission.timeline ?? []} />
    </section>
  );
}
