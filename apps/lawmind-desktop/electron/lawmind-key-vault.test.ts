import { createRequire } from "node:module";
import Module from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

type KeytarLike = {
  setPassword: (svc: string, account: string, value: string) => Promise<void>;
  getPassword: (svc: string, account: string) => Promise<string | null>;
  deletePassword: (svc: string, account: string) => Promise<boolean>;
  findCredentials: (svc: string) => Promise<Array<{ account: string; password: string }>>;
};

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

function withMockedKeytar(impl: KeytarLike | null, fn: (vault: VaultModule) => Promise<void>): Promise<void> {
  internal._resolveFilename = function (
    this: unknown,
    request: string,
    parent: unknown,
    isMain: boolean,
    options?: unknown,
  ) {
    if (request === "keytar") {
      return "__lawmind_mock_keytar__";
    }
    return ORIG_RESOLVE.call(this, request, parent, isMain, options);
  };
  internal._load = function (this: unknown, request: string, parent: unknown, isMain: boolean) {
    if (request === "keytar" || request === "__lawmind_mock_keytar__") {
      if (!impl) {
        throw new Error("not built for this ABI");
      }
      return impl;
    }
    return ORIG_LOAD.call(this, request, parent, isMain);
  };
  try {
    delete nodeRequire.cache[vaultPath];
  } catch {
    /* ignore */
  }
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
  it("reports unavailable when keytar cannot be required", async () => {
    await withMockedKeytar(null, async (vault) => {
      expect(vault.isAvailable()).toBe(false);
    });
  });

  it("delegates set/get/delete to keytar", async () => {
    const store = new Map<string, string>();
    const impl: KeytarLike = {
      setPassword: async (svc, account, value) => {
        store.set(`${svc}|${account}`, value);
      },
      getPassword: async (svc, account) => store.get(`${svc}|${account}`) ?? null,
      deletePassword: async (svc, account) => store.delete(`${svc}|${account}`),
      findCredentials: async (svc) => {
        const out: Array<{ account: string; password: string }> = [];
        for (const key of store.keys()) {
          if (key.startsWith(`${svc}|`)) {
            const account = key.slice(svc.length + 1);
            out.push({ account, password: store.get(key) ?? "" });
          }
        }
        return out;
      },
    };
    await withMockedKeytar(impl, async (vault) => {
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
    const store = new Map<string, string>();
    const impl: KeytarLike = {
      setPassword: async (svc, account, value) => {
        store.set(`${svc}|${account}`, value);
      },
      getPassword: async (svc, account) => store.get(`${svc}|${account}`) ?? null,
      deletePassword: async (svc, account) => store.delete(`${svc}|${account}`),
      findCredentials: async () => [],
    };
    await withMockedKeytar(impl, async (vault) => {
      await vault.saveSecret("x", "y");
      expect(store.size).toBe(1);
      await vault.saveSecret("x", "");
      expect(store.size).toBe(0);
    });
  });
});
