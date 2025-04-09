const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const TwitterScraper = require('./scraper');
const APIServer = require('./api-server');
const DataStore = require('./data-store');
const ChatManager = require('./chat');
const fs = require('fs').promises;
const TweetDatabase = require('./database');
const PreferencesManager = require('./preferences');
const LicenseManager = require('./license');

let mainWindow = null;
let scraper = null;
let apiServer = null;
let dataStore = null;
let autoScrapingInterval = null;
let db;
let chatManager;
let preferencesManager;
let licenseWindow = null;
const licenseManager = new LicenseManager();

async function createLicenseWindow() {
    licenseWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        resizable: true,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, '../preload/license.js')
        }
    });

    await licenseWindow.loadFile(path.join(__dirname, '../renderer/license.html'));
}

async function createMainWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, '../preload/index.js')
        }
    });

    // Initialize core services
    scraper = new TwitterScraper();
    apiServer = new APIServer();
    dataStore = new DataStore();
    db = new TweetDatabase();
    chatManager = new ChatManager(db, app.getPath('userData'));
    preferencesManager = new PreferencesManager();

    await mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
}

async function checkLicenseAndStart() {
    try {
        const licenseStatus = await licenseManager.isLicenseValid();
        console.log('License status:', licenseStatus);
        
        if (licenseStatus.success) {
            await createMainWindow();
        } else {
            await createLicenseWindow();
        }
    } catch (error) {
        console.error('Error checking license:', error);
        await createLicenseWindow();
    }
}

// App lifecycle handlers
app.whenReady().then(checkLicenseAndStart);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        checkLicenseAndStart();
    }
});

// IPC handlers
ipcMain.handle('start-twitter-auth', async () => {
    try {
        // Check license validity first
        const licenseCheck = await licenseManager.isLicenseValid();
        if (!licenseCheck.success) {
            throw new Error(licenseCheck.message);
        }

        if (!scraper) {
            throw new Error('Scraper not initialized');
        }
        const success = await scraper.startAuth();
        if (!success) {
            throw new Error('Failed to start Twitter authentication');
        }
        return { status: 'success', message: 'Authentication successful' };
    } catch (error) {
        console.error('Authentication error:', error);
        throw error;
    }
});

ipcMain.handle('scrape-tweets', async (event, { query, limit }) => {
    try {
        // Check license validity first
        const licenseCheck = await licenseManager.isLicenseValid();
        if (!licenseCheck.success) {
            throw new Error(licenseCheck.message);
        }

        if (!scraper) {
            throw new Error('Scraper not initialized');
        }
        if (!scraper.isLoggedIn) {
            throw new Error('Not logged in to Twitter');
        }
        const tweets = await scraper.scrapeTweets(query, limit);
        
        // Save scraped tweets to data store
        await dataStore.saveTweets({
            type: 'search',
            query,
            tweets,
            timestamp: new Date().toISOString()
        });
        
        return { status: 'success', tweets };
    } catch (error) {
        console.error('Scraping error:', error);
        throw error;
    }
});

ipcMain.handle('scrape-profile', async (event, { username, limit }) => {
    try {
        // Check license validity first
        const licenseCheck = await licenseManager.isLicenseValid();
        if (!licenseCheck.success) {
            throw new Error(licenseCheck.message);
        }

        if (!scraper) {
            throw new Error('Scraper not initialized');
        }
        if (!scraper.isLoggedIn) {
            throw new Error('Not logged in to Twitter');
        }
        
        const data = await scraper.scrapeProfile(username, limit);
        
        // Save profile data to data store
        await dataStore.saveTweets({
            type: 'profile',
            username,
            tweets: data.tweets,
            profileInfo: data.profile,
            timestamp: new Date().toISOString()
        });
        
        return { status: 'success', data };
    } catch (error) {
        console.error('Profile scraping error:', error);
        throw error;
    }
});

