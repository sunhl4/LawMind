/**
 * 律师办任务时点名的文件夹或文件若在 iCloud 上，正文可能还不在本机。
 * 这里只服务这类材料：直接下载到原路径，下完再读，同一轮继续办。
 * 单个文件超过 5 分钟还没落地，才停下来请律师在访达里下完后点「我已下完」。
 * 不改 LawMind 自己的会话、任务账本。那些仍只在本机读写。
 * dataless 文件不能用 read() 去触发下载，否则进程会堵在系统调用里。
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ClarificationQuestion } from "../types.js";

const LS = "/bin/ls";
const BRCTL = "/usr/bin/brctl";
const BACKOFF_MS = 15_000;
const CLEAN_MS = 2_000;
const LS_TIMEOUT_MS = 3_000;
const BRCTL_TIMEOUT_MS = 3_000;
/** 律师同意后，单个文件最多等这么久。超时就停，改请她手动下载。 */
export const ICLOUD_FILE_DOWNLOAD_WAIT_MS = 5 * 60 * 1000;
export const ICLOUD_DOWNLOAD_CONFIRM_KEY = "icloud_download_confirm";
export const ICLOUD_DOWNLOAD_MANUAL_KEY = "icloud_download_manual";
const DOWNLOAD_POLL_MS = 1_000;
const MAX_BUFFER = 16 * 1024 * 1024;

const LS_ENTRY = /^([-bcdlps][^\s]*)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\d+)\s+(\d{9,11})\s+(.+)$/;

/** 下载超时后请律师手动下完再继续。抛出后本轮停止，不读文件。 */
export class IcloudLawyerPrompt extends Error {
  readonly question: ClarificationQuestion;

  constructor(question: ClarificationQuestion) {
    super(question.question);
    this.name = "IcloudLawyerPrompt";
    this.question = question;
  }
}

export class IcloudDatalessError extends Error {
  readonly paths: readonly string[];

  constructor(paths: readonly string[]) {
    const names = paths
      .map((p) => path.basename(p))
      .slice(0, 4)
      .join("、");
    super(`文件正文还在 iCloud，自动下载未完成：${names}`);
    this.name = "IcloudDatalessError";
    this.paths = paths;
  }
}

type FileStatLike = {
  isFile: () => boolean;
  isSymbolicLink?: () => boolean;
  size: number;
  blocks: number;
};

export type IcloudMaterializeIO = {
  platform: NodeJS.Platform;
  execFileSync: (
    command: string,
    args: readonly string[],
    opts: { encoding: "utf8"; timeout: number; maxBuffer: number },
  ) => string;
  now: () => number;
  lstatSync: (filePath: string) => FileStatLike;
  statSync: (filePath: string) => FileStatLike;
};

type ExecOpts = { encoding: "utf8"; timeout: number; maxBuffer: number };

const defaultIO: IcloudMaterializeIO = {
  platform: process.platform,
  execFileSync: (command, args, opts) =>
    execFileSync(command, [...args], {
      encoding: "utf8",
      timeout: opts.timeout,
      maxBuffer: opts.maxBuffer,
      windowsHide: true,
    }),
  now: () => Date.now(),
  lstatSync: (filePath) => fs.lstatSync(filePath),
  statSync: (filePath) => fs.statSync(filePath),
};

const cleanDirUntil = new Map<string, number>();
const dirBackoffUntil = new Map<string, number>();
const fileBackoffUntil = new Map<string, number>();
const lastDatalessByDir = new Map<string, string[]>();
const consentedKeys = new Set<string>();
const declinedKeys = new Set<string>();
const manualHoldKeys = new Set<string>();
let askedKeys: string[] = [];
/** 律师说已经手动下完。下一回只检查是否在本机，不再自动下载。 */
let resumeWithoutDownload = false;
/** 本轮律师刚同意下载，或刚说手动下完要继续。回合开始时消化掉。 */
let downloadThisTurn = false;
let resumeThisTurn = false;

