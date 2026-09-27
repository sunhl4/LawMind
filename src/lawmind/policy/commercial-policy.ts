/**
 * 律所策略合同：`lawmind.policy.json` 只保留 IT 能下的硬边界。
 * 未知键、密钥、以及引擎调参都拒绝并说明原因，不静默生效，也不把整份扔掉。
 */

import { normalizeConversationLength } from "../agent/context-preset.js";
import type { LawMindWorkspacePolicy } from "./workspace-policy.js";

export type PolicyKeyNote = {
  key: string;
  reason: string;
};

export type CommercialPolicyInspection = {
  /** 缺 schemaVersion / 坏 JSON 时为 null，其余键仍尽量不整份作废。 */
  policy: LawMindWorkspacePolicy | null;
  rejected: PolicyKeyNote[];
  migrated: PolicyKeyNote[];
};

const NOT_A_FIRM_KNOB: Record<string, string> = {
  features: "版本能力由版本表决定，不能在策略里单键关掉",
  judgmentTiering: "判断分级是产品行为，不在策略文件里调",
  judgmentDisabledVerifiers: "判断分级是产品行为，不在策略文件里调",
  judgmentEscalation: "判断分级是产品行为，不在策略文件里调",
  judgmentEscalationPosture: "判断分级是产品行为，不在策略文件里调",
  judgementPromotion: "不按本地样本误报率跳过律师签批",
  decisionModelMode: "决策模型不写在策略文件里",
  decisionModelBaseUrl: "决策模型不写在策略文件里",
  decisionModelApiKey: "密钥不能写在策略文件里",
  decisionModelId: "决策模型不写在策略文件里",
  routeDivergenceShadow: "路由分歧是引擎内部对照，不在策略文件里",
  routeDivergencePosture: "路由分歧是引擎内部对照，不在策略文件里",
  productInsightsCollection: "产品观察默认不上传，不在策略文件里打开",
  teamMemorySync: "团队记忆同步不在这份策略合同里",
  memoryRecall: "记忆召回调参由引擎内置",
  citationMode: "引用门禁由版本决定，不能在策略里关掉",
  agentPromptVerbosity: "提示词详略不是律所硬约束",
  intakeHeuristicsEnabled: "交办启发式不是律所硬约束",
  searchIndexAutoRebuild: "索引重建不是律所硬约束",
  appliedPreferencesFooter: "偏好脚注不是律所硬约束",
  autoDeliverableWorkflow: "自动交付流程不是律所硬约束",
  agentMaxHistoryMessages: "历史条数配额会掐模型，不在策略里",
  agentMaxToolCallsPerTurn: "每轮工具上限会掐模型，不在策略里",
  autoApproveSandboxWorkflowSteps: "不能用策略跳过危险操作的确认",
  privilegeSentinel: "特权提示不能在策略里关掉",
  progressiveAutonomy: "不按本地通过率自动跳过律师签批",
  benchmarkGateMinScore: "benchmark 分不是律所策略",
  auditExportCadenceHint: "审计导出节奏不是产品开关",
  retrievalMode: "检索通道由引擎决定，不在策略文件里",
  hostAccess: "本机访问走本机授权，不在这份策略里",
  toolSandbox: "工具沙箱不是律所策略开关",
  ethicsWall: "伦理墙跟版本走，不能在策略里关掉",
  highSecurityMode: "已废弃",
  agentMandatoryRules: "长规则写进 firmRulesPath 指向的文件，不要内联进策略",
  networkAllowlistEnforced: "白名单是否强制由 network.mode 决定",
  buildChannel: "构建通道不进策略文件",
  LAWMIND_BUILD_CHANNEL: "构建通道不进策略文件",
};

function note(key: string, reason: string): PolicyKeyNote {
  return { key, reason };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
}

/**
 * 把磁盘上的对象收成引擎仍能读的策略。
 * 旧键能映射到合同的，记入 migrated 并生效；其余拒绝。
 */
