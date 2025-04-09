const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs/promises');
const { app } = require('electron');
const TweetDatabase = require('./database');
const TempStorage = require('./temp-storage');
const { ObjectId } = require('mongodb');

class TwitterScraper {
    constructor() {
        this.browser = null;
        this.context = null;
        this.page = null;
        this.isLoggedIn = false;
        this.db = new TweetDatabase();
        this.tempStorage = new TempStorage();
        
        // Use Electron's app data directory
        this.appDir = path.join(app.getPath('userData'), 'twitter-scraper-data');
        this.sessionFile = path.join(this.appDir, 'twitter_session.json');
        this.userDataDir = path.join(this.appDir, 'chrome_user_data');
        
        // Initialize directories and database when constructed
        this.initializeDirectories();
        this.db.initialize();
        this.tempStorage.initialize();
        
        // Check authentication state on startup
        this.initializeAuthState();
    }

    async initializeAuthState() {
        try {
            // Check if session file exists
            try {
                await fs.access(this.sessionFile);
            } catch (error) {
                if (error.code === 'ENOENT') {
                    console.log('No session file found, user needs to authenticate');
                    return;
                }
            }

            // Initialize browser and check auth state
            if (await this.initializeBrowser()) {
                await this.page.goto('https://x.com/home');
                const isAuthenticated = await this.checkAuthenticationState();
                if (isAuthenticated) {
                    console.log('Successfully restored previous session');
                    this.isLoggedIn = true;
                } else {
                    console.log('Previous session invalid, user needs to re-authenticate');
                    await this.cleanup();
                }
            }
        } catch (error) {
            console.error('Error checking authentication state:', error);
            this.isLoggedIn = false;
            await this.cleanup();
        }
    }

    async initializeDirectories() {
        try {
            // Create necessary directories
            await fs.mkdir(this.appDir, { recursive: true });
            await fs.mkdir(this.userDataDir, { recursive: true });
            console.log('Directories initialized:', {
                appDir: this.appDir,
                sessionFile: this.sessionFile,
                userDataDir: this.userDataDir
            });
        } catch (error) {
            console.error('Error initializing directories:', error);
        }
    }

    async initializeBrowser() {
        if (this.browser) {
            return true;
        }

        try {
            console.log('Initializing browser...');
            this.browser = await chromium.launch({
                headless: false,
                args: [
                    '--disable-features=site-per-process',
                    '--disable-dev-shm-usage',
                    '--no-sandbox',
                    '--disable-setuid-sandbox'
                ]
            });

            // Create new context with storage state if available
            const storageState = await this.loadStorageState();
            this.context = await this.browser.newContext({
                viewport: { width: 1280, height: 800 },
                storageState
            });

            this.page = await this.context.newPage();
            console.log('Browser initialized successfully');
            return true;
        } catch (error) {
            console.error('Failed to initialize browser:', error);
            await this.cleanup();
            return false;
        }
    }

    async startAuth() {
        try {
            console.log('Starting authentication process...');
            
            // Initialize browser if not already initialized
            if (!await this.initializeBrowser()) {
                throw new Error('Failed to initialize browser');
            }

            await this.page.goto('https://x.com/home');
            const isStillValid = await this.checkAuthenticationState();

            if (isStillValid) {
                console.log('Already logged in, no need to re-authenticate');
                this.isLoggedIn = true;
                return true;
            }

            // Try to verify existing session first
            try {
                console.log('Attempting to verify existing session...');
                await this.page.goto('https://x.com/home', { 
                    waitUntil: 'networkidle',
                    timeout: 30000 
                });
                
                // Check if we're redirected to login page
                const currentUrl = await this.page.url();
                if (!currentUrl.includes('/login') && !currentUrl.includes('/i/flow/login')) {
                    // If we're still on home page, check for authenticated elements
                    const isAuthenticated = await this.checkAuthenticationState();
                    if (isAuthenticated) {
                        console.log('Successfully restored previous session');
                        this.isLoggedIn = true;
                        return true;
                    }
                }
            } catch (error) {
                console.log('Session verification failed:', error.message);
                // Don't throw here, continue with login flow
            }

            // If we get here, we need to do a fresh login
            console.log('Proceeding with new login flow...');
            await this.page.goto('https://x.com/i/flow/login', { waitUntil: 'networkidle' });
            const loginSuccess = await this.waitForLogin();
            
            if (loginSuccess) {
                console.log('Login successful, saving session...');
                await this.saveSession();
                this.isLoggedIn = true;
            } else {
                console.log('Login failed');
                await this.cleanup();
            }
            
            return loginSuccess;
        } catch (error) {
            console.error('Authentication error:', error);
            await this.cleanup();
            return false;
        }
    }

