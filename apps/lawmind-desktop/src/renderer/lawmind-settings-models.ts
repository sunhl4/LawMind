/** Shared types for LawMind desktop settings sub-panels. */

export type AssistantOrgRole = "lead" | "member" | "intern";

export type AssistantStats = {
  lastUsedAt: string;
  turnCount: number;
  sessionCount: number;
};

export type AssistantRow = {
  assistantId: string;
  displayName: string;
  introduction: string;
  presetKey?: string;
  customRoleTitle?: string;
  customRoleInstructions?: string;
  orgRole?: AssistantOrgRole;
  reportsToAssistantId?: string;
  peerReviewDefaultAssistantId?: string;
  createdAt: string;
  updatedAt: string;
  stats?: AssistantStats;
};

export type LawmindSettingsAppConfig = {
  workspaceDir: string;
  projectDir: string | null;
  retrievalMode: "single" | "dual";
};

export type LawmindSettingsAuthorityCorpus = {
  configured?: boolean;
  status?: "unset" | "invalid" | "configured" | "sample-ready" | "unimplemented";
  endpointHost?: string | null;
  /** 是否已配置 LAWMIND_AUTHORITY_API_KEY（不暴露密钥） */
  authConfigured?: boolean;
  provider?: "open" | "generic" | "pkulaw" | "lexis";
  providerLabel?: string;
  message?: string;
  envKey?: string;
  authEnvKey?: string;
  providerEnvKey?: string;
  /** 开源来源就绪清单（含 npc_flk；来自 Doctor 权威库摘要） */
  openSources?: Array<{ id: string; ready?: boolean }>;
};

/** Doctor / settings: sample-ready or commercial configured (probeable). */
export function isAuthorityCorpusUiReady(
  status: LawmindSettingsAuthorityCorpus["status"] | undefined,
): boolean {
  return status === "configured" || status === "sample-ready";
}

/** Green pill only for commercial/configured endpoint — never for demo sample. */
export function isAuthorityCorpusCommercialReady(
  status: LawmindSettingsAuthorityCorpus["status"] | undefined,
): boolean {
  return status === "configured";
}

export function authorityCorpusStatusLabel(
  corpus: Pick<LawmindSettingsAuthorityCorpus, "status" | "endpointHost" | "authConfigured" | "providerLabel"> | null | undefined,
): string {
  const status = corpus?.status ?? "unset";
  if (status === "sample-ready") {
    return "演示语料就绪（非正式权威库）";
  }
  if (status === "configured") {
    return `已配置${corpus?.endpointHost ? ` · ${corpus.endpointHost}` : ""}${
      corpus?.authConfigured ? " · 已设鉴权" : ""
    }${corpus?.providerLabel ? ` · ${corpus.providerLabel}` : ""}`;
  }
  if (status === "unimplemented") {
    return "适配器未实现";
  }
  if (status === "invalid") {
    return "配置无效";
  }
  return "未配置";
}

/** Format /api/authority/probe success line — prefer note; avoid misleading hits 0. */
export function formatAuthorityProbeSuccessMsg(opts: {
  latencyMs?: number;
  hitCount?: number;
  note?: string;
  provider?: LawmindSettingsAuthorityCorpus["provider"];
}): string {
  const parts: string[] = [`探测成功：${opts.latencyMs ?? "?"}ms`];
  if (typeof opts.hitCount === "number") {
    parts.push(
      opts.provider === "open" ? `语料 ${opts.hitCount} 条` : `hits ${opts.hitCount}`,
    );
  }
  const note = opts.note?.trim();
  if (note) {
    parts.push(note);
  } else if (opts.provider !== "open") {
    parts.push("（契约探测，非语料核验）");
  }
  return parts.join(" · ");
}

export type LawmindSettingsHealth = {
  modelConfigured: boolean;
  modelVerified?: boolean;
  dualLegalConfigured?: boolean;
  webSearchApiKeyConfigured?: boolean;
  webSearchNativeAvailable?: boolean;
  webSearchReady?: boolean;
  webSearchPolicyBlocked?: boolean;
  modelName?: string | null;
  modelEnvFileExists?: boolean;
  draftWithModelEnabled?: boolean;
  draftWithModelActive?: boolean;
  /** 权威库端点契约（来自 /api/health doctor.authorityCorpus） */
  authorityCorpus?: LawmindSettingsAuthorityCorpus;
  /** 今日权威调用计量（无查询正文） */
  authorityUsage?: {
    day?: string;
    ok?: number;
    error?: number;
    total?: number;
    message?: string;
  };
} | null;

export function webSearchStatusLabel(health: {
  webSearchReady?: boolean;
  webSearchNativeAvailable?: boolean;
  webSearchApiKeyConfigured?: boolean;
}): { ready: boolean; label: string } {
  if (health.webSearchNativeAvailable) {
    return { ready: true, label: "随当前模型" };
  }
  if (health.webSearchApiKeyConfigured) {
    return { ready: true, label: "Brave 备用已配置" };
  }
  if (health.webSearchReady) {
    return { ready: true, label: "已就绪" };
  }
  return { ready: false, label: "未就绪" };
}

export function retrievalShareLabel(mode?: string): string {
  return mode === "dual" ? "对话与检索分开" : "共用同一模型";
}
