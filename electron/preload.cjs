const { contextBridge, ipcRenderer } = require('electron');

const progressListeners = new Set();

ipcRenderer.on('render:progress', (_event, payload) => {
  for (const listener of progressListeners) {
    listener(payload);
  }
});

contextBridge.exposeInMainWorld('autocutDesktop', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  selectImageFolder: () => ipcRenderer.invoke('dialog:select-image-folder'),
  selectImageFile: () => ipcRenderer.invoke('dialog:select-image-file'),
  selectBgmFile: () => ipcRenderer.invoke('dialog:select-bgm-file'),
  selectOutputFolder: () => ipcRenderer.invoke('dialog:select-output-folder'),
  startRender: (payload) => ipcRenderer.invoke('render:start', payload),
  openOutputFolder: (filePath) => ipcRenderer.invoke('shell:open-output-folder', filePath),
  onRenderProgress: (listener) => {
    progressListeners.add(listener);
    return () => {
      progressListeners.delete(listener);
    };
  },
});