    async checkAuthenticationState() {
        try {
            // Wait for any of these elements that indicate we're logged in
            const authenticatedElements = [
                '[data-testid="primaryColumn"]',
                '[data-testid="tweetButtonInline"]',
                '[data-testid="AppTabBar"]',
                '[data-testid="SideNav_AccountSwitcher_Button"]'
            ];

            const elementPromises = authenticatedElements.map(selector =>
                this.page.waitForSelector(selector, { timeout: 5000 })
            );

            const element = await Promise.race(elementPromises).catch(() => null);
            return element !== null;
        } catch (error) {
            return false;
        }
    }

    async waitForLogin() {
        try {
            console.log('Waiting for login completion...');
            
            const timeout = 180000; // 3 minutes
            const startTime = Date.now();
            let lastUrl = '';
            let consecutiveHomeChecks = 0;
            
            while (Date.now() - startTime < timeout) {
                try {
                    // Check if page is still valid
                    if (!this.page || !this.context || !this.browser) {
                        throw new Error('Browser resources were closed');
                    }

                    const currentUrl = await this.page.url();
                    
                    // If URL hasn't changed since last check
                    if (currentUrl === lastUrl) {
                        // If we're on home page, check authentication state more frequently
                        if (currentUrl.match(/(twitter\.com|x\.com)\/home/)) {
                            const isAuthenticated = await this.checkAuthenticationState();
                            if (isAuthenticated) {
                                console.log('Login successful - detected authenticated state');
                                await this.page.waitForTimeout(1000);
                                return true;
                            }
                            consecutiveHomeChecks++;
                            if (consecutiveHomeChecks >= 5) {
                                console.log('On home page but not detecting auth elements after multiple checks');
                                return false;
                            }
                        }
                        await this.page.waitForTimeout(1000);
                        continue;
                    }
                    
                    lastUrl = currentUrl;
                    consecutiveHomeChecks = 0;
                    console.log('Current URL:', currentUrl);

                    // Check different page states
                    if (currentUrl.match(/(twitter\.com|x\.com)\/home/)) {
                        const isAuthenticated = await this.checkAuthenticationState();
                        if (isAuthenticated) {
                            console.log('Login successful - detected authenticated state');
                            await this.page.waitForTimeout(1000);
                            return true;
                        }
                        console.log('On home page, waiting for authentication elements...');
                    }
                    else if (currentUrl.match(/(twitter\.com|x\.com)\/i\/flow\/login/)) {
                        console.log('On login flow page...');
                    }
                    else if (currentUrl.match(/(twitter\.com|x\.com)\/i\/flow\/verify/)) {
                        console.log('On verification page, waiting for user input...');
                    }
                    else if (currentUrl.match(/(twitter\.com|x\.com)\/i\/flow\/check/)) {
                        console.log('On security check page, waiting for user input...');
                    }
                    else if (!currentUrl.match(/(twitter\.com|x\.com)\/(login|i\/flow\/login)/)) {
                        console.log('On intermediate page:', currentUrl);
                    }
                    
                    await this.page.waitForTimeout(1000);
                } catch (error) {
                    if (error.message.includes('Target page, context or browser has been closed')) {
                        throw error; // Re-throw this specific error to handle it in the outer try-catch
                    }
                    console.log('Error during login check:', error.message);
                    await this.page.waitForTimeout(1000);
                }
            }
            
            throw new Error('Login timeout - waited too long for login completion');
        } catch (error) {
            console.error('Login failed:', error.message);
            return false;
        }
    }

