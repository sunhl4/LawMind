/** 本案讨论会：智能体轮流发言 → 结论 的调度辅助（纯函数，便于单测）。 */

export type MeetingTurnKind = "lawyer" | "chair" | "conclude";

export type DeliberationParticipant = {
  assistantId: string;
  displayName: string;
};

export type DeliberationCue = {
  assistantId: string;
  displayName: string;
  meetingTurnKind: MeetingTurnKind;
  /** 写入模型与时间线的主持/律师提示 */
  message: string;
  round: number;
  roundsTotal: number;
  turnIndex: number;
  turnsTotal: number;
};

export type BuildDeliberationPlanArgs = {
  participants: DeliberationParticipant[];
  topic: string;
  rounds: number;
  /** 开场由律师先发言时的开场白；空则跳过律师开场回合 */
  lawyerOpening?: string;
  /** 综合结论的助手；默认最后一位参会者 */
  synthesizerId?: string;
};

/**
 * 生成讨论计划：可选律师开场 → 若干轮按参会顺序轮流 → 指定助手综合结论。
 */
export function buildDeliberationPlan(args: BuildDeliberationPlanArgs): DeliberationCue[] {
  const topic = args.topic.trim();
  const participants = args.participants.filter((p) => p.assistantId.trim());
  const rounds = Math.max(1, Math.min(5, Math.floor(args.rounds) || 1));
  if (!topic || participants.length === 0) {
    return [];
  }

  const cues: DeliberationCue[] = [];
  const opening = args.lawyerOpening?.trim() ?? "";
  if (opening) {
    cues.push({
      assistantId: participants[0].assistantId,
      displayName: participants[0].displayName,
      meetingTurnKind: "lawyer",
      message: opening,
      round: 0,
      roundsTotal: rounds,
      turnIndex: 0,
      turnsTotal: 0,
    });
  }

  for (let r = 1; r <= rounds; r++) {
    for (const p of participants) {
      const others = participants
        .filter((x) => x.assistantId !== p.assistantId)
        .map((x) => x.displayName)
        .join("、");
      const cue =
        r === 1
          ? [
              `讨论议题：${topic}`,
              `请你（${p.displayName}）先从本职角度发表意见。`,
              others ? `在场还有：${others}。可点名补充或反驳前人，勿寒暄。` : "请具体、可执行。",
            ].join("\n")
          : [
              `讨论议题：${topic}`,
              `第 ${r}/${rounds} 轮：请你（${p.displayName}）继续发言。`,
              "请回应前人要点：赞同、补充或反驳；推进共识或标出分歧；勿重复寒暄。",
            ].join("\n");
      cues.push({
        assistantId: p.assistantId,
        displayName: p.displayName,
        meetingTurnKind: "chair",
        message: cue,
        round: r,
        roundsTotal: rounds,
        turnIndex: 0,
        turnsTotal: 0,
      });
    }
  }

  const synthId =
    args.synthesizerId && participants.some((p) => p.assistantId === args.synthesizerId)
      ? args.synthesizerId
      : participants[participants.length - 1].assistantId;
  const synth = participants.find((p) => p.assistantId === synthId)!;
  cues.push({
    assistantId: synth.assistantId,
    displayName: synth.displayName,
    meetingTurnKind: "conclude",
    message: `讨论议题：${topic}\n请基于上述讨论输出共识、分歧、工作计划与需律师拍板事项。`,
    round: rounds,
    roundsTotal: rounds,
    turnIndex: 0,
    turnsTotal: 0,
  });

  const turnsTotal = cues.length;
  return cues.map((c, i) => ({ ...c, turnIndex: i + 1, turnsTotal }));
}

export function formatDeliberationStatus(cue: DeliberationCue): string {
  if (cue.meetingTurnKind === "lawyer") {
    return "律师开场发言…";
  }
  if (cue.meetingTurnKind === "conclude") {
    return `正在汇总结论与工作计划（${cue.displayName}）…`;
  }
  return `第 ${cue.round}/${cue.roundsTotal} 轮 · ${cue.displayName} 发言中…`;
}
