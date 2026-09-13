/**
 * Shared instruction matchers for 办件 bind / keyword route / deliverable meta.
 * Leaf module (no fs). One regex per scene so the three routers cannot drift.
 */

export const RESEARCH_FALLBACK_RE = /(查一下|检索|法规|法条|类案|司法解释|研究一下|调研)/;

/** 法律检索线索：命中则不要当成娱乐/新闻公网事实。 */
const LEGAL_LOOKUP_RE =
  /(法条|法规|司法解释|民法典|刑法|合同|协议条款|合规|类案|裁判|条例|诉讼|律师|侵权|违约|管辖|开庭|立案|起诉|案号|[一-龥]{2,}法(第|修订|草案|实施)?|第\s*[0-9一二三四五六七八九十百]+\s*条|《[^》]{1,40}》)/;

const PUBLIC_WEB_FACT_RE =
  /(总冠军|冠军是谁|谁赢了|新说唱|选秀节目|综艺节目|热搜榜|票房冠军|比分是多少)/;

/**
 * 公开网页事实（赛事冠军、综艺），不是法律备忘。
 * 「查一下民法典违约责任」仍走 research.memo；「查一下新说唱总冠军」不应绑法律深度研究。
 */
export function isPublicWebFactLookup(text: string): boolean {
  const t = text.trim();
  if (!t || LEGAL_LOOKUP_RE.test(t)) {
    return false;
  }
  return PUBLIC_WEB_FACT_RE.test(t);
}

export function publicWebFactToolRefusal(
  instruction: string,
  allowWebSearch: boolean,
): string | null {
  if (!isPublicWebFactLookup(instruction)) {
    return null;
  }
  if (!allowWebSearch) {
    return "这是公开网页事实（不是法律备忘）。请在对话栏把「联网」改成开启后调用 web_search。deep_research / research_task / list_more_tools 都不能代替该开关。不要凭记忆填写冠军或获奖者。";
  }
  return "这是公开网页事实，请直接调用 web_search（不要 deep_research / research_task）。引用须带 URL；查不到就如实说，不要猜。";
}

/** 需要后台核算/出图/整表，而不是律师自己写代码。 */
export const COMPUTE_INTENT_RE =
  /(出图|柱状图|饼图|折线图|统计汇总|汇总表|对照表|测算表|透视表|归并表格|表格分析|分析这张表|分析这[份张].{0,12}表|把这[张份]表|电子表格|\.xlsx|\.csv|\bExcel\b)/i;
/** 路由到核算对照交件；不含裸 .xlsx，避免抢走合同审查。 */
export const COMPUTE_TABLE_PACK_RE =
  /(出图|柱状图|饼图|折线图|统计汇总|汇总表|对照表|测算表|透视表|归并表格|表格分析|分析这张表|分析这[份张].{0,12}表|把这[张份]表)/i;
export const LABOR_CALC_RE =
  /(经济补偿|赔偿金|N\s*\+?\s*1|2N|加班费|双倍工资|违法解除|解除劳动合同.{0,12}(赔|补偿))/;
export const PERIOD_CALC_RE =
  /(期限计算|(计算|起算|几天内).{0,10}(上诉期|答辩期|申请仲裁)|上诉期.{0,6}(计算|届满)|答辩期.{0,6}(计算|届满))/;
export const MATTER_INTAKE_RE = /(整理案卷|整理.{0,8}案件材料|新建案件|建立案件|案件目录|归位材料)/;
export const TALK_INTAKE_RE =
  /(谈话整理|谈话记录|会议纪要|客户口述|客户说了|把这段谈话|整理案情谈话)/;
export const LEGAL_EVENT_RE = /(传票|开庭通知|抽出开庭|写入日历|期限提醒)/;
export const INVOICE_RE = /(整理发票|发票归类|进项发票|发票入卷)/;
export const COURT_SMS_RE = /(法院短信|12368|开庭短信|缴费短信)/;
export const IP_DISPUTE_RE = /(知产争议|专利侵权|商标侵权|著作权侵权|被控侵权)/;
export const MA_DILIGENCE_RE = /(并购尽调|收购尽调|交割清单|经营者集中申报|股权收购尽调)/;
export const DATA_COMPLIANCE_RE = /(数据合规|个人信息保护影响|数据出境评估|PIPL|数据安全法合规)/;
export const ADS_COMPLIANCE_RE =
  /(广告合规|广告法审查|广告用语核对|食品标签合规|产品标签合规|产品合规备忘)/;
export const FAMILY_MATTER_RE = /(离婚诉讼|抚养权|探望权|遗产继承|婚内财产分割|遗嘱继承)/;
export const CAPITAL_MARKETS_RE = /(招股说明书|信息披露备忘|再融资尽调|发行文件核对|持续督导备忘)/;
export const GOVERNANCE_RE =
  /(董事会决议|股东会决议|监事会决议|关联交易审议|独立董事意见|公司治理备忘)/;
export const BANKRUPTCY_RE = /(债权申报|破产重整|债权人会议|破产清算|重整计划)/;
export const CIVIL_STAGE_RE = /(上诉状|二审上诉请求|执行异议|执行复议|案外人异议|立案材料清单)/;
export const APPEAL_RE = /(上诉状|二审上诉请求)/;
export const ENFORCEMENT_RE = /(执行异议|执行复议|案外人异议)/;
export const FILING_PACK_RE = /(立案材料清单)/;
export const CRIMINAL_MATTER_RE =
  /(侦查阶段|审查起诉|取保候审|刑事辩护|死刑复核|会见申请|刑事辩护提纲|审查起诉意见)/;
/** Kind/deliverable routing only — do not steal generic 查一下审查起诉. */
export const CRIMINAL_ROUTE_RE = /(取保候审|会见申请|审查起诉意见|刑事辩护提纲|死刑复核|侦查阶段)/;
export const QUICK_TRIAGE_RE =
  /(违法吗|合法吗|能不能告|能不能起诉|有没有责任|怎么维权|是否构成|算不算违法|这算不算问题)/;