    async loadStorageState() {
        try {
            const data = await fs.readFile(this.sessionFile, 'utf8');
            console.log('Found existing session file');
            return JSON.parse(data);
        } catch (error) {
            if (error.code !== 'ENOENT') {
                console.error('Error loading storage state:', error);
            } else {
                console.log('No existing session file found');
            }
            return {};
        }
    }

    async saveSession() {
        try {
            if (!this.context) {
                throw new Error('No active browser context to save session from');
            }

            // Get the storage state from the current context
            const storage = await this.context.storageState();
            
            // Save the session state
            await fs.writeFile(this.sessionFile, JSON.stringify(storage, null, 2));
            console.log('Session saved successfully to:', this.sessionFile);
            return true;
        } catch (error) {
            console.error('Failed to save session:', error);
            return false;
        }
    }

    async scrapeProfile(username, limit = 10) {
        if (!this.isLoggedIn) {
            throw new Error('Not logged in to Twitter');
        }

        let sessionId;
        try {
            console.log('\n=== Starting Profile Scrape ===');
            console.log('Username:', username);
            
            // Start a scraping session
            sessionId = await this.db.startScrapingSession('profile', username);
            console.log('Session ID:', sessionId);

            await this.page.goto(`https://x.com/${username}`);
            
            // Wait for profile information to load
            await this.page.waitForSelector('div[data-testid="primaryColumn"]');

            // Extract profile information
            const profile = await this.extractProfileInfo();
            console.log('Extracted profile:', JSON.stringify(profile, null, 2));

            // Extract tweets
            console.log('\n=== Extracting Tweets ===');
            const tweets = await this.extractTweets(limit);
            console.log(`Extracted ${tweets.length} tweets`);

            // Save to temporary storage first
            console.log('\n=== Saving to Temporary Storage ===');
            const tempFilePath = await this.tempStorage.saveTempData(sessionId, {
                type: 'profile',
                target: username,
                profile,
                tweets
            });
            console.log('Temporary file saved at:', tempFilePath);

            // Save profile information
            console.log('\n=== Saving Profile Information ===');
            await this.db.saveProfile({
                handle: username,
                name: profile.name,
                bio: profile.bio,
                followers_count: parseInt(profile.followers) || 0,
                following_count: parseInt(profile.following) || 0,
                tweets_count: parseInt(profile.tweets) || 0
            }, sessionId);

            // Save tweets with tracking
            console.log('\n=== Saving Tweets ===');
            const results = {
                total: tweets.length,
                success: 0,
                failed: 0,
                savedTweets: []
            };

            for (const tweet of tweets) {
                try {
                    console.log(`\nSaving tweet: ${tweet.url}`);
                    await this.db.saveTweet(tweet, sessionId);
                    results.success++;
                    results.savedTweets.push(tweet.url);
                    console.log('Tweet saved successfully');
                } catch (error) {
                    console.error('Failed to save tweet:', error.message);
                    results.failed++;
                }
            }

            // Verify database updates
            console.log('\n=== Verifying Database Updates ===');
            const dbTweets = await this.db.getTweetsBySession(sessionId);
            console.log('Database verification results:');
            console.log('- Expected tweets:', results.success);
            console.log('- Found tweets:', dbTweets.length);

            // Complete the scraping session
            console.log('\n=== Completing Profile Scrape ===');
            const isSuccessful = results.success > 0;
            
            if (isSuccessful) {
                console.log('Scraping completed successfully, cleaning up temp file');
                await this.tempStorage.deleteTempData(sessionId);
                await this.db.completeScrapingSession(sessionId, results.success, 'completed');
            } else {
                console.log('Scraping had issues, keeping temp file for recovery');
                await this.db.completeScrapingSession(sessionId, results.success, 'incomplete');
            }

            console.log('Profile scrape results:', {
                total: results.total,
                saved: results.success,
                failed: results.failed,
                status: isSuccessful ? 'completed' : 'incomplete'
            });

            return {
                profile,
                tweets: tweets.slice(0, results.success),
                sessionId,
                status: isSuccessful ? 'completed' : 'incomplete'
            };
        } catch (error) {
            console.error('\n=== Profile Scrape Failed ===');
            console.error('Error:', error.message);
            if (sessionId) {
                await this.db.completeScrapingSession(sessionId, 0, 'failed');
                console.log('Session marked as failed');
            }
            throw error;
        }
    }

