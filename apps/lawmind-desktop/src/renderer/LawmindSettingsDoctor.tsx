import { useEffect, useState, type ReactNode } from "react";
import { apiGetJson, apiSendJson, errorMessage, fetchApi } from "./api-client";
import { loadHealthPayload, type HealthPayload } from "./lawmind-app-data";
import { apiGetTriageRules } from "./lawmind-triage-api";
import {
  authorityCorpusStatusLabel,
  formatAuthorityProbeSuccessMsg,
  isAuthorityCorpusUiReady,
} from "./lawmind-settings-models";
import {
  DoctorConnectionGroup,
  DoctorIntegrationsGroup,
  DoctorPromptSectionsGroup,
  DoctorWorkspaceTruthGroup,
} from "./settings-doctor-groups";
import { isAutonomyUnlocked } from "../../../../src/lawmind/delivery/progressive-autonomy.ts";

type TeamGrowthMetricRow = {
  id: string;
  label: string;
  value: number | null;
  numerator: number;
  denominator: number;
  targetNote: string;
  baselineValue: number | null;
  deltaPts: number | null;
};

type NorthStarPayload = {
  ok?: boolean;
  firstPassRate?: number | null;
  unattendedCompleteRate?: number | null;
  reviewDurationMsMedian?: number | null;
  lintEscapeRate?: number | null;
  samples?: {
    firstPassOk?: number;
    firstPassFail?: number;
    unattended?: number;
    attended?: number;
    lintEscapes?: number;
    deliveries?: number;
  };
};

type TeamGrowthDashboardPayload = {
  ok?: boolean;
  capturedAt?: string;
  windowDays?: number;
  metrics?: TeamGrowthMetricRow[];
  baseline?: { capturedAt: string; note?: string; windowDays: number } | null;
};

type Props = {
  health: HealthPayload | null;
  apiBase: string;
  onOpenApiWizard: () => void;
  onOpenCollaborationPage: () => void;
  onScrollToWorkspace?: () => void;
  onOpenMemorySection?: () => void;
};

function pct(rate: number | undefined | null): string {
  if (rate == null || Number.isNaN(rate)) {
    return "n/a";
  }
  return `${Math.round(rate * 1000) / 10}%`;
}

function starPct(rate: number | undefined | null): string {
  if (rate == null || Number.isNaN(rate)) {
    return "尚无";
  }
  return pct(rate);
}

function formatDeltaPts(delta: number | null | undefined): string {
  if (delta == null || Number.isNaN(delta)) {
    return "—";
  }
  const sign = delta > 0 ? "+" : "";
  return `${sign}${delta}pt`;
}

