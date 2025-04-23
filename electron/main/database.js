const { MongoClient, ObjectId } = require('mongodb');
const config = require('./config');
const path = require('path');
const fs = require('fs');
const fsPromises = require('fs/promises');

const DEBUG = true;

function debugLog(...args) {
    if (DEBUG) {
        console.log('[DEBUG]', new Date().toISOString(), ...args);
    }
}

class TweetDatabase {
    constructor() {
        this.client = null;
        this.db = null;
        this.isConnected = false;
        this.collections = {
            ...config.collections,
            AUTO_SCRAPING_PROFILES: 'auto_scraping_profiles'
        };
        this.tempDir = config.storage.tempDir;
        this.localDataDir = config.storage.localDataDir;
        this.shareData = config.preferences.shareData;
        
        // Ensure local data directory exists
        if (!fs.existsSync(this.localDataDir)) {
            fs.mkdirSync(this.localDataDir, { recursive: true });
        }
        
        debugLog('Database initialized with config:', {
            uri: config.mongodb.uri,
            dbName: config.mongodb.dbName,
            collections: this.collections,
            tempDir: this.tempDir,
            localDataDir: this.localDataDir,
            shareData: this.shareData
        });
    }

    async ensureConnection() {
        if (!this.shareData) {
            return true;
        }

        if (!this.isConnected) {
            debugLog('No active connection, initializing...');
            await this.initialize();
        } else {
            try {
                // Test the connection
                await this.db.command({ ping: 1 });
                debugLog('Connection verified');
            } catch (error) {
                debugLog('Connection test failed, reinitializing...', error);
                this.isConnected = false;
                await this.initialize();
            }
        }
    }

    async initialize() {
        try {
            if (!this.shareData) {
                debugLog('Data sharing is disabled, skipping MongoDB initialization');
                return true;
            }
            
            if (this.isConnected) {
                debugLog('Already connected to database');
                return true;
            }

            debugLog('Initializing database connection...');
            debugLog('Connecting to MongoDB...', config.mongodb.uri);
            this.client = new MongoClient(config.mongodb.uri, config.mongodb.options);
            await this.client.connect();
            
            this.db = this.client.db(config.mongodb.dbName);
            this.isConnected = true;
            
            debugLog('Successfully connected to database');
            debugLog('Verifying collections...');
            
            // Verify collections exist
            const collections = await this.db.listCollections().toArray();
            const collectionNames = collections.map(c => c.name);
            debugLog('Existing collections:', collectionNames);

            // Create missing collections
            for (const [key, name] of Object.entries(this.collections)) {
                if (!collectionNames.includes(name)) {
                    debugLog(`Creating missing collection: ${name}`);
                    await this.db.createCollection(name);
                }
            }

            return true;
        } catch (error) {
            debugLog('Database initialization failed:', error);
            this.isConnected = false;
            throw error;
        }
    }