    async scrapeTweets(query, limit = 10) {
        if (!this.isLoggedIn) {
            throw new Error('Not logged in to Twitter');
        }

        let sessionId;
        try {
            console.log('\n=== Starting Search Scrape ===');
            console.log('Query:', query);
            
            // Start a scraping session
            sessionId = await this.db.startScrapingSession('search', query);
            console.log('Session ID:', sessionId);
            
            await this.page.goto(`https://x.com/search?q=${encodeURIComponent(query)}&f=live`);
            
            // Extract tweets
            console.log('\n=== Extracting Tweets ===');
            const tweets = await this.extractTweets(limit);
            console.log(`Extracted ${tweets.length} tweets`);

            // Save to temporary storage first
            console.log('\n=== Saving to Temporary Storage ===');
            const tempFilePath = await this.tempStorage.saveTempData(sessionId, {
                type: 'search',
                target: query,
                tweets
            });
            console.log('Temporary file saved at:', tempFilePath);

            // Save tweets with tracking
            console.log('\n=== Saving Tweets ===');
            const results = {
                total: tweets.length,
                success: 0,
                failed: 0
            };

            for (const tweet of tweets) {
                try {
                    console.log(`\nSaving tweet: ${tweet.url}`);
                    await this.db.saveTweet(tweet, sessionId);
                    results.success++;
                    console.log('Tweet saved successfully');
                } catch (error) {
                    console.error('Failed to save tweet:', error.message);
                    results.failed++;
                }
            }

            // Verify database update and cleanup temp file
            console.log('\n=== Verifying Database Update ===');
            const dbTweets = await this.db.getTweetsBySession(sessionId);
            console.log('Database verification results:');
            console.log('- Expected tweets:', results.success);
            console.log('- Found tweets:', dbTweets.length);

            // Complete the scraping session
            console.log('\n=== Completing Search Scrape ===');
            const isSuccessful = results.success > 0;
            
            if (isSuccessful) {
                console.log('Scraping completed successfully, cleaning up temp file');
                await this.tempStorage.deleteTempData(sessionId);
                await this.db.completeScrapingSession(sessionId, results.success, 'completed');
            } else {
                console.log('Scraping had issues, keeping temp file for recovery');
                await this.db.completeScrapingSession(sessionId, results.success, 'incomplete');
            }

            console.log('Search scrape results:', {
                total: results.total,
                saved: results.success,
                failed: results.failed,
                status: isSuccessful ? 'completed' : 'incomplete'
            });

            return {
                tweets: tweets.slice(0, results.success),
                sessionId,
                status: isSuccessful ? 'completed' : 'incomplete'
            };
        } catch (error) {
            console.error('\n=== Search Scrape Failed ===');
            console.error('Error:', error.message);
            if (sessionId) {
                await this.db.completeScrapingSession(sessionId, 0, 'failed');
                console.log('Session marked as failed');
            }
            throw error;
        }
    }

