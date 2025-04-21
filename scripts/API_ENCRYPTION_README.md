# API Encryption Feature

This document explains how to use and test the API encryption feature in Scrapenet.

## Overview

The API encryption feature allows you to:

1. Enable API delegation in the app settings
2. Make API requests with a public key for encryption
3. Receive encrypted responses that only you can decrypt with your private key
4. Store encrypted tweets in the database with a flag indicating they came from the API

## Setup

1. **Enable API Delegation**:
   - Open the Scrapenet app
   - Go to the Settings tab
   - Click "Enable API Delegation"
   - Note the port number (default: 3000)

2. **Generate RSA Key Pair**:
   You can use the provided test script to generate keys, or generate your own:

   ```javascript
   const crypto = require('crypto');
   const fs = require('fs');

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

   fs.writeFileSync('public_key.pem', publicKey);
   fs.writeFileSync('private_key.pem', privateKey);
   ```

## Using the API with Encryption

1. **Make an API Request**:
   
   ```javascript
   const axios = require('axios');
   const fs = require('fs');

   // Load your public key
   const publicKey = fs.readFileSync('public_key.pem', 'utf8');

   // Make the API request with encryption
   axios.post('http://localhost:3000/api/scrape/tweets', {
     query: 'your search query',
     limit: 100, // Max 500
     publicKey: publicKey
   })
   .then(response => {
     console.log('Encrypted response received:', response.data);
     // Decrypt the data (see below)
   })
   .catch(error => {
     console.error('Error:', error.response?.data || error.message);
   });
   ```

2. **Decrypt the Response**:

   ```javascript
   function decryptData(encryptedData, privateKey) {
     const crypto = require('crypto');
     
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

   // Load your private key
   const privateKey = fs.readFileSync('private_key.pem', 'utf8');
   
   // Decrypt the response data
   const decryptedData = decryptData(response.data.data, privateKey);
   console.log('Decrypted data:', decryptedData);
   ```

## Test Scripts

Two test scripts are provided to help you verify the API functionality:

1. **Test with Encryption** (`test-encryption.js`):
   ```bash
   node scripts/test-encryption.js
   ```
   This script:
   - Generates RSA keys if they don't exist (saved to `scripts/keys` directory)
   - Enables API delegation if needed
   - Makes a test API request with the public key
   - Decrypts the response using the private key
   - Displays sample data from the decrypted response

2. **Test without Encryption** (`test-api.js`):
   ```bash
   node scripts/test-api.js
   ```
   This script:
   - Enables API delegation if needed
   - Makes a test API request without encryption
   - Displays sample data from the response

## API Endpoints

All the following endpoints accept a `publicKey` parameter for encryption:

- **Search Tweets**:
  ```
  POST /api/scrape/tweets
  {
    "query": "search query",
    "limit": 100,
    "publicKey": "-----BEGIN PUBLIC KEY-----\n..."
  }
  ```

- **Scrape Profile**:
  ```
  POST /api/scrape/profile
  {
    "username": "twitter_handle",
    "limit": 100,
    "publicKey": "-----BEGIN PUBLIC KEY-----\n..."
  }
  ```

- **Scrape Home Timeline**:
  ```
  POST /api/scrape/home
  {
    "limit": 100,
    "publicKey": "-----BEGIN PUBLIC KEY-----\n..."
  }
  ```

## Security Notes

1. Always keep your private key secure
2. The public key is sent with each request
3. The response is encrypted using hybrid encryption:
   - A random symmetric key (AES-256-CBC) is generated for each request
   - The data is encrypted with this symmetric key
   - The symmetric key is encrypted with your public RSA key
   - Both are returned in the response for decryption

## Technical Details

- **Encryption Algorithm**: RSA-2048 (key) + AES-256-CBC (data)
- **Database Storage**: Tweets from API requests are marked with `source: 'api'` and `encrypted: true` flags
- **Maximum Limit**: All API requests have a maximum limit of 500 tweets per request 