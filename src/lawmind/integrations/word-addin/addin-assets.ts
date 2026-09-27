/**
 * Word 插件静态资源（清单 + 任务窗格），与 officecli 同一套“随包分发”约定。
 *
 * 目录：`apps/lawmind-desktop/resources/word-addin/`
 *   - dev：仓库内直接读；
 *   - 打包：electron-builder extraResources 拷到 `<resources>/word-addin`。
 *
 * 清单与页面里的 {{BASE}} / {{TOKEN}} 由本机服务在请求时替换：
 * 端口是动态的，不能写死；令牌只发给回环地址上的请求（与已有本地 API 同一信任模型）。
 */

import fs from "node:fs";
import path from "node:path";

export const WORD_ADDIN_VENDOR_REL = path.join(
  "apps",
  "lawmind-desktop",
  "resources",
  "word-addin",
);
export const WORD_ADDIN_RESOURCES_DIR = "word-addin";

export type ResolveWordAddinDirOpts = {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  exists?: (p: string) => boolean;
};

function defaultExists(p: string): boolean {
  try {
    return fs.existsSync(p) && fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** 插件目录绝对路径；找不到返回 undefined（桌面端不受影响，只是没有插件可侧载）。 */
export function resolveWordAddinDir(opts: ResolveWordAddinDirOpts = {}): string | undefined {
  const env = opts.env ?? process.env;
  const exists = opts.exists ?? defaultExists;
  const candidates: Array<string | undefined> = [
    env.LAWMIND_WORD_ADDIN_DIR,
    env.LAWMIND_RESOURCES_PATH
      ? path.join(env.LAWMIND_RESOURCES_PATH, WORD_ADDIN_RESOURCES_DIR)
      : undefined,
    env.LAWMIND_REPO_ROOT ? path.join(env.LAWMIND_REPO_ROOT, WORD_ADDIN_VENDOR_REL) : undefined,
    opts.cwd ? path.join(path.resolve(opts.cwd), WORD_ADDIN_VENDOR_REL) : undefined,
    path.join(path.resolve(process.cwd()), WORD_ADDIN_VENDOR_REL),
  ];
  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (trimmed && exists(trimmed)) {
      return trimmed;
    }
  }
  return undefined;
}

export const WORD_ADDIN_MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

/** 只放行插件自己的静态类型；其余一律不放行（避免把别的东西顺出去）。 */
export function wordAddinMimeFor(fileName: string): string | undefined {
  return WORD_ADDIN_MIME[path.extname(fileName).toLowerCase()];
}

export type WordAddinTemplateVars = {
  /** 回环基址，如 http://localhost:52100 */
  base: string;
  /**
   * 本插件专属的本地 API 凭据（按 clientId=`word-addin` 派生）。
   *
   * 它**随安装密钥持久**，所以桌面端重启后同一个窗格仍然能用；这与改造前那把
   * 「每进程随机、只下发一次」的共享令牌是本质区别（后者正是「重启即 401」的根因）。
   */
  token: string;
  /** 凭据归属的客户端标识；服务端据此做审计归属与最小权限（见 credentials 模块）。 */
  clientId: string;
  /** 凭据代次。窗格据此判断手上的凭据是否已过期。 */
  epoch: number;
  /** 本机服务实例标识（非秘密）。窗格用它做陈旧检测。 */
  instanceId: string;
  /**
   * 「审这份」是否由桌面端自动开跑（edition `wordAddinAutoRun` / policy）。
   * 任务窗格据此选文案：关掉时不能说「正在自动审查」，那是在说谎。
   */
  autoRun: boolean;
  /** 窗格上显示的本所标准名字（执业口径的立场）。 */
  standardName: string;
};

export function renderWordAddinTemplate(text: string, vars: WordAddinTemplateVars): string {
  return text.split("{{BASE}}").join(vars.base).split("{{TOKEN}}").join(vars.token);
}

export function readWordAddinAssetFile(abs: string): string {
  return fs.readFileSync(abs, "utf8");
}

/**
 * 32×32 应用图标（清单要求 png/jpg/gif）。
 * 内嵌而不是放二进制进仓库：图标是纯装饰，改色只改这一行。
 */
export const WORD_ADDIN_ICON_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAANElEQVR42mPoitKmKWIYtWAEW/Drx1eS0Ei2gOZxMGrBqAWjFoxaMCIsGK1wRpstoxZQjABgmTq8lb8icwAAAABJRU5ErkJggg==";

export function wordAddinIconPng(): Buffer {
  return Buffer.from(WORD_ADDIN_ICON_PNG_BASE64, "base64");
}
