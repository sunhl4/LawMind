/**
 * 律师可见词汇的单一真相源。
 *
 * ## 为什么需要这个文件
 *
 * 策略文档 A2 的目标是「词汇收敛」。真做的时候先盘了一遍现状，结论与文档预期不同：
 * 主界面其实已经很干净（一级导航只有 对话 / 工作台 / 在办，「守护」「判断分级」
 * 这类内部词一次都没出现）。**真正的问题不是词太多，是同一个对象有两个名字**：
 * 设置导航与主界面把定时任务叫「自动办件」，而它的面板内部叫「我的交办任务」，
 * 告警、空态、删除确认也全用后者。律师在同一个功能里要猜这两个是不是一回事。
 *
 * 所以这里不建大词表，只做一件事：**给每个律师可见对象钉一个名字，并把退休的同义词
 * 记下来**，让 `lawmind-lawyer-vocabulary.test.ts` 能守住「不再漂回去」。
 *
 * ## 边界（刻意不做的事）
 *
 * - **不改内部命名**：`automation` / `LawyerAutomation` 等代码标识符保持不动。
 *   改代码标识符的收益是零（律师看不到），代价是巨大的 diff 与回归风险。
 * - **不动「助手编制」**：它是有意的产品措辞（用户手册里有专门说明），
 *   且改动要同时动设置导航、导航单测、E2E 与文档。是否有必要属于产品决策，
 *   不该由一次词汇清理顺手决定。
 */

/** 律师可见对象 → 唯一对外名字。 */
export const LAWYER_VOCABULARY = {
  assistant: "助手",
  chat: "对话",
  desk: "工作台",
  fleet: "在办",
  /** 定时/条件触发的重复性工作。**不要**再叫「交办任务」。 */
  automation: "自动办件",
  template: "文书模板",
  memory: "记忆库",
} as const;

export type LawyerVocabularyKey = keyof typeof LAWYER_VOCABULARY;

/**
 * 退休的同义词：不再对律师使用的说法 → 应使用的名字。
 *
 * 只收录**真实发生过的漂移**，不预造一份「禁词表」——那种表会变成没人维护的摆设，
 * 而且容易把正常的近义表达（例：「交办」作为动词）误判成违规。
 */
export const RETIRED_LAWYER_SYNONYMS: Readonly<Record<string, LawyerVocabularyKey>> = {
  // 同一对象两个名字的实例：面板内部曾用「交办任务」指自动办件。
  交办任务: "automation",
};

/**
 * 允许出现退休同义词的地方。
 *
 * - `lawmind-lawyer-vocabulary.ts` 本身（就是这份清单）
 * - 测试文件（断言的是行为，不是文案；且有的用例正是在验历史措辞）
 * - CHANGELOG / 归档文档（历史记录不该被改写）
 *
 * 用路径片段而不是文件名精确匹配：目录位置变了也不至于让守卫失效。
 */
export const RETIRED_SYNONYM_ALLOWED_PATH_FRAGMENTS: readonly string[] = [
  "lawmind-lawyer-vocabulary",
  "/docs/archive/",
  "CHANGELOG.md",
];
