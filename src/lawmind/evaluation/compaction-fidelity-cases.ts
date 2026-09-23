/**
 * 压缩保真度金标语料（**自撰合成语料，自证**）。
 *
 * ## 这是什么，不是什么
 *
 * - **是**：一组「律师会怎么说话、案卷里会出现哪些关键事实」的**合成**对话，
 *   配上自撰的「压缩后必须仍能读到」的金标清单。用来回答一个具体问题：
 *   **连续压缩之后，模型还能不能读到关键事实？** 丢在哪一类、第几轮丢。
 * - **不是**：不是客户真实案卷，也不是律师人工标注的评测集。这里的金标是我按
 *   法律实务的关键事实类型（主体 / 金额 / 期限 / 引用 / 立场 / 未决 / 硬约束）
 *   自撰的。**它的结论只能用于机制回归，不能当现场证据**（同 `metrics/README.md`
 *   对演练数据的纪律：`drill: true` 必须自证，免得演练结果被当成真实分布）。
 *
 * 真实案卷的评测集需要律师把「必需存活的事实」在真案上标一遍——那是下一步，
 * 不是这个文件能替代的。
 */

export type FidelityFactKind =
  /** 任务目标：要做什么。丢了模型就会答非所问或重复已做的事。 */
  | "task"
  /** 主体 / 当事人 / 案号。 */
  | "party"
  /** 金额 / 标的。 */
  | "amount"
  /** 期限 / 时效 / 举证期。法律场景里丢了期限就是事故。 */
  | "deadline"
  /** 法条 / 案号引用。引用错 = 错误交付。 */
  | "citation"
  /** 已确认的立场 / 决定 / 口径。 */
  | "decision"
  /** 未决问题 / 待澄清。 */
  | "open_question"
  /** 律师给的硬约束（不要做什么、必须怎么写）。 */
  | "constraint";

export type FidelityFact = {
  id: string;
  kind: FidelityFactKind;
  /** 压缩后必须在留存历史里**按原串**读到的文本（子串匹配；被改写了一样算丢）。 */
  text: string;
  /**
   * `critical: true` = 丢了就是事故，基准**必须**保证存活。
   * `false` = 期望保留；基准只**测量**它，不据此判失败（测量值本身就是诊断信息）。
   */
  critical: boolean;
  note?: string;
};

export type FidelityTurn = {
  /** 律师这一轮说了什么（进入 lawyer 要点窗口的原料）。 */
  user: string;
  /** 助手这一轮回了什么（进入助手结论窗口）。 */
  assistant: string;
};

export type FidelityCase = {
  id: string;
  title: string;
  /** 合成语料自证：报告里会原样带出，消费方不得当现场证据。 */
  provenance: "synthetic-authored";
  matterId: string;
  /** 首条律师交办。任务锚点（钉子）的来源。 */
  openingInstruction: string;
  /** 之后的推进轮（律师 + 助手）。 */
  turns: FidelityTurn[];
  /** 金标：压缩后「必须仍能读到」的事实。 */
  facts: FidelityFact[];
};

/**
 * 案子一：劳动合同 / 竞业限制解除（实务里期限与金额最要命的一类）。
 *
 * 刻意让关键事实**分散在不同轮**：任务与主体在开场，立场与决定在中段，
 * 未决问题在近段——这样才能测出「哪一段会被压掉」。
 */
