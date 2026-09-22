/**
 * 常用 ClausePattern 构造函数。
 * 用于以声明式方式定义「定义-引用-义务-责任」等结构化条款模式。
 */

import type { ClausePattern, ClauseTrigger, ClauseType } from "./pattern.js";

export interface DefineClauseOptions {
  triggers?: ClauseTrigger[];
  children?: ClausePattern[];
  capture?: ClausePattern["capture"];
  extractor?: ClausePattern["extractor"];
}

export function defineClause(
  type: ClauseType,
  name: string,
  options: DefineClauseOptions = {},
): ClausePattern {
  return {
    type,
    name,
    triggers: options.triggers ?? [name],
    children: options.children,
    capture: options.capture,
    extractor: options.extractor,
  };
}

/** 定义条款模式：识别「定义」「释义」「以下简称」等表述。 */
export function definitions(): ClausePattern {
  return defineClause("definition", "定义", {
    triggers: [
      "定义",
      "释义",
      "术语",
      "本合同所称",
      "本协议所称",
      "以下简称",
      /[「“"][^」”"]+[」”"]\s*[（(]以下简称[）)]/,
    ],
  });
}

/** 义务条款模式：识别保密、付款、交付等义务。 */
export function obligations(): ClausePattern {
  return defineClause("obligation", "义务", {
    triggers: [
      "义务",
      "应当",
      "应",
      "必须",
      "履行",
      "保密义务",
      "付款义务",
      "交付义务",
      "通知义务",
      "协助义务",
      "交付",
      "付款",
    ],
  });
}

/** 权利条款模式：识别「有权」「解除权」等。 */
export function rights(): ClausePattern {
  return defineClause("right", "权利", {
    triggers: ["权利", "有权", "解除权", "选择权", "请求权", "终止权"],
  });
}

/** 违约责任模式：含赔偿上限与不可抗力子模式。 */
export function liability(): ClausePattern {
  return defineClause("liability", "违约责任", {
    triggers: ["违约", "违约责任", "赔偿", "赔偿责任", "赔偿损失", "违约金"],
    children: [
      defineClause("general", "赔偿上限", {
        triggers: ["赔偿上限", "最高赔偿", "不超过"],
        capture: { bodyRe: /(?:赔偿上限|最高赔偿|不超过)[^。；]+(?:。|；|\.)/ },
      }),
      defineClause("general", "不可抗力", {
        triggers: ["不可抗力"],
        capture: { bodyRe: /不可抗力[^。；]+(?:。|；|\.)/ },
      }),
    ],
  });
}

/** 争议解决模式：诉讼、仲裁、管辖。 */
export function dispute(): ClausePattern {
  return defineClause("dispute", "争议解决", {
    triggers: ["争议解决", "争议", "仲裁", "诉讼", "管辖", "人民法院", "法院"],
  });
}

/** 默认条款模式集合；后续可替换为更完备的合同族配置。 */
export function defaultClausePatterns(): ClausePattern[] {
  return [definitions(), obligations(), rights(), liability(), dispute()];
}