let installed = false;
let savedFs: {
  readFileSync: typeof fs.readFileSync;
  openSync: typeof fs.openSync;
  createReadStream: typeof fs.createReadStream;
  copyFileSync: typeof fs.copyFileSync;
  promisesReadFile: typeof fs.promises.readFile;
  promisesOpen: typeof fs.promises.open;
  promisesCopyFile: typeof fs.promises.copyFile;
} | null = null;

export function flagsLookDataless(flags: string): boolean {
  return flags.split(",").includes("dataless");
}

/** macOS 磁盘名常是 NFD，调用方路径常是 NFC。比较前合成同一个键。 */
export function icloudFileKey(filePath: string): string {
  return path.resolve(filePath).normalize("NFC");
}

/** 解析 `ls -lO -D %s` 的一行。不读文件正文。 */
export function parseLsLongOLine(
  line: string,
): { kind: string; flags: string; name: string } | undefined {
  const m = LS_ENTRY.exec(line);
  if (!m) {
    return undefined;
  }
  const mode = m[1] ?? "";
  const flags = m[5] ?? "";
  const name = m[8] ?? "";
  if (!mode || !name || name === "." || name === "..") {
    return undefined;
  }
  return { kind: mode[0] ?? "", flags, name };
}

function stdoutOf(err: unknown): string {
  if (!err || typeof err !== "object" || !("stdout" in err)) {
    return "";
  }
  const stdout = (err as { stdout?: unknown }).stdout;
  if (typeof stdout === "string") {
    return stdout;
  }
  if (Buffer.isBuffer(stdout)) {
    return stdout.toString("utf8");
  }
  return "";
}

function run(
  io: IcloudMaterializeIO,
  command: string,
  args: readonly string[],
  timeout: number,
): { ok: boolean; output: string } {
  const opts: ExecOpts = { encoding: "utf8", timeout, maxBuffer: MAX_BUFFER };
  try {
    return { ok: true, output: io.execFileSync(command, args, opts) };
  } catch (err) {
    const output = stdoutOf(err);
    if (output.trim()) {
      return { ok: true, output };
    }
    return { ok: false, output: "" };
  }
}

function listLines(output: string): string[] {
  return output.split("\n");
}

function datalessInListing(output: string, dir: string): string[] {
  const root = path.resolve(dir);
  const found: string[] = [];
  for (const line of listLines(output)) {
    const parsed = parseLsLongOLine(line);
    if (!parsed || parsed.kind !== "-" || !flagsLookDataless(parsed.flags)) {
      continue;
    }
    found.push(path.resolve(root, parsed.name));
  }
  return found;
}

function listDatalessFiles(
  dir: string,
  io: IcloudMaterializeIO,
): { ok: true; paths: string[] } | { ok: false } {
  const listed = run(io, LS, ["-lO", "-D", "%s", "--", dir], LS_TIMEOUT_MS);
  if (!listed.ok) {
    return { ok: false };
  }
  return { ok: true, paths: datalessInListing(listed.output, dir) };
}

function readFlags(filePath: string, io: IcloudMaterializeIO): string | undefined {
  // -L：符号链接看目标的标志。stat 目标，不读正文。
  const listed = run(io, LS, ["-ldOL", "-D", "%s", "--", filePath], LS_TIMEOUT_MS);
  if (!listed.ok) {
    return undefined;
  }
  for (const line of listLines(listed.output)) {
    const parsed = parseLsLongOLine(line);
    if (parsed) {
      return parsed.flags;
    }
  }
  return undefined;
}

function queueDownload(filePath: string, io: IcloudMaterializeIO): boolean {
  return run(io, BRCTL, ["download", filePath], BRCTL_TIMEOUT_MS).ok;
}

function queueAll(paths: readonly string[], io: IcloudMaterializeIO, deadline: number): void {
  for (const filePath of paths) {
    if (io.now() >= deadline) {
      return;
    }
    queueDownload(filePath, io);
  }
}

function skipForTests(io: IcloudMaterializeIO, explicit: boolean): boolean {
  if (io.platform !== "darwin") {
    return true;
  }
  return !explicit && process.env.VITEST === "true";
}

