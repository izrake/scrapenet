const express = require('express');
const cors = require('cors');

class APIServer {
    constructor(scraper) {
        this.scraper = scraper;
        this.app = express();
        this.server = null;
        this.port = process.env.API_PORT || 3000;

        // Middleware
        this.app.use(cors());
        this.app.use(express.json());

        // API Documentation endpoint
        this.app.get('/api/docs', (req, res) => {
            res.json({
                endpoints: {
                    '/api/status': {
                        method: 'GET',
                        description: 'Get current scraper status'
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
                            limit: 'Number of tweets to fetch (default: 10)'
                        }
                    },
                    '/api/scrape/profile': {
                        method: 'POST',
                        description: 'Scrape user profile and tweets',
                        body: {
                            username: 'Twitter username (without @)',
                            limit: 'Number of tweets to fetch (default: 10)'
                        }
                    },
                    '/api/scrape/home': {
                        method: 'POST',
                        description: 'Scrape home timeline tweets',
                        body: {
                            limit: 'Number of tweets to fetch (default: 10)'
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
                res.json({ status, message });
            } catch (error) {
                console.error('Status check error:', error);
                res.status(500).json({ error: 'Failed to check status' });
            }
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
                    return res.status(403).json({ error: 'Not logged in to Twitter' });
                }

                const { query, limit = 10 } = req.body;
                if (!query) {
                    return res.status(400).json({ error: 'Query parameter is required' });
                }

                const tweets = await this.scraper.scrapeTweets(query, limit);
                res.json({ status: 'success', tweets });
            } catch (error) {
                console.error('Tweet scraping error:', error);
                res.status(500).json({ error: 'Failed to scrape tweets: ' + error.message });
            }
        });

        // Profile scraping endpoint
        this.app.post('/api/scrape/profile', async (req, res) => {
            try {
                if (!this.scraper.isLoggedIn) {
                    return res.status(403).json({ error: 'Not logged in to Twitter' });
                }

                const { username, limit = 10 } = req.body;
                if (!username) {
                    return res.status(400).json({ error: 'Username parameter is required' });
                }

                const data = await this.scraper.scrapeProfile(username, limit);
                res.json({ status: 'success', data });
            } catch (error) {
                console.error('Profile scraping error:', error);
                res.status(500).json({ error: 'Failed to scrape profile: ' + error.message });
            }
        });

        // Home timeline endpoint
        this.app.post('/api/scrape/home', async (req, res) => {
            try {
                if (!this.scraper.isLoggedIn) {
                    return res.status(403).json({ error: 'Not logged in to Twitter' });
                }

                const { limit = 10 } = req.body;
                const tweets = await this.scraper.scrapeHomeTimeline(limit);
                res.json({ status: 'success', tweets });
            } catch (error) {
                console.error('Home timeline scraping error:', error);
                res.status(500).json({ error: 'Failed to scrape home timeline: ' + error.message });
            }
        });
    }

    async start() {
        return new Promise((resolve, reject) => {
            try {
                this.server = this.app.listen(this.port, () => {
                    console.log(`API server running on port ${this.port}`);
                    resolve();
                });
            } catch (error) {
                console.error('Failed to start API server:', error);
                reject(error);
            }
        });
    }

    async stop() {
        return new Promise((resolve, reject) => {
            if (this.server) {
                this.server.close((error) => {
                    if (error) {
                        console.error('Error stopping API server:', error);
                        reject(error);
                    } else {
                        console.log('API server stopped');
                        resolve();
                    }
                });
            } else {
                resolve();
            }
        });
    }
}

module.exports = APIServer; 