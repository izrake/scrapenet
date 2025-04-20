const crypto = require('crypto');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

// Generate keys for testing
async function generateKeys() {
    console.log('Generating RSA key pair for testing...');
    
    // Generate private and public keys
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: {
            type: 'spki',
            format: 'pem'
        },
        privateKeyEncoding: {
            type: 'pkcs8',
            format: 'pem'
        }
    });
    
    // Save keys for future use
    const keysDir = path.join(__dirname, 'keys');
    try {
        await fs.mkdir(keysDir, { recursive: true });
    } catch (error) {
        if (error.code !== 'EEXIST') throw error;
    }
    
    await fs.writeFile(path.join(keysDir, 'public_key.pem'), publicKey);
    await fs.writeFile(path.join(keysDir, 'private_key.pem'), privateKey);
    
    console.log('Keys generated and saved to scripts/keys directory');
    return { publicKey, privateKey };
}

// Decrypt response data using private key
function decryptData(encryptedData, privateKey) {
    // Base64 decode the encrypted key and IV
    const encryptedKeyBuffer = Buffer.from(encryptedData.encryptedKey, 'base64');
    const ivBuffer = Buffer.from(encryptedData.iv, 'base64');
    
    // Decrypt the symmetric key using the private key
    const symmetricKey = crypto.privateDecrypt(
        {
            key: privateKey,
            padding: crypto.constants.RSA_PKCS1_OAEP_PADDING
        },
        encryptedKeyBuffer
    );
    
    // Decrypt the data using the symmetric key
    const decipher = crypto.createDecipheriv('aes-256-cbc', symmetricKey, ivBuffer);
    let decryptedData = decipher.update(encryptedData.encryptedData, 'base64', 'utf8');
    decryptedData += decipher.final('utf8');
    
    // Parse the JSON data
    return JSON.parse(decryptedData);
}

// Test API call with encryption
async function testApi(publicKey, privateKey) {
    try {
        console.log('Testing API with encryption...');
        
        // First check if API delegation is enabled
        const statusResponse = await axios.get('http://localhost:3000/api/delegation/status');
        console.log('API Delegation Status:', statusResponse.data);
        
        if (!statusResponse.data.enabled) {
            console.log('API delegation is not enabled. Enabling it...');
            await axios.post('http://localhost:3000/api/delegation/enable');
            console.log('API delegation enabled');
        }
        
        // Make an API call with the public key for encryption
        console.log('\nMaking request to search tweets with encryption...');
        const searchResponse = await axios.post('http://localhost:3000/api/scrape/tweets', {
            query: 'ai x crypto',
            limit: 10,
            publicKey: publicKey
        });
        
        console.log('Response received:');
        console.log('- Status:', searchResponse.data.status);
        console.log('- Encrypted:', searchResponse.data.encrypted);
        
        // If the response is encrypted, decrypt it
        if (searchResponse.data.encrypted) {
            console.log('\nDecrypting response data...');
            const decryptedData = decryptData(searchResponse.data.data, privateKey);
            
            console.log('Decrypted data type:', typeof decryptedData);
            
            if (typeof decryptedData === 'object') {
                console.log('Decrypted data structure:', Object.keys(decryptedData));
                
                // Check if the decrypted data is directly an array of tweets
                if (Array.isArray(decryptedData)) {
                    const tweets = decryptedData;
                    console.log(`\nSuccessfully decrypted ${tweets.length} tweets (array format)`);
                    
                    if (tweets.length > 0) {
                        displayTweet(tweets[0]);
                    }
                }
                // Check if tweets property exists at the top level
                else if (decryptedData.tweets) {
                    const tweets = decryptedData.tweets;
                    console.log(`\nSuccessfully decrypted ${tweets.length} tweets (object.tweets format)`);
                    
                    if (tweets.length > 0) {
                        displayTweet(tweets[0]);
                    }
                }
                // If no clear tweets array, just display what we received
                else {
                    console.log('\nNo clear tweets array found in decrypted data');
                    console.log('Decrypted data sample:', JSON.stringify(decryptedData).substring(0, 500) + '...');
                }
            } else {
                console.log('Unexpected decrypted data format:', decryptedData);
            }
        } else {
            console.log('Response was not encrypted');
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

// Helper function to display a tweet
function displayTweet(tweet) {
    console.log('\nSample Tweet:');
    console.log('- Tweet ID:', tweet.tweet_id);
    console.log('- User:', tweet.user_handle || tweet.user_name || (tweet.user ? tweet.user.handle : 'Unknown'));
    console.log('- Content:', tweet.content || tweet.text);
    console.log('- URL:', tweet.url);
}

// Main function
async function main() {
    try {
        // Check if keys already exist
        const keysDir = path.join(__dirname, 'keys');
        let publicKey, privateKey;
        
        try {
            publicKey = await fs.readFile(path.join(keysDir, 'public_key.pem'), 'utf8');
            privateKey = await fs.readFile(path.join(keysDir, 'private_key.pem'), 'utf8');
            console.log('Using existing keys from scripts/keys directory');
        } catch (error) {
            // Generate new keys if they don't exist
            const keys = await generateKeys();
            publicKey = keys.publicKey;
            privateKey = keys.privateKey;
        }
        
        // Test the API with the keys
        await testApi(publicKey, privateKey);
    } catch (error) {
        console.error('Error in main function:', error);
    }
}

// Run the main function
main(); 