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
      store = JSON.parse(data);
    }
  } catch (err) {
    initError = err instanceof Error ? err.message : String(err);
    store = {};
  }
  return store;
}

function saveStore() {
  try {
    const filePath = getStorePath();
    fs.writeFileSync(filePath, JSON.stringify(store, null, 2), "utf8");
    return true;
  } catch (err) {
    initError = err instanceof Error ? err.message : String(err);
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
    store[account] = encrypted.toString("base64");
    return saveStore();
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
    if (!store[account]) {return false;}
    delete store[account];
    return saveStore();
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
