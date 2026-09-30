/**
 * 本机执行面清单（借鉴评审 B2）：哪些路径/凭据持久、哪些可丢、谁能读。
 * 真相源在本模块；Doctor / health 只读这里，不另写一份互相漂移的文档。
 */

export type ExecutionSurfaceKind = "persistent" | "rebuildable" | "ephemeral" | "credential";

export type ExecutionSurfaceItem = {
  id: string;
  kind: ExecutionSurfaceKind;
  /** 相对工作区，或以 ~ / 应用数据 开头的本机路径说明 */
  location: string;
  /** 律师可读一句话 */
  summaryZh: string;
};

/**
 * 固定清单（不扫盘、不猜测）。缺文件不表示「坏了」——许多项是首次使用才创建。
 */
export const EXECUTION_SURFACE_CATALOG: readonly ExecutionSurfaceItem[] = [
  {
    id: "matters",
    kind: "persistent",
    location: "matters/ · cases/",
    summaryZh: "案件卷宗与材料——不可重建，备份优先。",
  },
  {
    id: "sessions",
    kind: "persistent",
    location: "sessions/",
    summaryZh: "对话与回合记录——删助手会级联会话，不删卷宗。",
  },
  {
    id: "drafts",
    kind: "persistent",
    location: "drafts/",
    summaryZh: "草稿与交付物侧车——不可当缓存清掉。",
  },
  {
    id: "automations",
    kind: "persistent",
    location: "lawmind/automations/ · lawmind/automation-inbox/",
    summaryZh: "常设工作定义、运行历史与收件箱。",
  },
  {
    id: "assistants",
    kind: "persistent",
    location: "assistants/ · assistants.json",
    summaryZh: "助手名册、职务说明书与本助手档案。",
  },
  {
    id: "memory",
    kind: "persistent",
    location: "lawmind/ · LAWYER_PROFILE / golden / edit-examples",
    summaryZh: "律师偏好与改稿范例——确认后才写入。",
  },
  {
    id: "daemon-state",
    kind: "rebuildable",
    location: "lawmind/daemon.json · daemon.pid · daemon.lock",
    summaryZh: "后台办件心跳与锁——丢了可重建，不影响卷宗。",
  },
  {
    id: "daemon-log",
    kind: "rebuildable",
    location: "lawmind/daemon.log",
    summaryZh: "后台办件日志（有上限轮转）——排障用，不是可信证明。",
  },
  {
    id: "search-index",
    kind: "rebuildable",
    location: "lawmind/search-index（及嵌入索引）",
    summaryZh: "检索索引——可在设置体检里重建。",
  },
  {
    id: "model-usage",
    kind: "rebuildable",
    location: "model-usage/ledger.jsonl",
    summaryZh: "本机模型用量账本——可删，只影响用量页统计。",
  },
  {
    id: "rounds-cache",
    kind: "ephemeral",
    location: "workspace/rounds/ · lint 逃逸候选等运行时产物",
    summaryZh: "运行时中间产物——可丢；真相源在代码与内置技能。",
  },
  {
    id: "mail-secrets",
    kind: "credential",
    location: "应用根 mail-secrets.json（加密）",
    summaryZh: "邮箱密钥——不进工作区 git；解不开时拒绝覆盖。",
  },
  {
    id: "model-env",
    kind: "credential",
    location: "~/.lawmind 或工作区 .env.lawmind（本机）",
    summaryZh: "模型与集成密钥——优先 OS 钥匙串 / 宿主环境。",
  },
  {
    id: "local-api",
    kind: "credential",
    location: "userData/LawMind（installation secret / clients）",
    summaryZh: "本机 HTTP API 凭据——只绑 loopback，不进卷宗。",
  },
  {
    id: "license",
    kind: "credential",
    location: "~/.lawmind/license.json",
    summaryZh: "离线许可——在工作区外，助手工具读不到。",
  },
] as const;

export type ExecutionSurfaceReport = {
  persistent: ExecutionSurfaceItem[];
  rebuildable: ExecutionSurfaceItem[];
  ephemeral: ExecutionSurfaceItem[];
  credential: ExecutionSurfaceItem[];
  /** Doctor / CLI 三行摘要 */
  lines: string[];
};

export function buildExecutionSurfaceReport(): ExecutionSurfaceReport {
  const persistent = EXECUTION_SURFACE_CATALOG.filter((i) => i.kind === "persistent");
  const rebuildable = EXECUTION_SURFACE_CATALOG.filter((i) => i.kind === "rebuildable");
  const ephemeral = EXECUTION_SURFACE_CATALOG.filter((i) => i.kind === "ephemeral");
  const credential = EXECUTION_SURFACE_CATALOG.filter((i) => i.kind === "credential");
  const lines = [
    `执行面：持久 ${persistent.length} 项（卷宗/会话/草稿/常设工作等）不可当缓存清。`,
    `执行面：可重建 ${rebuildable.length} 项（索引/守护状态/用量账本）；临时 ${ephemeral.length} 项可丢。`,
    `执行面：凭据 ${credential.length} 项在工作区外或加密文件，助手不得当普通材料读。`,
  ];
  return { persistent, rebuildable, ephemeral, credential, lines };
}
