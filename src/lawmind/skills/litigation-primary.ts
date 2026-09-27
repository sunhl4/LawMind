/**
 * Which two litigation skill bodies to inject. Filename and the text after
 * the last drafting verb decide; a mentioned source pleading does not.
 */

const DEFENSE_PLEADINGS = ["答辩状", "质证意见", "保全申请", "管辖异议", "再审申请"] as const;

const TARGET_PLEADING_RE =
  /答辩状|质证意见|保全申请|管辖异议|再审申请|起诉状|代理词|辩护词|离婚诉讼|抚养权|探望权|遗产继承|婚内财产分割|遗嘱继承|侦查阶段|审查起诉|取保候审|刑事辩护|死刑复核|会见申请|债权申报|破产重整|债权人会议|破产清算|重整计划|知产争议|专利侵权|商标侵权|著作权侵权|被控侵权/;

function earliestIndex(text: string, needles: readonly string[]): number {
  let at = -1;
  for (const needle of needles) {
    const index = text.indexOf(needle);
    if (index >= 0 && (at < 0 || index < at)) {
      at = index;
    }
  }
  return at;
}

/** Text after the last drafting verb, so a mentioned source pleading does not pick the template. */
export function pleadingScope(instruction: string): string {
  const verbAt = Math.max(
    instruction.lastIndexOf("写"),
    instruction.lastIndexOf("起草"),
    instruction.lastIndexOf("拟"),
  );
  return verbAt >= 0 ? instruction.slice(verbAt) : instruction;
}

export function litigationPrimary(instruction: string, deliverableType?: string): string[] {
  if (/(离婚诉讼|抚养权|探望权|遗产继承|婚内财产分割|遗嘱继承)/.test(instruction)) {
    return ["family-matter-route", "legal-element-extraction"];
  }
  if (/(侦查阶段|审查起诉|取保候审|刑事辩护|死刑复核|会见申请|辩护词)/.test(instruction)) {
    return ["criminal-stage-route", "evidence-argument-chain"];
  }
  if (/(债权申报|破产重整|债权人会议|破产清算|重整计划)/.test(instruction)) {
    return ["bankruptcy-stage-route", "legal-period-calc"];
  }
  if (/(知产争议|专利侵权|商标侵权|著作权侵权|被控侵权)/.test(instruction)) {
    return ["ip-dispute-route", "evidence-argument-chain"];
  }
  const scope = pleadingScope(instruction);
  const defenseAt = earliestIndex(scope, DEFENSE_PLEADINGS);
  const complaintAt = scope.indexOf("起诉状");
  if (defenseAt >= 0 && (complaintAt < 0 || defenseAt < complaintAt)) {
    return ["litigation-stage-route", "evidence-argument-chain"];
  }
  if (deliverableType === "litigation.complaint" || complaintAt >= 0) {
    return ["complaint-elements-fill", "evidence-argument-chain"];
  }
  return ["litigation-stage-route", "evidence-argument-chain"];
}

/**
 * Word revision edits the pinned file. A vague「改一下」follows the filename.
 * Text after 改/写/起草/拟 that names a pleading still wins over the filename.
 */
export function litigationRevisionSkillIds(
  instruction: string,
  relPaths: readonly string[],
): string[] {
  const verbAt = Math.max(
    instruction.lastIndexOf("改"),
    instruction.lastIndexOf("写"),
    instruction.lastIndexOf("起草"),
    instruction.lastIndexOf("拟"),
  );
  const target = verbAt >= 0 ? instruction.slice(verbAt) : instruction;
  if (TARGET_PLEADING_RE.test(target)) {
    return litigationPrimary(instruction);
  }
  const names = relPaths
    .map((relPath) => relPath.split(/[/\\]/).pop() ?? relPath)
    .filter((name) => name.trim().length > 0)
    .join("\n");
  if (names.trim()) {
    return litigationPrimary(names);
  }
  return litigationPrimary(instruction);
}
