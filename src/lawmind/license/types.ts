/**
 * 许可文件格式（离线、软门槛）。
 *
 * 激活码 = base64url(payload JSON) + "." + base64url(ed25519 签名)。
 * 校验收到的公钥在 `keys.ts`；私钥只存在于发行方，绝不进仓库运行路径。
 * 全程无网络：不查服务器、不回报遥测。
 */

export type LicenseEdition = "solo" | "firm" | "private_deploy";

export type LicensePayload = {
  /** 载荷版本，便于将来换算法。 */
  v: 1;
  edition: LicenseEdition;
  /** 被许可人名称（展示用）。 */
  licensee: string;
  /** 签发时间 ISO。 */
  issuedAt: string;
  /** 到期时间 ISO；不设则视为长期。 */
  expiresAt?: string;
  /**
   * 机器指纹（hostname+platform 稳定哈希）。缺省表示不绑定机器。
   */
  machineFingerprint?: string;
};

export type LicenseStatus =
  | "licensed"
  | "licensed_expired"
  | "trial"
  | "trial_expired"
  | "invalid"
  | "missing";

export type LicenseState = {
  status: LicenseStatus;
  edition?: LicenseEdition;
  licensee?: string;
  expiresAt?: string;
  /** 试用剩余天数（trial 时有值；可为 0）。 */
  trialDaysLeft?: number;
  /** 律师可读的一句话说明。 */
  message: string;
  /** 软门槛：永不阻断交办，只在 UI 提醒。 */
  blocking: false;
};

/** 试用期天数。 */
export const TRIAL_DAYS = 30;
