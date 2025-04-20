const axios = require('axios');

// Test API without encryption
async function testApi() {
    try {
        console.log('Testing API without encryption...');
        
        // First check if API delegation is enabled
        const statusResponse = await axios.get('http://localhost:3000/api/delegation/status');
        console.log('API Delegation Status:', statusResponse.data);
        
        if (!statusResponse.data.enabled) {
            console.log('API delegation is not enabled. Enabling it...');
            await axios.post('http://localhost:3000/api/delegation/enable');
            console.log('API delegation enabled');
        }
        
        // Make an API call without encryption
        console.log('\nMaking request to search tweets without encryption...');
        const searchResponse = await axios.post('http://localhost:3000/api/scrape/tweets', {
            query: 'test',
            limit: 10
        });
        
        console.log('Response received:');
        console.log('- Status:', searchResponse.data.status);
        
        // Display tweet data
        if (searchResponse.data.tweets && searchResponse.data.tweets.length > 0) {
            console.log(`\nReceived ${searchResponse.data.tweets.length} tweets`);
            
            // Display sample tweet
            const sampleTweet = searchResponse.data.tweets[0];
            console.log('\nSample Tweet:');
            console.log('- Tweet ID:', sampleTweet.tweet_id);
            console.log('- User:', sampleTweet.user_handle || sampleTweet.user_name);
            console.log('- Content:', sampleTweet.content);
            console.log('- URL:', sampleTweet.url);
        } else {
            console.log('\nNo tweets received in response');
            console.log('Response data structure:', Object.keys(searchResponse.data));
            console.log('Raw response:', JSON.stringify(searchResponse.data, null, 2).substring(0, 500) + '...');
        }
        
        console.log('\nTest completed successfully!');
    } catch (error) {
        console.error('Error testing API:', error.message);
        if (error.response) {
            console.error('API Response:', error.response.data);
        } else {
            console.error('Error details:', error);
        }
    }
}

// Run the test
testApi(); 