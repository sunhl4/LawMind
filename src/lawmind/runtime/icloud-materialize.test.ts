import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ensureLocalFile,
  ensureLocalFileSync,
  flagsLookDataless,
  icloudFileKey,
  IcloudDatalessError,
  installIcloudReadMaterialize,
  materializeDatalessInDirectory,
  noteLawyerIcloudReply,
  runApprovedIcloudDownloads,
  parseLsLongOLine,
  resetIcloudMaterializeForTests,
  type IcloudMaterializeIO,
} from "./icloud-materialize.js";

const dirs: string[] = [];

beforeEach(() => {
  resetIcloudMaterializeForTests();
});

afterEach(() => {
  resetIcloudMaterializeForTests();
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function line(name: string, flags: string): string {
  return `-rw-r--r--  1 shl  staff  ${flags} 4 1790489974 ${name}`;
}

function listing(rows: Array<{ name: string; flags: string }>): string {
  return ["total 8", ...rows.map((row) => line(row.name, row.flags)), ""].join("\n");
}

function ioWith(handlers: {
  ls: (args: readonly string[]) => string;
  brctl?: (filePath: string) => void;
  lstat?: IcloudMaterializeIO["lstatSync"];
  now?: () => number;
}): { io: IcloudMaterializeIO; downloads: string[] } {
  const downloads: string[] = [];
  const io: IcloudMaterializeIO = {
    platform: "darwin",
    now: handlers.now ?? (() => 0),
    lstatSync:
      handlers.lstat ??
      (() => ({
        isFile: () => true,
        size: 4,
        blocks: 0,
      })),
    statSync:
      handlers.lstat ??
      (() => ({
        isFile: () => true,
        size: 4,
        blocks: 0,
      })),
    execFileSync: (command, args) => {
      if (command.endsWith("brctl")) {
        const filePath = args[args.length - 1] ?? "";
        downloads.push(filePath);
        handlers.brctl?.(filePath);
        return "";
      }
      if (command.endsWith("ls")) {
        return handlers.ls(args);
      }
      throw new Error(`unexpected ${command}`);
    },
  };
  return { io, downloads };
}

describe("parseLsLongOLine", () => {
  it("reads compressed,dataless without treating the word inside a filename as the flag", () => {
    expect(flagsLookDataless("compressed,dataless")).toBe(true);
    expect(flagsLookDataless("-")).toBe(false);
    expect(flagsLookDataless("compressed")).toBe(false);
    const dataless = parseLsLongOLine(
      line("19fbbe4a-0f9e-4821-b280-77c8ce9f9b66.json", "compressed,dataless"),
    );
    expect(dataless).toMatchObject({
      kind: "-",
      flags: "compressed,dataless",
      name: "19fbbe4a-0f9e-4821-b280-77c8ce9f9b66.json",
    });
    const named = parseLsLongOLine(line("dataless-notes.txt", "-"));
    expect(named?.flags).toBe("-");
    expect(named?.name).toBe("dataless-notes.txt");
    expect(parseLsLongOLine(line("my  file.txt", "hidden,compressed,dataless"))?.name).toBe(
      "my  file.txt",
    );
    expect(parseLsLongOLine(line("聘用合同.txt", "compressed,dataless"))?.name).toBe(
      "聘用合同.txt",
    );
    expect(
      parseLsLongOLine("drwxr-xr-x  2 shl  staff  compressed,dataless 64 1790489974 sub")?.kind,
    ).toBe("d");
    expect(parseLsLongOLine("total 8")).toBeUndefined();
  });
});

describe("materializeDatalessInDirectory", () => {
  it("does nothing off darwin", () => {
    const { io, downloads } = ioWith({
      ls: () => {
        throw new Error("ls");
      },
    });
    io.platform = "linux";
    expect(materializeDatalessInDirectory("/virtual/tasks", { io })).toEqual([]);
    expect(downloads).toEqual([]);
  });

  it("downloads only regular dataless files, after other files and before a deferred one", () => {
    const landed = new Set<string>();
    const { io, downloads } = ioWith({
      brctl: (filePath) => landed.add(path.basename(filePath)),
      ls: () =>
        listing([
          { name: "a.json", flags: landed.has("a.json") ? "-" : "compressed,dataless" },
          { name: "b.json", flags: landed.has("b.json") ? "-" : "compressed,dataless" },
          { name: "dataless-notes.txt", flags: "-" },
          { name: "my  file.txt", flags: landed.has("my  file.txt") ? "-" : "compressed,dataless" },
          { name: "sub", flags: "compressed,dataless" },
        ]).replace(
          line("sub", "compressed,dataless"),
          "drwxr-xr-x  2 shl  staff  compressed,dataless 64 1790489974 sub",
        ),
    });
    const still = materializeDatalessInDirectory("/virtual/tasks", {
      io,
      deferPaths: ["/virtual/tasks/b.json"],
    });
    expect(still).toEqual([]);
    expect(downloads.map((filePath) => path.basename(filePath))).toEqual([
      "a.json",
      "my  file.txt",
      "b.json",
    ]);
  });

  it("treats NFD and NFC names of the same file as one dataless path", () => {
    const nfd = "聘".normalize("NFD") + "用合同.txt";
    const nfc = "聘用合同.txt".normalize("NFC");
    const { io, downloads } = ioWith({
      ls: () =>
        listing([
          { name: "a.json", flags: "compressed,dataless" },
          { name: nfd, flags: "compressed,dataless" },
        ]),
    });
    const still = materializeDatalessInDirectory("/virtual/tasks", {
      io,
      deferPaths: [`/virtual/tasks/${nfc}`],
    });
    expect(downloads.map((filePath) => path.basename(filePath))).toEqual(["a.json"]);
    expect(still.map((filePath) => icloudFileKey(filePath)).toSorted()).toEqual(
      [icloudFileKey(`/virtual/tasks/${nfd}`), icloudFileKey("/virtual/tasks/a.json")].toSorted(),
    );
  });

  it("does not block the process when brctl refuses the download", () => {
    const { io, downloads } = ioWith({
      ls: () => listing([{ name: "a.json", flags: "compressed,dataless" }]),
      brctl: () => {
        throw new Error("brctl failed");
      },
    });
    const still = materializeDatalessInDirectory("/virtual/tasks", { io });
    expect(downloads.map((filePath) => path.basename(filePath))).toEqual(["a.json"]);
    expect(still.map((filePath) => path.basename(filePath))).toEqual(["a.json"]);
  });

  it("does not download the file a reader is blocked on until the others have landed", () => {
    const { io, downloads } = ioWith({
      ls: () =>
        listing([
          { name: "a.json", flags: "compressed,dataless" },
          { name: "open.json", flags: "compressed,dataless" },
        ]),
    });
    const still = materializeDatalessInDirectory("/virtual/tasks", {
      io,
      deferPaths: ["/virtual/tasks/open.json"],
    });
    expect(downloads.map((filePath) => path.basename(filePath))).toEqual(["a.json"]);
    expect(still.map((filePath) => path.basename(filePath)).toSorted()).toEqual([
      "a.json",
      "open.json",
    ]);
  });

  it("does not treat a failed relist as an empty, readable directory", () => {
    let calls = 0;
    const { io } = ioWith({
      ls: () => {
        calls += 1;
        if (calls >= 3) {
          throw new Error("ls down");
        }
        return listing([{ name: "a.json", flags: "compressed,dataless" }]);
      },
    });
    materializeDatalessInDirectory("/virtual/keep", { io });
    const second = materializeDatalessInDirectory("/virtual/keep", { io });
    expect(second.map((filePath) => path.basename(filePath))).toEqual(["a.json"]);
  });

  it("skips a second wait while the previous download is still backing off", () => {
    let calls = 0;
    const { io, downloads } = ioWith({
      ls: () => {
        calls += 1;
        return listing([{ name: "a.json", flags: "compressed,dataless" }]);
      },
    });
    materializeDatalessInDirectory("/virtual/tasks", { io });
    const second = materializeDatalessInDirectory("/virtual/tasks", { io });
    expect(downloads).toHaveLength(1);
    expect(second.map((filePath) => path.basename(filePath))).toEqual(["a.json"]);
    expect(calls).toBe(3);
  });
});

describe("ensureLocalFileSync", () => {
  it("does not spawn ls when the file already has local blocks", () => {
    const { io, downloads } = ioWith({
      lstat: () => ({ isFile: () => true, size: 4, blocks: 8 }),
      ls: () => {
        throw new Error("ls");
      },
    });
    expect(() => ensureLocalFileSync("/virtual/tasks/a.json", io)).not.toThrow();
    expect(downloads).toEqual([]);
  });

  it("throws instead of reading when the body is still dataless", () => {
    const { io, downloads } = ioWith({
      ls: (args) => {
        if (args.some((arg) => arg.startsWith("-ld"))) {
          return `${line("聘用合同.txt", "compressed,dataless")}\n`;
        }
        return listing([{ name: "聘用合同.txt", flags: "compressed,dataless" }]);
      },
    });
    expect(() => ensureLocalFileSync("/virtual/tasks/聘用合同.txt", io)).toThrow(
      IcloudDatalessError,
    );
    expect(downloads).toEqual([]);
  });
});

describe("installIcloudReadMaterialize", () => {
  it("does not read a file that is still dataless", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-icloud-"));
    dirs.push(dir);
    const filePath = path.join(dir, "note.txt");
    fs.writeFileSync(filePath, "secret");
    const io = ioWith({
      lstat: () => ({ isFile: () => true, size: 6, blocks: 0 }),
      ls: (args) => {
        if (args.some((arg) => arg.startsWith("-ld"))) {
          return `${line(path.basename(filePath), "compressed,dataless")}\n`;
        }
        return listing([{ name: "note.txt", flags: "compressed,dataless" }]);
      },
    }).io;
    installIcloudReadMaterialize(io);
    expect(() => fs.readFileSync(filePath, "utf8")).toThrow(IcloudDatalessError);
  });

  it("does not download from a plain read until the lawyer agrees", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-icloud-"));
    dirs.push(dir);
    const filePath = path.join(dir, "note.txt");
    fs.writeFileSync(filePath, "ok");
    const { io, downloads } = ioWith({
      lstat: () => ({ isFile: () => true, size: 2, blocks: 0 }),
      ls: () => listing([{ name: "note.txt", flags: "compressed,dataless" }]),
    });
    installIcloudReadMaterialize(io);
    expect(() => fs.readFileSync(filePath, "utf8")).toThrow(IcloudDatalessError);
    expect(downloads).toEqual([]);
  });
});

