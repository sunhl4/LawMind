import type { LawyerCapabilityId } from "../skills/lawyer-capability-lock.js";

export type LawyerWorkStatus = "open" | "running" | "needs_signoff" | "done" | "rejected";

export type LawyerWorkSource = "chat" | "mail" | "file" | "compare" | "automation";

export type LawyerWork = {
  workId: string;
  title: string;
  goal: string;
  status: LawyerWorkStatus;
  sessionId?: string;
  taskId?: string;
  draftId?: string;
  matterId?: string;
  /** 办件流程锁，供「存成自动办件」复用同一能力。 */
  capabilityId?: LawyerCapabilityId;
  source: LawyerWorkSource;
  createdAt: string;
  updatedAt: string;
};

export type LawyerWorkEvent = {
  type: string;
  at: string;
  [key: string]: unknown;
};

export type LawyerWorkUpsertInput = {
  workId?: string;
  title?: string;
  goal?: string;
  status?: LawyerWorkStatus;
  sessionId?: string;
  taskId?: string;
  draftId?: string;
  matterId?: string;
  capabilityId?: LawyerCapabilityId;
  source?: LawyerWorkSource;
};
