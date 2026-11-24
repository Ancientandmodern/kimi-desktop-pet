const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desktopPet', {
  ignoreMouse: (ignore) => ipcRenderer.send('mouse:ignore', ignore),
  dragStart: (point) => ipcRenderer.send('drag:start', point),
  dragMove: (point) => ipcRenderer.send('drag:move', point),
  dragEnd: () => ipcRenderer.send('drag:end'),
  close: () => ipcRenderer.send('app:close'),
  quota: () => ipcRenderer.invoke('quota:get'),
  monitor: () => ipcRenderer.invoke('monitor:get'),
  host: () => ipcRenderer.invoke('host:get'),
  onCodingState: (listener) => {
    ipcRenderer.on('coding:state', (_event, state) => listener(state));
  },
});