export function inspectCommercialPolicy(raw: unknown): CommercialPolicyInspection {
  const rejected: PolicyKeyNote[] = [];
  const migrated: PolicyKeyNote[] = [];
  const src = asRecord(raw);
  if (!src) {
    return {
      policy: null,
      rejected: [note("(file)", "策略文件不是 JSON 对象")],
      migrated,
    };
  }
  const schemaVersion = src.schemaVersion;
  if (typeof schemaVersion !== "number" || schemaVersion < 1) {
    return {
      policy: null,
      rejected: [note("schemaVersion", "必须是大于等于 1 的数字，否则整份不生效")],
      migrated,
    };
  }

  const out: Record<string, unknown> = { schemaVersion };

  const edition = typeof src.edition === "string" ? src.edition.trim().toLowerCase() : "";
  if (edition === "solo" || edition === "firm" || edition === "private_deploy") {
    out.edition = edition;
  } else if (src.edition !== undefined) {
    rejected.push(note("edition", "只能是 solo、firm 或 private_deploy"));
  }

  const network = asRecord(src.network);
  let egress: string | undefined;
  let hosts: string[] | undefined;
  if (network) {
    const mode = typeof network.mode === "string" ? network.mode.trim().toLowerCase() : "";
    if (mode === "open" || mode === "offline") {
      egress = mode;
    } else if (mode === "allowlist" || mode === "allowlisted") {
      egress = "allowlisted";
    } else if (network.mode !== undefined) {
      rejected.push(note("network.mode", "只能是 open、allowlist 或 offline"));
    }
    if (network.hosts !== undefined) {
      hosts = stringList(network.hosts);
    }
  }
  if (egress === undefined && typeof src.egressMode === "string") {
    const legacy = src.egressMode.trim().toLowerCase();
    if (legacy === "open" || legacy === "allowlisted" || legacy === "offline") {
      egress = legacy;
      migrated.push(note("egressMode", "请改成 network.mode（allowlisted 写成 allowlist）"));
    } else {
      rejected.push(note("egressMode", "只能是 open、allowlisted 或 offline"));
    }
  }
  if (src.highSecurityMode === true && egress === undefined) {
    egress = "offline";
    migrated.push(note("highSecurityMode", "已按离线生效，请改成 network.mode: offline"));
  } else if (src.highSecurityMode !== undefined) {
    rejected.push(note("highSecurityMode", "已废弃，请改成 network.mode"));
  }
  if (egress) {
    out.egressMode = egress;
    if (egress === "allowlisted") {
      out.networkAllowlistEnforced = true;
    }
  }

  if (hosts === undefined && Array.isArray(src.networkAllowlist)) {
    hosts = stringList(src.networkAllowlist);
    migrated.push(note("networkAllowlist", "请改成 network.hosts"));
  }
  if (hosts && hosts.length > 0) {
    out.networkAllowlist = hosts;
    if (out.egressMode === undefined) {
      out.egressMode = "allowlisted";
      out.networkAllowlistEnforced = true;
    }
  }

  if (src.allowWebSearch === false) {
    out.allowWebSearch = false;
  } else if (src.allowWebSearch !== undefined) {
    rejected.push(note("allowWebSearch", "联网偏好不写在策略里；要封顶用 network.mode"));
  }

  const outbound = asRecord(src.outbound);
  let domains = outbound ? stringList(outbound.recipientDomains) : [];
  if (domains.length === 0 && Array.isArray(src.outboundAllowedDomains)) {
    domains = stringList(src.outboundAllowedDomains);
    migrated.push(note("outboundAllowedDomains", "请改成 outbound.recipientDomains"));
  }
  if (domains.length > 0) {
    out.outboundAllowedDomains = domains;
  }

  const rulesPath =
    typeof src.firmRulesPath === "string"
      ? src.firmRulesPath.trim()
      : typeof src.agentMandatoryRulesPath === "string"
        ? src.agentMandatoryRulesPath.trim()
        : "";
  if (typeof src.agentMandatoryRulesPath === "string" && typeof src.firmRulesPath !== "string") {
    migrated.push(note("agentMandatoryRulesPath", "请改成 firmRulesPath"));
  }
  if (rulesPath) {
    out.agentMandatoryRulesPath = rulesPath;
  }

  if (src.delivery === "always_full_review") {
    out.delivery = { firmForceFullReview: true };
  } else if (src.delivery === "standard") {
    out.delivery = { firmForceFullReview: false };
  } else if (typeof src.delivery === "string") {
    rejected.push(note("delivery", "只能是 standard 或 always_full_review"));
  } else {
    const legacyDelivery = asRecord(src.delivery);
    if (legacyDelivery && typeof legacyDelivery.firmForceFullReview === "boolean") {
      out.delivery = { firmForceFullReview: legacyDelivery.firmForceFullReview };
      migrated.push(
        note("delivery.firmForceFullReview", "请改成 delivery: always_full_review 或 standard"),
      );
    }
  }

  const replica = asRecord(src.replica);
  const legacyReplica = asRecord(src.matterReplica);
  const sharedDir =
    (replica && typeof replica.sharedDir === "string" ? replica.sharedDir.trim() : "") ||
    (legacyReplica && typeof legacyReplica.sharedRelayDir === "string"
      ? legacyReplica.sharedRelayDir.trim()
      : "");
  if (legacyReplica && typeof legacyReplica.sharedRelayDir === "string" && !replica) {
    migrated.push(note("matterReplica.sharedRelayDir", "请改成 replica.sharedDir"));
  }
  const replicaEnabled =
    replica && typeof replica.enabled === "boolean"
      ? replica.enabled
      : legacyReplica && typeof legacyReplica.enabled === "boolean"
        ? legacyReplica.enabled
        : undefined;
  const replicaAutoSync =
    replica && typeof replica.autoSync === "boolean"
      ? replica.autoSync
      : legacyReplica && typeof legacyReplica.autoSync === "boolean"
        ? legacyReplica.autoSync
        : undefined;
  if (sharedDir || replicaEnabled !== undefined || replicaAutoSync !== undefined) {
    out.matterReplica = {
      ...(replicaEnabled !== undefined
        ? { enabled: replicaEnabled }
        : sharedDir
          ? { enabled: true }
          : {}),
      ...(sharedDir ? { sharedRelayDir: sharedDir } : {}),
      ...(replicaAutoSync !== undefined
        ? { autoSync: replicaAutoSync }
        : sharedDir
          ? { autoSync: true }
          : {}),
    };
  }
  if (legacyReplica) {
    for (const secret of ["cloudToken", "endpoint", "cloudDataDir"] as const) {
      if (legacyReplica[secret] !== undefined) {
        rejected.push(note(`matterReplica.${secret}`, "地址和令牌不能写在策略文件里"));
      }
    }
  }

  if (typeof src.wordAddinAutoRun === "boolean") {
    out.wordAddinAutoRun = src.wordAddinAutoRun;
  }

  if (src.allowAnalysisScripts === true) {
    out.allowAnalysisScripts = true;
  } else if (src.allowAnalysisScripts === false) {
    out.allowAnalysisScripts = false;
  }

  if (src.conversationLength !== undefined) {
    const length = normalizeConversationLength(src.conversationLength);
    if (length) {
      out.conversationLength = length;
    } else {
      rejected.push(note("conversationLength", "只能是 200K、500K 或 1M"));
    }
  }

  if (src.context && typeof src.context === "object" && !Array.isArray(src.context)) {
    out.context = src.context;
  }

  if (src.enableCollaboration === false) {
    out.enableCollaboration = false;
  } else if (src.enableCollaboration === true) {
    rejected.push(note("enableCollaboration", "协作是否可用由版本决定；策略只能显式关掉"));
  }

  const firmEdition = out.edition === "firm" || out.edition === "private_deploy";
  if (src.guardianTrackedRedline === "block") {
    out.guardianTrackedRedline = "block";
  } else if (src.guardianTrackedRedline === "advisory") {
    if (firmEdition) {
      rejected.push(note("guardianTrackedRedline", "律所和私有化不能把修订稿审稿降成只提示"));
    } else {
      rejected.push(note("guardianTrackedRedline", "修订稿审稿姿态跟版本走，不在策略里放宽"));
    }
  } else if (src.guardianTrackedRedline !== undefined) {
    rejected.push(note("guardianTrackedRedline", "不能识别的审稿姿态，已按版本默认"));
  }

  const consumed = new Set([
    "schemaVersion",
    "description",
    "edition",
    "network",
    "egressMode",
    "highSecurityMode",
    "networkAllowlist",
    "allowWebSearch",
    "outbound",
    "outboundAllowedDomains",
    "firmRulesPath",
    "agentMandatoryRulesPath",
    "agentMandatoryRules",
    "delivery",
    "replica",
    "matterReplica",
    "wordAddinAutoRun",
    "allowAnalysisScripts",
    "enableCollaboration",
    "guardianTrackedRedline",
    "description",
    "conversationLength",
    "context",
  ]);

  for (const key of Object.keys(src)) {
    if (consumed.has(key)) {
      if (NOT_A_FIRM_KNOB[key] && key !== "highSecurityMode" && key !== "agentMandatoryRules") {
        rejected.push(note(key, NOT_A_FIRM_KNOB[key]));
      }
      if (
        key === "agentMandatoryRules" &&
        typeof src.agentMandatoryRules === "string" &&
        src.agentMandatoryRules.trim()
      ) {
        rejected.push(note("agentMandatoryRules", NOT_A_FIRM_KNOB.agentMandatoryRules));
      }
      continue;
    }
    rejected.push(note(key, NOT_A_FIRM_KNOB[key] ?? "不是律所策略键，已忽略"));
  }

  if (typeof src.description === "string" && src.description.trim()) {
    out.description = src.description.trim();
  }

  return {
    policy: out as LawMindWorkspacePolicy,
    rejected,
    migrated,
  };
}