    async saveTweet(tweet, sessionId, source = 'app') {
        try {
            debugLog('\n=== Starting Tweet Save ===');
            debugLog('Tweet:', { url: tweet.url, sessionId });
            
            // Extract tweet ID from URL
            const tweet_id = tweet.url.split('/status/')[1]?.split('?')[0];
            if (!tweet_id) {
                throw new Error('Invalid tweet URL: ' + tweet.url);
            }
            debugLog('Extracted tweet_id:', tweet_id);

            let localSessionPath;
            if(source === 'app') {
                localSessionPath = path.join(this.localDataDir, `session_${sessionId}.json`);
            } else if(source === 'api') {
                localSessionPath = path.join(this.localDataDir, `sessionapi_${sessionId}.json`);
            }


            // Use a lock file to prevent concurrent writes
            const lockFile = localSessionPath + '.lock';
            
            // Wait for any existing lock to be released
            while (fs.existsSync(lockFile)) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            
            try {
                // Create lock file
                fs.writeFileSync(lockFile, '1');
                
                // Read existing session data
                let sessionData;
                try {
                    const fileContent = await fsPromises.readFile(localSessionPath, 'utf8');
                    sessionData = JSON.parse(fileContent);
                } catch (error) {
                    // File doesn't exist or is invalid, create new session data
                    sessionData = {
                        session_id: sessionId,
                        scrape_type: 'twitter',
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString(),
                        tweets: []
                    };
                }

                // Check if tweet already exists in the session
                const tweetExists = sessionData.tweets.some(t => t.tweet_id === tweet_id);
                
                if (!tweetExists) {
                    // Add new tweet to session data
                    sessionData.tweets.push({
                        tweet_id,
                        user: tweet.user,
                        content: tweet.content,
                        timestamp: tweet.timestamp,
                        url: tweet.url,
                        metrics: tweet.metrics,
                        saved_at: new Date().toISOString()
                    });
                    
                    sessionData.updated_at = new Date().toISOString();
                    sessionData.tweet_count = sessionData.tweets.length;

                    // Save to local storage with pretty formatting for readability
                    await fsPromises.writeFile(
                        localSessionPath, 
                        JSON.stringify(sessionData, null, 2)
                    );
                    debugLog('Saved session to local storage:', localSessionPath);
                } else {
                    debugLog('Tweet already exists in session, skipping:', tweet_id);
                }

                // Only save to MongoDB if data sharing is explicitly enabled
                if (this.shareData) {
                    await this.ensureConnection();
                    
                    // Prepare tweet document for database
                    const tweetDoc = {
                        tweet_id,
                        session_id: new ObjectId(sessionId),
                        user_handle: tweet.user.handle,
                        user_name: tweet.user.name || '',
                        content: tweet.content || '',
                        timestamp: tweet.timestamp ? new Date(tweet.timestamp) : new Date(),
                        url: tweet.url,
                        metrics: {
                            replies: this.parseMetric(tweet.metrics?.replies),
                            retweets: this.parseMetric(tweet.metrics?.retweets),
                            likes: this.parseMetric(tweet.metrics?.likes),
                            views: this.parseMetric(tweet.metrics?.views)
                        },
                        updated_at: new Date()
                    };

                    debugLog('Prepared tweet document:', tweetDoc);

                    // Save to database
                    const result = await this.db.collection(this.collections.TWEETS).updateOne(
                        { tweet_id },
                        { 
                            $set: tweetDoc,
                            $setOnInsert: { created_at: new Date() }
                        },
                        { upsert: true }
                    );

                    debugLog('Database save result:', {
                        matchedCount: result.matchedCount,
                        modifiedCount: result.modifiedCount,
                        upsertedCount: result.upsertedCount,
                        upsertedId: result.upsertedId
                    });

                    // Update session tweet count
                    await this.updateSessionTweetCount(sessionId);
                }

                return true;
            } finally {
                // Always remove the lock file
                try {
                    fs.unlinkSync(lockFile);
                } catch (error) {
                    debugLog('Error removing lock file:', error);
                }
            }
        } catch (error) {
            debugLog('Tweet save failed:', error);
            throw error;
        }
    }

    async verifyAllTweetsSaved(sessionId, tweets) {
        try {
            if (this.shareData) {
                // Only verify in database if data sharing is enabled
                const savedTweetsCount = await this.db.collection(this.collections.TWEETS)
                    .countDocuments({ session_id: new ObjectId(sessionId) });
                
                return savedTweetsCount === tweets.length;
            } else {
                // For local storage, just verify the local session file
                const localSessionPath = path.join(this.localDataDir, `session_${sessionId}.json`);
                const sessionData = JSON.parse(await fsPromises.readFile(localSessionPath, 'utf8'));
                
                return sessionData.tweets.length === tweets.length;
            }
        } catch (error) {
            debugLog('Error verifying tweets:', error);
            return false;
        }
    }

    async saveProfile(profile, sessionId) {
        try {
            console.log('\n=== Saving Profile ===');
            console.log('Profile:', JSON.stringify(profile, null, 2));
            console.log('Session ID:', sessionId);

            const now = new Date();
            const localSessionPath = path.join(this.localDataDir, `session_${sessionId}.json`);
            
            // Use a lock file to prevent concurrent writes
            const lockFile = localSessionPath + '.lock';
            
            // Wait for any existing lock to be released
            while (fs.existsSync(lockFile)) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            
            try {
                // Create lock file
                fs.writeFileSync(lockFile, '1');
                
                // Read existing session data
                let sessionData;
                try {
                    const fileContent = await fsPromises.readFile(localSessionPath, 'utf8');
                    sessionData = JSON.parse(fileContent);
                } catch (error) {
                    // File doesn't exist or is invalid, create new session data
                    sessionData = {
                        session_id: sessionId,
                        scrape_type: 'profile',
                        target: profile.handle,
                        created_at: now.toISOString(),
                        updated_at: now.toISOString(),
                        tweets: [],
                        profile: null
                    };
                }

                // Update profile data in session
                sessionData.profile = {
                    ...profile,
                    updated_at: now.toISOString(),
                    last_scraped_at: now.toISOString()
                };
                
                sessionData.updated_at = now.toISOString();

                // Save to local storage with pretty formatting
                await fsPromises.writeFile(
                    localSessionPath, 
                    JSON.stringify(sessionData, null, 2)
                );
                console.log('Saved profile to local storage:', localSessionPath);

                // Only save to MongoDB if data sharing is enabled
                if (this.shareData) {
                    await this.ensureConnection();

                    // Add timestamps
                    const profileDoc = {
                        ...profile,
                        updated_at: now,
                        last_scraped_at: now,
                        session_id: new ObjectId(sessionId)
                    };

                    // Upsert the profile
                    const result = await this.db.collection(this.collections.PROFILES).updateOne(
                        { handle: profile.handle },
                        { 
                            $set: profileDoc,
                            $setOnInsert: {
                                created_at: now
                            }
                        },
                        { upsert: true }
                    );

                    console.log('Profile save results:');
                    console.log('- Matched:', result.matchedCount);
                    console.log('- Modified:', result.modifiedCount);
                    console.log('- Upserted:', result.upsertedCount);

                    if (result.upsertedId) {
                        console.log('- New profile ID:', result.upsertedId);
                    }
                }

                return profile.handle;
            } finally {
                // Always remove the lock file
                try {
                    fs.unlinkSync(lockFile);
                } catch (error) {
                    console.error('Error removing lock file:', error);
                }
            }
        } catch (error) {
            console.error('=== Error Saving Profile ===');
            console.error('Error:', error.message);
            console.error('Stack:', error.stack);
            throw error;
        }
    }

