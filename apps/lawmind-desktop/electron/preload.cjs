"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("lawmindDesktop", {
  getConfig: () => ipcRenderer.invoke("lawmind:get-config"),
  checkForUpdates: () => ipcRenderer.invoke("lawmind:check-updates"),
  showNotification: (payload) => ipcRenderer.invoke("lawmind:show-notification", payload ?? {}),
  onNotificationClick: (handler) => {
    const channel = "lawmind:notification-click";
    const listener = (_evt, payload) => {
      handler(payload);
    };
    ipcRenderer.on(channel, listener);
    return () => {
      ipcRenderer.removeListener(channel, listener);
    };
  },
  pickWorkspace: () => ipcRenderer.invoke("lawmind:pick-workspace"),
  saveSetup: (payload) => ipcRenderer.invoke("lawmind:save-setup", payload),
  setRetrievalMode: (mode) => ipcRenderer.invoke("lawmind:set-retrieval-mode", mode),
  pickProject: () => ipcRenderer.invoke("lawmind:pick-project"),
  setProjectDir: (projectDir) => ipcRenderer.invoke("lawmind:set-project-dir", projectDir),
  openExternal: (url) => ipcRenderer.invoke("lawmind:open-external", url),
  showItemInFolder: (fullPath) => ipcRenderer.invoke("lawmind:show-item-in-folder", fullPath),
  openWithSystem: (payload) => ipcRenderer.invoke("lawmind:open-with-system", payload ?? {}),
  fsList: (payload) => ipcRenderer.invoke("lawmind:fs:list", payload),
  fsRead: (payload) => ipcRenderer.invoke("lawmind:fs:read", payload),
  fsWrite: (payload) => ipcRenderer.invoke("lawmind:fs:write", payload),
  fsMkdir: (payload) => ipcRenderer.invoke("lawmind:fs:mkdir", payload),
  fsRename: (payload) => ipcRenderer.invoke("lawmind:fs:rename", payload),
  fsDelete: (payload) => ipcRenderer.invoke("lawmind:fs:delete", payload),
  fsCopy: (payload) => ipcRenderer.invoke("lawmind:fs:copy", payload),
  saveTextFileDialog: (payload) => ipcRenderer.invoke("lawmind:dialog:save-text-file", payload ?? {}),
  onFileMenu: (handler) => {
    const channel = "lawmind:file-menu";
    const listener = (_evt, payload) => {
      handler(payload);
    };
    ipcRenderer.on(channel, listener);
    return () => {
      ipcRenderer.removeListener(channel, listener);
    };
  },
});
