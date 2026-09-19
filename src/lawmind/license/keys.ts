/**
 * 内嵌验签公钥（ed25519, SPKI DER base64）。
 *
 * 这是**开发/内测**密钥对里的公钥；对外发版前必须换成发行方的生产公钥
 * （私钥只保存在发行方，不进仓库）。换钥时同步更新 `scripts/lawmind/lawmind-license.ts`
 * 的签发流程文档与已发激活码。
 */
export const LICENSE_PUBLIC_KEY_DER_B64 =
  "MCowBQYDK2VwAyEAH3Bjx9N7DT0UIXAW+2gH3vAEKlM/+L8hdDvKYPJIcp4=";

/** 许可文件目录：`~/.lawmind/`（与 keys/ 同级，工作区外）。 */
export const LICENSE_DIR_NAME = ".lawmind";
export const LICENSE_FILE_NAME = "license.json";
