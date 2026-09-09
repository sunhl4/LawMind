/**
 * LPM columns for 办案周报 / 范围变更 / 结案 / 本地顾问 / 资源计划 / 干系人沟通.
 * Apache LPM field names absorbed as structure only — independent Chinese copy.
 * Never blocks. Mail/Word tracked redline do not use these scaffolds.
 * 飞书/日历写入不是交件；本稿只出内部口径。
 */

import type { ArtifactSection } from "../types.js";

export type LpmMemoKind =
  | "status"
  | "scope_change"
  | "close"
  | "local_counsel"
  | "resource_plan"
  | "stakeholder_comms"
  | "issuance_list"
  | "collab_platform";

const CLOSE_RE = /(结案备忘|办案复盘|结案小结|事项收尾)/;
const SCOPE_RE = /(事项范围变更|范围变更说明|范围变更)/;
const LOCAL_COUNSEL_RE = /(本地顾问对接|外地律师工作包|当地律师对接备忘|协办律师工作包)/;
const RESOURCE_PLAN_RE = /(办案人力安排|事项资源计划|办案资源计划)/;
const STAKEHOLDER_RE = /(干系人沟通计划|客户沟通节奏备忘)/;
const ISSUANCE_RE = /(待签发清单|文书签发清单|签发台账)/;
const COLLAB_RE = /(协作平台建议|事项协作建议|办案协作建议)/;
const STATUS_RE = /(办案周报|事项状态报告|今日办案简报|事项简报|写本案办案周报)/;

/** Shared matcher for bind + router. More specific kinds are inferred first. */
export const LPM_MEMO_INSTRUCTION_RE =
  /(办案周报|事项状态报告|事项范围变更|范围变更说明|结案备忘|办案复盘|结案小结|今日办案简报|事项简报|本地顾问对接|外地律师工作包|当地律师对接备忘|协办律师工作包|办案人力安排|事项资源计划|办案资源计划|干系人沟通计划|客户沟通节奏备忘|待签发清单|文书签发清单|签发台账|协作平台建议|事项协作建议|办案协作建议)/;

function placeholder(label: string): string {
  return `【${label}】`;
}

export function inferLpmMemoKind(instruction: string): LpmMemoKind | undefined {
  if (LOCAL_COUNSEL_RE.test(instruction)) {
    return "local_counsel";
  }
  if (RESOURCE_PLAN_RE.test(instruction)) {
    return "resource_plan";
  }
  if (STAKEHOLDER_RE.test(instruction)) {
    return "stakeholder_comms";
  }
  if (ISSUANCE_RE.test(instruction)) {
    return "issuance_list";
  }
  if (COLLAB_RE.test(instruction)) {
    return "collab_platform";
  }
  if (CLOSE_RE.test(instruction)) {
    return "close";
  }
  if (SCOPE_RE.test(instruction)) {
    return "scope_change";
  }
  if (STATUS_RE.test(instruction)) {
    return "status";
  }
  return undefined;
}

export function lpmMemoTitle(kind: LpmMemoKind): string {
  if (kind === "close") {
    return "结案备忘";
  }
  if (kind === "scope_change") {
    return "范围变更说明";
  }
  if (kind === "local_counsel") {
    return "本地顾问对接";
  }
  if (kind === "resource_plan") {
    return "办案资源计划";
  }
  if (kind === "stakeholder_comms") {
    return "干系人沟通计划";
  }
  if (kind === "issuance_list") {
    return "待签发清单";
  }
  if (kind === "collab_platform") {
    return "办案协作建议";
  }
  return "办案周报";
}

function confidenceBody(): string {
  return [
    `已确认：${placeholder("材料里写明的事实")}`,
    `从材料推断：${placeholder("未写明但可从附件推出")}`,
    `一般知识：${placeholder("执业常识，非正式依据")}`,
    `未知：${placeholder("冲突两说并列，不自动消解")}`,
  ].join("\n");
}