    // Helper method to parse metric values
    parseMetric(value) {
        if (!value && value !== 0) return 0;
        if (typeof value === 'number') return value;
        
        // If it's already a clean number string, parse it
        if (/^\d+$/.test(value)) {
            return parseInt(value);
        }
        
        // Handle K/M suffixes
        const str = value.toString().toLowerCase().trim();
        if (str.endsWith('k')) {
            return Math.round(parseFloat(str.slice(0, -1)) * 1000);
        }
        if (str.endsWith('m')) {
            return Math.round(parseFloat(str.slice(0, -1)) * 1000000);
        }
        
        // Remove any non-numeric characters and parse
        const numStr = str.replace(/[^0-9.]/g, '');
        return parseInt(numStr) || 0;
    }

    async updateSessionTweetCount(sessionId) {
        try {
            const tweetCount = await this.db.collection(this.collections.TWEETS)
                .countDocuments({ session_id: new ObjectId(sessionId) });
            
            await this.db.collection(this.collections.SESSIONS).updateOne(
                { _id: new ObjectId(sessionId) },
                { 
                    $set: { 
                        tweets_found: tweetCount,
                        status: tweetCount > 0 ? 'completed' : 'incomplete',
                        updated_at: new Date()
                    }
                }
            );
            
            console.log(`Updated session ${sessionId} with tweet count: ${tweetCount}`);
        } catch (error) {
            console.error('Error updating session tweet count:', error);
        }
    }

