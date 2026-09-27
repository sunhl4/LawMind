import { describe, expect, it } from "vitest";
import { freeBytesFromStatfs, fstypeFromMountTable, inspectWorkspaceVolume } from "./workspace-volume.mjs";

describe("workspace volume facts", () => {
  it("turns statfs blocks into free bytes and rejects nonsense", () => {
    expect(freeBytesFromStatfs({ bsize: 4096, bavail: 10 })).toBe(40960);
    expect(freeBytesFromStatfs({ bsize: 0, bavail: 10 })).toBeNull();
    expect(freeBytesFromStatfs(null)).toBeNull();
  });

  it.skipIf(process.platform === "win32")(
    "picks the longest covering mount, including a network volume under /Volumes",
    () => {
    const table = [
      "/dev/disk1s1 / apfs rw",
      "//server/share /Volumes/Cases smbfs rw",
      "/dev/disk2 /Volumes/USB exfat rw",
    ].join("\n");
    expect(fstypeFromMountTable(table, "/Volumes/Cases/LawMind")).toBe("smbfs");
    expect(fstypeFromMountTable(table, "/Volumes/USB/LawMind")).toBe("exfat");
    expect(fstypeFromMountTable(table, "/Users/a/Documents")).toBe("apfs");
    },
  );

  it("reads the root volume on this machine", async () => {
    const root = process.platform === "win32" ? "C:\\" : "/";
    const result = await inspectWorkspaceVolume(root);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.freeBytes).toBeGreaterThan(0);
    if (process.platform === "darwin") {
      expect(result.fstype).toBeTruthy();
      expect(result.fstype).not.toMatch(/smb|nfs|afp|webdav/i);
    }
  });

  it("rejects an empty path", async () => {
    const result = await inspectWorkspaceVolume("  ");
    expect(result.ok).toBe(false);
  });
});