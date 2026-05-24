"use strict";

/**
 * LawMind keychain wrapper.
 *
 * Wraps `keytar` so the Electron main process can store secrets in the OS
 * keychain (macOS Keychain, Windows Credential Manager, libsecret/gnome-keyring
 * on Linux). All operations are best-effort: if `keytar` cannot be required
 * (e.g. native module not rebuilt for current Electron ABI), `isAvailable()`
 * returns `false` and the caller falls back to plaintext `.env.lawmind`.
 *
 * Convention: secrets live under service `ai.lawmind.desktop` keyed by an
 * `account` string like `"wizard.default.apiKey"` or `"custom.<uuid>.apiKey"`.
 */

const SERVICE = "ai.lawmind.desktop";

let keytarLib = null;
let initialized = false;
let initError = null;

function tryRequireKeytar() {
  if (initialized) {return keytarLib;}
  initialized = true;
  try {
    // eslint-disable-next-line global-require
    keytarLib = require("keytar");
  } catch (err) {
    keytarLib = null;
    initError = err instanceof Error ? err.message : String(err);
  }
  return keytarLib;
}

function isAvailable() {
  return Boolean(tryRequireKeytar());
}

function lastError() {
  return initError;
}

async function saveSecret(account, value) {
  const lib = tryRequireKeytar();
  if (!lib) {return false;}
  const v = typeof value === "string" ? value : "";
  if (!account || typeof account !== "string") {
    throw new Error("account_required");
  }
  if (!v) {
    return deleteSecret(account);
  }
  await lib.setPassword(SERVICE, account, v);
  return true;
}

async function readSecret(account) {
  const lib = tryRequireKeytar();
  if (!lib) {return null;}
  if (!account || typeof account !== "string") {return null;}
  try {
    return await lib.getPassword(SERVICE, account);
  } catch {
    return null;
  }
}

async function deleteSecret(account) {
  const lib = tryRequireKeytar();
  if (!lib) {return false;}
  if (!account || typeof account !== "string") {return false;}
  try {
    return await lib.deletePassword(SERVICE, account);
  } catch {
    return false;
  }
}

async function listSecrets() {
  const lib = tryRequireKeytar();
  if (!lib) {return [];}
  try {
    const rows = await lib.findCredentials(SERVICE);
    return rows.map((r) => ({ account: r.account, hasValue: Boolean(r.password) }));
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
