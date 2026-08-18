/**
 * lawmindd 端口广告：桌面或独立守护进程启动后写入工作区，
 * Word 侧车与桌面用同一份 loopback 地址，不另开协议。
 */

import fs from "node:fs";
import path from "node:path";

export const DEFAULT_LAWMIDD_PORT = 4312;
export const LAWMIDD_ADVERTISE_REL = "lawmind/lawmindd.json";

export type LawminddAdvertisement = {
  daemon: "lawmindd";
  host: "127.0.0.1";
  port: number;
  pid: number;
  startedAt: string;
  workspaceDir: string;
  ingestPath: "/api/sidecar/ingest";
  statusPath: "/api/sidecar/status";
  pendingPath: "/api/sidecar/pending";
  outboxPath: "/api/sidecar/outbox";
};

export function lawminddAdvertisePath(workspaceDir: string): string {
  return path.join(workspaceDir, ...LAWMIDD_ADVERTISE_REL.split("/"));
}

export function writeLawminddAdvertisement(
  workspaceDir: string,
  port: number,
): LawminddAdvertisement {
  const record: LawminddAdvertisement = {
    daemon: "lawmindd",
    host: "127.0.0.1",
    port,
    pid: process.pid,
    startedAt: new Date().toISOString(),
    workspaceDir,
    ingestPath: "/api/sidecar/ingest",
    statusPath: "/api/sidecar/status",
    pendingPath: "/api/sidecar/pending",
    outboxPath: "/api/sidecar/outbox",
  };
  const file = lawminddAdvertisePath(workspaceDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  return record;
}

export function readLawminddAdvertisement(workspaceDir: string): LawminddAdvertisement | null {
  const file = lawminddAdvertisePath(workspaceDir);
  if (!fs.existsSync(file)) {
    return null;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<LawminddAdvertisement>;
    if (parsed.daemon !== "lawmindd" || typeof parsed.port !== "number") {
      return null;
    }
    if (!Number.isFinite(parsed.port) || parsed.port < 1 || parsed.port > 65535) {
      return null;
    }
    return {
      daemon: "lawmindd",
      host: parsed.host === "127.0.0.1" ? "127.0.0.1" : "127.0.0.1",
      port: parsed.port,
      pid: typeof parsed.pid === "number" ? parsed.pid : 0,
      startedAt: typeof parsed.startedAt === "string" ? parsed.startedAt : "",
      workspaceDir: typeof parsed.workspaceDir === "string" ? parsed.workspaceDir : workspaceDir,
      ingestPath: "/api/sidecar/ingest",
      statusPath: "/api/sidecar/status",
      pendingPath: "/api/sidecar/pending",
      outboxPath: "/api/sidecar/outbox",
    };
  } catch {
    return null;
  }
}

/** 仅当广告是本进程写的才删，避免桌面与 lawmindd 互相覆盖后误清。 */
export function clearLawminddAdvertisement(workspaceDir: string): void {
  const current = readLawminddAdvertisement(workspaceDir);
  if (!current || current.pid !== process.pid) {
    return;
  }
  try {
    fs.unlinkSync(lawminddAdvertisePath(workspaceDir));
  } catch {
    // best-effort
  }
}
