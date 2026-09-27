import { useEffect, useState } from "react";
import type { WorkspaceVolumeFacts } from "./lawmind-workspace-location";

/** 向主进程要文件系统类型和剩余空间。桥不在或查询失败时返回 null，字符串提示仍可用。 */
export function useWorkspaceVolumeFacts(absPath: string): WorkspaceVolumeFacts | null {
  const [facts, setFacts] = useState<WorkspaceVolumeFacts | null>(null);

  useEffect(() => {
    const inspect = window.lawmindDesktop?.inspectWorkspaceVolume;
    const path = absPath.trim();
    if (!inspect || !path) {
      setFacts(null);
      return undefined;
    }
    let cancelled = false;
    void inspect(path).then((res) => {
      if (cancelled) {
        return;
      }
      if (!res.ok) {
        setFacts(null);
        return;
      }
      setFacts({
        fstype: res.fstype ?? null,
        driveType: res.driveType ?? null,
        freeBytes: res.freeBytes ?? null,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [absPath]);

  return facts;
}
