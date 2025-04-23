const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const Logger = require('./logger');

class APIServer {
    constructor(scraper) {
        this.scraper = scraper;
        this.app = express();
        this.server = null;
        this.port = process.env.API_PORT || 3000;
        this.isDelegationEnabled = false;
        this.logger = new Logger({ filePrefix: 'api-audit' });

        // Initialize logger
        this.logger.initialize().then(() => {
            this.logger.info('API Server logger initialized');
        }).catch(err => {
            console.error('Failed to initialize API Server logger:', err);
        });

        // Middleware
        this.app.use(cors());
        this.app.use(express.json());
        
        // Request audit logging middleware
        this.app.use((req, res, next) => {
            // Record the start time
            req.startTime = Date.now();

            // Store logger reference for access in the closure
            const logger = this.logger;

            // Capture the original send method
            const originalSend = res.send;
            
            // Override the send method to capture response
            res.send = function(body) {
                // Restore the original send method to avoid infinite loops
                res.send = originalSend;
                
                // Calculate response time
                const responseTime = Date.now() - req.startTime;
                
                // Log the request and response details
                try {
                    let responseData = body;
                    if (typeof body === 'string') {
                        try {
                            responseData = JSON.parse(body);
                        } catch (e) {
                            // Not JSON, keep as string
                            responseData = body.substring(0, 100) + (body.length > 100 ? '...' : '');
                        }
                    }
                    
                    // Use the stored logger reference instead of this.logger
                    logger.logApiRequest(req, res, responseTime, responseData);
                } catch (error) {
                    console.error('Error in API audit logging:', error);
                }
                
                // Call the original send method
                return originalSend.call(this, body);
            };
            
            next();
        });

        // API Documentation endpoint
        this.app.get('/api/docs', (req, res) => {
            res.json({
                endpoints: {
                    '/api/status': {
                        method: 'GET',
                        description: 'Get current scraper status'
                    },
                    '/api/delegation/status': {
                        method: 'GET',
                        description: 'Get API delegation status'
                    },
                    '/api/delegation/enable': {
                        method: 'POST',
                        description: 'Enable API delegation'
                    },
                    '/api/delegation/disable': {
                        method: 'POST',
                        description: 'Disable API delegation'
                    },
                    '/api/auth/twitter/start': {
                        method: 'POST',
                        description: 'Start Twitter authentication process'
                    },
                    '/api/scrape/tweets': {
                        method: 'POST',
                        description: 'Search and scrape tweets',
                        body: {
                            query: 'Search query string',
                            limit: 'Number of tweets to fetch (default: 10, max: 500)',
                            publicKey: '(Optional) RSA public key for response encryption'
                        }
                    },
                    '/api/scrape/profile': {
                        method: 'POST',
                        description: 'Scrape user profile and tweets',
                        body: {
                            username: 'Twitter username (without @)',
                            limit: 'Number of tweets to fetch (default: 10, max: 500)',
                            publicKey: '(Optional) RSA public key for response encryption'
                        }
                    },
                    '/api/scrape/home': {
                        method: 'POST',
                        description: 'Scrape home timeline tweets',
                        body: {
                            limit: 'Number of tweets to fetch (default: 10, max: 500)',
                            publicKey: '(Optional) RSA public key for response encryption'
                        }
                    }
                }
            });
        });

        // Status endpoint
        this.app.get('/api/status', (req, res) => {
            try {
                const status = this.scraper.isLoggedIn ? 'ready' : 'not_ready';
                const message = this.scraper.isLoggedIn ? 'Ready to scrape' : 'Twitter authentication required';
                res.json({ 
                    status, 
                    message,
                    delegation: {
                        enabled: this.isDelegationEnabled,
                        port: this.port
                    }
                });
            } catch (error) {
                console.error('Status check error:', error);
                res.status(500).json({ error: 'Failed to check status' });
            }
        });

        // Delegation status endpoint
        this.app.get('/api/delegation/status', (req, res) => {
            res.json({
                enabled: this.isDelegationEnabled,
                port: this.port
            });
        });

        // Enable delegation endpoint
        this.app.post('/api/delegation/enable', (req, res) => {
            this.isDelegationEnabled = true;
            res.json({
                status: 'success',
                message: 'API delegation enabled',
                port: this.port
            });
        });

        // Disable delegation endpoint
        this.app.post('/api/delegation/disable', (req, res) => {
            this.isDelegationEnabled = false;
            res.json({
                status: 'success',
                message: 'API delegation disabled'
            });
        });

        // Authentication endpoint
        this.app.post('/api/auth/twitter/start', async (req, res) => {
            try {
                const success = await this.scraper.startAuth();
                if (!success) {
                    return res.status(500).json({ error: 'Failed to start Twitter authentication' });
                }
                res.json({ status: 'success', message: 'Authentication successful' });
            } catch (error) {
                console.error('Authentication error:', error);
                res.status(500).json({ error: 'Authentication failed: ' + error.message });
            }
        });

        // Tweet search endpoint
        this.app.post('/api/scrape/tweets', async (req, res) => {
            try {
                if (!this.scraper.isLoggedIn) {
                    this.logger.warn('API attempt without login', { endpoint: '/api/scrape/tweets', ip: req.ip });
                    return res.status(403).json({ error: 'Not logged in to Twitter' });
                }

                if (!this.isDelegationEnabled) {
                    this.logger.warn('API attempt without delegation', { endpoint: '/api/scrape/tweets', ip: req.ip });
                    return res.status(403).json({ error: 'API delegation is not enabled' });
                }

                const { query, limit = 10, publicKey } = req.body;
                if (!query) {
                    this.logger.warn('API request missing query', { endpoint: '/api/scrape/tweets', ip: req.ip });
                    return res.status(400).json({ error: 'Query parameter is required' });
                }

                // Log start of scraping operation
                this.logger.info('Starting tweet scrape', { 
                    endpoint: '/api/scrape/tweets',
                    query,
                    limit: Math.min(parseInt(limit) || 10, 500),
                    hasPublicKey: !!publicKey,
                    ip: req.ip
                });

                // Enforce tweet limit
                const tweetLimit = Math.min(parseInt(limit) || 10, 500);
                
                // Perform the scraping operation
                const scrapingResult = await this.scraper.scrapeTweets(query, tweetLimit, 'api');
                const tweets = await this.scraper.getTweetsBySession(scrapingResult.sessionId,'api');
                
                // Log successful scrape
                this.logger.info('Tweet scrape completed', {
                    endpoint: '/api/scrape/tweets',
                    query,
                    tweetsFound: tweets ? tweets.length : 0,
                    sessionId: scrapingResult.sessionId
                });
            
                
                if (publicKey) {
                    try {
                        
                        // Return encrypted response
                        const encryptedData = this.encryptData(tweets, publicKey);
                        res.json({ 
                            status: 'success', 
                            encrypted: true,
                            data: encryptedData
                        });
                    } catch (error) {
                        this.logger.error('Encryption error', {
                            endpoint: '/api/scrape/tweets',
                            query,
                            error: error.message
                        });
                        return res.status(400).json({ error: 'Invalid public key or encryption error' });
                    }
                } else {
                    res.json({ 
                        status: 'success', 
                        tweets: tweets
                    });
                }
            } catch (error) {
                this.logger.error('Tweet scraping error', {
                    endpoint: '/api/scrape/tweets',
                    error: error.message,
                    stack: error.stack
                });
                console.error('Tweet scraping error:', error);
                res.status(500).json({ error: 'Failed to scrape tweets: ' + error.message });
            }
        });

        // Profile scraping endpoint
        this.app.post('/api/scrape/profile', async (req, res) => {
            try {
                if (!this.scraper.isLoggedIn) {
                    this.logger.warn('API attempt without login', { endpoint: '/api/scrape/profile', ip: req.ip });
                    return res.status(403).json({ error: 'Not logged in to Twitter' });
                }

                if (!this.isDelegationEnabled) {
                    this.logger.warn('API attempt without delegation', { endpoint: '/api/scrape/profile', ip: req.ip });
                    return res.status(403).json({ error: 'API delegation is not enabled' });
                }

                const { username, limit = 10, publicKey } = req.body;
                if (!username) {
                    this.logger.warn('API request missing username', { endpoint: '/api/scrape/profile', ip: req.ip });
                    return res.status(400).json({ error: 'Username parameter is required' });
                }

                // Log start of scraping operation
                this.logger.info('Starting profile scrape', { 
                    endpoint: '/api/scrape/profile',
                    username,
                    limit: Math.min(parseInt(limit) || 10, 500),
                    hasPublicKey: !!publicKey,
                    ip: req.ip
                });

                // Enforce tweet limit
                const tweetLimit = Math.min(parseInt(limit) || 10, 500);
                
                // Perform the scraping operation
                const scrapingResult = await this.scraper.scrapeProfile(username, tweetLimit,'api');
                const tweets = await this.scraper.getTweetsBySession(scrapingResult.sessionId,'api');
                
                // Get profile info if available
                const profileInfo = scrapingResult.profile || await this.scraper.extractProfileInfo();
                
                // Log successful scrape
                this.logger.info('Profile scrape completed', {
                    endpoint: '/api/scrape/profile',
                    username,
                    tweetsFound: tweets ? tweets.length : 0,
                    hasProfileInfo: !!profileInfo,
                    sessionId: scrapingResult.sessionId
                });
                
                // Format the full response data
                const responseData = {
                    profile: profileInfo,
                    tweets: tweets
                };
                
                // Mark that this request came from the API
                const source = 'api';
                
                if (publicKey) {
                    try {
                        // Save tweets with encryption info to indicate it's from API
                        await this.scraper.saveTweets(tweets, 'profile', username, source, publicKey);
                        
                        // Return encrypted response
                        const encryptedData = this.encryptData(responseData, publicKey);
                        res.json({ 
                            status: 'success', 
                            encrypted: true,
                            data: encryptedData
                        });
                    } catch (error) {
                        this.logger.error('Encryption error', {
                            endpoint: '/api/scrape/profile',
                            username,
                            error: error.message
                        });
                        return res.status(400).json({ error: 'Invalid public key or encryption error' });
                    }
                } else {
                    // Save tweets with source info but no encryption
                    //await this.scraper.saveTweets(tweets, 'profile', username, source);
                    res.json({ 
                        status: 'success', 
                        data: responseData
                    });
                }
            } catch (error) {
                this.logger.error('Profile scraping error', {
                    endpoint: '/api/scrape/profile',
                    error: error.message,
                    stack: error.stack
                });
                console.error('Profile scraping error:', error);
                res.status(500).json({ error: 'Failed to scrape profile: ' + error.message });
            }
        });

        // Home timeline endpoint
        this.app.post('/api/scrape/home', async (req, res) => {
            try {
                if (!this.scraper.isLoggedIn) {
                    this.logger.warn('API attempt without login', { endpoint: '/api/scrape/home', ip: req.ip });
                    return res.status(403).json({ error: 'Not logged in to Twitter' });
                }

                if (!this.isDelegationEnabled) {
                    this.logger.warn('API attempt without delegation', { endpoint: '/api/scrape/home', ip: req.ip });
                    return res.status(403).json({ error: 'API delegation is not enabled' });
                }

                const { limit = 10, publicKey } = req.body;
                
                // Log start of scraping operation
                this.logger.info('Starting home timeline scrape', { 
                    endpoint: '/api/scrape/home',
                    limit: Math.min(parseInt(limit) || 10, 500),
                    hasPublicKey: !!publicKey,
                    ip: req.ip
                });

                // Enforce tweet limit
                const tweetLimit = Math.min(parseInt(limit) || 10, 500);
                
                // Perform the scraping operation
                const scrapingResult = await this.scraper.scrapeHomeTimeline(tweetLimit, 'api');
                const tweets = await this.scraper.getTweetsBySession(scrapingResult.sessionId, 'api');
                
                // Log successful scrape
                this.logger.info('Home timeline scrape completed', {
                    endpoint: '/api/scrape/home',
                    tweetsFound: tweets ? tweets.length : 0,
                    sessionId: scrapingResult.sessionId
                });
                
                // Mark that this request came from the API
                const source = 'api';
                
                if (publicKey) {
                    try {
                        // Save tweets with encryption info to indicate it's from API
                        await this.scraper.saveTweets(tweets, 'home', null, source, publicKey);
                        
                        // Return encrypted response
                        const encryptedData = this.encryptData(tweets, publicKey);
                        res.json({ 
                            status: 'success', 
                            encrypted: true,
                            data: encryptedData
                        });
                    } catch (error) {
                        this.logger.error('Encryption error', {
                            endpoint: '/api/scrape/home',
                            error: error.message
                        });
                        return res.status(400).json({ error: 'Invalid public key or encryption error' });
                    }
                } else {
                    // Save tweets with source info but no encryption
                    //await this.scraper.saveTweets(tweets, 'home', null, source);
                    res.json({ 
                        status: 'success', 
                        tweets: tweets
                    });
                }
            } catch (error) {
                this.logger.error('Home timeline scraping error', {
                    endpoint: '/api/scrape/home',
                    error: error.message,
                    stack: error.stack
                });
                console.error('Home timeline scraping error:', error);
                res.status(500).json({ error: 'Failed to scrape home timeline: ' + error.message });
            }
        });
    }
    
