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
    ...overrides,
  };
}