function rememberDataless(dir: string, paths: readonly string[]): void {
  const key = icloudFileKey(dir);
  if (paths.length === 0) {
    lastDatalessByDir.delete(key);
    return;
  }
  lastDatalessByDir.set(
    key,
    paths.map((filePath) => icloudFileKey(filePath)),
  );
}

function rememberedDataless(dir: string): string[] {
  return lastDatalessByDir.get(icloudFileKey(dir)) ?? [];
}

function noteBackoff(dir: string, paths: readonly string[], io: IcloudMaterializeIO): void {
  const until = io.now() + BACKOFF_MS;
  dirBackoffUntil.set(icloudFileKey(dir), until);
  for (const filePath of paths) {
    fileBackoffUntil.set(icloudFileKey(filePath), until);
  }
}

/** 只再列一次标志。列失败时把这些路径视为仍不可读，调用方不得 read()。 */
function datalessAmong(dir: string, wanted: readonly string[], io: IcloudMaterializeIO): string[] {
  const want = new Set(wanted.map((p) => icloudFileKey(p)));
  const listed = listDatalessFiles(dir, io);
  if (!listed.ok) {
    return [...want];
  }
  return listed.paths.filter((p) => want.has(icloudFileKey(p)));
}

function logDownload(paths: readonly string[]): void {
  const names = paths
    .map((p) => path.basename(p))
    .slice(0, 6)
    .join("、");
  const suffix = paths.length > 6 ? ` 等 ${paths.length} 个` : "";
  console.warn(
    `[LawMind] ${paths.length} 个文件正文还在 iCloud（${names}${suffix}）。已请求下载；这次读不到就跳过，不等待。`,
  );
}

/**
 * 请求把目录里当前 dataless 的普通文件下载到本机。不递归，不读正文，也不等待下载完成。
 * `deferPaths` 在其余文件这次还没落地时先不请求（已有 read() 堵在那个文件上时用）。
 * 返回仍不可读的路径；调用方必须跳过，不能 read()。
 */
export function materializeDatalessInDirectory(
  dir: string,
  opts?: { deferPaths?: readonly string[]; io?: IcloudMaterializeIO },
): string[] {
  const io = opts?.io ?? defaultIO;
  if (skipForTests(io, Boolean(opts?.io))) {
    return [];
  }
  const resolved = icloudFileKey(dir);
  const now = io.now();
  if ((cleanDirUntil.get(resolved) ?? 0) > now && !opts?.deferPaths?.length) {
    return [];
  }
  if ((dirBackoffUntil.get(resolved) ?? 0) > now) {
    const again = listDatalessFiles(resolved, io);
    if (!again.ok) {
      return rememberedDataless(resolved);
    }
    rememberDataless(resolved, again.paths);
    return again.paths;
  }
  const listed = listDatalessFiles(resolved, io);
  if (!listed.ok) {
    const remembered = rememberedDataless(resolved);
    if (remembered.length > 0) {
      return remembered;
    }
    // 列不出来就不能证明可以读。把目录项都当成不可读，避免接着 read() 把进程堵住。
    try {
      return fs.readdirSync(dir).map((name) => icloudFileKey(path.join(dir, name)));
    } catch {
      return [];
    }
  }
  const dataless = listed.paths;
  rememberDataless(resolved, dataless);
  if (dataless.length === 0) {
    cleanDirUntil.set(resolved, now + CLEAN_MS);
    return [];
  }
  cleanDirUntil.delete(resolved);
  const defer = new Set((opts?.deferPaths ?? []).map((p) => icloudFileKey(p)));
  const first = dataless.filter((p) => !defer.has(icloudFileKey(p)));
  const last = dataless.filter((p) => defer.has(icloudFileKey(p)));
  const log = io === defaultIO;
  if (log) {
    logDownload([...first, ...last]);
  }
  const queueDeadline = now + BRCTL_TIMEOUT_MS;
  if (first.length > 0) {
    queueAll(first, io, queueDeadline);
    const stuck = datalessAmong(resolved, first, io);
    if (stuck.length > 0) {
      // 其余文件还没落地时，不要先请求那个已经堵在 read() 里的文件。
      const pending = [...stuck, ...last];
      noteBackoff(resolved, pending, io);
      rememberDataless(resolved, pending);
      return pending;
    }
  }
  if (last.length > 0) {
    queueAll(last, io, queueDeadline);
    const still = datalessAmong(resolved, last, io);
    rememberDataless(resolved, still);
    return still;
  }
  rememberDataless(resolved, []);
  return [];
}

