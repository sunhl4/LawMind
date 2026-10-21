/**
 * 动作级审前评审（借鉴评审 D1）——默认 off；shadow 只记不改行为；on 才多问。
 *
 * 不替代确定性闸（permission / playbook deny / legalVerify / machine-verifiers）。
 * 2026-10-01 起没有 pause 工具（send_email 改 inbox_signoff 写入待发信）；
 * 本层只对高风险本机动作（run_host_command）在 on 模式下加问。
 */

import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { irreversibleDisposition, irreversibleImpactLabelZh } from "../agent/tool-name-sets.js";

export type ActionPreReviewMode = "off" | "shadow" | "on";

export type ActionPreReviewRecommend = "allow" | "ask";

/** 参数感知上下文。缺省时只按工具名分类（旧行为）。 */
export type ActionPreReviewContext = {
  /** 工具的原始参数（模型输出）。只看不改。 */
  args?: Record<string, unknown>;
  /** 工作区根（用于判断参数里的路径是否越出本案）。 */
  workspaceRoot?: string;
};

export type ActionPreReviewClassification = {
  toolName: string;
  recommend: ActionPreReviewRecommend;
  /** 为何归入 ask（律师/日志可读，无工程 id 堆砌） */
  reasonZh: string;
  /** 是否本层在 on 模式下会真正打断（与已有 pause 不重复） */
  ownedByThisLayer: boolean;
  /** 触发判据码（可空）。供影子日志/评测统计；人读仍看 reasonZh。 */
  codes: string[];
};

/** 破坏性/提权/网络执行类命令判据。命中任一条即加问（只加严，不放松）。 */
const HOST_COMMAND_RULES: ReadonlyArray<{
  code: string;
  reasonZh: string;
  test: (command: string, args: readonly string[], workspaceRoot?: string) => boolean;
}> = [
  {
    code: "recursive_force_delete",
    reasonZh: "命令含递归强制删除，可能不可逆地改动本机文件",
    test: (command, args) => {
      if (!/^(rm|unlink|rmdir)$/.test(command)) {
        return false;
      }
      const flags = args.filter((a) => a.startsWith("-"));
      const recursive =
        flags.some((f) => /^-[a-zA-Z]*[rR]/.test(f)) || args.includes("--recursive");
      const force = flags.some((f) => /^-[a-zA-Z]*f/.test(f)) || args.includes("--force");
      return recursive && (force || command === "rm");
    },
  },
  {
    code: "privilege_escalation",
    reasonZh: "命令试图提权（sudo/su），超出本案工作区授权范围",
    test: (command) => /^(sudo|su|doas)$/.test(command),
  },
  {
    code: "disk_or_boot_mutation",
    reasonZh: "命令会改动磁盘或系统开关（格式化/分区/关机/重启），须律师确认",
    test: (command) =>
      /^(dd|mkfs(\..+)?|fdisk|gdisk|diskutil|shutdown|reboot|halt|systemctl|launchctl)$/.test(
        command,
      ),
  },
  {
    code: "process_kill",
    reasonZh: "命令会结束本机进程，可能中断其它正在运行的任务",
    test: (command) => /^(kill|pkill|killall)$/.test(command),
  },
  {
    code: "network_to_shell",
    reasonZh: "命令把网络内容直接交给 shell 执行，来源与内容均不可核验",
    test: (command, args) =>
      /^(curl|wget)$/.test(command) &&
      args.some((a) => /^(sh|bash|zsh)$/.test(a) || a.includes("|")),
  },
  {
    code: "shell_inline_command",
    reasonZh: "命令用 -c 直接执行内联脚本，内容无法按工作区脚本文件留痕",
    test: (command, args) => /^(bash|sh|zsh)$/.test(command) && args.includes("-c"),
  },
  {
    code: "path_outside_workspace",
    reasonZh: "命令参数指向本案工作区之外的路径，须律师确认",
    test: (_command, args, workspaceRoot) =>
      args.some((a) => looksOutsideWorkspace(a, workspaceRoot)),
  },
];

/** officecli 的文档位置选择器（`/body`、`/body/p[3]`、`/sheet[1]`…）不是文件系统路径。 */
const OFFICECLI_SELECTOR_RE =
  /^\/(body|header|footer|sheet|slide|paragraph|table|text|numbering|styles|settings|comments|footnotes|endnotes)([[/]|$)/i;

function looksOutsideWorkspace(raw: string, workspaceRoot?: string): boolean {
  const value = raw.trim();
  if (!value || value.startsWith("-")) {
    return false;
  }
  // URL 与 officecli 选择器不算越界路径。
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value) || OFFICECLI_SELECTOR_RE.test(value)) {
    return false;
  }
  if (value === "~" || value.startsWith("~/")) {
    return true;
  }
  if (/^[A-Za-z]:[\\/]/.test(value)) {
    return true;
  }
  if (value.startsWith("/")) {
    if (!workspaceRoot) {
      return true;
    }
    const root = workspaceRoot.replace(/\\/g, "/").replace(/\/+$/, "");
    const normalized = value.replace(/\\/g, "/");
    const inside = normalized === root || normalized.startsWith(`${root}/`);
    return !inside;
  }
  return value.split(/[\\/]/).some((seg) => seg === "..");
}

