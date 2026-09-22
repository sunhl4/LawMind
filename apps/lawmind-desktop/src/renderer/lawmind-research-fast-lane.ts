/**
 * Solo 空态：合规卷宗 / 调研简报 / 培训课件一键交办文案。
 * 与 builtin workflow starterPrompt 对齐，保证 deliverableType 路由稳定。
 */

export type ResearchFastLaneKind = "compliance" | "learning" | "training";

export type ResearchFastLaneOption = {
  id: ResearchFastLaneKind;
  label: string;
  hint: string;
  deliverableType: "report.compliance" | "report.learning" | "ppt.training";
};

export const RESEARCH_FAST_LANE_OPTIONS: ResearchFastLaneOption[] = [
  {
    id: "compliance",
    label: "合规卷宗",
    hint: "URL + 管辖矩阵",
    deliverableType: "report.compliance",
  },
  {
    id: "learning",
    label: "调研简报",
    hint: "效力分级学习材料",
    deliverableType: "report.learning",
  },
  {
    id: "training",
    label: "培训课件",
    hint: "先大纲再 PPT",
    deliverableType: "ppt.training",
  },
];

export type ResearchFastLanePromptOpts = {
  jurisdictions?: string;
  urls?: string;
};

export function buildResearchFastLanePrompt(
  kind: ResearchFastLaneKind,
  topic = "",
  opts: ResearchFastLanePromptOpts = {},
): string {
  const t = topic.trim() || "【待补充主题】";
  const jurisdictions = opts.jurisdictions?.trim() ?? "";
  const urls = opts.urls?.trim() ?? "";
  switch (kind) {
    case "compliance": {
      const lines = [
        "【交办】合规研究卷宗",
        "交付物类型：涉外合规卷宗备忘录",
        "交付物类型代码：report.compliance",
        "交办要点：",
        `- 监管问题：${t}`,
      ];
      if (jurisdictions) {
        lines.push(`- 涉及管辖区：${jurisdictions}`);
      }
      if (urls) {
        lines.push(`- 相关 URL / 官网清单：${urls}`);
      }
      lines.push(
        "",
        "请先 deep_research / 抓取 URL 卷宗并给出研究大纲，待我在澄清卡片确认大纲后再写正文。",
        "须含：问题陈述、简要结论、管辖区效力矩阵、按风险域发现、行动建议、来源附录；不确定处标 [VERIFY]。",
        "调用 execute_workflow 时请传 deliverable_type: report.compliance。",
      );
      return lines.join("\n");
    }
    case "learning":
      return [
        "【交办】学习型调研简报",
        "交付物类型：学习型调研简报",
        "交付物类型代码：report.learning",
        "交办要点：",
        `- 主题：${t}`,
        "- 读者/用途：所内学习分享",
        "- 必覆盖章节：背景、制度要点（分效力层级）、比较与实务启示、来源",
        "",
        "请先给出研究大纲待我确认，再起草正文；新闻/博客不得写成现行法。",
        "调用 execute_workflow 时请传 deliverable_type: report.learning。",
      ].join("\n");
    case "training":
      return [
        "【交办】培训课件",
        "交付物类型：培训课件",
        "交付物类型代码：ppt.training",
        "交办要点：",
        `- 主题：${t}`,
        "- 受众/场合：所内律师培训",
        "- 时长：约 30 分钟",
        "- 脱敏声明：材料已脱敏或仅用公开信息",
        "",
        "请先给出课件大纲待我确认，再生成可导出 PPT；若使用案件材料须已脱敏并注明「已脱敏」。",
        "调用 execute_workflow 时请传 deliverable_type: ppt.training。",
      ].join("\n");
  }
}