    // Method to encrypt data using the client's public key
    encryptData(data, publicKey) {
        try {
            // Convert data to JSON string
            const dataString = JSON.stringify(data);
            
            // Generate a random symmetric key for encrypting the actual data
            const symmetricKey = crypto.randomBytes(32); // 256 bits for AES-256
            const iv = crypto.randomBytes(16); // Initialization vector
            
            // Encrypt the data with the symmetric key
            const cipher = crypto.createCipheriv('aes-256-cbc', symmetricKey, iv);
            let encryptedData = cipher.update(dataString, 'utf8', 'base64');
            encryptedData += cipher.final('base64');
            
            // Encrypt the symmetric key with the client's public key
            const encryptedKey = crypto.publicEncrypt(
                {
                    key: publicKey,
                    padding: crypto.constants.RSA_PKCS1_OAEP_PADDING
                },
                symmetricKey
            );
            
            // Return all components needed for decryption
            return {
                encryptedData,
                encryptedKey: encryptedKey.toString('base64'),
                iv: iv.toString('base64')
            };
        } catch (error) {
            console.error('Encryption error:', error);
            throw new Error('Failed to encrypt data: ' + error.message);
        }
    }

    enableDelegation() {
        console.log('API server enableDelegation called');
        this.isDelegationEnabled = true;
        console.log('API delegation enabled, isDelegationEnabled =', this.isDelegationEnabled);
        return { enabled: true, port: this.port };
    }

