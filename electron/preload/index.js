const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld(
    'api', {
        minimizeToTray: () => ipcRenderer.invoke('minimize-to-tray'),
        checkTwitterStatus: () => ipcRenderer.invoke('check-twitter-status'),
        onStatusUpdate: (callback) => ipcRenderer.on('status-update', (_, message) => callback(message)),
        startTwitterAuth: () => ipcRenderer.invoke('start-twitter-auth'),
        onTwitterAuthComplete: (callback) => ipcRenderer.on('twitter-auth-complete', (_, success) => callback(success))
    }
);

contextBridge.exposeInMainWorld('electronAPI', {
    startTwitterAuth: () => ipcRenderer.invoke('start-twitter-auth'),
    scrapeTweets: (params) => ipcRenderer.invoke('scrape-tweets', params),
    scrapeProfile: (params) => ipcRenderer.invoke('scrape-profile', params),
    scrapeHome: (params) => ipcRenderer.invoke('scrape-home', params),
    getStatus: () => ipcRenderer.invoke('get-status'),
    getStoredTweets: () => ipcRenderer.invoke('get-stored-tweets'),
    clearStoredTweets: () => ipcRenderer.invoke('clear-stored-tweets'),
    clearTwitterSession: () => ipcRenderer.invoke('clear-twitter-session'),
    // Download functionality
    downloadAllTweets: () => ipcRenderer.invoke('download-all-tweets'),
    downloadTweetsBySession: (sessionId) => ipcRenderer.invoke('download-tweets-by-session', sessionId),
    deleteSession: (sessionId) => ipcRenderer.invoke('delete-session', sessionId),
    // Auto-scraping functions
    startAutoScraping: (params) => ipcRenderer.invoke('start-auto-scraping', params),
    stopAutoScraping: () => ipcRenderer.invoke('stop-auto-scraping'),
    addAutoScrapingProfile: (params) => ipcRenderer.invoke('add-auto-scraping-profile', params),
    removeAutoScrapingProfile: (params) => ipcRenderer.invoke('remove-auto-scraping-profile', params),
    getAutoScrapingProfiles: () => ipcRenderer.invoke('get-auto-scraping-profiles'),
    // Chat APIs
    saveLLMConfig: (config) => ipcRenderer.invoke('save-llm-config', config),
    getLLMConfig: () => ipcRenderer.invoke('get-llm-config'),
    chatQuery: (query) => ipcRenderer.invoke('chat-query', query),
    // Natural language query
    naturalQuery: (query) => ipcRenderer.invoke('natural-query', query)
}); 