/** 对话里「去核对」的标记。不含磁盘读写，渲染进程也能用。 */

const MARKER_RE = /\[\[word-check:([A-Za-z0-9._-]+)\]\]/g;

export function wordCheckMarker(taskId: string): string {
  return `[[word-check:${taskId}]]`;
}

export function splitWordCheckMarkers(text: string): { body: string; taskIds: string[] } {
  const taskIds: string[] = [];
  const body = text
    .replace(new RegExp(MARKER_RE.source, "g"), (_all, id: string) => {
      if (!taskIds.includes(id)) {
        taskIds.push(id);
      }
      return "";
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { body, taskIds };
}