export function resolveActionPreReviewMode(
  env: NodeJS.ProcessEnv = process.env,
): ActionPreReviewMode {
  const raw = (env.LAWMIND_ACTION_PRE_REVIEW ?? "").trim().toLowerCase();
  if (raw === "shadow" || raw === "on" || raw === "off") {
    return raw;
  }
  return "off";
}

/**
 * 分类：pause 工具已不存在（send_email 2026-10-01 改 inbox_signoff）；保留分支
 * 仅为语义完整。on 模式本层加问：run_host_command（本机命令可能改状态）。
 *
 * 2026-10-19：升级为**参数感知**。只看工具名时，"ls" 与 "rm -rf /" 同级；
 * 这等于把确定性判据让给模型自觉。现在按命令名 + 参数命中破坏性/提权/越界路径
 * 判据单独给理由（对照 MeWork `/api/v1/tool-review` 的 arguments 入参）。
 */
export function classifyActionForPreReview(
  toolName: string,
  context?: ActionPreReviewContext,
): ActionPreReviewClassification {
  const n = toolName.trim();
  const disposition = irreversibleDisposition(n);
  if (disposition === "pause") {
    return {
      toolName: n,
      recommend: "ask",
      reasonZh: "不可逆外发，须律师确认",
      ownedByThisLayer: false,
      codes: ["irreversible_outbound"],
    };
  }
  if (n === "run_host_command") {
    const rawCommand =
      typeof context?.args?.command === "string" ? context.args.command.trim() : "";
    // 判据用小写（`RM -rf` 也要命中），展示用原文。
    const command = rawCommand.toLowerCase();
    const rawArgs = Array.isArray(context?.args?.args)
      ? context.args.args.filter((a): a is string => typeof a === "string")
      : [];
    const purpose = typeof context?.args?.purpose === "string" ? context.args.purpose.trim() : "";
    const commandLabel = [rawCommand, ...rawArgs.slice(0, 4)].filter(Boolean).join(" ");
    const purposeClause = purpose ? `目的：${purpose}。` : "";
    const commandClause = commandLabel ? `命令：${commandLabel}。` : "";
    const impact = irreversibleImpactLabelZh(n);
    const hits = command
      ? HOST_COMMAND_RULES.filter((rule) => rule.test(command, rawArgs, context?.workspaceRoot))
      : [];
    if (hits.length > 0) {
      return {
        toolName: n,
        recommend: "ask",
        reasonZh: `${hits[0].reasonZh}（${commandClause}${purposeClause}）${impact}。`,
        ownedByThisLayer: true,
        codes: hits.map((rule) => rule.code),
      };
    }
    return {
      toolName: n,
      recommend: "ask",
      reasonZh: `${purposeClause}${commandClause}本机命令可能改动文件或状态，须律师确认。${impact}。`,
      ownedByThisLayer: true,
      codes: ["host_command"],
    };
  }
  if (disposition === "inbox_signoff") {
    return {
      toolName: n,
      recommend: "allow",
      reasonZh: "只写入待发信，发送另有批准",
      ownedByThisLayer: false,
      codes: ["inbox_signoff"],
    };
  }
  return {
    toolName: n,
    recommend: "allow",
    reasonZh: "常规动作",
    ownedByThisLayer: false,
    codes: [],
  };
}

export type ActionPreReviewDecision = {
  mode: ActionPreReviewMode;
  classification: ActionPreReviewClassification;
  /** 是否应在本中间件返回 approvalRequest */
  shouldAsk: boolean;
  /** shadow 是否应落盘 */
  shouldRecord: boolean;
};

export function resolveActionPreReview(input: {
  toolName: string;
  alreadyApproved: boolean;
  mode?: ActionPreReviewMode;
  /** 参数感知上下文（可选；缺省时只按工具名分类）。 */
  context?: ActionPreReviewContext;
}): ActionPreReviewDecision {
  const mode = input.mode ?? resolveActionPreReviewMode();
  const classification = classifyActionForPreReview(input.toolName, input.context);
  if (mode === "off") {
    return { mode, classification, shouldAsk: false, shouldRecord: false };
  }
  const interesting = classification.recommend === "ask" || classification.ownedByThisLayer;
  const shouldRecord = mode === "shadow" || mode === "on" ? interesting : false;
  const shouldAsk =
    mode === "on" &&
    classification.ownedByThisLayer &&
    classification.recommend === "ask" &&
    !input.alreadyApproved;
  return { mode, classification, shouldAsk, shouldRecord };
}

export function actionPreReviewLogPath(workspaceDir: string): string {
  return path.join(workspaceDir, "lawmind", "decision", "action-pre-review.jsonl");
}

export function recordActionPreReviewShadow(
  workspaceDir: string,
  row: {
    toolName: string;
    mode: ActionPreReviewMode;
    recommend: ActionPreReviewRecommend;
    reasonZh: string;
    wouldAsk: boolean;
    sessionId?: string;
    /** 判据码（可选）：无参数感知的旧调用点不传。 */
    codes?: readonly string[];
  },
): void {
  const file = actionPreReviewLogPath(workspaceDir);
  mkdirSync(path.dirname(file), { recursive: true });
  const line = JSON.stringify({
    recordedAt: new Date().toISOString(),
    ...row,
  });
  appendFileSync(file, `${line}\n`, "utf8");
}

export function actionPreReviewLogExists(workspaceDir: string): boolean {
  return existsSync(actionPreReviewLogPath(workspaceDir));
}
