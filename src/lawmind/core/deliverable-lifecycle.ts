export const DELIVERABLE_LIFECYCLE_STATUSES = [
  "planned",
  "drafting",
  "pending_review",
  "approved",
  "rendered",
  "delivered",
  "learned",
  "blocked",
] as const;

export type DeliverableLifecycleStatus = (typeof DELIVERABLE_LIFECYCLE_STATUSES)[number];

export type DeliverableLifecycleTransition = {
  from: DeliverableLifecycleStatus;
  to: DeliverableLifecycleStatus;
  label: string;
};

export const DELIVERABLE_LIFECYCLE_TRANSITIONS: DeliverableLifecycleTransition[] = [
  { from: "planned", to: "drafting", label: "Start drafting" },
  { from: "drafting", to: "pending_review", label: "Submit for lawyer review" },
  { from: "pending_review", to: "approved", label: "Approve draft" },
  { from: "approved", to: "rendered", label: "Render deliverable" },
  { from: "rendered", to: "delivered", label: "Mark delivered to audience" },
  { from: "delivered", to: "learned", label: "Capture post-review learning" },
  { from: "drafting", to: "blocked", label: "Block draft" },
  { from: "pending_review", to: "blocked", label: "Request changes" },
  { from: "blocked", to: "drafting", label: "Resume drafting" },
];

export function isDeliverableLifecycleStatus(value: string): value is DeliverableLifecycleStatus {
  return DELIVERABLE_LIFECYCLE_STATUSES.includes(value as DeliverableLifecycleStatus);
}

export function canTransitionDeliverable(
  from: DeliverableLifecycleStatus,
  to: DeliverableLifecycleStatus,
): boolean {
  if (from === to) {
    return true;
  }
  return DELIVERABLE_LIFECYCLE_TRANSITIONS.some((transition) => {
    return transition.from === from && transition.to === to;
  });
}

export function nextDeliverableStatuses(
  from: DeliverableLifecycleStatus,
): DeliverableLifecycleStatus[] {
  return DELIVERABLE_LIFECYCLE_TRANSITIONS.filter((transition) => transition.from === from).map(
    (transition) => transition.to,
  );
}

export function deliverableStatusLabel(status: DeliverableLifecycleStatus): string {
  switch (status) {
    case "planned":
      return "已规划";
    case "drafting":
      return "起草中";
    case "pending_review":
      return "待审核";
    case "approved":
      return "已批准";
    case "rendered":
      return "已渲染";
    case "delivered":
      return "已交付";
    case "learned":
      return "已沉淀";
    case "blocked":
      return "已阻塞";
  }
}
