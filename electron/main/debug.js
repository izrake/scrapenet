const TweetDatabase = require('./database');
const { ObjectId } = require('mongodb');

// Mock tweet data
const mockTweet = {
    url: 'https://twitter.com/user123/status/1234567890',
    user: {
        handle: 'user123',
        name: 'Test User'
    },
    content: 'This is a test tweet',
    timestamp: new Date(),
    metrics: {
        replies: '10',
        retweets: '20',
        likes: '100',
        views: '1.5K'
    }
};

async function testDatabaseOperations() {
    const db = new TweetDatabase();
    
    try {
        // 1. Test database connection
        console.log('1. Testing database connection...');
        await db.initialize();
        
        // 2. Create a test session
        console.log('\n2. Creating test session...');
        const sessionId = await db.startScrapingSession('test', 'debug_test');
        console.log('Session created:', sessionId);
        
        // 3. Save tweet
        console.log('\n3. Attempting to save tweet...');
        try {
            const saved = await db.saveTweet(mockTweet, sessionId, false);
            console.log('Tweet save result:', saved);
        } catch (saveError) {
            console.error('Tweet save failed:', saveError);
        }
        
        // 4. Verify tweet in database
        console.log('\n4. Verifying saved tweet...');
        const tweet_id = mockTweet.url.split('/status/')[1];
        const savedTweet = await db.db.collection(db.collections.TWEETS).findOne({ tweet_id });
        console.log('Found tweet in database:', savedTweet ? 'Yes' : 'No');
        if (savedTweet) {
            console.log('Saved tweet data:', savedTweet);
        }
        
        // 5. Check session status
        console.log('\n5. Checking session status...');
        const session = await db.db.collection(db.collections.SESSIONS).findOne({ _id: new ObjectId(sessionId) });
        console.log('Session data:', session);
        
    } catch (error) {
        console.error('Test failed:', error);
    } finally {
        await db.close();
    }
}

// Run the test
console.log('=== Starting Database Debug Test ===');
testDatabaseOperations()
    .then(() => console.log('Debug test completed'))
    .catch(error => console.error('Debug test failed:', error)); 