    async scrapeHomeTimeline(targetTweetCount = 100) {
        if (!this.isLoggedIn) {
            throw new Error('Not logged in to Twitter');
        }

        let sessionId;
        try {
            console.log('\n=== Starting Home Timeline Scrape ===');
            
            // Start a scraping session
            sessionId = await this.db.startScrapingSession('home', 'timeline');
            console.log('Session ID:', sessionId);

            await this.page.goto('https://x.com/home');
            console.log('Navigated to home timeline');

            // Extract tweets using the comprehensive extraction method
            console.log('\n=== Extracting Tweets ===');
            const tweets = await this.extractTweets(targetTweetCount);
            console.log(`Extracted ${tweets.length} unique tweets`);

            // Save to temporary storage
            console.log('\n=== Saving to Temporary Storage ===');
            const tempFilePath = await this.tempStorage.saveTempData(sessionId, {
                type: 'home',
                target: 'timeline',
                tweets
            });
            console.log('Temporary file saved at:', tempFilePath);

            // Save tweets with tracking
            console.log('\n=== Saving Tweets ===');
            const results = {
                total: tweets.length,
                success: 0,
                failed: 0
            };

            for (const tweet of tweets) {
                try {
                    console.log(`\nSaving tweet: ${tweet.url}`);
                    await this.db.saveTweet(tweet, sessionId);
                    results.success++;
                    console.log('Tweet saved successfully');
                } catch (error) {
                    console.error('Failed to save tweet:', error.message);
                    results.failed++;
                }
            }

            // Verify database updates
            console.log('\n=== Verifying Database Updates ===');
            const dbTweets = await this.db.getTweetsBySession(sessionId);
            console.log('Database verification results:');
            console.log('- Expected tweets:', results.success);
            console.log('- Found tweets:', dbTweets.length);

            // Complete the scraping session
            console.log('\n=== Completing Home Timeline Scrape ===');
            const isSuccessful = results.success > 0;
            
            if (isSuccessful) {
                console.log('Scraping completed successfully, cleaning up temp file');
                await this.tempStorage.deleteTempData(sessionId);
                await this.db.completeScrapingSession(sessionId, results.success, 'completed');
            } else {
                console.log('Scraping had issues, keeping temp file for recovery');
                await this.db.completeScrapingSession(sessionId, results.success, 'incomplete');
            }

            console.log('Home timeline scrape results:', {
                total: results.total,
                saved: results.success,
                failed: results.failed,
                status: isSuccessful ? 'completed' : 'incomplete'
            });

            return {
                sessionId,
                tweetsFound: results.success,
                failed: results.failed,
                status: isSuccessful ? 'completed' : 'incomplete'
            };
        } catch (error) {
            console.error('\n=== Home Timeline Scrape Failed ===');
            console.error('Error:', error.message);
            if (sessionId) {
                await this.db.completeScrapingSession(sessionId, 0, 'failed');
                console.log('Session marked as failed');
            }
            throw error;
        }
    }

    async extractProfileInfo() {
        try {
            return await this.page.evaluate(() => {
                const getTextContent = (selector) => {
                    const element = document.querySelector(selector);
                    return element ? element.textContent.trim() : '';
                };

                // Get follower and following counts
                const statsElements = document.querySelectorAll('a[href*="/following"], a[href*="/followers"], a[href*="/verified_followers"]');
                const stats = {};
                statsElements.forEach(element => {
                    const text = element.textContent.trim();
                    if (element.href.includes('/following')) {
                        stats.following = text;
                    } else if (element.href.includes('/followers') || element.href.includes('/verified_followers')) {
                        stats.followers = text;
                    }
                });

                // Get tweet count
                const tweetsElement = document.querySelector('div[aria-label*="tweets"]');
                const tweetsCount = tweetsElement ? tweetsElement.getAttribute('aria-label').match(/\d+/)[0] : '0';

                return {
                    name: getTextContent('div[data-testid="primaryColumn"] h2[aria-level="1"]'),
                    handle: window.location.pathname.slice(1),
                    bio: getTextContent('div[data-testid="UserDescription"]'),
                    followers: stats.followers || '0',
                    following: stats.following || '0',
                    tweets: tweetsCount
                };
            });
        } catch (error) {
            console.error('Error extracting profile info:', error);
            return null;
        }
    }

