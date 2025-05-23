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
const AutoScraper = require('./auto-scraper');

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

const licenseText = `
Twitter Scraper Custom License

This software is provided under a custom license that allows:
- Free personal use
- Required login for all usage
- Commercial use only with explicit permission

By using this software, you agree to these terms.
For full license details, see the LICENSE file.
`;

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

    // Display license information
    await licenseWindow.loadFile(path.join(__dirname, '../renderer/license.html'));
    
    // Add license information to the page
    licenseWindow.webContents.executeJavaScript(`
        document.addEventListener('DOMContentLoaded', () => {
            const licenseInfoElement = document.createElement('div');
            licenseInfoElement.style.margin = '20px';
            licenseInfoElement.style.padding = '15px';
            licenseInfoElement.style.border = '1px solid #ddd';
            licenseInfoElement.style.borderRadius = '5px';
            licenseInfoElement.style.backgroundColor = '#f9f9f9';
            licenseInfoElement.innerHTML = \`
                <h3>License Information</h3>
                <p style="white-space: pre-line">${licenseText}</p>
                <p>This application is for personal use only. Commercial use requires explicit permission.</p>
                <p>All usage requires authentication via Twitter.</p>
            \`;
            
            document.body.appendChild(licenseInfoElement);
        });
    `);
}

async function createMainWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, '..', 'preload', 'index.js')
        }
    });

    // Add window close handler
    mainWindow.on('close', async (event) => {
        event.preventDefault(); // Prevent immediate closing
        
        try {
            // Stop auto-scraping if active
            if (global.autoScraper && global.autoScraper.isRunning) {
                await global.autoScraper.stop();
            }
            
            // Cleanup database connection
            if (db) {
                await db.close();
            }
            
            // Stop API server
            if (apiServer) {
                await apiServer.stop();
            }
            
            // Cleanup scraper resources
            if (scraper) {
                await scraper.cleanup(false);
            }

            // Cleanup chat manager
            if (chatManager) {
                chatManager.cleanup();
                chatManager = null;
            }
            
            // Now actually close the window
            mainWindow.destroy();
        } catch (error) {
            console.error('Error during cleanup:', error);
            mainWindow.destroy(); // Force close even if cleanup fails
        }
    });

    // Initialize core services
    scraper = new TwitterScraper();
    global.scraper = scraper;
    apiServer = new APIServer(scraper);
    dataStore = new DataStore();
    db = new TweetDatabase();
    chatManager = new ChatManager(db, app.getPath('userData'));
    preferencesManager = new PreferencesManager();

    // Initialize auto-scraper after db and scraper are created
    const autoScraper = new AutoScraper(scraper, db);

    // Set up auto-scraping event handlers
    autoScraper.on('started', ({ interval }) => {
        console.log(`Auto-scraping started with interval: ${interval}ms`);
        mainWindow.webContents.send('auto-scraping-status', { isActive: true, interval });
    });

    autoScraper.on('stopped', () => {
        console.log('Auto-scraping stopped');
        mainWindow.webContents.send('auto-scraping-status', { isActive: false, interval: null });
    });

    autoScraper.on('cycleStarted', () => {
        console.log('Auto-scraping cycle started');
        mainWindow.webContents.send('auto-scraping-event', { type: 'cycleStarted' });
    });

    autoScraper.on('cycleCompleted', () => {
        console.log('Auto-scraping cycle completed');
        mainWindow.webContents.send('auto-scraping-event', { type: 'cycleCompleted' });
    });

    autoScraper.on('cycleError', ({ error }) => {
        console.error('Auto-scraping cycle error:', error);
        mainWindow.webContents.send('auto-scraping-event', { type: 'cycleError', error });
    });

    autoScraper.on('profileStarted', ({ type, target }) => {
        console.log(`Starting to scrape ${type}: ${target}`);
        mainWindow.webContents.send('auto-scraping-event', { type: 'profileStarted', type, target });
    });

    autoScraper.on('profileCompleted', ({ type, target, tweetCount }) => {
        console.log(`Completed scraping ${type}: ${target}, found ${tweetCount} tweets`);
        mainWindow.webContents.send('auto-scraping-event', { type: 'profileCompleted', type, target, tweetCount });
    });

    autoScraper.on('profileError', ({ type, target, error }) => {
        console.error(`Error scraping ${type}: ${target}`, error);
        mainWindow.webContents.send('auto-scraping-event', { type: 'profileError', type, target, error });
    });

    autoScraper.on('profileAdded', ({ type, target }) => {
        console.log(`Added new auto-scraping profile: ${type}: ${target}`);
        mainWindow.webContents.send('auto-scraping-event', { type: 'profileAdded', type, target });
    });

    autoScraper.on('profileRemoved', ({ type, target }) => {
        console.log(`Removed auto-scraping profile: ${type}: ${target}`);
        mainWindow.webContents.send('auto-scraping-event', { type: 'profileRemoved', type, target });
    });

    // Store autoScraper in the global scope
    global.autoScraper = autoScraper;

    await apiServer.start();
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

app.on('window-all-closed', async () => {
    // For macOS, don't quit unless explicitly asked
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        checkLicenseAndStart(); // This already includes license validation
    }
});