export function buildLpmMemoSections(kind: LpmMemoKind, supplement: string): ArtifactSection[] {
  if (kind === "local_counsel") {
    return [
      {
        heading: "事项",
        body: `管辖地 / 程序阶段：${placeholder("法院或仲裁地")}${supplement}`,
      },
      {
        heading: "工作包",
        body: `主办负责：${placeholder("策略、客户、主文书")}\n当地负责：${placeholder("出庭、送达、当地程序、盖章")}\n不在当地范围内：${placeholder("明确排除，避免悄悄扩大")}`,
      },
      {
        heading: "对接",
        body: `当地律师：${placeholder("所名 / 联系人；缺则待补")}\n冲突与聘用：材料未写明仍出工作包，不把冲突表当开工闸门`,
      },
      {
        heading: "费率",
        body: `当地费率或上限：${placeholder("缺费率仍列工作项")}`,
      },
      {
        heading: "结论",
        body: `${placeholder("本周要交给当地的一页工作包")}（本稿不对客户签发）`,
      },
      {
        heading: "待办",
        body: `- ${placeholder("发出工作包或要回当地稿")}；日期：${placeholder("截止日期，缺则待补日期")}`,
      },
    ];
  }
  if (kind === "resource_plan") {
    return [
      {
        heading: "事项",
        body: `阶段：${placeholder("当前程序阶段")}${supplement}`,
      },
      {
        heading: "角色",
        body: `主办：${placeholder("合伙人/主办")}\n协办：${placeholder("律师/律师助理")}\n当地：${placeholder("需要则写；不需要写无")}`,
      },
      {
        heading: "关键路径",
        body: `谁盯哪份交件：${placeholder("交件 → 负责人")}\n卡住：${placeholder("谁、等到哪天")}`,
      },
      {
        heading: "预算",
        body: `剩余预算或上限：${placeholder("缺费率仍列工时项，标待补充")}`,
      },
      {
        heading: "结论",
        body: `${placeholder("本周人力安排")}（本稿不对客户签发）`,
      },
      {
        heading: "待办",
        body: `- ${placeholder("抽人或改预算")}；日期：${placeholder("截止日期")}`,
      },
    ];
  }
  if (kind === "stakeholder_comms") {
    return [
      {
        heading: "事项",
        body: `沟通对象：客户 / 对方 / 法院或仲裁庭 / 内部${supplement}`,
      },
      {
        heading: "口径",
        body: `先出邮件口径。飞书云文档和日历写入不是交件，未配置也不挡这篇。\n对客户说：${placeholder("本周要让客户知道的")}\n不外发：${placeholder("内部争点和未核数字")}`,
      },
      {
        heading: "节奏",
        body: `下次外发渠道：邮件（默认）。短信/电话只写要点，不把未核事实写死。\n- ${placeholder("对象 → 渠道 → 日期")}`,
      },
      {
        heading: "结论",
        body: `${placeholder("本周沟通安排")}（本稿不是律师函，也不自动群发）`,
      },
      {
        heading: "待办",
        body: `- ${placeholder("起草或发出哪一封")}；日期：${placeholder("截止日期")}`,
      },
    ];
  }
  if (kind === "issuance_list") {
    return [
      {
        heading: "事项",
        body: `待外发对象：${placeholder("客户 / 法院 / 对方")}${supplement}`,
      },
      {
        heading: "已可外发",
        body: `- ${placeholder("稿件已齐、只差发出")}`,
      },
      {
        heading: "仍差",
        body: `签批：${placeholder("谁签、哪一份")}\n附件：${placeholder("缺的清单")}\n本稿是清单不是审批页，缺签批仍列出，不挡看稿。`,
      },
      {
        heading: "结论",
        body: placeholder("本周能发出的和还不能发的"),
      },
      {
        heading: "待办",
        body: `- ${placeholder("补签或补件")}；日期：${placeholder("截止日期")}`,
      },
    ];
  }
  if (kind === "collab_platform") {
    return [
      {
        heading: "事项",
        body: `协作场景：${placeholder("跨所 / 客户 / 当地律师")}${supplement}`,
      },
      {
        heading: "建议",
        body: `默认邮件 + 本地事项目录。飞书云文档只读索引可选，未配置不挡干活。\n不要把写入飞书、日历或台账当成交件。`,
      },
      {
        heading: "落点",
        body: `主稿：${placeholder("本地 cases 目录")}\n外发：邮件。只读索引：${placeholder("需要则写飞书文件夹；不需要写无")}`,
      },
      {
        heading: "结论",
        body: `${placeholder("本事项怎么协作")}（本稿不改连接器，也不自动开通写入）`,
      },
      {
        heading: "待办",
        body: `- ${placeholder("告诉团队用哪条通道")}；日期：${placeholder("截止日期")}`,
      },
    ];
  }
  if (kind === "close") {
    return [
      {
        heading: "事项",
        body: `收尾对象：${placeholder("当事人 / 案由 / 阶段")}${supplement}`,
      },
      {
        heading: "已交付",
        body: `- ${placeholder("已交文书或节点")}`,
      },
      {
        heading: "未了结",
        body: `- ${placeholder("仍开放的期限、费用、对方请求")}`,
      },
      {
        heading: "范围回顾",
        body: `原范围：${placeholder("接案时要做的")}\n实际做了：${placeholder("含悄悄扩大的项，单独标出")}`,
      },
      {
        heading: "可复用",
        body: `- ${placeholder("下回同类事项可直接用的口径或目录")}`,
      },
      {
        heading: "结论",
        body: `${placeholder("内部收尾结论")}（本稿不对客户签发，除非交办要求外发摘要）`,
      },
      {
        heading: "待办",
        body: `- ${placeholder("下一步")}；日期：${placeholder("截止日期，缺则待补日期")}`,
      },
    ];
  }
  if (kind === "scope_change") {
    return [
      {
        heading: "事项",
        body: `范围变更对象：${placeholder("当事人 / 案由")}${supplement}`,
      },
      {
        heading: "原范围",
        body: `- ${placeholder("接案或上次确认仍要做的")}`,
      },
      {
        heading: "新出现",
        body: `- ${placeholder("材料或邮件里新冒出的工作，不要并进原范围")}`,
      },
      {
        heading: "已排除",
        body: `- ${placeholder("明确不做的")}`,
      },
      {
        heading: "结论",
        body: `${placeholder("是否扩大、谁确认")}（本稿不对客户签发）`,
      },
      {
        heading: "待办",
        body: `- ${placeholder("通知委托人或改预算")}；日期：${placeholder("截止日期")}`,
      },
    ];
  }
  return [
    {
      heading: "事项",
      body: `阶段：${placeholder("当前程序阶段")}${supplement}`,
    },
    {
      heading: "进度",
      body: `推进结果（不要写开会次数）：${placeholder("本周实际往前走了哪一步")}\n卡住：${placeholder("谁、等到哪天、逾期怎么办")}`,
    },
    {
      heading: "期限",
      body: `- ${placeholder("开庭 / 答辩 / 申报")}；能算用 calculate`,
    },
    {
      heading: "范围",
      body: `仍在范围内：${placeholder("本次要交的")}\n已排除：${placeholder("明确不做")}\n新变更：${placeholder("单独列出，不要悄悄扩大")}`,
    },
    {
      heading: "风险与已决",
      body: `风险：${placeholder("会改变交期或费用的")}\n假设：${placeholder("未证实但仍在用的")}\n问题：${placeholder("已发生的障碍")}\n已决：${placeholder("材料里已经定下来的")}`,
    },
    {
      heading: "置信",
      body: confidenceBody(),
    },
    {
      heading: "结论",
      body: `${placeholder("内部状态")}（本稿不对客户签发，除非交办要求外发摘要）`,
    },
    {
      heading: "待办",
      body: `- ${placeholder("下一步")}；日期：${placeholder("截止日期，缺则待补日期")}`,
    },
  ];
}

