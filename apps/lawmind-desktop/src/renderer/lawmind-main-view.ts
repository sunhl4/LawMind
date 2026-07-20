export type LawmindMainView =
  | "workspace"
  | "agents"
  | "meeting"
  | "automations"
  | "review";

export const LAWMIND_MAIN_VIEWS: LawmindMainView[] = [
  "workspace",
  "agents",
  "meeting",
  "automations",
  "review",
];

export function lawmindMainViewLabel(view: LawmindMainView): string {
  switch (view) {
    case "workspace":
      return "对话";
    case "agents":
      return "在办";
    case "meeting":
      return "会议室";
    case "automations":
      return "自动办件";
    case "review":
      return "文书台";
  }
}