// Add a before-quit handler for final cleanup
app.on('before-quit', async (event) => {
    event.preventDefault();
    try {
        // Final cleanup of any remaining resources
        if (global.autoScraper && global.autoScraper.isRunning) {
            await global.autoScraper.stop();
        }
        if (db) {
            await db.close();
        }
        if (apiServer) {
            await apiServer.stop();
        }
        if (scraper) {
            await scraper.cleanup(false);
        }
        if (chatManager) {
            chatManager.cleanup();
            chatManager = null;
        }
        // Now actually quit
        app.exit(0);
    } catch (error) {
        console.error('Error during final cleanup:', error);
        app.exit(1);
    }
});

// IPC handlers
ipcMain.handle('start-twitter-auth', async () => {
    try {
        // Check license validity first
        const licenseCheck = await licenseManager.isLicenseValid();
        if (!licenseCheck.success) {
            // Create license window instead of throwing error
            await createLicenseWindow();
            return { status: 'error', message: licenseCheck.message, redirectToLicense: true };
        }

        if (!scraper) {
            throw new Error('Scraper not initialized');
        }
        
        console.log('Starting Twitter authentication process...');
        
        // Add catch block specifically for initialization errors
        try {
            const success = await scraper.startAuth();
            
            if (!success) {
                // Provide more detailed error information
                if (!scraper.browser) {
                    throw new Error('Failed to start Twitter authentication: Browser could not be launched. Please check that you have a compatible browser installed (Chrome, Edge, or Brave).');
                } else {
                    throw new Error('Failed to start Twitter authentication: Authentication process was unsuccessful. Please try again.');
                }
            }
            return { status: 'success', message: 'Authentication successful' };
        } catch (error) {
            // Check for browser initialization errors for more specific messaging
            if (error.browserInitFailed || error.message.includes('Failed to initialize browser')) {
                throw new Error('Failed to start Twitter authentication: Could not initialize browser. Please make sure you have Google Chrome, Microsoft Edge, or Brave Browser installed and accessible.');
            }
            // Otherwise, re-throw the original error
            throw error;
        }
    } catch (error) {
        console.error('Authentication error:', error);
        // Make sure to throw the full error object for proper client-side handling
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
       /* await dataStore.saveTweets({
            type: 'search',
            query,
            tweets,
            timestamp: new Date().toISOString()
        });*/
        
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
        /*await dataStore.saveTweets({
            type: 'profile',
            username,
            tweets: data.tweets,
            profileInfo: data.profile,
            timestamp: new Date().toISOString()
        });*/
        
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
        /*await dataStore.saveTweets({
            type: 'home',
            tweets,
            timestamp: new Date().toISOString()
        });*/
        
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
        await scraper.db.deleteAllSessions();
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

// Update IPC handlers for auto-scraping
ipcMain.handle('start-auto-scraping', async (event, { interval = 3600000, type = 'home' }) => {
    try {
        await global.autoScraper.start(interval, type);
        return { status: 'success', message: 'Auto-scraping started' };
    } catch (error) {
        console.error('Error starting auto-scraping:', error);
        throw error;
    }
});

ipcMain.handle('stop-auto-scraping', async () => {
    try {
        await global.autoScraper.stop();
        return { status: 'success', message: 'Auto-scraping stopped' };
    } catch (error) {
        console.error('Error stopping auto-scraping:', error);
        throw error;
    }
});

ipcMain.handle('add-auto-scraping-profile', async (event, { type, target }) => {
    try {
        await global.autoScraper.addProfile(type, target);
        return { status: 'success', message: 'Profile added to auto-scraping' };
    } catch (error) {
        console.error('Error adding auto-scraping profile:', error);
        throw error;
    }
});

ipcMain.handle('remove-auto-scraping-profile', async (event, { type, target }) => {
    try {
        await global.autoScraper.removeProfile(type, target);
        return { status: 'success', message: 'Profile removed from auto-scraping' };
    } catch (error) {
        console.error('Error removing auto-scraping profile:', error);
        throw error;
    }
});

ipcMain.handle('get-auto-scraping-profiles', async () => {
    try {
        const profiles = await global.autoScraper.getProfiles();
        return { status: 'success', profiles };
    } catch (error) {
        console.error('Error getting auto-scraping profiles:', error);
        throw error;
    }
});

ipcMain.handle('get-auto-scraping-status', async () => {
    try {
        return { 
            status: 'success', 
            isActive: global.autoScraper.isActive(),
            interval: global.autoScraper.getInterval()
        };
    } catch (error) {
        console.error('Error getting auto-scraping status:', error);
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

// Add these event handlers near other ipcMain handlers
ipcMain.handle('get-delegation-status', async () => {
    console.log('get-delegation-status handler called');
    const status = apiServer.getDelegationStatus();
    console.log('Delegation status:', status);
    return status;
});

ipcMain.handle('enable-delegation', async () => {
    console.log('enable-delegation handler called');
    const result = apiServer.enableDelegation();
    console.log('Delegation enabled:', result);
    return result;
});

ipcMain.handle('disable-delegation', async () => {
    console.log('disable-delegation handler called');
    const result = apiServer.disableDelegation();
    console.log('Delegation disabled:', result);
    return result;
});

// Add new handler for API logs
ipcMain.handle('get-api-logs', async (event, options = {}) => {
    try {
        console.log('Getting API logs with options:', options);
        if (!apiServer || !apiServer.logger) {
            throw new Error('API logger not available');
        }
        
        const logs = await apiServer.logger.getApiLogs(options);
        return { success: true, logs };
    } catch (error) {
        console.error('Error retrieving API logs:', error);
        return { success: false, error: error.message };
    }
});

// Export for TypeScript support
module.exports = app; 