    async startScrapingSession(type, target, source = 'app', publicKey = null) {
        try {
            console.log('\n=== Starting Scraping Session ===');
            console.log('Type:', type);
            console.log('Target:', target);
            console.log('Source:', source);
            console.log('Encryption:', publicKey ? 'Yes' : 'No');

            // Ensure target is never undefined
            const sessionTarget = target || 'twitter';
            const sessionType = type || 'twitter';

            // Generate a unique session ID
            const sessionId = this.shareData ? 
                (await this.db.collection(this.collections.SESSIONS).insertOne({
                    scrape_type: sessionType,
                    target: sessionTarget,
                    source: source,
                    encrypted: !!publicKey,
                    status: 'in_progress',
                    started_at: new Date(),
                    created_at: new Date(),
                    updated_at: new Date()
                })).insertedId.toString() :
                `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

            console.log('Session created:', sessionId);

            // If not sharing data, create a local session file
            if (!this.shareData) {
                const sessionData = {
                    session_id: sessionId,
                    scrape_type: sessionType,
                    target: sessionTarget,
                    source: source,
                    encrypted: !!publicKey,
                    status: 'in_progress',
                    started_at: new Date().toISOString(),
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                    tweets: []
                };
                let localSessionPath;
                if(source === 'app') 
                    {
                     localSessionPath = path.join(this.localDataDir, `session_${sessionId}.json`);
                    }
                    else {
                        localSessionPath = path.join(this.localDataDir, `sessionapi_${sessionId}.json`);
                    }
                
                await fsPromises.writeFile(localSessionPath, JSON.stringify(sessionData, null, 2));
                console.log('Created local session file:', localSessionPath);
            }

            return sessionId;
        } catch (error) {
            console.error('=== Error Starting Session ===');
            console.error('Error:', error.message);
            console.error('Stack:', error.stack);
            throw error;
        }
    }

    async completeScrapingSession(sessionId, tweetsFound, status = 'completed', source = 'app', encrypted = false) {
        try {
            console.log('\n=== Updating Scraping Session Status ===');
            console.log('Session ID:', sessionId);
            console.log('Tweets Found:', tweetsFound);
            console.log('Requested Status:', status);
            console.log('Source:', source);
            console.log('Encrypted:', encrypted);

            if (this.shareData) {
                // Only connect to database if data sharing is enabled
                await this.ensureConnection();

                // Get current session status
                const currentSession = await this.db.collection(this.collections.SESSIONS).findOne(
                    { _id: new ObjectId(sessionId) }
                );

                console.log('Current session status:', currentSession?.status);

                // Determine final status based on simple rules
                let finalStatus = status;
                if (status !== 'failed') {  // Don't override failed status
                    if (tweetsFound > 0) {
                        finalStatus = 'completed';  // If we found tweets, mark as completed
                    } else {
                        finalStatus = 'incomplete';  // If no tweets found, mark as incomplete
                    }
                }

                console.log('Determined final status:', finalStatus);

                const updateDoc = {
                    completed_at: new Date(),
                    tweets_found: tweetsFound,
                    status: finalStatus,
                    source: source,
                    encrypted: encrypted,
                    updated_at: new Date()
                };

                console.log('Updating session with:', JSON.stringify(updateDoc, null, 2));

                const result = await this.db.collection(this.collections.SESSIONS).updateOne(
                    { _id: new ObjectId(sessionId) },
                    { $set: updateDoc }
                );

                console.log('Session update results:');
                console.log('- Documents matched:', result.matchedCount);
                console.log('- Documents modified:', result.modifiedCount);
                console.log('- Status changed:', currentSession?.status !== finalStatus);

                // Verify the update
                const updatedSession = await this.db.collection(this.collections.SESSIONS).findOne(
                    { _id: new ObjectId(sessionId) }
                );

                console.log('\n=== Final Session State ===');
                console.log('- Status:', updatedSession.status);
                console.log('- Tweets Found:', updatedSession.tweets_found);
                console.log('- Source:', updatedSession.source);
                console.log('- Encrypted:', updatedSession.encrypted);
                console.log('- Completed At:', updatedSession.completed_at);

                return result.modifiedCount > 0;
            } else {
                // For local storage, just update the local session file
                let localSessionPath;
                if(source === 'app') {
                    localSessionPath = path.join(this.localDataDir, `session_${sessionId}.json`);
                }
                else {
                    localSessionPath = path.join(this.localDataDir, `sessionapi_${sessionId}.json`);
                }
                const sessionData = JSON.parse(await fsPromises.readFile(localSessionPath, 'utf8'));
                
                // Update session status
                sessionData.status = status;
                sessionData.completed_at = new Date().toISOString();
                sessionData.tweets_found = tweetsFound;
                sessionData.source = source;
                sessionData.encrypted = encrypted;
                sessionData.updated_at = new Date().toISOString();
                
                // Save updated session data
                await fsPromises.writeFile(localSessionPath, JSON.stringify(sessionData, null, 2));
                console.log('Updated local session file:', localSessionPath);
                
                return true;
            }
        } catch (error) {
            console.error('=== Session Status Update Failed ===');
            console.error('Error:', error.message);
            console.error('Stack:', error.stack);
            throw error;
        }
    }

    async getProfileScrapingHistory(handle, limit = 10) {
        try {
            const sessions = await this.db.collection(this.collections.SESSIONS)
                .aggregate([
                    {
                        $match: {
                            scrape_type: 'profile',
                            target: handle
                        }
                    },
                    {
                        $lookup: {
                            from: this.collections.TWEETS,
                            let: { session_id: '$_id' },
                            pipeline: [
                                {
                                    $match: {
                                        $expr: {
                                            $eq: ['$session_id', '$$session_id']
                                        }
                                    }
                                },
                                {
                                    $count: 'count'
                                }
                            ],
                            as: 'tweet_count'
                        }
                    },
                    {
                        $sort: { started_at: -1 }
                    },
                    {
                        $limit: limit
                    }
                ]).toArray();

            return sessions;
        } catch (error) {
            console.error('Error getting profile scraping history:', error);
            return [];
        }
    }

    async getTweets() {
        try {
            console.log('\n=== Getting Tweets ===');
            
            if (this.shareData) {
                // Get tweets from MongoDB if data sharing is enabled
                if (!this.isConnected) {
                    console.log('Database not connected, attempting to initialize...');
                    await this.initialize();
                }

                console.log('Fetching sessions from database...');
                const sessions = await this.db.collection(this.collections.SESSIONS)
                    .aggregate([
                        {
                            $sort: { started_at: -1 }  // Sort sessions by most recent first
                        },
                        {
                            $lookup: {
                                from: this.collections.TWEETS,
                                let: { session_id: '$_id' },
                                pipeline: [
                                    {
                                        $match: {
                                            $expr: { $eq: ['$session_id', '$$session_id'] }
                                        }
                                    },
                                    {
                                        $sort: { created_at: 1 }  // Sort by creation time to maintain scraping order
                                    }
                                ],
                                as: 'tweets'
                            }
                        },
                        {
                            $lookup: {
                                from: this.collections.PROFILES,
                                localField: 'target',
                                foreignField: 'handle',
                                as: 'profile'
                            }
                        }
                    ]).toArray();

                console.log(`Found ${sessions.length} sessions in database`);
                
                // Process and return database sessions
                return this.processSessions(sessions);
            } else {
                // Get tweets from local storage when data sharing is disabled
                const sessions = [];
                const files = await fsPromises.readdir(this.localDataDir);
                
                // Get file stats for sorting
                const fileStats = await Promise.all(
                    files
                        .filter(file => file.startsWith('session_') && file.endsWith('.json'))
                        .map(async file => {
                            const filePath = path.join(this.localDataDir, file);
                            const stats = await fsPromises.stat(filePath);
                            return { file, filePath, mtime: stats.mtime };
                        })
                );
                
                // Sort files by modification time (newest first)
                fileStats.sort((a, b) => b.mtime - a.mtime);
                
                // Process files in sorted order
                for (const { filePath } of fileStats) {
                    try {
                        const fileContent = await fsPromises.readFile(filePath, 'utf8');
                        if (!fileContent.trim()) {
                            console.warn(`Empty file found: ${filePath}`);
                            continue;
                        }
                        
                        let sessionData;
                        try {
                            sessionData = JSON.parse(fileContent);
                        } catch (parseError) {
                            console.error(`Error parsing JSON in file ${filePath}:`, parseError);
                            continue;
                        }

                        // Validate required fields
                        if (!sessionData.session_id || !sessionData.tweets) {
                            console.warn(`Invalid session data in file ${filePath}`);
                            continue;
                        }
                        
                        // Format session data to match database structure
                        const formattedSession = {
                            _id: sessionData.session_id,
                            scrape_type: sessionData.scrape_type || 'twitter',
                            target: sessionData.target || 'unknown',
                            status: sessionData.status || 'completed',
                            started_at: new Date(sessionData.started_at || sessionData.created_at),
                            completed_at: new Date(sessionData.completed_at || sessionData.updated_at),
                            tweets_found: sessionData.tweet_count || sessionData.tweets.length,
                            tweets: sessionData.tweets.map(tweet => ({
                                _id: tweet.tweet_id,
                                user_name: tweet.user?.name || 'Unknown User',
                                user_handle: tweet.user?.handle || 'unknown',
                                content: tweet.content,
                                timestamp: new Date(tweet.timestamp),
                                url: tweet.url,
                                metrics: tweet.metrics
                            }))
                        };
                        
                        sessions.push(formattedSession);
                    } catch (error) {
                        console.error(`Error processing file ${filePath}:`, error);
                        continue;
                    }
                }
                
                console.log(`Found ${sessions.length} valid sessions in local storage`);
                return this.processSessions(sessions);
            }
        } catch (error) {
            console.error('Error getting tweets:', error);
            throw error;
        }
    }

    processSessions(sessions) {
        // Group sessions by date
        const sessionsByDate = {};
        const dates = [];
        
        for (const session of sessions) {
            const date = new Date(session.started_at).toLocaleDateString();
            
            if (!sessionsByDate[date]) {
                sessionsByDate[date] = [];
                dates.push(date);
            }

            // Format the session data
            const formattedSession = {
                _id: session._id.toString(),
                scrape_type: session.scrape_type || 'twitter',
                target: session.target || 'twitter',  // Default to 'twitter' if target is undefined
                status: session.status || 'unknown',
                tweets_found: session.tweets?.length || 0,
                started_at: session.started_at ? new Date(session.started_at) : new Date(),
                completed_at: session.completed_at ? new Date(session.completed_at) : null,
                tweets: (session.tweets || []).map(tweet => ({
                    _id: tweet._id.toString(),
                    user_name: tweet.user_name || tweet.username || 'Unknown User',
                    user_handle: tweet.user_handle || tweet.handle || 'unknown',
                    content: tweet.content || '',
                    timestamp: tweet.timestamp ? new Date(tweet.timestamp) : new Date(),
                    url: tweet.url || '#',
                    metrics: {
                        replies: parseInt(tweet.metrics?.replies) || 0,
                        retweets: parseInt(tweet.metrics?.retweets) || 0,
                        likes: parseInt(tweet.metrics?.likes) || 0,
                        views: parseInt(tweet.metrics?.views) || 0
                    }
                })),
                profile: session.profile && session.profile.length > 0 ? session.profile[0] : null
            };

            sessionsByDate[date].push(formattedSession);
        }

        // Sort dates in descending order (newest first)
        dates.sort((a, b) => new Date(b) - new Date(a));

        // Create a new sorted object with sessions sorted by date
        const sortedSessionsByDate = {};
        for (const date of dates) {
            // Sort sessions within each date by started_at (newest first)
            sessionsByDate[date].sort((a, b) => b.started_at - a.started_at);
            sortedSessionsByDate[date] = sessionsByDate[date];
        }

        return { sessionsByDate: sortedSessionsByDate };
    }

    async getTweetsBySession(sessionId, source = 'app') {
        try {
            console.log('\n=== Getting Tweets by Session ===');
            console.log('Session ID:', sessionId);
            
            if (this.shareData) {
                // Only connect to database if data sharing is enabled
                await this.ensureConnection();
                
                const tweets = await this.db.collection(this.collections.TWEETS)
                    .find({ session_id: new ObjectId(sessionId) })
                    .toArray();
                
                console.log(`Found ${tweets.length} tweets for session`);
                return tweets;
            } else {
                // For local storage, read from the session file
                let localSessionPath;
                if(source === 'app') {
                     localSessionPath = path.join(this.localDataDir, `session_${sessionId}.json`);
                }
                else {
                    localSessionPath = path.join(this.localDataDir, `sessionapi_${sessionId}.json`);
                }
                
                const sessionData = JSON.parse(await fsPromises.readFile(localSessionPath, 'utf8'));
                
                console.log(`Found ${sessionData.tweets.length} tweets in local session`);
                return sessionData.tweets.map(tweet => ({
                    _id: tweet.tweet_id,
                    user_handle: tweet.user.handle,
                    user_name: tweet.user.name,
                    content: tweet.content,
                    timestamp: new Date(tweet.timestamp),
                    url: tweet.url,
                    metrics: tweet.metrics,
                    created_at: new Date(tweet.saved_at),
                    updated_at: new Date(tweet.saved_at)
                }));
            }
        } catch (error) {
            console.error('Error getting tweets by session:', error);
            throw error;
        }
    }

    async close() {
        try {
            if (this.client) {
                await this.client.close();
                this.client = null;
                this.db = null;
                this.isConnected = false;
                console.log('MongoDB connection closed');
            }
        } catch (error) {
            console.error('Error closing MongoDB connection:', error);
        }
    }

    async checkData() {
        try {
            if (!this.shareData) {
                // For local storage, count files in the local data directory
                const files = await fsPromises.readdir(this.localDataDir);
                const sessionFiles = files.filter(file => file.startsWith('session_') && file.endsWith('.json'));
                
                return {
                    [this.collections.SESSIONS]: sessionFiles.length,
                    [this.collections.TWEETS]: sessionFiles.reduce((total, file) => {
                        const sessionData = JSON.parse(fs.readFileSync(path.join(this.localDataDir, file), 'utf8'));
                        return total + (sessionData.tweets?.length || 0);
                    }, 0),
                    [this.collections.PROFILES]: 0 // Profiles are not stored locally
                };
            }

            if (!this.isConnected) {
                await this.initialize();
            }

            const collections = [this.collections.SESSIONS, this.collections.TWEETS, this.collections.PROFILES];
            const counts = {};

            for (const collection of collections) {
                counts[collection] = await this.db.collection(collection).countDocuments();
            }

            console.log('Database collection counts:', counts);
            return counts;
        } catch (error) {
            console.error('Error checking data:', error);
            throw error;
        }
    }

    async clearTweets() {
        try {
            if (!this.shareData) {
                return true;
            }

            if (!this.isConnected) {
                await this.initialize();
            }

            const result = await this.db.collection(this.collections.TWEETS).deleteMany({});
            console.log('Cleared tweets:', result.deletedCount);
            return result.deletedCount;
        } catch (error) {
            console.error('Error clearing tweets:', error);
            throw error;
        }
    }

    async deleteAllSessions() {
        try {
            if (!this.shareData) {
                // Delete only session files in localDataDir
                const files = await fsPromises.readdir(this.localDataDir);
                for (const file of files) {
                    if (file.startsWith('session_') && file.endsWith('.json')) {
                        await fsPromises.unlink(path.join(this.localDataDir, file));
                    }
                }
                console.log('Deleted all local session files');
                return true;
            }

            if (!this.isConnected) {
                await this.initialize();
            }

            // Delete all sessions and tweets from MongoDB
            await this.db.collection(this.collections.SESSIONS).deleteMany({});
            await this.db.collection(this.collections.TWEETS).deleteMany({});
            
            console.log('Deleted all sessions and associated tweets from database');
            return true;
        } catch (error) {
            console.error('Error deleting all sessions:', error);
            throw error;
        }
    }

    async saveAutoScrapingProfile(profile) {
        try {
            await this.ensureConnection();
            
            const now = new Date();
            const profileDoc = {
                ...profile,
                updated_at: now,
                last_scraped_at: null,
                is_active: true
            };

            const result = await this.db.collection(this.collections.AUTO_SCRAPING_PROFILES).updateOne(
                { 
                    type: profile.type,
                    target: profile.target
                },
                { 
                    $set: profileDoc,
                    $setOnInsert: {
                        created_at: now
                    }
                },
                { upsert: true }
            );

            return result.upsertedId || profile.target;
        } catch (error) {
            console.error('Error saving auto-scraping profile:', error);
            throw error;
        }
    }

    async getAutoScrapingProfiles() {
        try {
            await this.ensureConnection();
            return await this.db.collection(this.collections.AUTO_SCRAPING_PROFILES)
                .find({ is_active: true })
                .toArray();
        } catch (error) {
            console.error('Error getting auto-scraping profiles:', error);
            return [];
        }
    }

    async updateAutoScrapingProfileLastScraped(type, target) {
        try {
            await this.ensureConnection();
            await this.db.collection(this.collections.AUTO_SCRAPING_PROFILES).updateOne(
                { type, target },
                { 
                    $set: { 
                        last_scraped_at: new Date()
                    }
                }
            );
        } catch (error) {
            console.error('Error updating auto-scraping profile last scraped:', error);
            throw error;
        }
    }

    async deleteAutoScrapingProfile(type, target) {
        try {
            await this.ensureConnection();
            await this.db.collection(this.collections.AUTO_SCRAPING_PROFILES).deleteOne(
                { type, target }
            );
        } catch (error) {
            console.error('Error deleting auto-scraping profile:', error);
            throw error;
        }
    }

    async downloadAllTweets() {
        try {
            console.log('\n=== Downloading All Tweets ===');
            await this.ensureConnection();

            const tweets = await this.db.collection(this.collections.TWEETS)
                .aggregate([
                    {
                        $lookup: {
                            from: this.collections.SESSIONS,
                            localField: 'session_id',
                            foreignField: '_id',
                            as: 'session'
                        }
                    },
                    {
                        $sort: { timestamp: -1 }
                    }
                ]).toArray();

            // Format tweets for download
            const formattedTweets = tweets.map(tweet => ({
                tweet_id: tweet.tweet_id,
                user_handle: tweet.user_handle,
                user_name: tweet.user_name,
                content: tweet.content,
                timestamp: tweet.timestamp,
                url: tweet.url,
                metrics: tweet.metrics,
                session: tweet.session?.[0] ? {
                    id: tweet.session[0]._id.toString(),
                    type: tweet.session[0].scrape_type,
                    target: tweet.session[0].target,
                    started_at: tweet.session[0].started_at
                } : null,
                created_at: tweet.created_at,
                updated_at: tweet.updated_at
            }));

            return formattedTweets;
        } catch (error) {
            console.error('Error downloading all tweets:', error);
            throw error;
        }
    }

    async downloadTweetsBySession(sessionId) {
        try {
            console.log('\n=== Downloading Tweets by Session ===');
            console.log('Session ID:', sessionId);
            
            if (this.shareData) {
                await this.ensureConnection();

                // Get session details first
                const session = await this.db.collection(this.collections.SESSIONS)
                    .findOne({ _id: new ObjectId(sessionId) });

                if (!session) {
                    throw new Error('Session not found');
                }

                // Get tweets for the session
                const tweets = await this.db.collection(this.collections.TWEETS)
                    .find({ session_id: new ObjectId(sessionId) })
                    .sort({ timestamp: -1 })
                    .toArray();

                // Format tweets for download
                const formattedTweets = tweets.map(tweet => ({
                    tweet_id: tweet.tweet_id,
                    user_handle: tweet.user_handle,
                    user_name: tweet.user_name,
                    content: tweet.content,
                    timestamp: tweet.timestamp,
                    url: tweet.url,
                    metrics: tweet.metrics,
                    created_at: tweet.created_at,
                    updated_at: tweet.updated_at
                }));

                return {
                    session: {
                        id: session._id.toString(),
                        type: session.scrape_type,
                        target: session.target,
                        started_at: session.started_at,
                        completed_at: session.completed_at,
                        status: session.status,
                        tweets_found: session.tweets_found
                    },
                    tweets: formattedTweets
                };
            } else {
                // Local storage mode
                const sessionFile = path.join(this.localDataDir, `session_${sessionId}.json`);
                
                try {
                    // Read the file using fsPromises
                    const sessionData = JSON.parse(await fsPromises.readFile(sessionFile, 'utf8'));
                    
                    return {
                        session: {
                            id: sessionId,
                            type: sessionData.scrape_type || 'twitter',
                            target: sessionData.target,
                            started_at: sessionData.started_at,
                            completed_at: sessionData.completed_at,
                            status: sessionData.status,
                            tweets_found: sessionData.tweets?.length || 0
                        },
                        tweets: sessionData.tweets.map(tweet => ({
                            tweet_id: tweet.tweet_id,
                            user_handle: tweet.user.handle,
                            user_name: tweet.user.name,
                            content: tweet.content,
                            timestamp: tweet.timestamp,
                            url: tweet.url,
                            metrics: tweet.metrics,
                            created_at: tweet.created_at,
                            updated_at: tweet.updated_at
                        }))
                    };
                } catch (error) {
                    if (error.code === 'ENOENT') {
                        throw new Error('Session file not found');
                    }
                    throw error;
                }
            }
        } catch (error) {
            console.error('Error downloading tweets by session:', error);
            throw error;
        }
    }

    async scrapeTweets(tweets, sessionId) {
        try {
            console.log('\n=== Scraping Tweets ===');
            console.log('Session ID:', sessionId);
            console.log('Number of tweets:', tweets.length);

            const now = new Date();
            const localSessionPath = path.join(this.localDataDir, `session_${sessionId}.json`);
            
            // Use a lock file to prevent concurrent writes
            const lockFile = localSessionPath + '.lock';
            
            // Wait for any existing lock to be released
            while (fs.existsSync(lockFile)) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            
            try {
                // Create lock file
                fs.writeFileSync(lockFile, '1');
                
                // Read existing session data
                let sessionData;
                try {
                    const fileContent = await fsPromises.readFile(localSessionPath, 'utf8');
                    sessionData = JSON.parse(fileContent);
                } catch (error) {
                    // File doesn't exist or is invalid, create new session data
                    sessionData = {
                        session_id: sessionId,
                        scrape_type: 'tweets',
                        created_at: now.toISOString(),
                        updated_at: now.toISOString(),
                        tweets: []
                    };
                }

                // Process each tweet
                for (const tweet of tweets) {
                    const tweet_id = tweet.url.split('/status/')[1]?.split('?')[0];
                    if (!tweet_id) continue;

                    // Check if tweet already exists
                    const tweetExists = sessionData.tweets.some(t => t.tweet_id === tweet_id);
                    
                    if (!tweetExists) {
                        // Add new tweet to session data
                        sessionData.tweets.push({
                            tweet_id,
                            user: tweet.user,
                            content: tweet.content,
                            timestamp: tweet.timestamp,
                            url: tweet.url,
                            metrics: tweet.metrics,
                            saved_at: now.toISOString()
                        });
                    }
                }
                
                sessionData.updated_at = now.toISOString();
                sessionData.tweet_count = sessionData.tweets.length;

                // Save to local storage with pretty formatting
                await fsPromises.writeFile(
                    localSessionPath, 
                    JSON.stringify(sessionData, null, 2)
                );
                console.log('Saved tweets to local storage:', localSessionPath);

                // Only save to MongoDB if data sharing is enabled
                if (this.shareData) {
                    await this.ensureConnection();

                    // Save each tweet to MongoDB
                    for (const tweet of tweets) {
                        const tweet_id = tweet.url.split('/status/')[1]?.split('?')[0];
                        if (!tweet_id) continue;

                        const tweetDoc = {
                            tweet_id,
                            session_id: new ObjectId(sessionId),
                            user_handle: tweet.user.handle,
                            user_name: tweet.user.name || '',
                            content: tweet.content || '',
                            timestamp: tweet.timestamp ? new Date(tweet.timestamp) : now,
                            url: tweet.url,
                            metrics: {
                                replies: this.parseMetric(tweet.metrics?.replies),
                                retweets: this.parseMetric(tweet.metrics?.retweets),
                                likes: this.parseMetric(tweet.metrics?.likes),
                                views: this.parseMetric(tweet.metrics?.views)
                            },
                            updated_at: now
                        };

                        await this.db.collection(this.collections.TWEETS).updateOne(
                            { tweet_id },
                            { 
                                $set: tweetDoc,
                                $setOnInsert: { created_at: now }
                            },
                            { upsert: true }
                        );
                    }

                    // Update session tweet count
                    await this.updateSessionTweetCount(sessionId);
                }

                return true;
            } finally {
                // Always remove the lock file
                try {
                    fs.unlinkSync(lockFile);
                } catch (error) {
                    console.error('Error removing lock file:', error);
                }
            }
        } catch (error) {
            console.error('=== Error Scraping Tweets ===');
            console.error('Error:', error.message);
            console.error('Stack:', error.stack);
            throw error;
        }
    }

    async deleteSession(sessionId) {
        try {
            console.log('Deleting session:', sessionId);
            
            if (this.shareData) {
                // Delete from MongoDB if data sharing is enabled
                if (!this.isConnected) {
                    await this.initialize();
                }

                // Delete session and associated tweets
                await this.db.collection(this.collections.SESSIONS).deleteOne({ _id: new ObjectId(sessionId) });
                await this.db.collection(this.collections.TWEETS).deleteMany({ session_id: new ObjectId(sessionId) });
                
                console.log('Session and associated tweets deleted from database');
            } else {
                // Delete from local storage
                const localSessionPath = path.join(this.localDataDir, `session_${sessionId}.json`);
                try {
                    await fsPromises.unlink(localSessionPath);
                    console.log('Session file deleted from local storage:', localSessionPath);
                } catch (error) {
                    if (error.code !== 'ENOENT') {
                        throw error;
                    }
                    console.log('Session file not found, might have been already deleted');
                }
            }

            return { success: true };
        } catch (error) {
            console.error('Error deleting session:', error);
            throw error;
        }
    }
}

module.exports = TweetDatabase; 