function probeStat(filePath: string, io: IcloudMaterializeIO): FileStatLike | undefined {
  try {
    const st = io.lstatSync(filePath);
    if (st.isSymbolicLink?.()) {
      return io.statSync(filePath);
    }
    return st;
  } catch {
    return undefined;
  }
}

/**
 * 扫描用。正文不在本机就立刻抛出，不下载、不等待、不 read()。
 * 下载并等待由 ensureLocalFile 负责。
 */
export function ensureLocalFileSync(filePath: string, io?: IcloudMaterializeIO): void {
  const use = io ?? defaultIO;
  if (skipForTests(use, Boolean(io))) {
    return;
  }
  const resolved = icloudFileKey(filePath);
  const st = probeStat(filePath, use);
  if (!st?.isFile() || st.size === 0 || st.blocks > 0) {
    return;
  }
  const backedOff = (fileBackoffUntil.get(resolved) ?? 0) > use.now();
  const flags = readFlags(filePath, use);
  if (!flags) {
    throw new IcloudDatalessError([resolved]);
  }
  if (!flagsLookDataless(flags)) {
    fileBackoffUntil.delete(resolved);
    return;
  }
  if (backedOff) {
    throw new IcloudDatalessError([resolved]);
  }
  // 扫描任务/会话时不问律师、也不在这里下载。读文书走 ensureLocalFile。
  throw new IcloudDatalessError([resolved]);
}

export function icloudDownloadQuestion(names: readonly string[]): ClarificationQuestion {
  const shown = names.slice(0, 6).join("、");
  const suffix = names.length > 6 ? ` 等 ${names.length} 个` : "";
  return {
    key: ICLOUD_DOWNLOAD_CONFIRM_KEY,
    question: `这些文件在 iCloud 上，本机还没有正文（${shown}${suffix}）。要继续办理需要先下载。是否现在下载？`,
    inputType: "enum",
    options: ["现在下载", "先不下载"],
    required: true,
  };
}

export function icloudManualQuestion(name: string): ClarificationQuestion {
  return {
    key: ICLOUD_DOWNLOAD_MANUAL_KEY,
    question: `「${name}」已尝试下载超过 5 分钟，仍没有落到本机。请在访达中把它下载完，完成后点「我已下完」。`,
    inputType: "enum",
    options: ["我已下完"],
    required: true,
  };
}

/** 澄清卡片会把问题原文和「答：」一起送回来。只认答语，避免问题里的「现在下载」盖过「先不下载」。 */
function icloudReplyBody(text: string): string {
  const marked = text.match(/答：\s*([^\n]+)/);
  return (marked?.[1] ?? text).replace(/\s+/g, "");
}

/** 律师在澄清里的答复。要在本轮工具读文件之前调用。 */
export function noteLawyerIcloudReply(text: string): void {
  const compact = icloudReplyBody(text);
  if (/先不下载|不下载/.test(compact) && !/现在下载/.test(compact)) {
    for (const key of askedKeys) {
      consentedKeys.delete(key);
      declinedKeys.add(key);
    }
    downloadThisTurn = false;
    return;
  }
  // 「我已下完 / 继续 / 已经下载」只检查是否落地，不再自动下 5 分钟。
  if (
    /继续|已经下载|下载完|下好了|已下完|下完了/.test(compact) &&
    manualHoldKeys.size > 0 &&
    !/现在下载/.test(compact)
  ) {
    manualHoldKeys.clear();
    resumeWithoutDownload = true;
    resumeThisTurn = askedKeys.length > 0;
    return;
  }
  // 「下载」和「现在下载」都算同意。超时后说「下载」会再试一次。
  if (/现在下载/.test(compact) || (/下载/.test(compact) && !/不下载/.test(compact))) {
    resumeWithoutDownload = false;
    downloadThisTurn = askedKeys.length > 0;
    for (const key of askedKeys) {
      declinedKeys.delete(key);
      manualHoldKeys.delete(key);
      consentedKeys.add(key);
    }
  }
}

