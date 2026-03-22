"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("lawmindDesktop", {
  getConfig: () => ipcRenderer.invoke("lawmind:get-config"),
  pickWorkspace: () => ipcRenderer.invoke("lawmind:pick-workspace"),
  saveSetup: (payload) => ipcRenderer.invoke("lawmind:save-setup", payload),
  setRetrievalMode: (mode) => ipcRenderer.invoke("lawmind:set-retrieval-mode", mode),
  pickProject: () => ipcRenderer.invoke("lawmind:pick-project"),
  openExternal: (url) => ipcRenderer.invoke("lawmind:open-external", url),
  showItemInFolder: (fullPath) => ipcRenderer.invoke("lawmind:show-item-in-folder", fullPath),
});