    async extractTweets(targetCount, maxScrollAttempts = 500) {
        try {
            const uniqueTweets = new Map();
            let scrollAttempts = 0;
            let lastHeight = 0;
            let noNewTweetsCount = 0;

            console.log(`Attempting to extract ${targetCount} unique tweets...`);

            while (uniqueTweets.size < targetCount && scrollAttempts < maxScrollAttempts && noNewTweetsCount < 5) {
                // Extract tweets from current view
                const newTweets = await this.page.evaluate(() => {
                    return Array.from(document.querySelectorAll('article[data-testid="tweet"]')).map(tweet => {
                        // Extract user information
                        const userElement = tweet.querySelector('div[data-testid="User-Name"]');
                        const user = userElement ? {
                            name: userElement.querySelector('span')?.textContent || '',
                            handle: userElement.querySelector('a')?.href.split('/').pop() || ''
                        } : null;

                        // Extract tweet URL and ID first - we need these for uniqueness check
                        const linkElement = tweet.querySelector('a[role="link"][href*="/status/"]');
                        const tweetUrl = linkElement ? linkElement.href : '';
                        const tweetId = tweetUrl ? tweetUrl.split('/').pop() : null;

                        if (!tweetId) return null; // Skip invalid tweets

                        // Extract timestamp
                        const timeElement = tweet.querySelector('time');
                        const timestamp = timeElement ? timeElement.getAttribute('datetime') : '';

                        // Extract tweet content
                        const contentElement = tweet.querySelector('div[data-testid="tweetText"]');
                        const content = contentElement ? contentElement.textContent : '';

                        // Extract metrics
                        const metrics = {};
                        const metricMappings = {
                            'reply': 'replies',
                            'retweet': 'retweets',
                            'like': 'likes',
                            'analytics': 'views'
                        };
                        
                        Object.entries(metricMappings).forEach(([testId, metricName]) => {
                            const element = tweet.querySelector(`[data-testid="${testId}"]`);
                            const rawValue = element ? element.textContent.trim() : '0';
                            let value = rawValue.toLowerCase();
                            if (value.endsWith('k')) {
                                value = parseFloat(value.slice(0, -1)) * 1000;
                            } else if (value.endsWith('m')) {
                                value = parseFloat(value.slice(0, -1)) * 1000000;
                            } else {
                                value = parseInt(value.replace(/[^0-9]/g, '')) || 0;
                            }
                            metrics[metricName] = value;
                        });

                        return {
                            tweet_id: tweetId,
                            user,
                            timestamp,
                            content,
                            metrics,
                            url: tweetUrl,
                            saved_at: new Date().toISOString()
                        };
                    }).filter(tweet => tweet !== null); // Remove invalid tweets
                });

                // Track new unique tweets
                let newUniqueCount = 0;
                for (const tweet of newTweets) {
                    if (!uniqueTweets.has(tweet.tweet_id)) {
                        uniqueTweets.set(tweet.tweet_id, tweet);
                        newUniqueCount++;
                        console.log(`Found new unique tweet ${uniqueTweets.size}/${targetCount}: ${tweet.tweet_id}`);
                    }
                }

                // Check if we found any new tweets
                if (newUniqueCount === 0) {
                    noNewTweetsCount++;
                    console.log(`No new tweets found in attempt ${scrollAttempts + 1}. Consecutive attempts without new tweets: ${noNewTweetsCount}`);
                } else {
                    noNewTweetsCount = 0; // Reset counter when we find new tweets
                }

                // Get current scroll height
                const currentHeight = await this.page.evaluate('document.documentElement.scrollHeight');
                
                // If we haven't reached our target, scroll down with human-like behavior
                if (uniqueTweets.size < targetCount) {
                    // Generate random scroll amount (between 300 and 800 pixels)
                    const scrollAmount = Math.floor(Math.random() * 500) + 300;
                    
                    // Get current scroll position
                    const currentScroll = await this.page.evaluate('window.pageYOffset');
                    
                    // Scroll smoothly with random amount
                    await this.page.evaluate((amount) => {
                        window.scrollBy({
                            top: amount,
                            behavior: 'smooth'
                        });
                    }, scrollAmount);

                    // Random delay between 1.5 and 3.5 seconds to simulate human behavior
                    const delay = Math.floor(Math.random() * 2000) + 1500;
                    await this.page.waitForTimeout(delay);
                    
                    // Check if we're actually getting new content
                    if (currentHeight === lastHeight) {
                        noNewTweetsCount++;
                        console.log('No new content loaded after scroll');
                    }
                    
                    lastHeight = currentHeight;
                }

                scrollAttempts++;
                console.log(`Scroll attempt ${scrollAttempts}/${maxScrollAttempts}. Current unique tweets: ${uniqueTweets.size}/${targetCount}`);
            }

            // Convert Map to Array and slice to target count
            const tweets = Array.from(uniqueTweets.values()).slice(0, targetCount);
            
            console.log(`Tweet extraction complete. Found ${tweets.length} unique tweets out of ${targetCount} requested`);
            return tweets;
        } catch (error) {
            console.error('Error extracting tweets:', error);
            throw error;
        }
    }