function rememberAsked(filePath: string): void {
  const key = icloudFileKey(filePath);
  if (!askedKeys.includes(key)) {
    askedKeys.push(key);
  }
}

async function sleepMs(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 正文还在 iCloud 就下载到原路径，单个文件最多等 5 分钟，下完返回，调用方接着读。
 * 律师明确说过先不下载的文件不再下。超时则停下，请她手动下载后再继续。
 * 等待用定时器，不堵住整个服务进程。
 */
export async function ensureLocalFile(
  filePath: string,
  deps?: {
    io?: IcloudMaterializeIO;
    sleep?: (ms: number) => Promise<void>;
    waitMs?: number;
  },
): Promise<void> {
  const use = deps?.io ?? defaultIO;
  if (skipForTests(use, Boolean(deps?.io))) {
    return;
  }
  const st = probeStat(filePath, use);
  // 文件夹只列名字，不把整个目录当一个下载。本地文件（含已在本机的 iCloud 文件）直接读。
  if (!st?.isFile() || st.size === 0 || st.blocks > 0) {
    return;
  }
  const flags = readFlags(filePath, use);
  const diskPath = path.resolve(filePath);
  const key = icloudFileKey(diskPath);
  const name = path.basename(diskPath);
  // 只有标志里明确有 dataless 才算在云端。解析不到、或只是 compressed，都当本地文件。
  // 已经在本机就直接读。刚才那次「我已下完」也到此结束，后面的文件仍可自动下载。
  if (!flags || !flagsLookDataless(flags)) {
    resumeWithoutDownload = false;
    manualHoldKeys.delete(key);
    return;
  }
  if (declinedKeys.has(key)) {
    throw new IcloudDatalessError([key]);
  }
  if (manualHoldKeys.has(key)) {
    throw new IcloudLawyerPrompt(icloudManualQuestion(name));
  }
  if (resumeWithoutDownload) {
    resumeWithoutDownload = false;
    manualHoldKeys.add(key);
    throw new IcloudLawyerPrompt(icloudManualQuestion(name));
  }
  // 原路径上下载，不另存一份。效果与律师在访达里点「下载」相同。不问就下，下完本轮继续读。
  rememberAsked(diskPath);
  queueDownload(diskPath, use);
  const waitMs = deps?.waitMs ?? ICLOUD_FILE_DOWNLOAD_WAIT_MS;
  const sleep = deps?.sleep ?? sleepMs;
  const deadline = use.now() + waitMs;
  while (use.now() < deadline) {
    const again = readFlags(diskPath, use);
    if (again && !flagsLookDataless(again)) {
      manualHoldKeys.delete(key);
      return;
    }
    const slice = Math.min(DOWNLOAD_POLL_MS, deadline - use.now());
    if (slice <= 0) {
      break;
    }
    const started = use.now();
    await sleep(slice);
    if (use.now() <= started) {
      break;
    }
  }
  const done = readFlags(diskPath, use);
  if (done && !flagsLookDataless(done)) {
    manualHoldKeys.delete(key);
    return;
  }
  consentedKeys.delete(key);
  manualHoldKeys.add(key);
  throw new IcloudLawyerPrompt(icloudManualQuestion(name));
}

/** 律师刚同意下载或刚点「我已下完」时，由 LawMind 自己处理这些文件，不等模型再点一次读取。 */
export async function runApprovedIcloudDownloads(deps?: {
  io?: IcloudMaterializeIO;
  sleep?: (ms: number) => Promise<void>;
  waitMs?: number;
}): Promise<ClarificationQuestion | null> {
  const mode = downloadThisTurn ? "download" : resumeThisTurn ? "resume" : null;
  downloadThisTurn = false;
  resumeThisTurn = false;
  if (!mode || askedKeys.length === 0) {
    return null;
  }
  for (const filePath of askedKeys) {
    try {
      await ensureLocalFile(filePath, deps);
    } catch (err) {
      if (err instanceof IcloudLawyerPrompt) {
        return err.question;
      }
      throw err;
    }
  }
  return null;
}

function pathFrom(file: unknown): string | undefined {
  if (typeof file === "number") {
    return undefined;
  }
  if (typeof file === "string" && file) {
    return file;
  }
  if (file instanceof URL) {
    try {
      return fileURLToPath(file);
    } catch {
      return undefined;
    }
  }
  if (Buffer.isBuffer(file)) {
    const text = file.toString("utf8");
    return text || undefined;
  }
  return undefined;
}

function guard(file: unknown, io: IcloudMaterializeIO): void {
  const filePath = pathFrom(file);
  if (!filePath) {
    return;
  }
  ensureLocalFileSync(filePath, io === defaultIO ? undefined : io);
}

/**
 * 读之前先落地。签名跟被包的 fs 方法一致，避免把文件描述符当成路径传进 openSync。
 * `thisArg` 只给 `fs.promises.*`：拆出来的方法必须带 promises 的 this。
 */
function guardCall<F extends (path: fs.PathLike, ...rest: never[]) => unknown>(
  fn: F,
  use: IcloudMaterializeIO,
  thisArg?: object,
): F {
  const wrapped = (file: fs.PathLike, ...rest: never[]) => {
    guard(file, use);
    if (thisArg) {
      return Reflect.apply(fn, thisArg, [file, ...rest]);
    }
    return fn(file, ...rest);
  };
  return wrapped as F;
}

/**
 * 包住本进程的读文件入口。测试进程不包（避免改掉套件里的 fs）。
 * 重复调用无效果。
 */
export function installIcloudReadMaterialize(io?: IcloudMaterializeIO): void {
  if (installed) {
    return;
  }
  const use = io ?? defaultIO;
  if (!io && (process.env.VITEST === "true" || use.platform !== "darwin")) {
    installed = true;
    return;
  }
  if (use.platform !== "darwin") {
    installed = true;
    return;
  }
  savedFs = {
    readFileSync: fs.readFileSync,
    openSync: fs.openSync,
    createReadStream: fs.createReadStream,
    copyFileSync: fs.copyFileSync,
    promisesReadFile: fs.promises.readFile,
    promisesOpen: fs.promises.open,
    promisesCopyFile: fs.promises.copyFile,
  };
  const readFileSync = savedFs.readFileSync;
  const openSync = savedFs.openSync;
  const createReadStream = savedFs.createReadStream;
  const copyFileSync = savedFs.copyFileSync;
  const promisesReadFile = savedFs.promisesReadFile;
  const promisesOpen = savedFs.promisesOpen;
  const promisesCopyFile = savedFs.promisesCopyFile;

  fs.readFileSync = guardCall(readFileSync, use);
  fs.openSync = guardCall(openSync, use);
  fs.createReadStream = guardCall(createReadStream, use);
  fs.copyFileSync = guardCall(copyFileSync, use);
  fs.promises.readFile = guardCall(promisesReadFile, use, fs.promises);
  fs.promises.open = guardCall(promisesOpen, use, fs.promises);
  fs.promises.copyFile = guardCall(promisesCopyFile, use, fs.promises);

  installed = true;
}

/** 测试恢复 fs，并清掉落地缓存。 */
export function resetIcloudMaterializeForTests(): void {
  if (savedFs) {
    fs.readFileSync = savedFs.readFileSync;
    fs.openSync = savedFs.openSync;
    fs.createReadStream = savedFs.createReadStream;
    fs.copyFileSync = savedFs.copyFileSync;
    fs.promises.readFile = savedFs.promisesReadFile;
    fs.promises.open = savedFs.promisesOpen;
    fs.promises.copyFile = savedFs.promisesCopyFile;
    savedFs = null;
  }
  installed = false;
  cleanDirUntil.clear();
  dirBackoffUntil.clear();
  fileBackoffUntil.clear();
  lastDatalessByDir.clear();
  consentedKeys.clear();
  declinedKeys.clear();
  manualHoldKeys.clear();
  askedKeys = [];
  resumeWithoutDownload = false;
  downloadThisTurn = false;
  resumeThisTurn = false;
}