export const LABOR_NONCOMPETE_CASE: FidelityCase = {
  id: "labor-noncompete",
  title: "竞业限制解除与补偿（合成）",
  provenance: "synthetic-authored",
  matterId: "m-fidelity-labor",
  openingInstruction:
    "帮我把这份竞业限制协议的解除条款与三方义务分配写出来，落到 Word 稿；" +
    "我方是用人单位一方，注意补偿标准不能低于法定下限，也不要把员工已签的保密义务一起解除掉。",
  turns: [
    {
      user: "先说清楚背景：员工王某 2024 年 3 月 1 日入职，2026 年 8 月 31 日离职。",
      assistant:
        "已记：员工王某入职 2024 年 3 月 1 日、离职 2026 年 8 月 31 日，在职期间担任华东区销售总监。",
    },
    {
      user: "补偿按离职前十二个月平均工资的 30% 算，每月 9,800 元，先考虑发 12 个月。",
      assistant:
        "已按离职前十二个月平均工资的 30% 折算：每月补偿 9,800 元，暂按 12 个月计，合计 117,600 元。",
    },
    {
      user: "依据是《劳动合同法》第23条，以及《劳动合同法》第24条关于人员范围与期限上限的规定，限制范围只限华东区同类业务。",
      assistant:
        "已定位《劳动合同法》第23条（保密与竞业限制约定）与第24条（人员范围与期限上限），限制地域限华东区同类业务。",
    },
    {
      user: "我们的立场：解除的是竞业限制，保密义务继续有效；这一点必须在正文写明。",
      assistant: "已按立场写明：本次仅解除竞业限制，保密义务继续有效，并在解除条款段单独成句。",
    },
    {
      user: "还有两个坑要处理：一是补偿支付方式要约定违约金上限，二是要写清违约后的返还义务。",
      assistant:
        "已把两个缺口登记：补偿支付方式的违约金上限、违约后的补偿返还义务；均按待补充标注。",
    },
    {
      user: "补充：如果员工拒绝签收解除通知，就按协议约定的送达地址邮寄，并留存回执。",
      assistant: "已写入送达条款：拒签时按协议约定地址邮寄并留存回执，作为送达凭证归档。",
    },
    {
      user: "另外提醒：劳动仲裁申请时效是一年，从当事人知道权利被侵害之日起算，别把时间写死。",
      assistant:
        "已记：劳动仲裁申请时效为一年，自当事人知道其权利被侵害之日起计算；正文不写死具体日期。",
    },
    {
      user: "现在开始起草吧，先把解除条款正文写出来给我看，其余两方义务分配随后补。",
      assistant: "开始起草解除条款正文；三方义务分配待解除条款定稿后接着补。",
    },
  ],
  facts: [
    {
      id: "task-解除条款与三方义务",
      kind: "task",
      text: "解除条款与三方义务分配",
      critical: true,
      note: "任务锚点。丢了模型会答非所问或重复已做的事。",
    },
    {
      id: "constraint-保密义务不解除",
      kind: "constraint",
      text: "不要把员工已签的保密义务一起解除掉",
      critical: true,
      note: "律师开场给的硬约束，压缩后仍要能读到。",
    },
    {
      id: "constraint-补偿不低于法定下限",
      kind: "constraint",
      text: "补偿标准不能低于法定下限",
      critical: true,
    },
    {
      id: "party-王某",
      kind: "party",
      text: "员工王某",
      critical: true,
    },
    {
      id: "citation-第23条",
      kind: "citation",
      text: "《劳动合同法》第23条",
      critical: true,
      note: "引用错 = 错误交付；靠压缩时的引用锚点跨轮传递。",
    },
    {
      id: "citation-第24条",
      kind: "citation",
      text: "《劳动合同法》第24条",
      critical: true,
    },
    {
      id: "deadline-仲裁时效一年",
      kind: "deadline",
      text: "劳动仲裁申请时效是一年",
      critical: true,
      note: "期限类事实：法律场景里丢了就是事故。",
    },
    {
      id: "amount-月补偿9800",
      kind: "amount",
      text: "每月 9,800 元",
      critical: false,
      note: "金额期望保留；基准只测量，不据此判失败。",
    },
    {
      id: "decision-保密继续有效",
      kind: "decision",
      text: "保密义务继续有效",
      critical: false,
    },
    {
      id: "open-违约金上限",
      kind: "open_question",
      text: "违约金上限",
      critical: false,
    },
    {
      id: "service-送达回执",
      kind: "decision",
      text: "留存回执",
      critical: false,
    },
  ],
};

/** 可供基准与 CLI 遍历的全部语料（当前一案；后续可加合并 / 诉讼类）。 */
export const FIDELITY_CASES: readonly FidelityCase[] = [LABOR_NONCOMPETE_CASE];
