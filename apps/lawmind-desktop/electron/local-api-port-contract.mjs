/**
 * 本机 API 端口契约 —— **纯函数**（不 import electron，可单测）。
 *
 * ## 为什么端口是「契约」
 *
 * Word 的侧载清单把回环端口**钉死**在文件里：清单由服务端按请求的实际 `Host` 现场
 * 生成，但律师**存盘并侧载之后**那个端口就固定了。于是端口和安装密钥一样，属于
 * **持久化契约**的一部分 —— 任何静默改变它的行为都会让所有已侧载的窗格失联。
 *
 * 2026-09-21 实测故障正是如此：持久化端口被另一个实例占着 → `pickPort` 静默回退随机
 * 端口 → 窗格先报 `unauthorized`（旧凭据），服务换端口后变成 `Load failed`（网络错误）。
 *
 * 这个模块只回答三个纯问题，便于单测：
 *   1. 这次的端口算不算漂移、被谁占的？
 *   2. 一个发现端点的响应，是不是 LawMind 自己？
 *   3. 清单该写到哪儿（平台相关，且要能测）？
 *
 * 副作用（实际绑定端口、探测占用者、写文件）留在 `local-server.mjs`。
 */

/** 发现端点响应的「是不是 LawMind」判定见 `classifyDiscoveryResponse`。 */
/**
 * 漂移记录。`null` 表示没有漂移（端口与持久化值一致，或本来就没有偏好值）。
 *
 * `occupant` 三态是刻意的：`unknown` 不等于 `foreign` —— 探测不到占用者时可能是外部
 * 程序，也可能是刚崩掉的残留，把它们混为一谈会让排障的人往错的方向查。
 */
export function buildPortDrift({ preferredPort, actualPort, occupant }) {
  // 越界的「偏好端口」不是真实偏好（`readPersistedApiPort` 也做同样的上界校验）——
  // 把它当偏好会产生一条永远修不好的漂移告警。
  if (!Number.isInteger(preferredPort) || preferredPort <= 0 || preferredPort > 65535) {
    return null;
  }
  if (preferredPort === actualPort) {
    return null;
  }
  const kind =
    occupant === "another-lawmind" || occupant === "foreign" ? occupant : "unknown";
  return { requestedPort: preferredPort, actualPort, occupant: kind };
}

/**
 * 判断发现端点的响应体是不是 LawMind 本机 API。
 *
 * 判据取的是**形状**而不是进程名或端口 —— 进程名不可靠，端口本身就是我们在查的东西。
 * 形状要求 `instanceId` + `clients[]` + `epoch`（三者都由我们的发现端点产出），所以
 * 巧合通过的概率极低。
 */
export function classifyDiscoveryResponse(body) {
  if (!body || typeof body !== "object") {
    return "foreign";
  }
  const looksLikeLawmind =
    typeof body.instanceId === "string" &&
    body.instanceId.length > 0 &&
    Array.isArray(body.clients) &&
    typeof body.epoch === "number";
  return looksLikeLawmind ? "another-lawmind" : "foreign";
}

/** 只用于把响应的形状说得更明确；路径本身在 credentials 模块里定义。 */
/**
 * 清单的候选落点，按优先级排列。
 *
 * macOS 上 Word 的侧载目录在 `~/Library/Containers/com.microsoft.Word/.../wef/`；
 * 只有该容器**已存在**（= 装过 Word）才把它排第一 —— 否则会凭空造出 Word 的容器目录，
 * 那是污染别的应用的地盘。退路统一是下载目录，让律师自己拖。
 *
 * `exists` 注入进来是为了可测（不碰真实文件系统）。
 */
/** 与清单模板里的 Id 一致。Windows 用它登记到当前用户的 Word 开发者加载项。 */
export const WORD_ADDIN_MANIFEST_ID = "d6a1a7a6-8f8f-4d1b-9f5c-6b0f0f1c2a31";

export function resolveManifestTargets({ platform, home, downloads, exists, appData, windowsWord }) {
  const targets = [];
  if (platform === "darwin" && typeof home === "string" && home.trim()) {
    const container = [
      home.trim(),
      "Library",
      "Containers",
      "com.microsoft.Word",
      "Data",
      "Documents",
      "wef",
    ].join("/");
    if (exists(container)) {
      targets.push({ location: "word-container", dir: `${container}/lawmind-word-addin` });
    }
  }
  if (platform === "win32" && windowsWord && typeof appData === "string" && appData.trim()) {
    targets.push({ location: "word-windows", dir: `${appData.trim()}/LawMind/word-addin` });
  }
  if (typeof downloads === "string" && downloads.trim()) {
    targets.push({ location: "downloads", dir: downloads.trim() });
  }
  return targets;
}

/**
 * `reg add` 的参数（不含 shell）。只写当前用户的 Office 开发者加载项，不碰 HKLM。
 */
export function windowsWordDeveloperRegArgs(manifestPath) {
  if (typeof manifestPath !== "string" || !manifestPath.trim() || manifestPath.includes("\0")) {
    throw new Error("invalid manifest path");
  }
  return [
    "add",
    "HKCU\\Software\\Microsoft\\Office\\16.0\\WEF\\Developer",
    "/v",
    WORD_ADDIN_MANIFEST_ID,
    "/t",
    "REG_SZ",
    "/d",
    manifestPath,
    "/f",
  ];
}

