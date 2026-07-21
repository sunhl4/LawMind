export type LawmindMainView =
  | "home"
  | "workspace"
  | "agents"
  | "meeting"
  | "automations"
  | "review";

export const LAWMIND_MAIN_VIEWS: LawmindMainView[] = [
  "home",
  "workspace",
  "agents",
  "meeting",
  "automations",
  "review",
];

export function lawmindMainViewLabel(view: LawmindMainView): string {
  switch (view) {
    case "home":
      return "驾驶舱";
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