    disableDelegation() {
        console.log('API server disableDelegation called');
        this.isDelegationEnabled = false;
        console.log('API delegation disabled, isDelegationEnabled =', this.isDelegationEnabled);
        return { enabled: false };
    }

    getDelegationStatus() {
        console.log('API server getDelegationStatus called, isDelegationEnabled =', this.isDelegationEnabled);
        return {
            enabled: this.isDelegationEnabled,
            port: this.port
        };
    }

    async start() {
        return new Promise((resolve, reject) => {
            try {
                this.server = this.app.listen(this.port, () => {
                    console.log(`API server running on port ${this.port}`);
                    this.logger.info('API server started', { port: this.port });
                    resolve(true);
                });
            } catch (error) {
                console.error('Failed to start API server:', error);
                this.logger.error('API server start failed', { error: error.message });
                reject(error);
            }
        });
    }

    async stop() {
        return new Promise((resolve, reject) => {
            if (this.server) {
                this.server.close((err) => {
                    if (err) {
                        console.error('Error stopping API server:', err);
                        this.logger.error('API server stop failed', { error: err.message });
                        reject(err);
                    } else {
                        console.log('API server stopped');
                        this.logger.info('API server stopped');
                        this.server = null;
                        resolve(true);
                    }
                });
            } else {
                console.log('API server not running');
                resolve(true);
            }
        });
    }
}

module.exports = APIServer; 