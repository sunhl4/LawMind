/** Shared types for LawMind desktop settings sub-panels. */

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
