export type LawmindMainView =
  | "workspace"
  | "desk"
  | "agents"
  | "meeting"
  | "review"
  | "archive";

export const LAWMIND_MAIN_VIEWS: LawmindMainView[] = [
  "workspace",
  "desk",
  "agents",
  "meeting",
  "review",
  "archive",
];

export function lawmindMainViewLabel(view: LawmindMainView): string {
  switch (view) {
    case "workspace":
      return "对话";
    case "desk":
      return "工作台";
    case "agents":
      return "在办";
    case "meeting":
      return "会议室";
    case "review":
      return "改稿";
    case "archive":
      return "整理资料";
    default: {
      const unreachable: never = view;
      return unreachable;
    }
  }
}
