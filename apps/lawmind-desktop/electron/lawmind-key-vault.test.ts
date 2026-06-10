import { createRequire } from "node:module";
import Module from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

type VaultModule = {
  isAvailable: () => boolean;
  saveSecret: (account: string, value: string) => Promise<boolean>;
  readSecret: (account: string) => Promise<string | null>;
  deleteSecret: (account: string) => Promise<boolean>;
  listSecrets: () => Promise<Array<{ account: string; hasValue: boolean }>>;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const vaultPath = path.resolve(__dirname, "lawmind-key-vault.cjs");
const nodeRequire = createRequire(import.meta.url);

const internal = Module as unknown as {
  _resolveFilename: (request: string, parent: unknown, isMain: boolean, options?: unknown) => string;
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
};

const ORIG_RESOLVE = internal._resolveFilename;
const ORIG_LOAD = internal._load;

let encryptionAvailable = true;
const encryptedStore = new Map<string, Buffer>();

function mockSafeStorage() {
  return {
    isEncryptionAvailable: () => encryptionAvailable,
    encryptString: (value: string) => {
      if (!encryptionAvailable) {
        throw new Error("encryption not available");
      }
      // Simple "encryption" for testing: reverse the string
      return Buffer.from(value.split("").toReversed().join(""));
    },
    decryptString: (buffer: Buffer) => {
      if (!encryptionAvailable) {
        throw new Error("encryption not available");
      }
      // Reverse the "encryption"
      return buffer.toString().split("").toReversed().join("");
    },
  };
}

function mockApp() {
  return {
    getPath: (name: string) => {
      if (name === "userData") {
        return "/tmp/lawmind-test-userData";
      }
      return "/tmp";
    },
  };
}

function mockFs() {
  const files = new Map<string, string>();
  return {
    existsSync: (p: string) => files.has(p),
    readFileSync: (p: string) => files.get(p) ?? "",
    writeFileSync: (p: string, content: string) => {
      files.set(p, content);
    },
    _files: files,
  };
}

const fsMock = mockFs();

function withMockedElectron(fn: (vault: VaultModule) => Promise<void>): Promise<void> {
  internal._resolveFilename = function (
    this: unknown,
    request: string,
    parent: unknown,
    isMain: boolean,
    options?: unknown,
  ) {
    if (request === "electron") {
      return "__lawmind_mock_electron__";
    }
    if (request === "node:fs") {
      return "__lawmind_mock_fs__";
    }
    return ORIG_RESOLVE.call(this, request, parent, isMain, options);
  };
  internal._load = function (this: unknown, request: string, parent: unknown, isMain: boolean) {
    if (request === "electron" || request === "__lawmind_mock_electron__") {
      return {
        app: mockApp(),
        safeStorage: mockSafeStorage(),
      };
    }
    if (request === "node:fs" || request === "__lawmind_mock_fs__") {
      return fsMock;
    }
    return ORIG_LOAD.call(this, request, parent, isMain);
  };
  try {
    delete nodeRequire.cache[vaultPath];
  } catch {
    /* ignore */
  }
  fsMock._files.clear();
  encryptedStore.clear();
  const vault = nodeRequire(vaultPath) as VaultModule;
  return fn(vault);
}

afterEach(() => {
  internal._resolveFilename = ORIG_RESOLVE;
  internal._load = ORIG_LOAD;
  try {
    delete nodeRequire.cache[vaultPath];
  } catch {
    /* ignore */
  }
});

describe("lawmind-key-vault.cjs", () => {
  it("reports unavailable when encryption is not available", async () => {
    encryptionAvailable = false;
    await withMockedElectron(async (vault) => {
      expect(vault.isAvailable()).toBe(false);
    });
    encryptionAvailable = true;
  });

  it("encrypts and decrypts secrets via safeStorage", async () => {
    encryptionAvailable = true;
    await withMockedElectron(async (vault) => {
      expect(vault.isAvailable()).toBe(true);
      await vault.saveSecret("wizard.default.apiKey", "sk-123");
      expect(await vault.readSecret("wizard.default.apiKey")).toBe("sk-123");
      const list = await vault.listSecrets();
      expect(list).toHaveLength(1);
      expect(list[0].account).toBe("wizard.default.apiKey");
      expect(await vault.deleteSecret("wizard.default.apiKey")).toBe(true);
      expect(await vault.readSecret("wizard.default.apiKey")).toBeNull();
    });
  });

  it("clears secret when saveSecret called with empty string", async () => {
    encryptionAvailable = true;
    await withMockedElectron(async (vault) => {
      await vault.saveSecret("x", "y");
      const list1 = await vault.listSecrets();
      expect(list1).toHaveLength(1);
      await vault.saveSecret("x", "");
      const list2 = await vault.listSecrets();
      expect(list2).toHaveLength(0);
    });
  });
});
