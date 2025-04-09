const path = require('path');
const { app } = require('electron');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const config = {
    mongodb: {
        uri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017',
        dbName: process.env.MONGODB_DB_NAME || 'twitter_scraper',
        options: {
            connectTimeoutMS: parseInt(process.env.MONGODB_CONNECT_TIMEOUT_MS) || 5000,
            socketTimeoutMS: parseInt(process.env.MONGODB_SOCKET_TIMEOUT_MS) || 30000,
            maxPoolSize: parseInt(process.env.MONGODB_MAX_POOL_SIZE) || 10,
            retryWrites: process.env.MONGODB_RETRY_WRITES !== 'false',
            retryReads: process.env.MONGODB_RETRY_READS !== 'false'
        }
    },
    collections: {
        PROFILES: process.env.COLLECTION_PROFILES || 'twitter_profiles',
        TWEETS: process.env.COLLECTION_TWEETS || 'tweets',
        SESSIONS: process.env.COLLECTION_SESSIONS || 'scraping_sessions'
    },
    storage: {
        tempDir: process.env.TEMP_STORAGE_PATH || path.join(app.getPath('userData'), 'temp'),
        localDataDir: process.env.LOCAL_DATA_PATH || path.join(app.getPath('userData'), 'local_data')
    },
    preferences: {
        shareData: process.env.SHARE_DATA === 'true' // Default to false if not specified
    }
};

module.exports = config; 