export function LawmindSettingsDoctor(props: Props): ReactNode {
  const {
    health: healthProp,
    apiBase,
    onOpenApiWizard,
    onOpenCollaborationPage,
    onScrollToWorkspace,
    onOpenMemorySection,
  } = props;
  const [fetchedHealth, setFetchedHealth] = useState<HealthPayload | null>(null);
  const [rebuildBusy, setRebuildBusy] = useState(false);
  const [rebuildMsg, setRebuildMsg] = useState<string | null>(null);
  const [matterRepairBusy, setMatterRepairBusy] = useState(false);
  const [matterRepairMsg, setMatterRepairMsg] = useState<string | null>(null);
  const [triageRuleIds, setTriageRuleIds] = useState<string[] | null>(null);
  const [integrationCatalog, setIntegrationCatalog] = useState<
    Array<{ id: string; label?: string; status?: string; hint?: string; phase?: string }> | null
  >(null);
  const [teamGrowth, setTeamGrowth] = useState<TeamGrowthDashboardPayload | null>(null);
  const [teamGrowthBusy, setTeamGrowthBusy] = useState(false);
  const [teamGrowthMsg, setTeamGrowthMsg] = useState<string | null>(null);
  const [northStar, setNorthStar] = useState<NorthStarPayload | null>(null);
  const [auditExportBusy, setAuditExportBusy] = useState(false);
  const [auditExportMsg, setAuditExportMsg] = useState<string | null>(null);
  const [authorityProbeBusy, setAuthorityProbeBusy] = useState(false);
  const [authorityProbeMsg, setAuthorityProbeMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!apiBase || healthProp) {
      return;
    }
    let cancelled = false;
    void loadHealthPayload(apiBase)
      .then((h) => {
        if (!cancelled) {
          setFetchedHealth(h);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFetchedHealth(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [apiBase, healthProp]);

  useEffect(() => {
    if (!apiBase) {
      return;
    }
    let cancelled = false;
    void apiGetTriageRules(apiBase)
      .then((j) => {
        if (!cancelled && j.ok && Array.isArray(j.ruleIds)) {
          setTriageRuleIds(j.ruleIds);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setTriageRuleIds(null);
        }
      });
    void apiGetJson<{
      ok?: boolean;
      connectors?: Array<{ id: string; label?: string; status?: string; hint?: string; phase?: string }>;
    }>(apiBase, "/api/integrations")
      .then((j) => {
        if (!cancelled && j.ok && Array.isArray(j.connectors)) {
          setIntegrationCatalog(j.connectors);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setIntegrationCatalog(null);
        }
      });
    void apiGetJson<TeamGrowthDashboardPayload>(apiBase, "/api/metrics/team-growth?windowDays=30")
      .then((j) => {
        if (!cancelled && j.ok) {
          setTeamGrowth(j);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setTeamGrowth(null);
        }
      });
    void apiGetJson<NorthStarPayload>(apiBase, "/api/metrics/north-star")
      .then((j) => {
        if (!cancelled && j.ok) {
          setNorthStar(j);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setNorthStar(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [apiBase]);

  const health = healthProp ?? fetchedHealth;
  const autonomyCaption = northStar
    ? isAutonomyUnlocked({
        firstPassRate: northStar.firstPassRate ?? null,
        firstPassSamples:
          (northStar.samples?.firstPassOk ?? 0) + (northStar.samples?.firstPassFail ?? 0),
        lintEscapeRate: northStar.lintEscapeRate ?? null,
        lintEscapeSamples: northStar.lintEscapeRate == null ? null : (northStar.samples?.deliveries ?? 0),
      })
      ? " 当前：内部低风险可放宽。"
      : " 当前：尚未放宽（样本或逃逸未达标）。"
    : "";
  const doctor = health?.doctor;
  const ws = doctor?.workspaceStandard;
  const mem = doctor?.memoryTruthSources;
  const sessionHealth = doctor?.sessionHealth;
  const integrationConnectors =
    integrationCatalog ?? doctor?.integrations?.connectors ?? [];
  const searchIndex = doctor?.searchIndex;
  const p2 = doctor?.p2;
  const matterConsistency = doctor?.matterConsistency;
  const taskDraftConsistency = doctor?.taskDraftConsistency;
  const authorityCorpus = doctor?.authorityCorpus;
  const multitaskObservability = doctor?.multitaskObservability;
  const reasoningGraphCoverage = doctor?.reasoningGraphCoverage;

  async function probeAuthorityEndpointLive(): Promise<void> {
    if (!apiBase) {
      return;
    }
    setAuthorityProbeBusy(true);
    setAuthorityProbeMsg(null);
    try {
      const j = (await apiSendJson(apiBase, "/api/authority/probe", "POST", {})) as {
        ok?: boolean;
        probe?: { ok?: boolean; latencyMs?: number; hitCount?: number; error?: string };
        note?: string;
        message?: string;
        error?: string;
      };
      if (j.ok && j.probe?.ok) {
        setAuthorityProbeMsg(
          formatAuthorityProbeSuccessMsg({
            latencyMs: j.probe.latencyMs,
            hitCount: j.probe.hitCount,
            note: j.note,
            provider: authorityCorpus?.provider,
          }),
        );
      } else {
        setAuthorityProbeMsg(
          [j.note, j.probe?.error || j.message || j.error || "权威端点探测失败（fail-closed）。"]
            .filter(Boolean)
            .join(" · "),
        );
      }
    } catch (e) {
      setAuthorityProbeMsg(errorMessage(e, "权威端点探测失败"));
    } finally {
      setAuthorityProbeBusy(false);
    }
  }

  async function repairMatterProjections(): Promise<void> {
    if (!apiBase) {
      return;
    }
    setMatterRepairBusy(true);
    setMatterRepairMsg(null);
    try {
      const j = (await apiSendJson(apiBase, "/api/matters/repair-projections", "POST", {})) as {
        ok?: boolean;
        repaired?: number;
        error?: string;
      };
      if (j.ok) {
        setMatterRepairMsg(`已从案件数据重建 ${j.repaired ?? 0} 个案件的档案。`);
        const h = await loadHealthPayload(apiBase);
        setFetchedHealth(h);
      } else {
        setMatterRepairMsg(j.error ?? "修复失败");
      }
    } catch (e) {
      setMatterRepairMsg(e instanceof Error ? e.message : "修复失败");
    } finally {
      setMatterRepairBusy(false);
    }
  }

  async function rebuildSearchIndex(): Promise<void> {
    if (!apiBase) {
      return;
    }
    setRebuildBusy(true);
    setRebuildMsg(null);
    try {
      const j = (await apiSendJson(apiBase, "/api/search/workspace/rebuild", "POST", {})) as {
        ok?: boolean;
        error?: string;
        hint?: string;
        auditRows?: number;
        sessionRows?: number;
        knowledgeRows?: number;
      };
      if (j.ok) {
        setRebuildMsg(
          `已重建：审计 ${j.auditRows ?? 0} 条，会话 ${j.sessionRows ?? 0} 条，知识 ${j.knowledgeRows ?? 0} 条。刷新体检可查看最新状态。`,
        );
        const h = await loadHealthPayload(apiBase);
        setFetchedHealth(h);
      } else {
        setRebuildMsg(j.hint ?? j.error ?? "重建失败");
      }
    } catch (e) {
      setRebuildMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setRebuildBusy(false);
    }
  }

  async function exportCaseAuditSummary(): Promise<void> {
    if (!apiBase?.trim()) {
      return;
    }
    setAuditExportBusy(true);
    setAuditExportMsg(null);
    try {
      const res = await fetchApi(`${apiBase}/api/audit/export`, {}, { tag: "doctor:audit-export" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string; message?: string } | null;
        throw new Error(body?.message ?? body?.error ?? `导出失败（HTTP ${res.status}）`);
      }
      const text = await res.text();
      const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "lawmind-audit-summary.md";
      a.click();
      URL.revokeObjectURL(url);

      let integrityNote = "";
      if (health?.edition?.features?.auditIntegrityExport) {
        try {
          const j = await apiGetJson<{
            ok?: boolean;
            integrity?: { ok?: boolean; eventCount?: number; chainedCount?: number; brokenAt?: number };
          }>(apiBase, "/api/audit/export?integrity=true");
          const i = j.integrity;
          if (i) {
            const chainNote =
              typeof i.brokenAt === "number"
                ? `断链 @${i.brokenAt}`
                : i.ok === false
                  ? "异常"
                  : "完整";
            integrityNote = ` · hash-chain ${i.eventCount ?? 0}/${i.chainedCount ?? 0}（${chainNote}）`;
          }
        } catch {
          /* integrity optional */
        }
      }
      setAuditExportMsg(`已下载办案审计摘要${integrityNote}。`);
    } catch (e) {
      setAuditExportMsg(errorMessage(e, "审计摘要导出失败"));
    } finally {
      setAuditExportBusy(false);
    }
  }

  async function captureTeamGrowthBaseline(): Promise<void> {
    if (!apiBase) {
      return;
    }
    setTeamGrowthBusy(true);
    setTeamGrowthMsg(null);
    try {
      const j = await apiSendJson<TeamGrowthDashboardPayload, { windowDays: number; note: string }>(
        apiBase,
        "/api/metrics/team-growth/baseline",
        "POST",
        { windowDays: teamGrowth?.windowDays ?? 30, note: "内测基线" },
      );
      if (j.ok) {
        setTeamGrowth(j);
        setTeamGrowthMsg("已记录当前窗口为基线，后续对比将显示相对变化。");
      } else {
        setTeamGrowthMsg("记录基线失败");
      }
    } catch (e) {
      setTeamGrowthMsg(e instanceof Error ? e.message : "记录基线失败");
    } finally {
      setTeamGrowthBusy(false);
    }
  }

  return (
    <div className="lm-settings-section lm-settings-doctor" id="lawmind-settings-doctor">
      <DoctorConnectionGroup health={health} doctor={doctor} onOpenApiWizard={onOpenApiWizard} />

      <DoctorWorkspaceTruthGroup
        ws={ws}
        mem={mem}
        onOpenMemorySection={onOpenMemorySection}
        onScrollToWorkspace={onScrollToWorkspace}
      />

      <div className="lm-settings-group lm-settings-surface" data-testid="lm-doctor-skills-trust">
        <h4 className="lm-doctor-group-title">信任与核对</h4>
        <div className="lm-doctor-security-grid">
          <span className="lm-settings-key">引用模式</span>
          <span
            className={
              (doctor?.citationModeActive ?? health?.citationModeActive)
                ? "lm-pill lm-pill-success"
                : "lm-pill lm-pill-neutral"
            }
          >
            {doctor?.citationMode ?? health?.citationMode ?? "assisted"}
          </span>
          <span className="lm-settings-key">强制规则</span>
          <span
            className={
              health?.agentMandatoryRulesTruncated
                ? "lm-pill lm-pill-warn"
                : health?.agentMandatoryRulesActive
                  ? "lm-pill lm-pill-success"
                  : "lm-pill lm-pill-neutral"
            }
            title={health?.agentMandatoryRulesTruncated ? "规则内容过长，仅部分生效" : undefined}
            data-testid="lm-doctor-mandatory-rules"
          >
            {health?.agentMandatoryRulesTruncated
              ? "部分生效"
              : health?.agentMandatoryRulesActive
                ? "已生效"
                : "未配置"}
          </span>
          <span className="lm-settings-key">模型能力</span>
          <span className="lm-meta" data-testid="lm-doctor-capability-envelope">
            {health?.capabilityEnvelope?.contextTokens
              ? `上下文 ${health.capabilityEnvelope.contextTokens.toLocaleString("zh-CN")}`
              : "未配置模型"}
          </span>
        </div>
        <div className="lm-doctor-actions" style={{ marginTop: 8 }}>
          <button
            type="button"
            className="lm-btn lm-btn-secondary lm-btn-sm"
            onClick={onOpenCollaborationPage}
          >
            打开在办
          </button>
        </div>
      </div>

      <details className="lm-settings-advanced" data-testid="lm-doctor-admin">
        <summary>
          <span className="lm-settings-advanced__label">运维与高级体检</span>
          <span className="lm-settings-advanced__hint">硬控 · 指标 · 修复</span>
        </summary>
        <div className="lm-settings-advanced-body">

      <DoctorPromptSectionsGroup sections={health?.promptSections} />

      {integrationConnectors.length > 0 ? (
        <DoctorIntegrationsGroup connectors={integrationConnectors} />
      ) : null}

      {p2 ? (
        <div className="lm-settings-group lm-settings-surface">
          <h4 className="lm-doctor-group-title">隔离与团队记忆</h4>
          <div className="lm-doctor-security-grid">
            <span className="lm-settings-key">工具子进程沙箱</span>
            <span
              className={
                p2.toolSandbox?.enabled ? "lm-pill lm-pill-success" : "lm-pill lm-pill-neutral"
              }
            >
              {p2.toolSandbox?.enabled
                ? `已启用（${p2.toolSandbox.source === "env" ? "环境变量" : "策略"}）`
                : "未启用"}
            </span>
            <span className="lm-settings-key">团队记忆同步</span>
            <span
              className={
                p2.teamMemorySync?.allowed ? "lm-pill lm-pill-success" : "lm-pill lm-pill-neutral"
              }
            >
              {p2.teamMemorySync?.allowed ? "已允许（Firm + 策略）" : "已关闭"}
            </span>
          </div>
          {p2.toolSandbox?.enabled && (p2.toolSandbox.sandboxedToolNames?.length ?? 0) > 0 ? (
            <p className="lm-meta">
              沙箱工具：{p2.toolSandbox.sandboxedToolNames?.join("、")}
            </p>
          ) : null}
          {!p2.toolSandbox?.enabled ? (
            <p className="lm-meta">见 policy 沙箱开关。</p>
          ) : null}
          {!p2.teamMemorySync?.allowed && p2.teamMemorySync?.reason ? (
            <p className="lm-meta">
              团队同步状态：<code>{p2.teamMemorySync.reason}</code>（需 Firm 版且{" "}
              <code>teamMemorySync.enabled</code> + endpoint；上传前会做密钥扫描）。
            </p>
          ) : null}
        </div>
      ) : null}

      <div
        className="lm-settings-group lm-settings-surface"
        data-testid="lm-doctor-judgment-hard-controls"
      >
        <h4 className="lm-doctor-group-title">判断类硬控</h4>
        <p className="lm-meta">
          判断类改为 Soft Ask / Craft；安全与空交付仍硬拦（只读清单）。
        </p>
        <div className="lm-doctor-security-grid">
          <span className="lm-settings-key">Intake Soft Ask</span>
          <span
            className={
              doctor?.judgmentHardControls?.intakeSoftAsk !== false
                ? "lm-pill lm-pill-success"
                : "lm-pill lm-pill-warn"
            }
            data-testid="lm-doctor-intake-soft"
          >
            {doctor?.judgmentHardControls?.intakeSoftAsk !== false ? "已软化" : "仍硬冻"}
          </span>
          <span className="lm-settings-key">update_draft 幅度</span>
          <span
            className={
              doctor?.judgmentHardControls?.updateDraftAmplitudeSoft !== false
                ? "lm-pill lm-pill-success"
                : "lm-pill lm-pill-warn"
            }
            data-testid="lm-doctor-amplitude-soft"
          >
            {doctor?.judgmentHardControls?.updateDraftAmplitudeSoft !== false
              ? "soft 教练"
              : "硬拒（enforce）"}
          </span>
          <span className="lm-settings-key">空修订导出</span>
          <span className="lm-pill lm-pill-neutral" data-testid="lm-doctor-empty-redline-hard">
            {doctor?.judgmentHardControls?.emptyRedlineHard !== false ? "仍硬拦" : "已软化"}
          </span>
          <span className="lm-settings-key">send_email 批准</span>
          <span className="lm-pill lm-pill-neutral" data-testid="lm-doctor-send-email-hard">
            {doctor?.judgmentHardControls?.sendEmailApprovalHard !== false ? "仍硬拦" : "已软化"}
          </span>
        </div>
      </div>

      <div className="lm-settings-group lm-settings-surface" data-testid="lm-doctor-triage-metrics">
        <h4 className="lm-doctor-group-title">分诊与产品指标</h4>
        <div className="lm-doctor-security-grid">
          <span className="lm-settings-key">本案规则</span>
          <span className="lm-meta" data-testid="lm-doctor-matter-rules-hint">
            案件档案内的规则区
          </span>
          <span className="lm-settings-key">分诊规则</span>
          <span
            className={
              (doctor?.triageRulesLoaded ?? health?.triageRulesLoaded) || (triageRuleIds?.length ?? 0) > 0
                ? "lm-pill lm-pill-success"
                : "lm-pill lm-pill-warn"
            }
          >
            {(doctor?.triageRulesLoaded ?? health?.triageRulesLoaded) || (triageRuleIds?.length ?? 0) > 0
              ? `已加载 ${triageRuleIds?.length ?? doctor?.triageRuleCount ?? health?.triageRuleCount ?? 0} 条`
              : "未加载"}
          </span>
          <span className="lm-settings-key">产品指标</span>
          <span className="lm-meta">
            事件 {doctor?.productMetricsSummary?.total ?? 0} · 分诊确认{" "}
            {doctor?.productMetricsSummary?.triageConfirmed ?? 0} · 核对失败{" "}
            {doctor?.productMetricsSummary?.gateFailures ?? 0} · 一次过{" "}
            {doctor?.productMetricsSummary?.firstPassOk ?? 0} · 改写{" "}
            {doctor?.productMetricsSummary?.rewrites ?? 0} · 改写幅度样本{" "}
            {doctor?.productMetricsSummary?.rewriteAmplitudeSamples ?? 0}
          </span>
          <span className="lm-settings-key">Fleet Playbook</span>
          <span
            className={
              doctor?.fleetPlaybooksLoaded || health?.fleetPlaybooksLoaded
                ? "lm-pill lm-pill-success"
                : "lm-pill lm-pill-warn"
            }
          >
            {doctor?.fleetPlaybookCount ?? health?.fleetPlaybookCount ?? 0} 套
          </span>
        </div>
        {doctor?.privateDeployChecklist ? (
          <div className="lm-doctor-private-deploy" data-testid="lm-doctor-private-deploy">
            <p className="lm-meta">
              私有化检查清单
              {doctor.privateDeployChecklist.applicable ? "（当前 edition 适用）" : "（Solo/Firm 仅预览）"}
              ：通过 {doctor.privateDeployChecklist.passCount ?? 0}/
              {doctor.privateDeployChecklist.total ?? 0}
            </p>
            <ul className="lm-meta">
              {(doctor.privateDeployChecklist.items ?? []).map((it) => (
                <li key={it.id}>
                  {it.ok ? "✓" : "✗"} {it.label}
                  {it.detail ? ` — ${it.detail}` : ""}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {triageRuleIds && triageRuleIds.length > 0 ? (
          <details className="lm-doctor-triage-rules" data-testid="lm-doctor-triage-rules">
            <summary className="lm-meta">查看分诊规则 ID（只读）</summary>
            <ul className="lm-meta" style={{ marginTop: 8 }}>
              {triageRuleIds.map((id) => (
                <li key={id}>
                  <code>{id}</code>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
        <details className="lm-settings-advanced" data-testid="lm-doctor-golden-hint">
          <summary>黄金集（开发者）</summary>
          <p className="lm-settings-caption">
            <code>pnpm lawmind:skills:golden -- --compare</code>
          </p>
        </details>
      </div>

      <div className="lm-settings-group lm-settings-surface" data-testid="lm-doctor-north-star">
        <h4 className="lm-doctor-group-title">交付北极星</h4>
        <p className="lm-settings-caption">
          无干预完成、一次通过、审阅时长、机械核对逃逸。样本不足显示「尚无」，不编造 0%。
        </p>
        <p className="lm-settings-caption" data-testid="lm-doctor-delivery-autonomy">
          外发邮件与对外文书始终需您一键签批，不会因一次通过率自动放行。低风险内部稿仅在一次通过与机械核对逃逸均达标、且样本足够后，才可放宽交付。
          {autonomyCaption}
        </p>
        <table className="lm-role-table" style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}>
          <thead>
            <tr>
              <th scope="col">指标</th>
              <th scope="col">当前</th>
              <th scope="col">样本</th>
            </tr>
          </thead>
          <tbody>
            <tr data-testid="lm-doctor-north-star-unattended">
              <td>无干预完成</td>
              <td>{starPct(northStar?.unattendedCompleteRate)}</td>
              <td className="lm-meta">
                {(northStar?.samples?.unattended ?? 0) + (northStar?.samples?.attended ?? 0)}
              </td>
            </tr>
            <tr data-testid="lm-doctor-north-star-first-pass">
              <td>一次通过</td>
              <td>{starPct(northStar?.firstPassRate)}</td>
              <td className="lm-meta">
                {(northStar?.samples?.firstPassOk ?? 0) + (northStar?.samples?.firstPassFail ?? 0)}
              </td>
            </tr>
            <tr data-testid="lm-doctor-north-star-review">
              <td>审阅时长中位</td>
              <td>
                {northStar?.reviewDurationMsMedian == null
                  ? "尚无"
                  : `${Math.round(northStar.reviewDurationMsMedian / 1000)} 秒`}
              </td>
              <td className="lm-meta">—</td>
            </tr>
            <tr data-testid="lm-doctor-north-star-lint-escape">
              <td>机械核对逃逸</td>
              <td>{starPct(northStar?.lintEscapeRate)}</td>
              <td className="lm-meta">{northStar?.samples?.deliveries ?? 0}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div
        className="lm-settings-group lm-settings-surface"
        data-testid="lm-doctor-team-growth"
      >
        <h4 className="lm-doctor-group-title">团队成长 · 内测指标</h4>
        <p className="lm-settings-caption">近 {teamGrowth?.windowDays ?? 30} 天相对基线趋势。</p>
        {teamGrowth?.metrics && teamGrowth.metrics.length > 0 ? (
          <table
            className="lm-role-table"
            style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}
          >
            <thead>
              <tr>
                <th scope="col">指标</th>
                <th scope="col">当前</th>
                <th scope="col">样本</th>
                <th scope="col">基线</th>
                <th scope="col">Δ</th>
                <th scope="col">目标</th>
              </tr>
            </thead>
            <tbody>
              {teamGrowth.metrics.map((m) => (
                <tr key={m.id} data-testid={`lm-doctor-team-growth-row-${m.id}`}>
                  <td>{m.label}</td>
                  <td>{pct(m.value)}</td>
                  <td className="lm-meta">
                    {m.numerator}/{m.denominator}
                  </td>
                  <td>{pct(m.baselineValue)}</td>
                  <td>{formatDeltaPts(m.deltaPts)}</td>
                  <td className="lm-meta">{m.targetNote}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="lm-meta">加载中或暂无数据…</p>
        )}
        <p className="lm-meta" style={{ marginTop: 8 }}>
          {teamGrowth?.baseline
            ? `基线：${teamGrowth.baseline.capturedAt.slice(0, 10)}${
                teamGrowth.baseline.note ? ` · ${teamGrowth.baseline.note}` : ""
              }`
            : "尚未记录基线"}
        </p>
        <div className="lm-doctor-actions" style={{ marginTop: 8 }}>
          <button
            type="button"
            className="lm-btn lm-btn-secondary"
            disabled={!apiBase || teamGrowthBusy}
            onClick={() => void captureTeamGrowthBaseline()}
            data-testid="lm-doctor-team-growth-baseline"
          >
            {teamGrowthBusy ? "记录中…" : "记录基线"}
          </button>
        </div>
        {teamGrowthMsg ? <p className="lm-meta">{teamGrowthMsg}</p> : null}
      </div>

      <div className="lm-settings-group lm-settings-surface">
        <h4 className="lm-doctor-group-title">办案审计摘要</h4>
        <p className="lm-settings-caption">
          一键导出本机审计 Markdown
          {health?.edition?.features?.auditIntegrityExport ? "，并附带 hash-chain 完整性核对。" : "。"}
        </p>
        <div className="lm-settings-actions lm-settings-actions--flush">
          <button
            type="button"
            className="lm-btn lm-btn-secondary lm-btn-sm"
            data-testid="lm-doctor-export-audit-summary"
            disabled={auditExportBusy || !apiBase}
            onClick={() => void exportCaseAuditSummary()}
          >
            {auditExportBusy ? "导出中…" : "一键导出办案审计摘要"}
          </button>
        </div>
        {auditExportMsg ? (
          <p className="lm-meta" role="status">
            {auditExportMsg}
          </p>
        ) : null}
      </div>

      <div
        className="lm-settings-group lm-settings-surface"
        data-testid="lm-doctor-authority-boundary"
      >
        <h4 className="lm-doctor-group-title">权威法条 / 类案库</h4>
        <div className="lm-doctor-security-grid">
          <span className="lm-settings-key">外接权威库</span>
          <span
            className={
              isAuthorityCorpusUiReady(authorityCorpus?.status)
                ? "lm-pill lm-pill-success"
                : authorityCorpus?.status === "invalid"
                  ? "lm-pill lm-pill-danger"
                  : "lm-pill lm-pill-warn"
            }
            data-testid="lm-doctor-authority-status"
            data-status={authorityCorpus?.status ?? "unset"}
          >
            {authorityCorpus?.status === "invalid"
              ? "配置无效（已拒外呼）"
              : authorityCorpus?.status === "unimplemented"
                ? "适配器未实现（占位）"
                : authorityCorpusStatusLabel(authorityCorpus)}
          </span>
          <span className="lm-settings-key">无命中时</span>
          <span className="lm-pill lm-pill-neutral">拒答 / 缺源提示</span>
        </div>
        <p className="lm-settings-caption" role="status">
          {authorityCorpus?.message?.trim()
            ? authorityCorpus.message
            : "开源语料；无命中拒答。"}{" "}
          闭源库需手动配置；正式引用请核对官方法条。
        </p>
        <div className="lm-settings-actions">
          <button
            type="button"
            className="lm-btn lm-btn-secondary lm-btn-sm"
            data-testid="lm-doctor-authority-probe"
            disabled={
              authorityProbeBusy ||
              !apiBase ||
              !isAuthorityCorpusUiReady(authorityCorpus?.status)
            }
            onClick={() => void probeAuthorityEndpointLive()}
            title={
              isAuthorityCorpusUiReady(authorityCorpus?.status)
                ? authorityCorpus?.provider === "open"
                  ? "探测开源本地语料是否就绪（非厂商付费库核验）"
                  : "对已配置端点发起契约健康探测（非厂商语料核验）"
                : "开源：检查语料；闭源/generic：需先配置合法 LAWMIND_AUTHORITY_ENDPOINT"
            }
          >
            {authorityProbeBusy
              ? "探测中…"
              : authorityCorpus?.provider === "open"
                ? "探测开源语料"
                : "探测权威端点"}
          </button>
        </div>
        {authorityProbeMsg ? (
          <p className="lm-settings-caption" role="status" data-testid="lm-doctor-authority-probe-msg">
            {authorityProbeMsg}
          </p>
        ) : null}
      </div>

      <div className="lm-settings-group lm-settings-surface">
        <h4 className="lm-doctor-group-title">高安全核对</h4>
        <div className="lm-doctor-security-grid">
          <span className="lm-settings-key">联网白名单</span>
          <span
            className={
              health?.policy?.networkAllowlist?.length
                ? "lm-pill lm-pill-success"
                : "lm-pill lm-pill-warn"
            }
          >
            {health?.policy?.networkAllowlist?.length
              ? `已配置 ${health.policy.networkAllowlist.length} 项`
              : "未配置"}
          </span>
          <span className="lm-settings-key">危险工具策略</span>
          <span
            className={
              health?.edition?.features?.strictDangerousToolApproval
                ? "lm-pill lm-pill-success"
                : "lm-pill lm-pill-neutral"
            }
          >
            {health?.edition?.features?.strictDangerousToolApproval
              ? "Firm：一律显式批准"
              : "Solo：开发可放宽"}
          </span>
          <span className="lm-settings-key">审计 hash-chain</span>
          <span
            className={
              health?.edition?.features?.auditIntegrityExport
                ? "lm-pill lm-pill-success"
                : "lm-pill lm-pill-neutral"
            }
          >
            {health?.edition?.features?.auditIntegrityExport
              ? "写入时启用链式校验"
              : "仅标准 JSONL"}
          </span>
        </div>
      </div>

      {health?.policy && typeof health.policy === "object" && "loaded" in health.policy && health.policy.loaded ? (
        <div className="lm-settings-group lm-settings-surface">
          <h4 className="lm-doctor-group-title">联网策略</h4>
        <div className="lm-settings-row">
          <span className="lm-settings-key">联网白名单</span>
          <span className="lm-meta">
              {Array.isArray(health.policy.networkAllowlist) && health.policy.networkAllowlist.length > 0
                ? health.policy.networkAllowlist.join(", ")
                : "未配置"}
            </span>
          </div>
          {health.policy.networkAllowlistEnforced ? (
            <p className="lm-meta">仅允许名单主机。</p>
          ) : null}
        </div>
      ) : null}

      {sessionHealth ? (
        <div className="lm-settings-group lm-settings-surface">
          <h4 className="lm-doctor-group-title">会话健康</h4>
          <div className="lm-doctor-score" data-grade={sessionHealth.grade}>
            <span className="lm-doctor-score-value">{sessionHealth.score}</span>
            <span className="lm-meta">{sessionHealth.summary}</span>
          </div>
          {(sessionHealth.signals?.length ?? 0) > 0 ? (
            <ul className="lm-doctor-signals">
              {(sessionHealth.signals ?? []).map((s) => (
                <li key={s.id}>{s.label}</li>
              ))}
            </ul>
          ) : (
            <p className="lm-meta">暂无需要关注的会话风险信号。</p>
          )}
        </div>
      ) : null}

      <div className="lm-settings-group lm-settings-surface">
        <h4 className="lm-doctor-group-title">推理留痕覆盖</h4>
        <div className="lm-settings-row">
          <span className="lm-settings-key">覆盖率</span>
          <span
            className={
              reasoningGraphCoverage?.ratio === null || reasoningGraphCoverage?.ratio === undefined
                ? "lm-pill lm-pill-neutral"
                : (reasoningGraphCoverage.ratio ?? 0) >= 1
                  ? "lm-pill lm-pill-success"
                  : "lm-pill lm-pill-warn"
            }
          >
            {reasoningGraphCoverage?.ratio === null || reasoningGraphCoverage?.ratio === undefined
              ? "无样本"
              : `${Math.round((reasoningGraphCoverage.ratio ?? 0) * 100)}%`}
          </span>
        </div>
        <p className="lm-meta">
          应留痕 {reasoningGraphCoverage?.requiredDraftCount ?? 0} 份 · 已留痕{" "}
          {reasoningGraphCoverage?.withSnapshotCount ?? 0} 份
        </p>
      </div>

      <div className="lm-settings-group lm-settings-surface">
        <h4 className="lm-doctor-group-title">案件数据一致性</h4>
        <p className="lm-settings-caption">案件档案由系统数据生成；不一致时可重建。</p>
        <div className="lm-settings-row">
          <span className="lm-settings-key">一致性</span>
          <span
            className={
              matterConsistency?.ok !== false ? "lm-pill lm-pill-success" : "lm-pill lm-pill-warn"
            }
          >
            {matterConsistency?.ok !== false
              ? "正常"
              : `${matterConsistency?.issueCount ?? 0} 项待处理`}
          </span>
        </div>
        {(matterConsistency?.issues?.length ?? 0) > 0 ? (
          <ul className="lm-meta lm-doctor-issue-list">
            {matterConsistency!.issues!.map((issue) => (
              <li key={`${issue.matterId}-${issue.code}`}>
                <strong>{issue.matterId}</strong> [{issue.code}] {issue.message}
              </li>
            ))}
          </ul>
        ) : null}
        <button
          type="button"
          className="lm-btn lm-btn-secondary lm-btn-sm"
          disabled={matterRepairBusy || !apiBase}
          onClick={() => void repairMatterProjections()}
        >
          {matterRepairBusy ? "重建中…" : "重建案件档案"}
        </button>
        {matterRepairMsg ? <p className="lm-meta">{matterRepairMsg}</p> : null}
      </div>

      <div className="lm-settings-group lm-settings-surface">
        <h4 className="lm-doctor-group-title">任务 / 草稿 / 交付物一致性</h4>
        <p className="lm-settings-caption">任务/草稿一致性。</p>
        <div className="lm-settings-row">
          <span className="lm-settings-key">一致性</span>
          <span
            className={
              taskDraftConsistency?.ok !== false ? "lm-pill lm-pill-success" : "lm-pill lm-pill-warn"
            }
          >
            {taskDraftConsistency?.ok !== false
              ? "正常"
              : `${taskDraftConsistency?.issueCount ?? 0} 项待处理`}
          </span>
        </div>
        {(taskDraftConsistency?.issues?.length ?? 0) > 0 ? (
          <ul className="lm-meta lm-doctor-issue-list">
            {taskDraftConsistency!.issues!.map((issue) => (
              <li key={`${issue.taskId}-${issue.code}`}>
                <strong>{issue.taskId}</strong> [{issue.code}] {issue.message}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="lm-settings-group lm-settings-surface">
        <h4 className="lm-doctor-group-title">多任务运行观测（{multitaskObservability?.windowDays ?? 14} 天）</h4>
        <div className="lm-settings-row">
          <span className="lm-settings-key">样本</span>
          <span className="lm-meta">
            窗口内 {multitaskObservability?.jobsInWindow ?? 0} / 总计{" "}
            {multitaskObservability?.jobsTotal ?? 0}
          </span>
        </div>
        <div className="lm-settings-row">
          <span className="lm-settings-key">Lead time P50/P90</span>
          <span className="lm-meta">
            {multitaskObservability?.leadTimeP50Ms != null
              ? `${Math.round(multitaskObservability.leadTimeP50Ms / 1000)}s`
              : "n/a"}{" "}
            /{" "}
            {multitaskObservability?.leadTimeP90Ms != null
              ? `${Math.round(multitaskObservability.leadTimeP90Ms / 1000)}s`
              : "n/a"}
          </span>
        </div>
        <div className="lm-settings-row">
          <span className="lm-settings-key">重试 / 取消 / 失败</span>
          <span className="lm-meta">
            {pct(multitaskObservability?.retryRate)} · {pct(multitaskObservability?.cancelRate)} ·{" "}
            {pct(multitaskObservability?.failureRate)}
          </span>
        </div>
        {(multitaskObservability?.notes?.length ?? 0) > 0 ? (
          <ul className="lm-meta lm-doctor-issue-list">
            {multitaskObservability!.notes!.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="lm-settings-group lm-settings-surface">
        <h4 className="lm-doctor-group-title">本地搜索索引（FTS）</h4>
        <div className="lm-settings-row">
          <span className="lm-settings-key">索引状态</span>
          <span
            className={
              searchIndex?.ready ? "lm-pill lm-pill-success" : "lm-pill lm-pill-warn"
            }
          >
            {searchIndex?.ready ? "已就绪" : "未建立"}
          </span>
        </div>
        {searchIndex?.ready ? (
          <p className="lm-meta">
            审计 {searchIndex.auditRows ?? 0} 条 · 会话 {searchIndex.sessionRows ?? 0} 条 · 知识{" "}
            {searchIndex.knowledgeRows ?? 0} 条
            {searchIndex.lastRebuildAt ? ` · 上次重建 ${searchIndex.lastRebuildAt}` : ""}
            {searchIndex.truncated ? " · 已截断（工作区过大）" : ""}
          </p>
        ) : null}
        {searchIndex?.stale ? (
          <p className="lm-meta lm-doctor-stale-hint" role="status">
            索引过期，请重建
            {searchIndex.staleReason === "older_than_24h"
              ? "（超 24h）"
              : searchIndex.staleReason === "index_missing"
                ? "（未建）"
                : ""}
            。
          </p>
        ) : null}
        <button
          type="button"
          className="lm-btn lm-btn-secondary lm-btn-sm"
          disabled={rebuildBusy || !apiBase}
          onClick={() => void rebuildSearchIndex()}
        >
          {rebuildBusy ? "重建中…" : "重建索引"}
        </button>
        {rebuildMsg ? <p className="lm-meta">{rebuildMsg}</p> : null}
        <p className="lm-settings-caption">
          重建需 <code>LAWMIND_ALLOW_INDEX_REBUILD=1</code>
        </p>
      </div>

      <div className="lm-settings-group lm-settings-surface">
        <h4 className="lm-doctor-group-title">MCP 只读桥接</h4>
        <pre className="lm-doctor-mcp-snippet">{`{
  "mcpServers": {
    "lawmind-readonly": {
      "command": "pnpm",
      "args": ["lawmind:mcp:readonly"],
      "env": {
        "LAWMIND_WORKSPACE_DIR": "<你的工作区绝对路径>"
      }
    }
  }
}`}</pre>
        <p className="lm-meta">
          实现：<code>scripts/lawmind/mcp-readonly-server.ts</code> · 本地自检：
          <code> pnpm lawmind:doctor -- --json</code>
        </p>
      </div>

      {doctor ? (
        <div className="lm-settings-group lm-settings-surface">
          <h4 className="lm-doctor-group-title">协作与任务统计</h4>
          <div className="lm-doctor-stats">
            <span>任务 {doctor.taskCount ?? 0}</span>
            <span>草稿 {doctor.draftCount ?? 0}</span>
            <span>审计文件 {doctor.auditJsonlFileCount ?? 0}</span>
            <span>研究快照 {doctor.researchSnapshotCount ?? 0}</span>
          </div>
        </div>
      ) : null}

        </div>
      </details>
    </div>
  );
}
