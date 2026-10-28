/**
 * 案件成果物再生纪律（对照 MeWork 项目扩展 prompt，合法吸收措辞）。
 *
 * 核心三条：先读再更新、不另建同类文件、资料不足先确认不编造。
 */

export type MatterArtifactExtensionId = "timeline" | "mindmap" | "chronology";

export type MatterArtifactExtension = {
  id: MatterArtifactExtensionId;
  skill: string;
  file: string;
  /** 律师可见短名 */
  nameZh: string;
  emptyDescriptionZh: string;
};

/** 与 MeWork 三件套同构的默认落点（案件根目录 JSON）。 */
export const MATTER_ARTIFACT_EXTENSIONS: readonly MatterArtifactExtension[] = [
  {
    id: "timeline",
    skill: "case-timeline",
    file: "project.case-timeline.json",
    nameZh: "时间线",
    emptyDescriptionZh: "按时间梳理事件，串联关键节点与来源。",
  },
  {
    id: "mindmap",
    skill: "case-mindmap",
    file: "project.case-mindmap.json",
    nameZh: "思维导图",
    emptyDescriptionZh: "展开事项脉络，呈现问题、观点与关联关系。",
  },
  {
    id: "chronology",
    skill: "case-chronology",
    file: "project.case-chronology.json",
    nameZh: "大事记",
    emptyDescriptionZh: "逐项整理重要事实，记录时间、人物与依据。",
  },
] as const;

/**
 * 单条成果物的再生/首次生成指令。可直接塞进交办或交付物重生成 helper。
 */
export function formatMatterArtifactRegeneratePrompt(input: {
  skill: string;
  name: string;
  file: string;
}): string {
  const skill = input.skill.trim();
  const name = input.name.trim();
  const file = input.file.trim();
  return (
    `请使用 ${skill} 技能，根据当前项目资料整理${name}，` +
    `保存到项目工作目录根目录的 \`${file}\`，并交付该文件。` +
    `如果文件已经存在，请先读取，再按本次要求更新，不另建同类文件；` +
    `资料不足时先向我确认，不编造内容。`
  );
}

export function formatMatterArtifactExtensionPrompt(extension: MatterArtifactExtension): string {
  return formatMatterArtifactRegeneratePrompt({
    skill: extension.skill,
    name: extension.nameZh,
    file: extension.file,
  });
}

/** 新建案件时勾选多件扩展：共用上下文、逐项交付。 */
export function formatMatterArtifactBatchPrompt(input: {
  matterName: string;
  description?: string;
  extensionIds: readonly MatterArtifactExtensionId[];
}): string | null {
  const selected = MATTER_ARTIFACT_EXTENSIONS.filter((e) => input.extensionIds.includes(e.id));
  if (selected.length === 0) {
    return null;
  }
  const desc = (input.description ?? "").trim();
  const head =
    `为项目「${input.matterName.trim()}」创建以下成果。` +
    (desc ? `项目描述：${desc}。` : "") +
    `请在本次对话中共用项目资料和上下文，逐项完成所选任务并交付全部文件。`;
  const lines = selected.map((e) => formatMatterArtifactExtensionPrompt(e));
  return [head, ...lines].join("\n\n");
}