/** 给律师看的一句说明（按落点区分动作）。 */
export function manifestInstructions(location, _base) {
  return location === "word-container" || location === "word-windows"
    ? "已重新连接。请完全退出 Word 后再打开。"
    : "已保存到「下载」。请把它放进 Word 的加载项文件夹，然后完全退出 Word 再打开。";
}

/**
 * WPS 的 JS 加载项目录。只在已经装了 WPS（父目录存在）时返回，避免凭空造出 WPS 的容器。
 * Mac 写在 Word 容器旁边的 kingsoft 容器里；Windows / Linux 用官方 jsaddons 路径。
 */
export function resolveWpsJsaddonsDir({ platform, home, exists, appData }) {
  if (typeof home !== "string" || !home.trim() || typeof exists !== "function") {
    return null;
  }
  const root = home.trim();
  let parent = null;
  if (platform === "darwin") {
    parent = [
      root,
      "Library",
      "Containers",
      "com.kingsoft.wpsoffice.mac",
      "Data",
      ".kingsoft",
      "wps",
    ].join("/");
  } else if (platform === "win32") {
    const roaming =
      typeof appData === "string" && appData.trim() ? appData.trim() : `${root}/AppData/Roaming`;
    parent = `${roaming}/kingsoft/wps`;
  } else if (platform === "linux") {
    parent = `${root}/.local/share/Kingsoft/wps`;
  }
  if (!parent || !exists(parent)) {
    return null;
  }
  return `${parent}/jsaddons`;
}

/** 从清单或 publish.xml 里认出回环端口。认不出就 null，不当成「已经连上」。 */
export function loopbackPortInText(text) {
  if (typeof text !== "string") {
    return null;
  }
  const match = /https?:\/\/(?:localhost|127\.0\.0\.1):(\d{1,5})\b/.exec(text);
  if (!match) {
    return null;
  }
  const port = Number(match[1]);
  return port > 0 && port <= 65535 ? port : null;
}

const LAWMIND_WPS_PLUGIN =
  /<jsplugin\b(?=[^>]*\bname="lawmind")[^>]*\/>|<jsplugin\b(?=[^>]*\bname="lawmind")[^>]*>[\s\S]*?<\/jsplugin>/;

/** 只读我们自己的那条，避免把别人插件的地址当成 LawMind。 */
export function lawmindPortInWpsPublish(xml) {
  if (typeof xml !== "string") {
    return null;
  }
  const tag = LAWMIND_WPS_PLUGIN.exec(xml);
  return tag ? loopbackPortInText(tag[0]) : null;
}

/**
 * 登记或更新 publish.xml 里的 LawMind 条。其它加载项原样留下。
 * url 必须是本机回环上的 WPS 加载项目录，避免把任意地址写进 WPS。
 */
export function upsertWpsPublishXml(existing, url) {
  if (typeof url !== "string" || !/^https?:\/\/(?:localhost|127\.0\.0\.1):\d+\/word-addin\/wps\/$/.test(url)) {
    throw new Error("invalid wps addin url");
  }
  const line = `<jsplugin name="lawmind" type="wps" url="${url}" enable="enable" install="null" version="1.0.0"/>`;
  const text = typeof existing === "string" ? existing : "";
  if (LAWMIND_WPS_PLUGIN.test(text)) {
    return text.replace(LAWMIND_WPS_PLUGIN, line);
  }
  if (text.includes("</jsplugins>")) {
    return text.replace("</jsplugins>", `  ${line}\n</jsplugins>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<jsplugins>\n  ${line}\n</jsplugins>\n`;
}

/**
 * 设置页上的连接状态。不带端口号。
 * 这次进程里刚改过清单 → reopen，直到下次启动且文件已经对上当前端口。
 */
export function addinHostStatus({ installed, recordedPort, actualPort, pendingReopen, anotherCopy }) {
  if (anotherCopy) {
    return "another-copy";
  }
  if (!installed) {
    return "missing";
  }
  if (pendingReopen || recordedPort !== actualPort) {
    return "reopen";
  }
  return "connected";
}

/** 重新连接之后给律师的一句。地址不出现。 */
export function hostReconnectInstructions({ wordLocation, wpsStatus, changed }) {
  const hosts = [];
  if (wordLocation === "word-container" || wordLocation === "word-windows") {
    hosts.push("Word");
  }
  if (wpsStatus === "written" || wpsStatus === "unchanged") {
    hosts.push("WPS");
  }
  if (!changed && hosts.length > 0 && wordLocation !== "downloads") {
    return `已经连着。若窗格仍打不开，请完全退出${hosts.join("和")}后再打开。`;
  }
  if (wordLocation === "downloads") {
    const wps = hosts.includes("WPS") ? "WPS 已重新连接，请完全退出后再打开。" : "";
    return `${manifestInstructions("downloads")}${wps}`;
  }
  if (hosts.length > 0) {
    return `已重新连接。请完全退出${hosts.join("和")}后再打开。`;
  }
  return "没能重新连接。请稍后再试。";
}