ipcMain.handle('scrape-home', async (event, { limit }) => {
    try {
        // Check license validity first
        const licenseCheck = await licenseManager.isLicenseValid();
        if (!licenseCheck.success) {
            throw new Error(licenseCheck.message);
        }

        if (!scraper) {
            throw new Error('Scraper not initialized');
        }
        if (!scraper.isLoggedIn) {
            throw new Error('Not logged in to Twitter');
        }
        
        const tweets = await scraper.scrapeHomeTimeline(limit);
        
        // Save home timeline tweets to data store
        await dataStore.saveTweets({
            type: 'home',
            tweets,
            timestamp: new Date().toISOString()
        });
        
        return { status: 'success', tweets };
    } catch (error) {
        console.error('Home timeline scraping error:', error);
        throw error;
    }
});

ipcMain.handle('get-status', async () => {
    try {
        if (!scraper) {
            return {
                error: 'Scraper not initialized',
                ready: false,
                isLoggedIn: false
            };
        }

        // Check if browser is initialized
        if (!scraper.browser || !scraper.page) {
            return {
                error: 'Browser not initialized',
                ready: false,
                isLoggedIn: false
            };
        }

        // Return current status
        return {
            ready: true,
            isLoggedIn: scraper.isLoggedIn,
            error: null
        };
    } catch (error) {
        console.error('Error in get-status:', error);
        return {
            error: `Error checking status: ${error.message}`,
            ready: false,
            isLoggedIn: false
        };
    }
});

// New IPC handlers for data management
ipcMain.handle('get-stored-tweets', async () => {
    try {
        console.log('Handling get-stored-tweets request');
        
        if (!scraper || !scraper.db) {
            console.error('Database not initialized');
            throw new Error('Database not initialized');
        }

        console.log('Getting tweets from database...');
        const data = await scraper.db.getTweets();
        console.log('Retrieved tweets:', data ? 'Data found' : 'No data');
        
        return data;
    } catch (error) {
        console.error('Error in get-stored-tweets handler:', error);
        throw error;
    }
});

ipcMain.handle('clear-stored-tweets', async () => {
    try {
        console.log('Handling clear-stored-tweets request');
        
        if (!scraper || !scraper.db) {
            console.error('Database not initialized');
            throw new Error('Database not initialized');
        }

        console.log('Clearing tweets from database...');
        await scraper.db.clearTweets();
        console.log('Tweets cleared successfully');
        
        return { success: true };
    } catch (error) {
        console.error('Error in clear-stored-tweets handler:', error);
        throw error;
    }
});

// Update the clear-twitter-session handler
ipcMain.handle('clear-twitter-session', async () => {
    try {
        if (!scraper) {
            throw new Error('Scraper not initialized');
        }
        
        // Use the new clearSession method
        const success = await scraper.clearSession();
        
        if (success) {
            // Clear session storage from the window as well
            await mainWindow.webContents.session.clearStorageData({
                storages: ['cookies', 'localstorage', 'caches']
            });
            return { success: true, message: 'Twitter session cleared successfully' };
        } else {
            throw new Error('Failed to clear Twitter session');
        }
    } catch (error) {
        console.error('Error clearing Twitter session:', error);
        return { success: false, message: 'Failed to clear Twitter session: ' + error.message };
    }
});

// Add new IPC handlers for auto-scraping
ipcMain.handle('start-auto-scraping', async (event, { interval = 3600000 }) => {
    try {
        if (autoScrapingInterval) {
            clearInterval(autoScrapingInterval);
        }

        autoScrapingInterval = setInterval(async () => {
            try {
                const profiles = await scraper.db.getAutoScrapingProfiles();
                for (const profile of profiles) {
                    try {
                        if (profile.type === 'profile') {
                            const data = await scraper.scrapeProfile(profile.target, 100);
                            // Save profile data to data store
                            await dataStore.saveTweets({
                                type: 'profile',
                                username: profile.target,
                                tweets: data.tweets,
                                profileInfo: data.profile,
                                timestamp: new Date().toISOString()
                            });
                        } else if (profile.type === 'home') {
                            const data = await scraper.scrapeHomeTimeline(100);
                            // Save home timeline data to data store
                            await dataStore.saveTweets({
                                type: 'home',
                                tweets: data.tweets,
                                timestamp: new Date().toISOString()
                            });
                        }
                        await scraper.db.updateAutoScrapingProfileLastScraped(profile.type, profile.target);
                    } catch (error) {
                        console.error(`Error auto-scraping ${profile.type} ${profile.target}:`, error);
                    }
                }
            } catch (error) {
                console.error('Error in auto-scraping interval:', error);
            }
        }, interval);

        return { status: 'success', message: 'Auto-scraping started' };
    } catch (error) {
        console.error('Error starting auto-scraping:', error);
        throw error;
    }
});

