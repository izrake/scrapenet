const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('licenseAPI', {
    activateLicense: (licenseKey) => ipcRenderer.invoke('activate-license', licenseKey),
    notifyActivation: () => ipcRenderer.invoke('license-activated')
}) 