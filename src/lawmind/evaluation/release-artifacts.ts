/**
 * 发行产物检查（签名/公证/自动更新清单）：release-readiness 的三项新闸门之一。
 *
 * 诚实口径：产物不存在就报「未评估」，不把「没跑打包」写成「已公证」。
 * 只读检查；不做签名动作（签名在 CI / 本机 electron-builder 流程里）。
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export type SigningStatus = "signed_notarized" | "signed_only" | "unsigned" | "not_evaluated";

export type ReleaseArtifactsReport = {
  /** 产物目录（apps/lawmind-desktop/release）；不存在则 undefined。 */
  releaseDir?: string;
  /** mac 是否 Developer ID 签名 + 已装订公证。 */
  macSigning: {
    status: SigningStatus;
    detail: string;
    appPaths: string[];
  };
  /** 自动更新清单：latest*.yml 是否存在（缺了客户端就只能手动下载升级）。 */
  updaterManifest: {
    present: boolean;
    files: string[];
    detail: string;
  };
  /** 各平台安装包文件名。 */
  installers: string[];
};

const INSTALLER_RE = /\.(dmg|zip|exe|AppImage|tar\.gz)$/i;
const UPDATER_RE = /^latest(-mac|-linux)?\.ya?ml$/i;

function findApps(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string, depth: number): void => {
    if (depth > 4) {
      return;
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.endsWith(".app")) {
          out.push(abs);
          continue;
        }
        // unpacked .app lives under mac/ or mac-arm64/
        walk(abs, depth + 1);
      }
    }
  };
  walk(dir, 0);
  return out;
}

/** 只读询问 codesign：Developer ID 签名 + 公证是否已装订。 */
function inspectMacApp(appPath: string): {
  signed: boolean;
  developerId: boolean;
  notarized: boolean;
  detail: string;
} {
  if (process.platform !== "darwin") {
    return {
      signed: false,
      developerId: false,
      notarized: false,
      detail: "非 macOS 构建机，未评估",
    };
  }
  const verify = spawnSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", appPath], {
    encoding: "utf8",
  });
  const signed = verify.status === 0;
  const describe = spawnSync("/usr/bin/codesign", ["-dv", "--verbose=2", appPath], {
    encoding: "utf8",
  });
  const describeText = `${describe.stdout ?? ""}${describe.stderr ?? ""}`;
  const developerId = /Developer ID Application/.test(describeText);
  const staple = spawnSync("/usr/bin/xcrun", ["stapler", "validate", appPath], {
    encoding: "utf8",
  });
  const notarized = staple.status === 0;
  const detail = [
    signed ? "签名校验通过" : "签名校验失败",
    developerId ? "Developer ID" : "非 Developer ID（adhoc 或未签名）",
    notarized ? "公证已装订" : "未装订公证",
  ].join("；");
  return { signed, developerId, notarized, detail };
}

export function inspectReleaseArtifacts(releaseDir: string | undefined): ReleaseArtifactsReport {
  const dir = releaseDir?.trim();
  if (!dir || !fs.existsSync(dir)) {
    return {
      macSigning: {
        status: "not_evaluated",
        detail: "未找到 release 产物目录；先执行 pnpm lawmind:desktop:dist。",
        appPaths: [],
      },
      updaterManifest: {
        present: false,
        files: [],
        detail: "未找到 release 产物目录，自动更新清单未评估。",
      },
      installers: [],
    };
  }
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    names = [];
  }
  const installers = names.filter((n) => INSTALLER_RE.test(n)).toSorted();
  const updaterFiles = names.filter((n) => UPDATER_RE.test(n)).toSorted();

  const appPaths = findApps(dir);
  let macSigning: ReleaseArtifactsReport["macSigning"];
  if (appPaths.length === 0) {
    macSigning = {
      status: "not_evaluated",
      detail: "release 目录内没有 .app（未打 mac 包），签名/公证未评估。",
      appPaths: [],
    };
  } else {
    const results = appPaths.map((app) => inspectMacApp(app));
    const allNotarized = results.every((r) => r.signed && r.developerId && r.notarized);
    const allSigned = results.every((r) => r.signed && r.developerId);
    const status: SigningStatus = allNotarized
      ? "signed_notarized"
      : allSigned
        ? "signed_only"
        : "unsigned";
    macSigning = {
      status,
      detail: results.map((r) => r.detail).join(" / "),
      appPaths,
    };
  }

  return {
    releaseDir: dir,
    macSigning,
    updaterManifest: {
      present: updaterFiles.length > 0,
      files: updaterFiles,
      detail:
        updaterFiles.length > 0
          ? `自动更新清单：${updaterFiles.join("、")}`
          : "缺少 latest*.yml；客户端将只能手动下载升级。",
    },
    installers,
  };
}

/** release-readiness 报告用的行与风险项。 */
export function formatReleaseArtifactsReport(report: ReleaseArtifactsReport): {
  lines: string[];
  risks: string[];
} {
  const lines: string[] = [];
  const risks: string[] = [];

  lines.push(
    report.releaseDir
      ? `- 产物目录：${report.releaseDir}`
      : "- 产物目录：未找到（未执行 pnpm lawmind:desktop:dist）",
  );
  lines.push(`- 安装包：${report.installers.length > 0 ? report.installers.join("、") : "无"}`);

  switch (report.macSigning.status) {
    case "signed_notarized":
      lines.push(`- macOS 签名/公证：已签名并公证（${report.macSigning.detail}）`);
      break;
    case "signed_only":
      lines.push(`- macOS 签名/公证：仅签名，未装订公证（${report.macSigning.detail}）`);
      risks.push(
        "macOS 产物已 Developer ID 签名但未装订公证；对外分发前请跑 notarytool 并 staple（LAWMIND_REQUIRE_NOTARIZED=1）。",
      );
      break;
    case "unsigned":
      lines.push(`- macOS 签名/公证：未通过签名校验（${report.macSigning.detail}）`);
      risks.push("macOS 产物未通过 Developer ID 签名校验；下载者无法直接双击打开，不应对外交付。");
      break;
    default:
      lines.push(`- macOS 签名/公证：未评估（${report.macSigning.detail}）`);
      risks.push(
        "macOS 签名/公证未评估：本机未打 mac 包或不在 macOS 上。发版前须在有证书的机器/CI 上确认。",
      );
      break;
  }

  lines.push(
    report.updaterManifest.present
      ? `- ${report.updaterManifest.detail}`
      : `- ${report.updaterManifest.detail}`,
  );
  if (report.releaseDir && !report.updaterManifest.present) {
    risks.push(
      "缺少 latest*.yml 自动更新清单；须与安装包一起上传到同一 GitHub Release，否则客户端无法自动升级。",
    );
  }
  return { lines, risks };
}