export function effectivePolicyRows(policy: LawMindWorkspacePolicy | null): PolicyKeyNote[] {
  if (!policy) {
    return [];
  }
  const rows: PolicyKeyNote[] = [];
  const edition = policy.edition;
  if (edition) {
    rows.push(note("edition", edition));
  }
  if (policy.egressMode) {
    const mode = policy.egressMode === "allowlisted" ? "allowlist" : policy.egressMode;
    rows.push(note("network.mode", mode));
  }
  if (policy.networkAllowlist && policy.networkAllowlist.length > 0) {
    rows.push(note("network.hosts", policy.networkAllowlist.join(", ")));
  }
  if (policy.allowWebSearch === false) {
    rows.push(note("allowWebSearch", "false"));
  }
  if (policy.outboundAllowedDomains && policy.outboundAllowedDomains.length > 0) {
    rows.push(note("outbound.recipientDomains", policy.outboundAllowedDomains.join(", ")));
  }
  if (policy.agentMandatoryRulesPath) {
    rows.push(note("firmRulesPath", policy.agentMandatoryRulesPath));
  }
  if (policy.delivery?.firmForceFullReview === true) {
    rows.push(note("delivery", "always_full_review"));
  } else if (policy.delivery?.firmForceFullReview === false) {
    rows.push(note("delivery", "standard"));
  }
  if (policy.matterReplica?.sharedRelayDir) {
    rows.push(note("replica.sharedDir", policy.matterReplica.sharedRelayDir));
  }
  if (typeof policy.wordAddinAutoRun === "boolean") {
    rows.push(note("wordAddinAutoRun", policy.wordAddinAutoRun ? "true" : "false"));
  }
  if (policy.enableCollaboration === false) {
    rows.push(note("enableCollaboration", "false"));
  }
  if (policy.guardianTrackedRedline === "block") {
    rows.push(note("guardianTrackedRedline", "block"));
  }
  return rows;
}
