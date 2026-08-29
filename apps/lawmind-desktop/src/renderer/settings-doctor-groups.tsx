/**
 * LawmindSettingsDoctor 的展示性子组件（拆分自 LawmindSettingsDoctor.tsx，纯提取无行为变化）。
 * 连接与模型 / 工作区与记忆真相源 / 外部集成 三个分组。
 */
import type { ReactNode } from "react";
import type { HealthPayload } from "./lawmind-app-data";

type DoctorData = NonNullable<HealthPayload["doctor"]>;
type WorkspaceStandard = NonNullable<DoctorData["workspaceStandard"]>;
type MemoryTruthSources = NonNullable<DoctorData["memoryTruthSources"]>;
type WorkspaceCheck = {
  id: string;
  label: string;
  state: "ok" | "warn" | "missing";
  hint: string;
};

export type IntegrationConnectorView = {
  id: string;
  label?: string;
  status?: string;
  hint?: string;
  phase?: string;
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

export function DoctorConnectionGroup(props: {
  health: HealthPayload | null;
  doctor: DoctorData | undefined;
  onOpenApiWizard: () => void;
}): ReactNode {
  const { health, doctor, onOpenApiWizard } = props;
  return (
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
  );
}

export function DoctorWorkspaceTruthGroup(props: {
  ws: WorkspaceStandard | undefined;
  mem: MemoryTruthSources | undefined;
  onOpenMemorySection?: () => void;
  onScrollToWorkspace?: () => void;
}): ReactNode {
  const { ws, mem, onOpenMemorySection, onScrollToWorkspace } = props;
  return (
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
      )) ?? <p className="lm-meta">正在检测工作区标准…</p>}
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
  );
}

export function DoctorPromptSectionsGroup(props: {
  sections?: Array<{ id: string; title: string; always: boolean; cache?: "static" | "session" | "turn" }>;
}): ReactNode {
  const sections = props.sections ?? [];
  if (sections.length === 0) {
    return null;
  }
  return (
    <div className="lm-settings-group lm-settings-surface" id="lawmind-settings-prompt-sections">
      <h4 className="lm-doctor-group-title">助手说明装配（段表）</h4>
      <p className="lm-settings-caption">
        与对话里实际装配的助手说明同一张段表。标「每轮」的段落始终注入；其余按案件、岗位、联网等条件装配。
      </p>
      <ol className="lm-doctor-prompt-sections">
        {sections.map((row) => (
          <li key={row.id}>
            <span>{row.title}</span>
            <em>{row.always ? "每轮" : "按需"}</em>
          </li>
        ))}
      </ol>
    </div>
  );
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

export function DoctorIntegrationsGroup(props: {
  connectors: IntegrationConnectorView[];
}): ReactNode {
  const { connectors } = props;
  return (
    <div className="lm-settings-group lm-settings-surface">
      <h4 className="lm-doctor-group-title">外部集成</h4>
      <ul className="lm-doctor-integrations-list">
        {connectors.map((conn) => {
          const status = typeof conn.status === "string" ? conn.status : "";
          return (
            <li key={conn.id} className="lm-doctor-integration-row">
              <div className="lm-doctor-check-head">
                <span>
                  {conn.label} <span className="lm-meta">({conn.phase})</span>
                </span>
                <span className={connectorPillClass(status)}>{connectorStatusLabel(status)}</span>
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
  );
}
