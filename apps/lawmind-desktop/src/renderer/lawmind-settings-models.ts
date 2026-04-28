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

export type LawmindSettingsHealth = {
  modelConfigured: boolean;
  dualLegalConfigured?: boolean;
} | null;