export function buildMatterIntakeSections(supplement: string, instruction = ""): ArtifactSection[] {
  const party = instruction.match(/(?:原告|当事人|委托人)[：:]\s*([^\n，。;；]{1,40})/);
  const other = instruction.match(/(?:被告|对方)[：:]\s*([^\n，。;；]{1,40})/);
  const cause = instruction.match(/案由[：:]\s*([^\n，。;；]{1,40})/);
  const partyLine = [
    party?.[1] ? `当事人：${party[1].trim()}` : `当事人：${placeholder("已能确定的")}`,
    other?.[1] ? `对方：${other[1].trim()}` : null,
    cause?.[1] ? `案由：${cause[1].trim()}` : `案由：${placeholder("已能确定的")}`,
  ]
    .filter(Boolean)
    .join("；");
  return [
    {
      heading: "事项",
      body: `${partyLine}${supplement}`,
    },
    {
      heading: "归位说明",
      body: `委托、证据、对方材料、我方文稿、财务。知产加权利证书与被控侵权材料。\n- ${placeholder("文件 → 目录")}`,
    },
    {
      heading: "范围",
      body: `本次要交：${placeholder("文书/程序")}\n不在范围内：${placeholder("明确排除")}\n粗预算：${placeholder("缺费率仍列工作项")}`,
    },
    {
      heading: "结论",
      body: `${placeholder("已能建档的字段")}；缺的标【待补充】，不挡建档`,
    },
    {
      heading: "下一步",
      body: `- ${placeholder("归位或补材料")}；日期：${placeholder("截止日期")}`,
    },
  ];
}
