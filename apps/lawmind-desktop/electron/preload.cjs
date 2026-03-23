"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("lawmindDesktop", {
  getConfig: () => ipcRenderer.invoke("lawmind:get-config"),
  pickWorkspace: () => ipcRenderer.invoke("lawmind:pick-workspace"),
  saveSetup: (payload) => ipcRenderer.invoke("lawmind:save-setup", payload),
  setRetrievalMode: (mode) => ipcRenderer.invoke("lawmind:set-retrieval-mode", mode),
  pickProject: () => ipcRenderer.invoke("lawmind:pick-project"),
  setProjectDir: (projectDir) => ipcRenderer.invoke("lawmind:set-project-dir", projectDir),
  openExternal: (url) => ipcRenderer.invoke("lawmind:open-external", url),
  showItemInFolder: (fullPath) => ipcRenderer.invoke("lawmind:show-item-in-folder", fullPath),
  fsList: (payload) => ipcRenderer.invoke("lawmind:fs:list", payload),
  fsRead: (payload) => ipcRenderer.invoke("lawmind:fs:read", payload),
  fsWrite: (payload) => ipcRenderer.invoke("lawmind:fs:write", payload),
  fsMkdir: (payload) => ipcRenderer.invoke("lawmind:fs:mkdir", payload),
  fsRename: (payload) => ipcRenderer.invoke("lawmind:fs:rename", payload),
  fsDelete: (payload) => ipcRenderer.invoke("lawmind:fs:delete", payload),
});
