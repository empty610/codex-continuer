const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('continuerDesktop', {
  control: (action, value) => ipcRenderer.invoke('continuer:control', action, value),
  pickDirectory: () => ipcRenderer.invoke('continuer:pick-directory'),
  onState: callback => { ipcRenderer.on('continuer:state', (_event, state) => callback(state)); },
});
