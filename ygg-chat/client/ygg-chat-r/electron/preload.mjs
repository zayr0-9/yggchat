import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld("electronAPI", {
  auth: {
    login: (credentials) => ipcRenderer.invoke("auth:login", credentials),
    logout: () => ipcRenderer.invoke("auth:logout"),
    openExternal: (url) => ipcRenderer.invoke("auth:openExternal", url),
    openOAuthWindow: (url) => ipcRenderer.invoke("auth:openOAuthWindow", url),
    onOAuthCallback: (callback) => {
      const listener = (_event, url) => callback(url);
      ipcRenderer.on("oauth:callback", listener);
      return () => {
        ipcRenderer.removeListener("oauth:callback", listener);
      };
    }
  },
  storage: {
    get: (key) => ipcRenderer.invoke("storage:get", key),
    set: (key, value) => ipcRenderer.invoke("storage:set", key, value),
    clear: () => ipcRenderer.invoke("storage:clear")
  },
  platformInfo: {
    get: () => ipcRenderer.invoke("platform:info")
  },
  window: {
    minimize: () => ipcRenderer.invoke("window:minimize"),
    maximize: () => ipcRenderer.invoke("window:maximize"),
    close: () => ipcRenderer.invoke("window:close")
  },
  theme: {
    update: (isDark) => ipcRenderer.invoke("theme:update", isDark)
  },
  platform: "electron"
});
console.log("[Electron Preload] Script loaded, electronAPI exposed");
//# sourceMappingURL=preload.mjs.map
