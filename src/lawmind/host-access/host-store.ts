import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { newHostId } from "./paths.js";
import type { HostAccessFileState, HostGrant, HostMount } from "./types.js";

export const HOST_ACCESS_FILE_ENV = "LAWMIND_HOST_ACCESS_FILE";

const sessionGrantStore = new Map<string, HostGrant[]>();
const sessionCommandStore = new Set<string>();
const locateHitStore = new Map<string, Map<string, string>>();

export function defaultHostAccessFilePath(): string {
  const fromEnv = process.env[HOST_ACCESS_FILE_ENV]?.trim();
  if (fromEnv) {
    return path.resolve(fromEnv);
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "LawMind", "host-access.json");
  }
  if (process.platform === "win32") {
    const base = process.env.APPDATA?.trim() || path.join(os.homedir(), "AppData", "Roaming");
    return path.join(base, "LawMind", "host-access.json");
  }
  return path.join(os.homedir(), ".config", "LawMind", "host-access.json");
}

export function emptyHostAccessFileState(): HostAccessFileState {
  return { schemaVersion: 1, mounts: [], persistentGrants: [] };
}

export function readHostAccessFile(filePath = defaultHostAccessFilePath()): HostAccessFileState {
  try {
    if (!fs.existsSync(filePath)) {
      return emptyHostAccessFileState();
    }
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<HostAccessFileState>;
    if (!raw || raw.schemaVersion !== 1) {
      return emptyHostAccessFileState();
    }
    return {
      schemaVersion: 1,
      mounts: Array.isArray(raw.mounts) ? raw.mounts.filter(isMount) : [],
      persistentGrants: Array.isArray(raw.persistentGrants)
        ? raw.persistentGrants.filter(isGrant)
        : [],
      fullDiskAccessNoted: raw.fullDiskAccessNoted === true,
    };
  } catch {
    return emptyHostAccessFileState();
  }
}

export function writeHostAccessFile(
  state: HostAccessFileState,
  filePath = defaultHostAccessFilePath(),
): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function isMount(value: unknown): value is HostMount {
  if (!value || typeof value !== "object") {
    return false;
  }
  const o = value as HostMount;
  return typeof o.id === "string" && typeof o.absPath === "string" && typeof o.addedAt === "string";
}

function isGrant(value: unknown): value is HostGrant {
  if (!value || typeof value !== "object") {
    return false;
  }
  const o = value as HostGrant;
  return (
    typeof o.id === "string" &&
    typeof o.absPath === "string" &&
    (o.kind === "read" || o.kind === "write") &&
    (o.duration === "once" || o.duration === "session" || o.duration === "always")
  );
}

export function migrateProjectDirToMounts(
  projectDir: string | undefined,
  mounts: HostMount[],
): HostMount[] {
  const abs = projectDir?.trim();
  if (!abs) {
    return mounts;
  }
  const resolved = path.resolve(abs);
  if (mounts.some((m) => path.resolve(m.absPath) === resolved)) {
    return mounts;
  }
  return [
    {
      id: "project",
      absPath: resolved,
      label: path.basename(resolved),
      addedAt: new Date().toISOString(),
    },
    ...mounts,
  ];
}

export function addSessionGrant(
  sessionId: string,
  grant: Omit<HostGrant, "id" | "addedAt" | "sessionId">,
): HostGrant {
  const next: HostGrant = {
    ...grant,
    id: newHostId("grant"),
    sessionId,
    addedAt: new Date().toISOString(),
  };
  const list = sessionGrantStore.get(sessionId) ?? [];
  list.push(next);
  sessionGrantStore.set(sessionId, list);
  return next;
}

export function listSessionGrants(sessionId: string): HostGrant[] {
  return [...(sessionGrantStore.get(sessionId) ?? [])];
}

export function consumeOnceGrant(sessionId: string, absPath: string): void {
  const resolved = path.resolve(absPath);
  const list = sessionGrantStore.get(sessionId) ?? [];
  sessionGrantStore.set(
    sessionId,
    list.filter((g) => !(g.duration === "once" && path.resolve(g.absPath) === resolved)),
  );
}

export function rememberLocateHit(sessionId: string, hitId: string, absPath: string): void {
  const id = hitId.trim();
  const abs = absPath.trim();
  if (!sessionId || !id || !abs) {
    return;
  }
  const bucket = locateHitStore.get(sessionId) ?? new Map<string, string>();
  bucket.set(id, path.resolve(abs));
  locateHitStore.set(sessionId, bucket);
}

export function resolveLocateHit(sessionId: string, hitId: string): string | undefined {
  const id = hitId.trim();
  if (!sessionId || !id) {
    return undefined;
  }
  return locateHitStore.get(sessionId)?.get(id);
}

export function clearSessionHostAccess(sessionId: string): void {
  sessionGrantStore.delete(sessionId);
  sessionCommandStore.delete(sessionId);
  locateHitStore.delete(sessionId);
}

export function setSessionCommandAllowed(sessionId: string, allowed: boolean): void {
  if (allowed) {
    sessionCommandStore.add(sessionId);
  } else {
    sessionCommandStore.delete(sessionId);
  }
}

export function isSessionCommandAllowed(sessionId: string): boolean {
  return sessionCommandStore.has(sessionId);
}

export function persistAlwaysGrant(grant: HostGrant, filePath = defaultHostAccessFilePath()): void {
  const state = readHostAccessFile(filePath);
  const abs = path.resolve(grant.absPath);
  if (
    state.persistentGrants.some((g) => path.resolve(g.absPath) === abs && g.kind === grant.kind)
  ) {
    return;
  }
  state.persistentGrants.push(grant);
  writeHostAccessFile(state, filePath);
}

export function addMountToStore(
  mount: HostMount,
  filePath = defaultHostAccessFilePath(),
  maxMounts = 16,
): HostAccessFileState {
  const state = readHostAccessFile(filePath);
  const abs = path.resolve(mount.absPath);
  if (state.mounts.some((m) => path.resolve(m.absPath) === abs)) {
    return state;
  }
  if (state.mounts.length >= maxMounts) {
    throw new Error(`本机文件夹已达上限（${maxMounts}）`);
  }
  state.mounts.push({ ...mount, absPath: abs });
  writeHostAccessFile(state, filePath);
  return state;
}

export function removeMountFromStore(
  mountId: string,
  filePath = defaultHostAccessFilePath(),
): HostAccessFileState {
  const state = readHostAccessFile(filePath);
  state.mounts = state.mounts.filter((m) => m.id !== mountId);
  writeHostAccessFile(state, filePath);
  return state;
}

export function firstMountProjectDir(mounts: HostMount[]): string | undefined {
  const first = mounts[0];
  return first?.absPath ? path.resolve(first.absPath) : undefined;
}
