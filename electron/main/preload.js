const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // Authentication
    startTwitterAuth: () => ipcRenderer.invoke('start-twitter-auth'),
    clearTwitterSession: () => ipcRenderer.invoke('clear-twitter-session'),
    getStatus: () => ipcRenderer.invoke('get-status'),

    // License Management
    activateLicense: (licenseKey) => ipcRenderer.invoke('activate-license'),
    validateLicense: (licenseKey) => ipcRenderer.invoke('validate-license', licenseKey),
    checkLicenseStatus: () => ipcRenderer.invoke('check-license-status'),
    licenseActivated: () => ipcRenderer.invoke('license-activated'),

    // Scraping
    scrapeTweets: (params) => ipcRenderer.invoke('scrape-tweets', params),
    scrapeProfile: (params) => ipcRenderer.invoke('scrape-profile', params),
    scrapeHome: (params) => ipcRenderer.invoke('scrape-home', params),
    saveTweets: (data) => ipcRenderer.invoke('save-tweets', data),
    getStoredTweets: () => ipcRenderer.invoke('get-stored-tweets'),
    clearStoredTweets: () => ipcRenderer.invoke('clear-stored-tweets'),
    downloadTweetsBySession: (sessionId) => ipcRenderer.invoke('download-tweets-by-session', sessionId),
    deleteSession: (sessionId) => ipcRenderer.invoke('delete-session', sessionId),

    // Auto-scraping
    startAutoScraping: (params) => ipcRenderer.invoke('start-auto-scraping', params),
    stopAutoScraping: () => ipcRenderer.invoke('stop-auto-scraping'),
    getAutoScrapingProfiles: () => ipcRenderer.invoke('get-auto-scraping-profiles'),
    addAutoScrapingProfile: (profile) => ipcRenderer.invoke('add-auto-scraping-profile', profile),
    removeAutoScrapingProfile: (profile) => ipcRenderer.invoke('remove-auto-scraping-profile', profile),

    // Data sharing
    setDataSharing: (enabled) => ipcRenderer.invoke('set-data-sharing', enabled),
    getDataSharing: () => ipcRenderer.invoke('get-data-sharing'),

    // LLM
    saveLLMConfig: (config) => ipcRenderer.invoke('save-llm-config', config),
    getLLMConfig: () => ipcRenderer.invoke('get-llm-config'),
    chatQuery: (params) => ipcRenderer.invoke('chat-query', params),
    naturalQuery: (query) => ipcRenderer.invoke('natural-query', query)
}); 