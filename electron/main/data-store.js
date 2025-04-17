const { app } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const { ObjectId } = require('mongodb');

class DataStore {
    constructor() {
        this.dataDir = path.join(app.getPath('userData'), 'scraped-data');
        this.datasessionDir = path.join(app.getPath('userData'), 'local_data');
        this.dataFile = path.join(this.dataDir, 'tweets.json');
        this.data = {
            tweets: [],
            lastUpdated: null
        };
    }

    async initialize() {
        try {
            await fs.mkdir(this.dataDir, { recursive: true });

        } catch (error) {
            console.error('Error initializing data store:', error);
            throw error;
        }
    }

    async saveTweets(entry) {
        try {
            console.log('Saving new tweets entry:', entry.type);
            
            // Validate entry
            if (!entry || !entry.type || !entry.tweets) {
                throw new Error('Invalid tweet entry format');
            }

            // Add new entry to the beginning of the array
            this.data.tweets.unshift({
                ...entry,
                timestamp: entry.timestamp || new Date().toISOString()
            });
            
            this.data.lastUpdated = new Date().toISOString();

            // Keep only the last 100 entries to manage storage
       //     if (this.data.tweets.length > 100) {
       //         this.data.tweets = this.data.tweets.slice(0, 100);
       //     }

            // Save to file
            await fs.writeFile(this.dataFile, JSON.stringify(this.data, null, 2));
            console.log('Successfully saved tweets to:', this.dataFile);
            return true;
        } catch (error) {
            console.error('Error saving tweets:', error);
            throw error;
        }
    }

    async getAllScrapedData() {
        try {
            // Always read from file to ensure we have the latest data
            try {
                const fileContent = await fs.readFile(this.dataFile, 'utf-8');
                this.data = JSON.parse(fileContent);
                console.log('Refreshed data from file');
            } catch (error) {
                if (error.code === 'ENOENT') {
                    // File doesn't exist, initialize empty data
                    this.data = {
                        tweets: [],
                        lastUpdated: null
                    };
                    console.log('No data file found, initialized empty data');
                } else {
                    console.error('Error reading data file:', error);
                    throw error;
                }
            }
            return this.data;
        } catch (error) {
            console.error('Error getting stored tweets:', error);
            throw error;
        }
    }

    async clearData() {
        try {
            console.log('Clearing all stored tweets...');
            this.data = {
                tweets: [],
                lastUpdated: null
            };
            await fs.writeFile(this.dataFile, JSON.stringify(this.data, null, 2));
            console.log('Successfully cleared all stored tweets');
            return true;
        } catch (error) {
            console.error('Error clearing data:', error);
            throw error;
        }
    }

    async deleteSession(sessionId) {
        try {
            console.log('Deleting session from data store:', sessionId);
            
            // Construct the path to the session file
            const localSessionPath = path.join(this.datasessionDir, `session_${sessionId}.json`);
            
            try {
                // Delete the session file
                await fs.unlink(localSessionPath);
                console.log('Session file deleted from local storage:', localSessionPath);
            } catch (error) {
                if (error.code !== 'ENOENT') {
                    throw error;
                }
                console.log('Session file not found, might have been already deleted');
            }
            
            return { success: true };
        } catch (error) {
            console.error('Error deleting session:', error);
            throw error;
        }
    }
}

module.exports = DataStore; 