    async cleanup(isLogout = false) {
        try {
            console.log('Cleaning up browser resources...');
            
            // If we're logged in and it's not a logout operation, save the session before cleanup
            if (this.isLoggedIn && !isLogout) {
                try {
                    console.log('Saving session before cleanup...');
                    await this.saveSession();
                } catch (error) {
                    console.error('Error saving session during cleanup:', error);
                }
            }
            
            if (this.page) {
                await this.page.close();
                this.page = null;
            }
            
            if (this.context) {
                await this.context.close();
                this.context = null;
            }
            
            if (this.browser) {
                await this.browser.close();
                this.browser = null;
            }

            // Only delete the session file if this is an explicit logout
            if (isLogout) {
                try {
                    await fs.unlink(this.sessionFile);
                    console.log('Session file deleted during logout');
                } catch (error) {
                    if (error.code !== 'ENOENT') {
                        console.error('Error deleting session file:', error);
                    }
                }
                this.isLoggedIn = false;
            }

            console.log('Cleanup completed successfully');
        } catch (error) {
            console.error('Error during cleanup:', error);
            throw error;
        }
    }

    async clearSession() {
        try {
            console.log('Clearing Twitter session...');
            
            // Navigate to Twitter logout URL if we have an active page
            if (this.page && this.isLoggedIn) {
                try {
                    await this.page.goto('https://x.com/logout');
                    await this.page.waitForTimeout(1000); // Give some time for logout to process
                } catch (error) {
                    console.log('Could not navigate to logout page:', error.message);
                }
            }
            
            // Perform full cleanup with session deletion
            await this.cleanup(true);
            
            // Reset the login state
            this.isLoggedIn = false;
            
            console.log('Twitter session cleared successfully');
            return true;
        } catch (error) {
            console.error('Error clearing Twitter session:', error);
            return false;
        }
    }

    async saveTweets(tweets, type, target) {
        try {
            console.log('=== Starting Tweet Storage Process ===');
            console.log(`Type: ${type}`);
            console.log(`Target: ${target}`);
            console.log(`Total tweets to save: ${tweets.length}`);
            
            // Start a new scraping session
            const sessionId = await this.db.startScrapingSession(type, target);
            console.log(`Created scraping session with ID: ${sessionId}`);

            // If this is a profile scrape, save the profile information first
            if (type === 'profile' && tweets.length > 0) {
                console.log('Profile scrape detected, saving profile information...');
                const firstTweet = tweets[0];
                const profile = {
                    handle: target,
                    name: firstTweet.user.name,
                    bio: firstTweet.user.bio || '',
                    followers_count: firstTweet.user.followers_count,
                    following_count: firstTweet.user.following_count,
                    tweets_count: firstTweet.user.tweets_count
                };
                console.log('Profile data:', JSON.stringify(profile, null, 2));
                await this.db.saveProfile(profile);
            }

            // Save each tweet
            console.log('Starting to save individual tweets...');
            let savedCount = 0;
            let errorCount = 0;
            
            for (let i = 0; i < tweets.length; i++) {
                const tweet = tweets[i];
                try {
                    console.log(`\nProcessing tweet ${i + 1}/${tweets.length}`);
                    console.log(`URL: ${tweet.url}`);
                    await this.db.saveTweet(tweet, sessionId);
                    savedCount++;
                    console.log(`Successfully saved tweet ${i + 1}`);
                } catch (error) {
                    errorCount++;
                    console.error(`Failed to save tweet ${i + 1}:`, error.message);
                }
            }

            // Complete the scraping session
            const status = savedCount > 0 ? 'completed' : 'failed';
            console.log('\n=== Completing Storage Process ===');
            console.log(`Total tweets processed: ${tweets.length}`);
            console.log(`Successfully saved: ${savedCount}`);
            console.log(`Failed to save: ${errorCount}`);
            console.log(`Final status: ${status}`);

            await this.db.completeScrapingSession(
                sessionId,
                savedCount,
                status
            );

            console.log('=== Storage Process Complete ===');
            return {
                success: true,
                sessionId,
                savedCount,
                errorCount,
                status
            };
        } catch (error) {
            console.error('=== Storage Process Failed ===');
            console.error('Error:', error.message);
            console.error('Stack:', error.stack);
            throw error;
        }
    }
}

module.exports = TwitterScraper; 