const TweetDatabase = require('./database');
const { ObjectId } = require('mongodb');

// Helper functions to generate random data
function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomMetric() {
    const value = randomInt(1, 1000000);
    if (value >= 1000000) {
        return `${(value / 1000000).toFixed(1)}M`;
    } else if (value >= 1000) {
        return `${(value / 1000).toFixed(1)}K`;
    }
    return value.toString();
}

function generateTweet(index) {
    const timestamp = new Date();
    timestamp.setMinutes(timestamp.getMinutes() - index); // Each tweet 1 minute apart

    const userTypes = ['regular', 'verified', 'business'];
    const userType = userTypes[randomInt(0, 2)];
    const userId = randomInt(1000, 9999);

    return {
        url: `https://twitter.com/user${userId}/status/${new ObjectId().toString()}`,
        user: {
            handle: `user${userId}`,
            name: `User ${userId}`,
            type: userType,
            followers: randomInt(100, 1000000).toString(),
            following: randomInt(100, 10000).toString()
        },
        content: `This is test tweet #${index + 1} from ${userType} user. Generated for database testing. #testing #mock #data${index}`,
        timestamp: timestamp,
        metrics: {
            replies: randomMetric(),
            retweets: randomMetric(),
            likes: randomMetric(),
            views: randomMetric()
        },
        hashtags: ['testing', 'mock', `data${index}`],
        mentions: [`@user${randomInt(1000, 9999)}`],
        media: {
            has_media: Math.random() > 0.7,
            type: ['image', 'video', 'gif'][randomInt(0, 2)]
        }
    };
}

// Generate 100 mock tweets
const MOCK_TWEETS = Array.from({ length: 100 }, (_, i) => generateTweet(i));

async function testDatabaseInsertion(temp_delete = false) {
    const db = new TweetDatabase();
    const batchSize = 10; // Process tweets in batches of 10
    
    try {
        console.log('\n=== Starting Database Test ===');
        console.log(`Total tweets to process: ${MOCK_TWEETS.length}`);
        console.log(`Temporary files will be ${temp_delete ? 'deleted' : 'preserved'} after successful DB insertion`);
        
        // Initialize database
        console.log('1. Initializing database...');
        await db.ensureConnection();
        
        // Start a test session
        console.log('\n2. Creating test session...');
        const sessionId = await db.startScrapingSession('test', 'mock_data');
        console.log('Session created:', sessionId);

        // Save tweets in batches
        console.log('\n3. Saving mock tweets in batches...');
        const results = [];
        for (let i = 0; i < MOCK_TWEETS.length; i += batchSize) {
            const batch = MOCK_TWEETS.slice(i, i + batchSize);
            console.log(`\nProcessing batch ${(i/batchSize) + 1}/${Math.ceil(MOCK_TWEETS.length/batchSize)}`);
            
            for (const tweet of batch) {
                try {
                    console.log(`Processing tweet: ${tweet.url}`);
                    const saved = await db.saveTweet(tweet, sessionId, temp_delete);
                    results.push({ 
                        url: tweet.url, 
                        success: saved,
                        user: tweet.user.handle,
                        metrics: tweet.metrics
                    });
                } catch (error) {
                    console.error(`Failed to save tweet ${tweet.url}:`, error.message);
                    results.push({ 
                        url: tweet.url, 
                        success: false, 
                        error: error.message,
                        user: tweet.user.handle
                    });
                }
            }
            
            // Progress update after each batch
            const successCount = results.filter(r => r.success).length;
            console.log(`Progress: ${results.length}/${MOCK_TWEETS.length} tweets processed (${successCount} successful)`);
        }

        // Verify database state
        console.log('\n4. Verifying database state...');
        const tweets = await db.getTweetsBySession(sessionId);
        
        console.log('\nDatabase verification results:');
        console.log('- Session ID:', sessionId);
        console.log('- Expected tweets:', MOCK_TWEETS.length);
        console.log('- Actual tweets in DB:', tweets.length);
        
        // Sample verification (first 5 and last 5 tweets)
        console.log('\n5. Sample tweet verification:');
        const sampleTweets = [...tweets.slice(0, 5), ...tweets.slice(-5)];
        for (const tweet of sampleTweets) {
            console.log('\nTweet:', {
                id: tweet.tweet_id,
                user: tweet.user_handle,
                metrics: tweet.metrics,
                url: tweet.url
            });
        }

        // Complete the session
        console.log('\n6. Completing test session...');
        await db.completeScrapingSession(sessionId, tweets.length);

        // Final summary
        console.log('\n=== Test Summary ===');
        console.log('- All tweets processed:', results.length === MOCK_TWEETS.length);
        console.log('- Successful saves:', results.filter(r => r.success).length);
        console.log('- Failed saves:', results.filter(r => !r.success).length);
        console.log('- Success rate:', `${tweets.length}/${MOCK_TWEETS.length} (${(tweets.length/MOCK_TWEETS.length*100).toFixed(1)}%)`);

        // Detailed error report if any failures
        const failures = results.filter(r => !r.success);
        if (failures.length > 0) {
            console.log('\nFailed tweets:');
            failures.forEach(f => {
                console.log(`- ${f.user}: ${f.error}`);
            });
        }

        return {
            success: tweets.length === MOCK_TWEETS.length,
            expected: MOCK_TWEETS.length,
            actual: tweets.length,
            tweets: tweets,
            results: results
        };
    } catch (error) {
        console.error('Test failed:', error);
        throw error;
    } finally {
        await db.close();
    }
}

// Run the test if this file is executed directly
if (require.main === module) {
    // Parse command line arguments for temp_delete flag
    const args = process.argv.slice(2);
    const temp_delete = args.includes('--delete-temp') || args.includes('-d');

    testDatabaseInsertion(temp_delete)
        .then(result => {
            console.log('\nTest completed:', result.success ? 'PASSED' : 'FAILED');
            if (!result.success) {
                console.log('\nFailed operations:', result.results.filter(r => !r.success));
            }
            process.exit(result.success ? 0 : 1);
        })
        .catch(error => {
            console.error('Test failed with error:', error);
            process.exit(1);
        });
}

module.exports = { testDatabaseInsertion }; 