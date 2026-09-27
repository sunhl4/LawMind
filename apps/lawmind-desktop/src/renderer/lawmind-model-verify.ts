import type { ModelCatalogEntry } from "./lawmind-models-api";
import { resolveComposeModelSelectValue } from "./lawmind-model-picker-utils";

export const MODEL_NOT_VERIFIED_HINT =
  "当前模型尚未验证通过。本机存过密钥不等于能连上。请点「验证模型」；若提示密钥无效，到服务商重新生成后再用「连接向导」粘贴。";

/** Whether the catalog row has a recent successful probe (`verifiedAt`). */
export function isModelEntryVerified(row: ModelCatalogEntry | undefined): boolean {
  return Boolean(row?.configured && row.verifiedAt?.trim());
}

export function findCatalogEntry(
  catalog: ModelCatalogEntry[],
  selectedModelId: string,
): ModelCatalogEntry | undefined {
  const id = resolveComposeModelSelectValue(catalog, selectedModelId);
  return catalog.find((m) => m.id === id);
}

export function isSelectedModelVerified(
  catalog: ModelCatalogEntry[],
  selectedModelId: string,
): boolean {
  return isModelEntryVerified(findCatalogEntry(catalog, selectedModelId));
}

/**
 * 目录行 `configured: false` 表示这一行没有单独存密钥。
 * 健康检查已经 `modelConfigured` 时，运行中的服务自己有密钥（环境变量或向导），
 * 不能因为目录行没标密钥就把律师拽进设置、把这句话吞掉。
 */
export function blockSendForUnconfiguredCatalogRow(opts: {
  catalogRowConfigured: boolean | undefined;
  healthModelConfigured: boolean | undefined;
}): boolean {
  return opts.catalogRowConfigured === false && opts.healthModelConfigured !== true;
}

/** Catalog probe stamp, or `/api/health` / bootstrap `modelVerified` after wizard save. */
export function isActiveModelVerified(opts: {
  catalog: ModelCatalogEntry[];
  selectedModelId: string;
  healthVerified?: boolean;
}): boolean {
  return opts.healthVerified === true || isSelectedModelVerified(opts.catalog, opts.selectedModelId);
}