ipcMain.handle('stop-auto-scraping', async () => {
    try {
        if (autoScrapingInterval) {
            clearInterval(autoScrapingInterval);
            autoScrapingInterval = null;
        }
        return { status: 'success', message: 'Auto-scraping stopped' };
    } catch (error) {
        console.error('Error stopping auto-scraping:', error);
        throw error;
    }
});

ipcMain.handle('add-auto-scraping-profile', async (event, { type, target }) => {
    try {
        const profiles = await scraper.db.getAutoScrapingProfiles();
        if (profiles.length >= 5) {
            throw new Error('Maximum number of auto-scraping profiles (5) reached');
        }

        await scraper.db.saveAutoScrapingProfile({ type, target });
        return { status: 'success', message: 'Profile added to auto-scraping' };
    } catch (error) {
        console.error('Error adding auto-scraping profile:', error);
        throw error;
    }
});

ipcMain.handle('remove-auto-scraping-profile', async (event, { type, target }) => {
    try {
        await scraper.db.deleteAutoScrapingProfile(type, target);
        return { status: 'success', message: 'Profile removed from auto-scraping' };
    } catch (error) {
        console.error('Error removing auto-scraping profile:', error);
        throw error;
    }
});

ipcMain.handle('get-auto-scraping-profiles', async () => {
    try {
        const profiles = await scraper.db.getAutoScrapingProfiles();
        return { status: 'success', profiles };
    } catch (error) {
        console.error('Error getting auto-scraping profiles:', error);
        throw error;
    }
});

// Add handlers for downloading tweets
ipcMain.handle('download-all-tweets', async () => {
    try {
        if (!scraper || !scraper.db) {
            throw new Error('Database connection not available');
        }
        
        console.log('Downloading all tweets...');
        const tweets = await scraper.db.downloadAllTweets();
        
        // Create a timestamp for the filename
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `all_tweets_${timestamp}.json`;
        
        // Save to downloads folder
        const downloadsPath = app.getPath('downloads');
        const filePath = path.join(downloadsPath, filename);
        
        await fs.writeFile(filePath, JSON.stringify(tweets, null, 2));
        
        return {
            success: true,
            filePath,
            tweetCount: tweets.length
        };
    } catch (error) {
        console.error('Error downloading all tweets:', error);
        throw error;
    }
});

ipcMain.handle('download-tweets-by-session', async (event, sessionId) => {
    try {
        if (!scraper || !scraper.db) {
            throw new Error('Database connection not available');
        }
        
        if (!sessionId) {
            throw new Error('Session ID is required');
        }

        console.log('Downloading tweets for session:', sessionId);
        const data = await scraper.db.downloadTweetsBySession(sessionId);
        
        // Create a timestamp for the filename
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `session_${sessionId}_tweets_${timestamp}.json`;
        
        // Save to downloads folder
        const downloadsPath = app.getPath('downloads');
        const filePath = path.join(downloadsPath, filename);
        
        await fs.writeFile(filePath, JSON.stringify(data, null, 2));
        
        return {
            success: true,
            filePath,
            tweetCount: data.tweets.length,
            sessionInfo: data.session
        };
    } catch (error) {
        console.error('Error downloading session tweets:', error);
        throw error;
    }
});

// Handle data sharing preference changes
ipcMain.handle('set-data-sharing', async (event, enabled) => {
    const result = await preferencesManager.setDataSharing(enabled);
    if (result.success) {
        db.shareData = enabled;
    }
    return result;
});

ipcMain.handle('get-data-sharing', () => {
    return preferencesManager.getDataSharing();
});

ipcMain.handle('delete-session', async (event, sessionId) => {
    try {
        console.log('Deleting session:', sessionId);
        await dataStore.deleteSession(sessionId);
        return { success: true };
    } catch (error) {
        console.error('Error deleting session:', error);
        throw error;
    }
});

ipcMain.handle('license-activated', async () => {
    if (licenseWindow) {
        licenseWindow.close();
        licenseWindow = null;
    }
    await createMainWindow();
});

// Export for TypeScript support
module.exports = app; 