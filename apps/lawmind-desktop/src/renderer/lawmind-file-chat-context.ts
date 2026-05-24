import type { FileChatContextItem } from "./lawmind-app-shell";

export function buildFileContextMessagePrefix(items: FileChatContextItem[]): string {
  if (items.length === 0) {
    return "";
  }
  const lines = items.map((it) => {
    const scope = it.root === "workspace" ? "工作区" : "项目";
    const p = it.relPath || "（工作区/项目根，谨慎操作）";
    if (it.root === "workspace") {
      const hint =
        it.kind === "directory"
          ? "请先在目录中定位要读的文件，用 analyze_document 读工作区相对路径。"
          : "请用 analyze_document 读取以下工作区相对路径。";
      return `- [${scope} · ${it.kind === "directory" ? "目录" : "文件"}] \`${p}\` — ${hint}`;
    }
    const hint =
      it.kind === "directory"
        ? "对项目内文件用 read_project_file(相对项目根的路径) 逐份阅读；目录下请先列举再选读。"
        : "请用 read_project_file 读取。";
    return `- [${scope} · ${it.kind === "directory" ? "目录" : "文件"}] \`${p}\` — ${hint}`;
  });
  return `【用户在 LawMind 文件页将下列路径标为“本回合重点”】\n${lines.join("\n")}\n\n`;
}
