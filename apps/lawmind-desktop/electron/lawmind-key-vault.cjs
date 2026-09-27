"use strict";

/**
 * LawMind keychain wrapper using Electron's safeStorage API.
 *
 * Uses Electron's built-in safeStorage to encrypt secrets, which are then
 * persisted to a JSON file in the app's userData directory. This replaces
 * the deprecated `keytar` native module.
 *
 * All operations are best-effort: if safeStorage encryption is unavailable
 * (rare, but possible on some Linux configurations), `isAvailable()` returns
 * `false` and callers must refuse persisting new secrets (see main.mjs save-setup).
 *
 * Convention: secrets live under service `ai.lawmind.desktop` keyed by an
 * `account` string like `"wizard.default.apiKey"` or `"custom.<uuid>.apiKey"`.
 */

const fs = require("node:fs");
const path = require("node:path");
const { app, safeStorage } = require("electron");

const SERVICE = "ai.lawmind.desktop";

let storePath = null;
let store = {};
let initialized = false;
let initError = null;
/** 磁盘上的密钥文件坏了时拒绝再写，避免用空库覆盖把已存密钥冲掉。 */
let storeCorrupt = false;

function getStorePath() {
  if (storePath) {return storePath;}
  const userDataPath = app.getPath("userData");
  storePath = path.join(userDataPath, "lawmind-secrets.json");
  return storePath;
}

function loadStore() {
  if (initialized) {return store;}
  initialized = true;
  try {
    const filePath = getStorePath();
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, "utf8");
      const parsed = JSON.parse(data);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("secrets store is not an object");
      }
      store = parsed;
    }
  } catch (err) {
    initError = err instanceof Error ? err.message : String(err);
    store = {};
    storeCorrupt = true;
  }
  return store;
}

function saveStore() {
  if (storeCorrupt) {
    return false;
  }
  const filePath = getStorePath();
  const tmp = `${filePath}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(store, null, 2), { encoding: "utf8", mode: 0o600 });
    fs.renameSync(tmp, filePath);
    try {
      fs.chmodSync(filePath, 0o600);
    } catch {
      /* 某些文件系统不支持 chmod；内容已经换名落盘 */
    }
    return true;
  } catch (err) {
    initError = err instanceof Error ? err.message : String(err);
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* 临时文件可能还没写出来 */
    }
    return false;
  }
}

function isAvailable() {
  return safeStorage.isEncryptionAvailable();
}

function lastError() {
  return initError;
}

async function saveSecret(account, value) {
  if (!isAvailable()) {return false;}
  const v = typeof value === "string" ? value : "";
  if (!account || typeof account !== "string") {
    throw new Error("account_required");
  }
  if (!v) {
    return deleteSecret(account);
  }
  try {
    const encrypted = safeStorage.encryptString(v);
    loadStore();
    if (storeCorrupt) {
      return false;
    }
    const previous = Object.prototype.hasOwnProperty.call(store, account) ? store[account] : undefined;
    store[account] = encrypted.toString("base64");
    if (!saveStore()) {
      if (previous === undefined) {
        delete store[account];
      } else {
        store[account] = previous;
      }
      return false;
    }
    return true;
  } catch (err) {
    initError = err instanceof Error ? err.message : String(err);
    return false;
  }
}

async function readSecret(account) {
  if (!isAvailable()) {return null;}
  if (!account || typeof account !== "string") {return null;}
  try {
    loadStore();
    const encrypted = store[account];
    if (!encrypted) {return null;}
    const buffer = Buffer.from(encrypted, "base64");
    return safeStorage.decryptString(buffer);
  } catch (err) {
    initError = err instanceof Error ? err.message : String(err);
    return null;
  }
}

async function deleteSecret(account) {
  if (!account || typeof account !== "string") {return false;}
  try {
    loadStore();
    if (storeCorrupt) {return false;}
    if (!store[account]) {return false;}
    const previous = store[account];
    delete store[account];
    if (!saveStore()) {
      store[account] = previous;
      return false;
    }
    return true;
  } catch (err) {
    initError = err instanceof Error ? err.message : String(err);
    return false;
  }
}

async function listSecrets() {
  if (!isAvailable()) {return [];}
  try {
    loadStore();
    return Object.keys(store).map((account) => ({
      account,
      hasValue: true,
    }));
  } catch {
    return [];
  }
}

module.exports = {
  SERVICE,
  isAvailable,
  lastError,
  saveSecret,
  readSecret,
  deleteSecret,
  listSecrets,
};
