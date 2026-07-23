import { vi } from "vitest";
import type { LawmindComposeExtras } from "../useLawmindComposeExtras";

export function mockComposeExtras(
  overrides: Partial<LawmindComposeExtras> = {},
): LawmindComposeExtras {
  return {
    permissionMode: "standard",
    onPermissionModeChange: vi.fn(),
    pendingApprovalCount: 0,
    actionSummary: null,
    refreshPending: vi.fn().mockResolvedValue(undefined),
    contextBudget: null,
    refreshContextBudget: vi.fn().mockResolvedValue(undefined),
    applyStreamTokenBudget: vi.fn(),
    compactSession: vi.fn().mockResolvedValue(undefined),
    distillSessionLearning: vi.fn().mockResolvedValue(undefined),
    compactBusy: false,
    compactHint: null,
    ...overrides,
  };
}
