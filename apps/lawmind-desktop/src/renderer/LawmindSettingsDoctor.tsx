import { useEffect, useState, type ReactNode } from "react";
import { apiSendJson } from "./api-client";
import { loadHealthPayload, type HealthPayload } from "./lawmind-app-data";

type WorkspaceCheck = {
  id: string;
  label: string;
  state: "ok" | "warn" | "missing";
  hint: string;
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

function pct(rate: number | undefined): string {
  if (rate == null || Number.isNaN(rate)) {
    return "n/a";
  }
  return `${Math.round(rate * 1000) / 10}%`;
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

  const health = healthProp ?? fetchedHealth;
  const doctor = health?.doctor;
  const ws = doctor?.workspaceStandard;
  const mem = doctor?.memoryTruthSources;
  const sessionHealth = doctor?.sessionHealth;
  const integrationConnectors = doctor?.integrations?.connectors ?? [];
  const searchIndex = doctor?.searchIndex;
  const p2 = doctor?.p2;
  const matterConsistency = doctor?.matterConsistency;
  const taskDraftConsistency = doctor?.taskDraftConsistency;
  const multitaskObservability = doctor?.multitaskObservability;
  const reasoningGraphCoverage = doctor?.reasoningGraphCoverage;

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
      };
      if (j.ok) {
        setRebuildMsg(
          `已重建：审计 ${j.auditRows ?? 0} 条，会话 ${j.sessionRows ?? 0} 条。刷新体检可查看最新状态。`,
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
      <div className="lm-settings-section-title">系统体检</div>
      <p className="lm-meta lm-settings-doctor-lead">
        检查本机连接、工作区记忆与协作环境，便于新律师在 30 分钟内完成首份可交付草稿。
      </p>

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
        <p className="lm-settings-hint">
          检查 MEMORY.md、律师/律所档案等真相源文件是否就绪。待采纳的记忆建议请在设置 →{" "}
          {onOpenMemorySection ? (
            <button type="button" className="lm-link-btn" onClick={() => onOpenMemorySection()}>
              记忆库
            </button>
          ) : (
            "记忆库"
          )}
          中处理。
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
          <h4 className="lm-doctor-group-title">外部集成（M2）</h4>
          <p className="lm-meta lm-settings-doctor-lead">
            只读连接器 POC：本地案件目录可索引；DMS 需在工作区配置后由 IT 启用真实 API。
          </p>
          <ul className="lm-doctor-integrations-list">
            {integrationConnectors.map((conn) => (
              <li key={conn.id} className="lm-doctor-integration-row">
                <div className="lm-doctor-check-head">
                  <span>
                    {conn.label}{" "}
                    <span className="lm-meta">({conn.phase})</span>
                  </span>
                  <span className={connectorPillClass(conn.status)}>
                    {connectorStatusLabel(conn.status)}
                  </span>
                </div>
                {conn.hint ? <p className="lm-meta">{conn.hint}</p> : null}
                {conn.status === "active" && /fixture|演示|POC/i.test(conn.hint ?? "") ? (
                  <p className="lm-callout lm-callout-info lm-callout-compact">
                    当前为演示数据，非真实 DMS 连接。Solo 版默认不启用 OAuth；律所版由 IT 配置环境变量与{" "}
                    <code>lawmind/integrations.json</code>。
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {p2 ? (
        <div className="lm-settings-group lm-settings-surface">
          <h4 className="lm-doctor-group-title">P2 隔离与团队记忆（默认关闭）</h4>
          <p className="lm-meta lm-settings-doctor-lead">
            高风险工具子进程沙箱与律所团队记忆云同步均为 opt-in；未启用时不改变现有执行路径。
          </p>
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
        <h4 className="lm-doctor-group-title">信任闭环（Skills S1）</h4>
        <p className="lm-meta lm-settings-doctor-lead">
          分诊规则、引用模式与产品指标管道状态；用于验收 G1 / 日常自检。
        </p>
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
          <span className="lm-settings-key">分诊规则</span>
          <span
            className={
              (doctor?.triageRulesLoaded ?? health?.triageRulesLoaded)
                ? "lm-pill lm-pill-success"
                : "lm-pill lm-pill-warn"
            }
          >
            {(doctor?.triageRulesLoaded ?? health?.triageRulesLoaded)
              ? `已加载 ${doctor?.triageRuleCount ?? health?.triageRuleCount ?? 0} 条`
              : "未加载"}
          </span>
          <span className="lm-settings-key">产品指标</span>
          <span className="lm-meta">
            事件 {doctor?.productMetricsSummary?.total ?? 0} · 分诊确认{" "}
            {doctor?.productMetricsSummary?.triageConfirmed ?? 0} · gate 失败{" "}
            {doctor?.productMetricsSummary?.gateFailures ?? 0}
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
        <p className="lm-meta" data-testid="lm-doctor-golden-hint">
          黄金集基线：本地运行{" "}
          <code>pnpm lawmind:skills:golden -- --compare</code>，报告见{" "}
          <code>docs/generated/skills-golden-compare-report.json</code>（CI 亦上传 artifact）。
        </p>
      </div>

      <div className="lm-settings-group lm-settings-surface">
        <h4 className="lm-doctor-group-title">高安全模式（参考 cLawyer）</h4>
        <p className="lm-meta lm-settings-doctor-lead">
          三项状态供律所 IT 快速核对：联网边界、危险工具批准、审计链完整性。
        </p>
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
        <h4 className="lm-doctor-group-title">Legal Reasoning Graph 覆盖率</h4>
        <p className="lm-meta lm-settings-doctor-lead">
          高风控交付物（需 reasoning graph 侧车）的草稿中，已写入 reasoning snapshot 的比例。
        </p>
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
        <p className="lm-meta lm-settings-doctor-lead">
          检查 <code>matters/&lt;id&gt;/matter.json</code> 与 <code>cases/&lt;id&gt;/CASE.md</code>{" "}
          是否对齐（JSON 为真相源，CASE 为投影）。
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
        <h4 className="lm-doctor-group-title">任务 / 草稿一致性</h4>
        <p className="lm-meta lm-settings-doctor-lead">
          只读检查 <code>tasks/*.json</code> 与 <code>drafts/*.json</code>{" "}
          是否对齐（孤儿草稿、交付任务缺草稿）。
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

      <div className="lm-settings-group lm-settings-surface">
        <h4 className="lm-doctor-group-title">多任务 Jobs 观测（{multitaskObservability?.windowDays ?? 14} 天）</h4>
        <p className="lm-meta lm-settings-doctor-lead">
          读取 <code>lawmind/jobs/*.json</code> 与协作审计窗口，展示 lead time / 重试 / 取消 / 失败率（只读）。
        </p>
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
        <p className="lm-meta lm-settings-doctor-lead">
          只读索引库位于工作区 <code>lawmind/search-index.sqlite</code>，用于审计与会话全文检索。
        </p>
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
            审计 {searchIndex.auditRows ?? 0} 条 · 会话 {searchIndex.sessionRows ?? 0} 条
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
        <p className="lm-meta">
          需在本机环境设置 <code>LAWMIND_ALLOW_INDEX_REBUILD=1</code> 后重建按钮才可用。
        </p>
      </div>

      <div className="lm-settings-group lm-settings-surface">
        <h4 className="lm-doctor-group-title">MCP 只读桥接（Cursor / Claude Desktop）</h4>
        <p className="lm-meta lm-settings-doctor-lead">
          工作区诊断与案件/草稿只读查询可通过 stdio MCP 暴露给外部助手，不写入工作区。
        </p>
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
          <button type="button" className="lm-btn lm-btn-secondary lm-btn-sm" onClick={onOpenCollaborationPage}>
            打开在办
          </button>
        </div>
      ) : null}
    </div>
  );
}
