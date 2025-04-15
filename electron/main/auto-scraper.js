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

    async start(interval = 3600000, type = 'home') {
        if (this.isRunning) {
            throw new Error('Auto-scraping is already running');
        }

        this.isRunning = true;
        this.interval = interval;
        this.scrapeType = type;
        this.emit('started', { interval, type });
        // Set up the interval for cycles
        this.currentCycle = setInterval(async () => {
            await this.runCycle(this.scrapeType);
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

    async runCycle(type='home') {
        let data;
        try {
            this.emit('cycleStarted');
 
            if(type === 'home') {
                data = await this.scraper.scrapeHomeTimeline(50);
                this.emit('home timeline scraped', { 
                    type: type, 
                    session_id: data.sessionId,
                    status: data.status,
                    tweetCount: data.tweetsFound
                });
            }
            else if(type === 'profile') {
                const profiles = await this.getProfiles();
                for (const profile of profiles) {
                    data = await this.scraper.scrapeProfile(profile.target, 50);
                    await this.updateProfileLastScraped(profile.type, profile.target);
                    this.emit('home timeline scraped', { 
                        type: type, 
                        profile_id: profile.target,
                        target: "Profile",
                        tweetCount: data.tweetsFound
                    });
                }
            }
            else{
                this.emit('QueryScrape', { type: type, target: "Query" });
                data = await this.scraper.scrapeTweets(type, 50);
                this.emit('QueryScrape', { type: type, target: "Query", tweetCount: data.tweets.length });
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