const { EventEmitter } = require('events');
const fs = require('fs').promises;
const path = require('path');

class AutoScraper extends EventEmitter {
    constructor(scraper, db) {
        super();
        this.scraper = scraper;
        this.db = db;
        this.interval = null;
        this.isRunning = false;
        this.currentCycle = null;
        this.profilesFile = path.join(this.db.localDataDir, 'auto_scraping_profiles.json');
    }

    async start(interval = 3600000) {
        if (this.isRunning) {
            throw new Error('Auto-scraping is already running');
        }

        this.isRunning = true;
        this.interval = interval;
        this.emit('started', { interval });

        // Set up the interval for cycles
        this.currentCycle = setInterval(async () => {
            await this.runCycle();
        }, interval);
    }

    async stop() {
        if (!this.isRunning) {
            throw new Error('Auto-scraping is not running');
        }

        if (this.currentCycle) {
            clearInterval(this.currentCycle);
            this.currentCycle = null;
        }

        this.isRunning = false;
        this.emit('stopped');
    }

    async runCycle() {
        try {
            this.emit('cycleStarted');
            const profiles = await this.getProfiles();
            
            for (const profile of profiles) {
                try {
                    this.emit('profileStarted', { type: profile.type, target: profile.target });
                    
                    let data;
                    if (profile.type === 'profile') {
                        data = await this.scraper.scrapeProfile(profile.target, 50);
                    } else if (profile.type === 'home') {
                        data = await this.scraper.scrapeHomeTimeline(50);
                    }

                    // Save the scraped data
                    for (const tweet of data.tweets) {
                        await this.db.saveTweet(tweet, data.sessionId);
                    }

                    // Update last scraped timestamp
                    await this.updateProfileLastScraped(profile.type, profile.target);
                    
                    this.emit('profileCompleted', { 
                        type: profile.type, 
                        target: profile.target,
                        tweetCount: data.tweets.length
                    });
                } catch (error) {
                    console.error(`Error auto-scraping ${profile.type} ${profile.target}:`, error);
                    this.emit('profileError', { 
                        type: profile.type, 
                        target: profile.target,
                        error: error.message
                    });
                }
            }
            
            this.emit('cycleCompleted');
        } catch (error) {
            console.error('Error in auto-scraping cycle:', error);
            this.emit('cycleError', { error: error.message });
        }
    }

    async addProfile(type, target) {
        if (this.db.shareData) {
            const profiles = await this.db.getAutoScrapingProfiles();
            if (profiles.length >= 5) {
                throw new Error('Maximum number of auto-scraping profiles (5) reached');
            }
            await this.db.saveAutoScrapingProfile({ type, target });
        } else {
            const profiles = await this.getLocalProfiles();
            if (profiles.length >= 5) {
                throw new Error('Maximum number of auto-scraping profiles (5) reached');
            }
            
            // Add new profile
            profiles.push({
                type,
                target,
                is_active: true,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                last_scraped_at: null
            });
            
            await this.saveLocalProfiles(profiles);
        }
        
        this.emit('profileAdded', { type, target });
    }

    async removeProfile(type, target) {
        if (this.db.shareData) {
            await this.db.deleteAutoScrapingProfile(type, target);
        } else {
            const profiles = await this.getLocalProfiles();
            const updatedProfiles = profiles.filter(p => !(p.type === type && p.target === target));
            await this.saveLocalProfiles(updatedProfiles);
        }
        
        this.emit('profileRemoved', { type, target });
    }

    async getProfiles() {
        if (this.db.shareData) {
            return await this.db.getAutoScrapingProfiles();
        } else {
            return await this.getLocalProfiles();
        }
    }

    async updateProfileLastScraped(type, target) {
        if (this.db.shareData) {
            await this.db.updateAutoScrapingProfileLastScraped(type, target);
        } else {
            const profiles = await this.getLocalProfiles();
            const updatedProfiles = profiles.map(p => {
                if (p.type === type && p.target === target) {
                    return { ...p, last_scraped_at: new Date().toISOString() };
                }
                return p;
            });
            await this.saveLocalProfiles(updatedProfiles);
        }
    }

    async getLocalProfiles() {
        try {
            const data = await fs.readFile(this.profilesFile, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            if (error.code === 'ENOENT') {
                return [];
            }
            throw error;
        }
    }

    async saveLocalProfiles(profiles) {
        await fs.writeFile(this.profilesFile, JSON.stringify(profiles, null, 2));
    }

    isActive() {
        return this.isRunning;
    }

    getInterval() {
        return this.interval;
    }
}

module.exports = AutoScraper; 