export type LawmindMainView =
  | "workspace"
  | "agents"
  | "meeting"
  | "review";

export const LAWMIND_MAIN_VIEWS: LawmindMainView[] = [
  "workspace",
  "agents",
  "meeting",
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
    case "review":
      return "文书台";
  }
}
