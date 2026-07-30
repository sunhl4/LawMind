import { useEffect, useState, type ReactNode } from "react";
import { apiGetJson, apiSendJson, errorMessage } from "./api-client";
import { loadHealthPayload, type HealthPayload } from "./lawmind-app-data";
import { apiAuthHeaders } from "./lawmind-api-auth";
import { apiGetTriageRules } from "./lawmind-triage-api";
import {
  authorityCorpusStatusLabel,
  formatAuthorityProbeSuccessMsg,
  isAuthorityCorpusUiReady,
} from "./lawmind-settings-models";

type WorkspaceCheck = {
  id: string;
  label: string;
  state: "ok" | "warn" | "missing";
  hint: string;
};

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

function checkRowClass(state: WorkspaceCheck["state"]): string {
  switch (state) {
    case "ok":
      return "lm-doctor-check lm-doctor-check-ok";
    case "warn":
      return "lm-doctor-check lm-doctor-check-warn";
    default:
      return "lm-doctor-check lm-doctor-check-missing";
  }
}

function stateLabel(state: WorkspaceCheck["state"]): string {
  switch (state) {
    case "ok":
      return "正常";
    case "warn":
      return "建议完善";
    default:
      return "缺失";
  }
}

function pct(rate: number | undefined | null): string {
  if (rate == null || Number.isNaN(rate)) {
    return "n/a";
  }
  return `${Math.round(rate * 1000) / 10}%`;
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
    return () => {
      cancelled = true;
    };
  }, [apiBase]);

  const health = healthProp ?? fetchedHealth;
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
        setMatterRepairMsg(`已从 matter.json 重建 ${j.repaired ?? 0} 个案件的 CASE.md 投影。`);
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
      const res = await fetch(`${apiBase}/api/audit/export`, { headers: apiAuthHeaders() });
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

  function connectorPillClass(status: string): string {
    if (status === "active") {
      return "lm-pill lm-pill-success";
    }
    if (status === "disabled") {
      return "lm-pill lm-pill-neutral";
    }
    return "lm-pill lm-pill-warn";
  }

  function connectorStatusLabel(status: string): string {
    if (status === "active") {
      return "已启用";
    }
    if (status === "disabled") {
      return "已禁用";
    }
    return "待配置";
  }

  return (
    <div className="lm-settings-section lm-settings-doctor" id="lawmind-settings-doctor">
      <div className="lm-settings-section-title lm-settings-section-title--duplicate">系统体检</div>

      <div className="lm-settings-group lm-settings-surface">
        <h4 className="lm-doctor-group-title">连接与模型</h4>
        <div className="lm-settings-row">
          <span className="lm-settings-key">AI 服务</span>
          <span className={health?.modelConfigured ? "lm-pill lm-pill-success" : "lm-pill lm-pill-warn"}>
            {health?.modelConfigured ? "已配置" : "待配置"}
          </span>
          {!health?.modelConfigured ? (
            <button type="button" className="lm-btn lm-btn-sm" onClick={onOpenApiWizard}>
              配置 API
            </button>
          ) : null}
        </div>
        {health?.modelName ? (
          <div className="lm-settings-row">
            <span className="lm-settings-key">当前模型</span>
            <span className="lm-meta">{health.modelName}</span>
          </div>
        ) : null}
        {doctor?.nodeVersion ? (
          <div className="lm-settings-row">
            <span className="lm-settings-key">运行环境</span>
            <span className="lm-meta">
              Node {doctor.nodeVersion}
              {doctor.lawmindPackageVersion ? ` · LawMind ${doctor.lawmindPackageVersion}` : ""}
            </span>
          </div>
        ) : null}
      </div>

      <div className="lm-settings-group lm-settings-surface" id="lawmind-settings-memory-truth">
        <h4 className="lm-doctor-group-title">工作区与记忆真相源</h4>
        <p className="lm-settings-caption">
          真相源文件状态
          {onOpenMemorySection ? (
            <>
              {" · "}
              <button type="button" className="lm-link-btn" onClick={() => onOpenMemorySection()}>
                记忆库
              </button>
            </>
          ) : null}
        </p>
        {ws?.checks?.map((c) => (
          <div key={c.id} className={checkRowClass(c.state)}>
            <div className="lm-doctor-check-head">
              <span>{c.label}</span>
              <em>{stateLabel(c.state)}</em>
            </div>
            <p className="lm-meta">{c.hint}</p>
          </div>
        )) ?? (
          <p className="lm-meta">正在检测工作区标准…</p>
        )}
        {mem ? (
          <div className="lm-doctor-memory-grid">
            <span className={mem.memoryMd ? "lm-pill lm-pill-success" : "lm-pill lm-pill-warn"}>
              MEMORY.md
            </span>
            <span className={mem.lawyerProfile ? "lm-pill lm-pill-success" : "lm-pill lm-pill-warn"}>
              律师偏好
            </span>
            <span className={mem.firmProfile ? "lm-pill lm-pill-success" : "lm-pill lm-pill-neutral"}>
              律所档案
            </span>
            {(mem.clientProfileFilesUnderClients ?? 0) > 0 ? (
              <span className="lm-pill lm-pill-neutral">
                客户档案 {mem.clientProfileFilesUnderClients}
              </span>
            ) : null}
          </div>
        ) : null}
        {onScrollToWorkspace ? (
          <button type="button" className="lm-btn lm-btn-secondary lm-btn-sm" onClick={onScrollToWorkspace}>
            工作区设置
          </button>
        ) : null}
      </div>

      {integrationConnectors.length > 0 ? (
        <div className="lm-settings-group lm-settings-surface">
          <h4 className="lm-doctor-group-title">外部集成</h4>
          <ul className="lm-doctor-integrations-list">
            {integrationConnectors.map((conn) => {
              const status = typeof conn.status === "string" ? conn.status : "";
              return (
                <li key={conn.id} className="lm-doctor-integration-row">
                  <div className="lm-doctor-check-head">
                    <span>
                      {conn.label}{" "}
                      <span className="lm-meta">({conn.phase})</span>
                    </span>
                    <span className={connectorPillClass(status)}>
                      {connectorStatusLabel(status)}
                    </span>
                  </div>
                  {conn.hint ? <p className="lm-meta">{conn.hint}</p> : null}
                  {status === "active" && /fixture|演示|POC/i.test(conn.hint ?? "") ? (
                    <p className="lm-settings-caption">演示数据，非真实 DMS</p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
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
            <p className="lm-meta">
              启用：工作区 <code>lawmind.policy.json</code> 设 <code>toolSandbox: true</code>，或环境变量{" "}
              <code>LAWMIND_TOOL_SANDBOX=1</code>。
            </p>
          ) : null}
          {!p2.teamMemorySync?.allowed && p2.teamMemorySync?.reason ? (
            <p className="lm-meta">
              团队同步状态：<code>{p2.teamMemorySync.reason}</code>（需 Firm 版且{" "}
              <code>teamMemorySync.enabled</code> + endpoint；上传前会做密钥扫描）。
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="lm-settings-group lm-settings-surface" data-testid="lm-doctor-skills-trust">
        <h4 className="lm-doctor-group-title">信任与分诊</h4>
        <div className="lm-doctor-security-grid">
          <span className="lm-settings-key">模型能力包络</span>
          <span className="lm-meta" data-testid="lm-doctor-capability-envelope">
            {health?.capabilityEnvelope?.contextTokens
              ? `上下文 ${health.capabilityEnvelope.contextTokens.toLocaleString("zh-CN")} · 输出上限 ${
                  health.capabilityEnvelope.maxOutputTokens?.toLocaleString("zh-CN") ?? "—"
                } · 工具/轮 ${health.capabilityEnvelope.toolCallsPerTurn ?? "—"} · 历史 ${
                  health.capabilityEnvelope.maxHistoryMessages ?? "—"
                }`
              : "未配置模型"}
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
            data-testid="lm-doctor-mandatory-rules"
          >
            {health?.agentMandatoryRulesTruncated
              ? "已截断（见 policy 全文）"
              : health?.agentMandatoryRulesActive
                ? "已注入"
                : "未配置"}
          </span>
          <span className="lm-settings-key">本案规则</span>
          <span className="lm-meta" data-testid="lm-doctor-matter-rules-hint">
            可选：在 <code>matters/&lt;id&gt;/RULES.md</code> 或{" "}
            <code>cases/&lt;id&gt;/RULES.md</code> 写入本案强制规则（每轮硬注入）
          </span>
        </div>
        <details className="lm-doctor-advanced-trust" data-testid="lm-doctor-advanced-trust">
          <summary className="lm-meta">信任闭环指标（高级）</summary>
          <div className="lm-doctor-security-grid">
            <span className="lm-settings-key">引用模式</span>
            <span
              className={
                (doctor?.citationModeActive ?? health?.citationModeActive)
                  ? "lm-pill lm-pill-success"
                  : "lm-pill lm-pill-neutral"
              }
            >
              {(() => {
                const m = doctor?.citationMode ?? health?.citationMode ?? "assisted";
                return m === "grounded"
                  ? "严格援引"
                  : m === "off"
                    ? "关闭"
                    : "辅助标注";
              })()}
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
              {doctor?.productMetricsSummary?.triageConfirmed ?? 0} · 门禁失败{" "}
              {doctor?.productMetricsSummary?.gateFailures ?? 0} · 一次过{" "}
              {doctor?.productMetricsSummary?.firstPassOk ?? 0} · 改写{" "}
              {doctor?.productMetricsSummary?.rewrites ?? 0} · 改写幅度样本{" "}
              {doctor?.productMetricsSummary?.rewriteAmplitudeSamples ?? 0}
            </span>
            <span className="lm-settings-key">审查模板</span>
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
        </details>
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

      <details
        className="lm-settings-group lm-settings-surface lm-doctor-advanced"
        data-testid="lm-doctor-team-growth"
      >
        <summary className="lm-doctor-group-title">团队成长 · 内测指标（高级）</summary>
        <p className="lm-settings-caption">
          近 {teamGrowth?.windowDays ?? 30} 天窗口；相对基线看一次过 / 改写 / 学习处理 / 路由命中 /
          互审覆盖。样本不足时显示 n/a。
        </p>
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
      </details>

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
            : "默认 provider=open：使用本地开源语料（内置演示 sample，非正式完整法库）。无命中则拒答并显示「缺源」，不会编造条文或案号。"}{" "}
          闭源北大法宝 / Lexis 需手动设置 provider 与端点/Token（Lexis 未实现时为「适配器未实现」，非端点无效）；正式引用请律师核对官方法条与裁判文书。
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
          <span className="lm-settings-key">联网 allowlist</span>
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
            <span className="lm-settings-key">networkAllowlist</span>
            <span className="lm-meta">
              {Array.isArray(health.policy.networkAllowlist) && health.policy.networkAllowlist.length > 0
                ? health.policy.networkAllowlist.join(", ")
                : "未配置"}
            </span>
          </div>
          {health.policy.networkAllowlistEnforced ? (
            <p className="lm-meta">已启用强制 allowlist：未列入的主机将无法联网检索。</p>
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
        <h4 className="lm-doctor-group-title">推理图覆盖率</h4>
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
          需侧车 {reasoningGraphCoverage?.requiredDraftCount ?? 0} 份 · 已写入{" "}
          {reasoningGraphCoverage?.withSnapshotCount ?? 0} 份
        </p>
      </div>

      <div className="lm-settings-group lm-settings-surface">
        <h4 className="lm-doctor-group-title">案件数据一致性</h4>
        <p className="lm-settings-caption">
          读侧以 <code>matters/&lt;id&gt;/matter.json</code> 为准；CASE.md 为投影。不一致时可用下方按钮从
          JSON 重建。
        </p>
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
          {matterRepairBusy ? "重建中…" : "从 JSON 重建 CASE.md"}
        </button>
        {matterRepairMsg ? <p className="lm-meta">{matterRepairMsg}</p> : null}
      </div>

      <div className="lm-settings-group lm-settings-surface">
        <h4 className="lm-doctor-group-title">任务 / 草稿 / 交付物一致性</h4>
        <p className="lm-settings-caption">
          读侧优先 <code>tasks/</code>、<code>drafts/</code> 与{" "}
          <code>matters/&lt;id&gt;/deliverables/</code>{" "}
          JSON；含交付物指向缺失草稿、以及交付物审核态与草稿 <code>reviewStatus</code>{" "}
          不一致的漂移计数。
        </p>
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

      <details
        className="lm-settings-group lm-settings-surface lm-doctor-advanced"
        data-testid="lm-doctor-multitask-observability"
      >
        <summary className="lm-doctor-group-title">多任务运行观测（{multitaskObservability?.windowDays ?? 14} 天）（高级）</summary>
        <div className="lm-settings-row">
          <span className="lm-settings-key">样本</span>
          <span className="lm-meta">
            窗口内 {multitaskObservability?.jobsInWindow ?? 0} / 总计{" "}
            {multitaskObservability?.jobsTotal ?? 0}
          </span>
        </div>
        <div className="lm-settings-row">
          <span className="lm-settings-key">响应时间 P50/P90</span>
          <span className="lm-meta">
            {multitaskObservability?.leadTimeP50Ms != null
              ? `${Math.round(multitaskObservability.leadTimeP50Ms / 1000)}s`
              : "暂无"}{" "}
            /{" "}
            {multitaskObservability?.leadTimeP90Ms != null
              ? `${Math.round(multitaskObservability.leadTimeP90Ms / 1000)}s`
              : "暂无"}
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
      </details>

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
          <h4 className="lm-doctor-group-title">工作流与任务统计</h4>
          <div className="lm-doctor-stats">
            <span>任务 {doctor.taskCount ?? 0}</span>
            <span>草稿 {doctor.draftCount ?? 0}</span>
            <span>审计文件 {doctor.auditJsonlFileCount ?? 0}</span>
            <span>研究快照 {doctor.researchSnapshotCount ?? 0}</span>
          </div>
          <button type="button" className="lm-btn lm-btn-secondary lm-btn-sm" onClick={onOpenCollaborationPage}>
            打开在办
          </button>
        </div>
      ) : null}
    </div>
  );
}
