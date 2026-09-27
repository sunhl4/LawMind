import { describe, expect, it } from "vitest";
import {
  WORKSPACE_LOW_SPACE_BYTES,
  workspaceCloudSyncLabel,
  workspaceLocationCaution,
  workspaceLocationCautionMessage,
} from "./lawmind-workspace-location";

describe("workspaceCloudSyncLabel", () => {
  it("flags common sync folders, including the folder root", () => {
    expect(workspaceCloudSyncLabel("/Users/a/Library/Mobile Documents/com~apple~CloudDocs/LawMind")).toBe(
      "iCloud",
    );
    expect(workspaceCloudSyncLabel("/Users/a/Dropbox/cases")).toBe("Dropbox");
    expect(workspaceCloudSyncLabel("/Users/a/Dropbox")).toBe("Dropbox");
    expect(workspaceCloudSyncLabel("C:\\Users\\a\\OneDrive - Firm\\workspace")).toBe("OneDrive");
    expect(workspaceCloudSyncLabel("C:\\Users\\a\\OneDrive")).toBe("OneDrive");
    expect(workspaceCloudSyncLabel("/Users/a/Library/CloudStorage/GoogleDrive-a/My Drive/ws")).toBe(
      "Google 云端硬盘",
    );
  });

  it("flags macOS File Provider paths that do not contain a slash after the brand name", () => {
    expect(
      workspaceCloudSyncLabel("/Users/a/Library/CloudStorage/OneDrive-Personal/LawMind"),
    ).toBe("OneDrive");
    expect(workspaceCloudSyncLabel("/Users/a/Library/CloudStorage/Box-Box/cases")).toBe("Box");
    expect(workspaceCloudSyncLabel("/Users/a/Library/CloudStorage/Dropbox/cases")).toBe("Dropbox");
  });

  it("leaves a local disk path alone", () => {
    expect(workspaceCloudSyncLabel("/Users/a/Documents/LawMind/workspace")).toBeNull();
    expect(workspaceCloudSyncLabel("/Volumes/External/LawMind")).toBeNull();
    expect(workspaceCloudSyncLabel("")).toBeNull();
  });
});

describe("workspaceLocationCaution", () => {
  it("flags network shares without treating an external volume as a share", () => {
    expect(workspaceLocationCaution("\\\\fileserver\\cases\\LawMind")).toEqual({
      kind: "network",
      label: "网络共享",
    });
    expect(workspaceLocationCaution("smb://nas/cases/LawMind")).toEqual({
      kind: "network",
      label: "网络共享",
    });
    expect(workspaceLocationCaution("/net/nas/cases")).toEqual({
      kind: "network",
      label: "网络共享",
    });
    expect(workspaceLocationCaution("/Volumes/External/LawMind")).toBeNull();
  });

  it("explains the risk in lawyer language and stays quiet on a local disk", () => {
    expect(workspaceLocationCautionMessage("/Users/a/Dropbox")).toContain("Dropbox");
    expect(workspaceLocationCautionMessage("/Users/a/Dropbox")).toContain("仍可继续使用");
    expect(workspaceLocationCautionMessage("\\\\nas\\cases")).toContain("网络共享");
    expect(workspaceLocationCautionMessage("/Users/a/Documents/LawMind")).toBeNull();
  });

  it("treats an OS-reported network filesystem as a share, and a USB volume as local", () => {
    expect(
      workspaceLocationCautionMessage("/Volumes/Cases", { fstype: "smbfs", freeBytes: 80 * 1024 ** 3 }),
    ).toContain("网络共享");
    expect(
      workspaceLocationCautionMessage("/Volumes/USB", { fstype: "exfat", freeBytes: 80 * 1024 ** 3 }),
    ).toBeNull();
    expect(
      workspaceLocationCautionMessage("D:\\LawMind", { driveType: 4, freeBytes: 80 * 1024 ** 3 }),
    ).toContain("网络共享");
    expect(
      workspaceLocationCautionMessage("E:\\LawMind", { driveType: 2, freeBytes: 80 * 1024 ** 3 }),
    ).toBeNull();
  });

  it("warns when a local disk has under 5 GB free, and stays quiet when there is room", () => {
    expect(
      workspaceLocationCautionMessage("/Users/a/Documents/LawMind", {
        fstype: "apfs",
        freeBytes: WORKSPACE_LOW_SPACE_BYTES - 1,
      }),
    ).toContain("不足 5 GB");
    expect(
      workspaceLocationCautionMessage("/Users/a/Documents/LawMind", {
        fstype: "apfs",
        freeBytes: WORKSPACE_LOW_SPACE_BYTES,
      }),
    ).toBeNull();
  });

  it("keeps the sync-folder warning when that folder sits on a local volume", () => {
    expect(
      workspaceLocationCautionMessage("/Users/a/Dropbox", { fstype: "apfs", freeBytes: 1024 }),
    ).toContain("Dropbox");
  });
});
