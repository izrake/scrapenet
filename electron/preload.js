contextBridge.exposeInMainWorld('electronAPI', {
    // ... existing exposed methods ...
    
    // Auto-scraping methods
    startAutoScraping: (options) => ipcRenderer.invoke('start-auto-scraping', options),
    stopAutoScraping: () => ipcRenderer.invoke('stop-auto-scraping'),
    addAutoScrapingProfile: (profile) => ipcRenderer.invoke('add-auto-scraping-profile', profile),
    removeAutoScrapingProfile: (profile) => ipcRenderer.invoke('remove-auto-scraping-profile', profile),
    getAutoScrapingProfiles: () => ipcRenderer.invoke('get-auto-scraping-profiles'),
    getAutoScrapingStatus: () => ipcRenderer.invoke('get-auto-scraping-status'),
    
    // Auto-scraping events
    onAutoScrapingStatus: (callback) => {
        ipcRenderer.on('auto-scraping-status', (event, status) => callback(status));
    },
    onAutoScrapingEvent: (callback) => {
        ipcRenderer.on('auto-scraping-event', (event, eventData) => callback(eventData));
    },
    removeAutoScrapingStatusListener: () => {
        ipcRenderer.removeAllListeners('auto-scraping-status');
    },
    removeAutoScrapingEventListener: () => {
        ipcRenderer.removeAllListeners('auto-scraping-event');
    }
}); 