describe("ensureLocalFile lawyer download", () => {
  it("reads a local file without asking or downloading", async () => {
    const { io, downloads } = ioWith({
      lstat: () => ({ isFile: () => true, size: 20, blocks: 8 }),
      ls: () => {
        throw new Error("local file should not be probed for download");
      },
    });
    await ensureLocalFile("/Users/lawyer/Desktop/本地合同.docx", { io });
    expect(downloads).toEqual([]);
  });

  it("does not download a file that is only compressed", async () => {
    const { io, downloads } = ioWith({
      lstat: () => ({ isFile: () => true, size: 20, blocks: 0 }),
      ls: () => `${line("本地合同.docx", "compressed")}\n`,
    });
    await ensureLocalFile("/Users/lawyer/Desktop/本地合同.docx", { io });
    expect(downloads).toEqual([]);
  });

  it("downloads a dataless file without asking, then returns once it is local", async () => {
    let now = 0;
    let downloaded = false;
    const { io, downloads } = ioWith({
      now: () => now,
      brctl: () => {
        downloaded = true;
      },
      ls: () => `${line("驾驶员劳务派遣协议.doc", downloaded ? "-" : "dataless")}\n`,
    });
    await ensureLocalFile("/virtual/驾驶员劳务派遣协议.doc", {
      io,
      sleep: async (ms) => {
        now += ms;
      },
      waitMs: 5_000,
    });
    expect(downloads.map((filePath) => path.basename(filePath))).toEqual([
      "驾驶员劳务派遣协议.doc",
    ]);
  });

  it("asks for a manual download when the file is still dataless after the wait", async () => {
    let now = 0;
    const { io, downloads } = ioWith({
      now: () => now,
      ls: () => `${line("聘用合同.docx", "compressed,dataless")}\n`,
    });
    await expect(
      ensureLocalFile("/virtual/聘用合同.docx", {
        io,
        sleep: async (ms) => {
          now += ms;
        },
        waitMs: 5_000,
      }),
    ).rejects.toMatchObject({
      question: {
        key: "icloud_download_manual",
        options: ["我已下完"],
      },
    });
    expect(downloads.map((filePath) => path.basename(filePath))).toEqual(["聘用合同.docx"]);
    noteLawyerIcloudReply("我已下完");
    const afterManual = ioWith({
      ls: () => `${line("聘用合同.docx", "compressed,dataless")}\n`,
    });
    await expect(
      ensureLocalFile("/virtual/聘用合同.docx", { io: afterManual.io }),
    ).rejects.toMatchObject({
      question: { key: "icloud_download_manual" },
    });
    expect(afterManual.downloads).toEqual([]);
  });

  it("retries a timed-out file when the lawyer says 下载", async () => {
    let now = 0;
    const asked = ioWith({
      now: () => now,
      ls: () => `${line("聘用合同.docx", "dataless")}\n`,
    });
    await expect(
      ensureLocalFile("/virtual/聘用合同.docx", {
        io: asked.io,
        sleep: async (ms) => {
          now += ms;
        },
        waitMs: 2_000,
      }),
    ).rejects.toMatchObject({ question: { key: "icloud_download_manual" } });
    noteLawyerIcloudReply("下载");
    let now2 = 0;
    let downloaded = false;
    const downloading = ioWith({
      now: () => now2,
      brctl: () => {
        downloaded = true;
      },
      ls: () => `${line("聘用合同.docx", downloaded ? "-" : "dataless")}\n`,
    });
    const stopped = await runApprovedIcloudDownloads({
      io: downloading.io,
      sleep: async (ms) => {
        now2 += ms;
      },
      waitMs: 5_000,
    });
    expect(stopped).toBeNull();
    expect(downloading.downloads).toEqual([path.resolve("/virtual/聘用合同.docx")]);
  });
});
