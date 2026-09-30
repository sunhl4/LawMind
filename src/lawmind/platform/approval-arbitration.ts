/**
 * 审批仲裁（借鉴评审 D2）：Ask first 命中即停；Allow 仅在无其它停止理由时放行。
 *
 * 仓库没有 Cursor 式可配置规则表；本模块把「中间件链已经保证的顺序」写成可测的纯函数，
 * 避免后人把 Allow（`__approved` / 模板预批）接到 Deny/block 之前。
 *
 * 生产管线顺序（`buildDefaultToolPipeline`）：
 * permissionMode / roleAllowlist（deny）→ legalVerify（block / 特权确认）→ approval（ask）。
 */

export type ApprovalArbitrationOutcome = "deny" | "block" | "ask" | "allow";

export type ApprovalArbitrationInput = {
  /** 权限/岗位/playbook 拒绝（尚未发生的动作直接否决）。 */
  denied: boolean;
  /** 外发预检等硬拦（收件域、特权等）。 */
  blocked: boolean;
  /** Ask first：必须停下来问律师（如 send_email 未 `__approved`）。 */
  askFirst: boolean;
  /** Allow automatically：仅当上面都未命中时才放行（如律师已批 / 模板预批注入）。 */
  allowAutomatically: boolean;
};

/**
 * 冲突时 Ask first 赢；Deny/block 永远优先于 Ask/Allow。
 * 两边都没说时默认 ask（宁可多问一次，不可默默外发）。
 */
export function resolveApprovalArbitration(
  input: ApprovalArbitrationInput,
): ApprovalArbitrationOutcome {
  if (input.denied) {
    return "deny";
  }
  if (input.blocked) {
    return "block";
  }
  if (input.askFirst) {
    return "ask";
  }
  if (input.allowAutomatically) {
    return "allow";
  }
  return "ask";
}
