const { ipcMain } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const https = require('https');

class ChatManager {
    constructor(db, userDataPath) {
        this.db = db;
        this.configPath = path.join(userDataPath, 'llm_config.json');
        this.config = null;
        this.conversations = new Map(); // Store conversation state
        this.handlers = []; // Add this to track handlers
        
        this.initializeHandlers();
        this.loadConfig();  
    }

    async loadConfig() {
        try {
            const data = await fs.readFile(this.configPath, 'utf8');
            this.config = JSON.parse(data);
        } catch (error) {
            this.config = null;
        }
    }

    async saveConfig(config) {
        try {
            await fs.writeFile(this.configPath, JSON.stringify(config));
            this.config = config;
            return { success: true };
        } catch (error) {
            console.error('Error saving config:', error);
            throw error;
        }
    }

    async getRecentTweets() {
        try {
            const data = await this.db.getTweets();
            const allTweets = [];
            
            // Extract tweets from all sessions
            Object.values(data.sessionsByDate).forEach(sessions => {
                sessions.forEach(session => {
                    session.tweets.forEach(tweet => {
                        allTweets.push({
                            content: tweet.content,
                            timestamp: tweet.timestamp,
                            user: tweet.user_name
                        });
                    });
                });
            });
            
            // Sort by timestamp (most recent first) and limit to 100
            return allTweets
                .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
                .slice(0, 100);
        } catch (error) {
            console.error('Error fetching tweets:', error);
            throw error;
        }
    }

    async queryLLM(messages) {
        if (!this.config?.endpoint) {
            throw new Error('LLM endpoint not configured');
        }

        try {
            if (this.config.type === 'gemini') {
                // Google Gemini API call
                const headers = {
                    'Content-Type': 'application/json'
                };

                // Combine messages into a single prompt for Gemini
                const combinedContent = messages.map(msg => {
                    if (msg.role === 'system') {
                        return `Instructions: ${msg.content}\n\n`;
                    }
                    return `${msg.role === 'assistant' ? 'Assistant' : 'User'}: ${msg.content}\n`;
                }).join('\n');

                const body = {
                    contents: [{
                        parts: [{
                            text: combinedContent
                        }]
                    }],
                    generationConfig: {
                        temperature: this.config.temperature || 0.1,
                        topP: this.config.topP || 0.9,
                        maxOutputTokens: this.config.maxTokens || 512
                    }
                };

                // Construct Gemini API URL with API key
                const endpoint = `${this.config.endpoint}/models/${this.config.model}:generateContent?key=${this.config.apiKey}`;

                console.log('Sending Gemini query to:', endpoint);

                return new Promise((resolve, reject) => {
                    const url = new URL(endpoint);
                    const options = {
                        hostname: url.hostname,
                        path: url.pathname + url.search,
                        method: 'POST',
                        headers: headers
                    };

                    const req = https.request(options, (res) => {
                        let data = '';

                        res.on('data', (chunk) => {
                            data += chunk;
                        });

                        res.on('end', () => {
                            if (res.statusCode >= 200 && res.statusCode < 300) {
                                try {
                                    const responseData = JSON.parse(data);
                                    if (responseData.candidates && responseData.candidates[0]?.content?.parts[0]?.text) {
                                        resolve(responseData.candidates[0].content.parts[0].text);
                                    } else {
                                        reject(new Error('Invalid Gemini API response format'));
                                    }
                                } catch (error) {
                                    reject(new Error(`Failed to parse Gemini response: ${error.message}`));
                                }
                            } else {
                                reject(new Error(`Gemini API error (${res.statusCode}): ${data}`));
                            }
                        });
                    });

                    req.on('error', (error) => {
                        reject(new Error(`Gemini request failed: ${error.message}`));
                    });

                    req.write(JSON.stringify(body));
                    req.end();
                });
            } else {
                // OpenAI-compatible API call
                const headers = {
                    'Content-Type': 'application/json',
                    ...(this.config.apiKey && { 
                        'Authorization': `Bearer ${this.config.apiKey}`
                    })
                };

                const body = {
                    messages: messages.map(msg => ({
                        role: msg.role,
                        content: msg.content
                    })),
                    model: this.config.model,
                    max_tokens: this.config.maxTokens || 512,
                    temperature: this.config.temperature || 0.1,
                    top_p: this.config.topP || 0.9
                };

                const endpoint = this.config.endpoint.endsWith('/v1/chat/completions') 
                    ? this.config.endpoint 
                    : `${this.config.endpoint.replace(/\/$/, '')}/v1/chat/completions`;

                console.log('Sending OpenAI query to:', endpoint);

                return new Promise((resolve, reject) => {
                    const url = new URL(endpoint);
                    const options = {
                        hostname: url.hostname,
                        path: url.pathname,
                        method: 'POST',
                        headers: headers
                    };

                    const req = https.request(options, (res) => {
                        let data = '';

                        res.on('data', (chunk) => {
                            data += chunk;
                        });

                        res.on('end', () => {
                            if (res.statusCode >= 200 && res.statusCode < 300) {
                                try {
                                    const responseData = JSON.parse(data);
                                    resolve(responseData.choices[0].message.content);
                                } catch (error) {
                                    reject(new Error(`Failed to parse OpenAI response: ${error.message}`));
                                }
                            } else {
                                reject(new Error(`OpenAI API error (${res.statusCode}): ${data}`));
                            }
                        });
                    });

                    req.on('error', (error) => {
                        reject(new Error(`OpenAI request failed: ${error.message}`));
                    });

                    req.write(JSON.stringify(body));
                    req.end();
                });
            }
        } catch (error) {
            console.error('LLM query error:', error);
            throw error;
        }
    }

    async naturalToMongoQuery(naturalQuery) {
        try {
            // Extract number of tweets if specified
            const match = naturalQuery.match(/\b(\d+)\s*tweets?\b/i);
            const limit = match ? parseInt(match[1]) : 100; // Default to 100 if not specified
            
            const systemPrompt = {
                role: 'system',
                content: `You are a MongoDB query generator. Convert natural language instructions into MongoDB query objects.

                            The MongoDB collection is named tweets and has the following fields:
                            - content: tweet text
                            - user_name: author's display name
                            - user_handle: author's Twitter handle
                            - timestamp: date of tweet (ISODate format)
                            - metrics: { replies, retweets, likes, views }
                            - url: tweet URL

                            IMPORTANT RULES:
                            1. Only return a complete query object with sort and limit.
                            2. Format must be: { "sort": {}, "limit": number }
                            3. Do not use $text, $regex, or any special MongoDB operators.
                            4. Do not return comments, explanations, or shell commands.
                            5. Always include both sort and limit.
                            6. Default sort: { "timestamp": -1 }
                            7. Default limit: 100
                            8. Maximum limit: 1000

                            Sort priorities:
                            - Use "metrics.likes": -1 if the query refers to "liked"
                            - Use "metrics.retweets": -1 if the query refers to "retweeted"
                            - Use "metrics.views": -1 if the query refers to "viewed"
                            - Use "timestamp": -1 if query refers to "latest", "recent", or doesn't specify
                            - Combine sorts when applicable (e.g., likes + retweets)

                            EXAMPLES:

                            Input: get top 500 tweets  
                            Output:
                            {
                            "sort": { "timestamp": -1 },
                            "limit": 500
                            }

                            Input: show most liked tweets  
                            Output:
                            {
                            "sort": { "metrics.likes": -1, "metrics.retweets": -1 },
                            "limit": 100
                            }

                            Input: get 200 most viewed tweets  
                            Output:
                            {
                            "sort": { "metrics.views": -1 },
                            "limit": 200
                            }

                            Input: latest tweets from this week  
                            Output:
                            {
                            "sort": { "timestamp": -1 },
                            "limit": 100
                            }

                            GOAL:
                            Return only the MongoDB query object. No text. No markdown. No extra formatting.`
            };

            const userPrompt = {
                role: 'user',
                content: `Return a complete MongoDB query object with sort and limit for: ${naturalQuery}`
            };

            const response = await this.queryLLM([systemPrompt, userPrompt]);
            
            // Clean the response by removing markdown code blocks and any extra whitespace
            const cleanedResponse = response
                .replace(/```(?:json|javascript)?\n?/g, '') // Remove code block markers
                .replace(/`/g, '')                          // Remove any remaining backticks
                .replace(/^db\.tweets\.find\((.+)\).*$/s, '$1') // Remove any db.tweets.find() wrapper
                .trim();                                    // Remove extra whitespace

            try {
                // Parse the cleaned response
                let queryObject = JSON.parse(cleanedResponse);
                
                // Validate the query structure
                if (!queryObject.sort || !queryObject.limit) {
                    throw new Error('Invalid query structure. Missing required fields.');
                }

                // Ensure we have a reasonable limit
                queryObject.limit = Math.min(limit, 1000); // Cap at 1000 tweets

                // If no specific sort is provided, default to timestamp
                if (!queryObject.sort || Object.keys(queryObject.sort).length === 0) {
                    queryObject.sort = { "timestamp": -1 };
                }

                // Remove any extra fields and keep only sort and limit
                return {
                    sort: queryObject.sort,
                    limit: queryObject.limit
                };
            } catch (error) {
                console.error('Failed to parse LLM response:', error);
                console.error('Raw response:', response);
                console.error('Cleaned response:', cleanedResponse);
                
                // Return a default query for any parsing errors
                return {
                    sort: { "timestamp": -1 },
                    limit: 100
                };
            }
        } catch (error) {
            console.error('Error generating MongoDB query:', error);
            // Return a default query for any errors
            return {
                sort: { "timestamp": -1 },
                limit: 100
            };
        }
    }

    async executeMongoQuery(naturalQuery) {
        try {
            // Generate MongoDB query
            const mongoQuery = await this.naturalToMongoQuery(naturalQuery);
            
            if (this.db.shareData) {
                // Execute the query with sort and limit from MongoDB
                const results = await this.db.db.collection(this.db.collections.TWEETS)
                    .find(mongoQuery.query)
                    .sort(mongoQuery.sort)
                    .limit(mongoQuery.limit)
                    .toArray();
                    
                return {
                    query: mongoQuery,
                    results: results,
                    count: results.length
                };
            } else {
                // Execute the query with sort and limit from local storage
                const allTweets = [];
                const files = await fs.readdir(this.db.localDataDir);
                
                // Get file stats and sort files by creation time (latest first)
                const fileStats = await Promise.all(
                    files
                        .filter(file => file.startsWith('session_') && file.endsWith('.json'))
                        .map(async file => {
                            const filePath = path.join(this.db.localDataDir, file);
                            const stats = await fs.stat(filePath);
                            return { file, filePath, birthtime: stats.birthtime };
                        })
                );
                
                // Sort files by creation time (newest first)
                fileStats.sort((a, b) => b.birthtime - a.birthtime);
                
                // Process files in sorted order and collect tweets until we reach the limit
                let totalTweets = 0;
                const limit = mongoQuery.limit || 100;

                for (const { filePath } of fileStats) {
                    if (totalTweets >= limit) break;

                    const fileContent = await fs.readFile(filePath, 'utf8');
                    const sessionData = JSON.parse(fileContent);
                    
                    // Add tweets from this session maintaining their original order
                    sessionData.tweets.forEach(tweet => {
                        if (totalTweets < limit) {
                            allTweets.push({
                                _id: tweet.tweet_id,
                                user_name: tweet.user.name,
                                user_handle: tweet.user.handle,
                                content: tweet.content,
                                timestamp: new Date(tweet.timestamp),
                                url: tweet.url,
                                metrics: tweet.metrics
                            });
                            totalTweets++;
                        }
                    });
                }
                
                // Apply any additional sorting criteria from mongoQuery if needed
                // (excluding the timestamp sort since we want to maintain scraping order)
                if (Object.keys(mongoQuery.sort).length > 1 || !mongoQuery.sort.hasOwnProperty('timestamp')) {
                    allTweets.sort((a, b) => {
                        for (const [field, direction] of Object.entries(mongoQuery.sort)) {
                            if (field === 'timestamp') continue; // Skip timestamp to maintain scraping order
                            const aValue = field.split('.').reduce((obj, key) => obj[key], a);
                            const bValue = field.split('.').reduce((obj, key) => obj[key], b);
                            if (aValue !== bValue) {
                                return direction === -1 ? bValue - aValue : aValue - bValue;
                            }
                        }
                        return 0;
                    });
                }
                
                return {
                    query: mongoQuery,
                    results: allTweets,
                    count: allTweets.length
                };
            }
        } catch (error) {
            console.error('Error executing query:', error);
            throw error;
        }
    }

    isTimeBasedQuery(query) {
        const timeKeywords = ['latest', 'recent', 'last', 'past', 'today', 'yesterday', 'week', 'month', 'days'];
        return timeKeywords.some(keyword => query.toLowerCase().includes(keyword));
    }

    isUserSpecificQuery(query) {
        return query.toLowerCase().includes('from user') || 
               query.toLowerCase().includes('by user') ||
               query.includes('@');
    }

    async handleTimeBasedQuery(query) {
        // Return a prompt asking for time specification if not provided
        if (!query.match(/\d+\s*(day|week|month|year)s?/i)) {
            return {
                needsMoreInfo: true,
                prompt: "How many days of tweets would you like to analyze?"
            };
        }
        return null; // Continue with normal processing
    }

    async processNaturalQuery(query, timeframe = null) {
        let naturalQuery = query;
        
        // If timeframe is provided, modify the query
        if (timeframe) {
            const days = parseInt(timeframe);
            if (!isNaN(days)) {
                const dateQuery = `from the last ${days} days`;
                naturalQuery = `${query} ${dateQuery}`;
            }
        }

        return await this.executeMongoQuery(naturalQuery);
    }

    async analyzeTweets(tweets, userPrompt) {
        const defaultSystemPrompt = `You are an intelligent and context-aware assistant that specializes in analyzing Twitter data. The user will provide a collection of tweets — which may include posts, replies, retweets, or quoted tweets — often spanning different users, tones, and topics.

                            Your job is to:

                            Understand the overarching context, sentiment, and themes in the tweets.

                            Identify patterns, trends, public sentiment, or key points of discussion.

                            Prioritize clarity, usefulness, and accuracy in your summaries or insights.

                            Anticipate what a user might be looking for: whether it's trend analysis, sentiment breakdown, topic categorization, influential users, or anomalies.

                            When unsure about intent, infer the most likely goal based on the data and give your best intelligent guess with transparency.

                            Keep your responses concise, well-structured, and highly informative. When relevant, use bullet points, summaries, or categories.

                            Be analytical, but conversational. Avoid generic fluff. Use examples from the tweet data to support your insights when possible.`;

        const messages = [
            {
                role: 'system',
                content: this.config?.systemPrompt || defaultSystemPrompt
            },
            {
                role: 'user',
                content: `Analyze these tweets: ${JSON.stringify(tweets)}\n\nUser request: ${userPrompt}`
            }
        ];

        return await this.queryLLM(messages);
    }

    initializeHandlers() {
        // Store handlers so we can remove them later
        this.handlers = [
            { channel: 'save-llm-config', handler: async (event, config) => await this.saveConfig(config) },
            { channel: 'get-llm-config', handler: async () => this.config },
            { channel: 'chat-query', handler: async (event, { query, conversationId, timeframe = null }) => {
                try {
                    let conversation = this.conversations.get(conversationId);
                    if (!conversation) {
                        conversation = { state: 'initial', context: {} };
                        this.conversations.set(conversationId, conversation);
                    }

                    // Handle time-based queries
                    if (this.isTimeBasedQuery(query)) {
                        const timeCheck = await this.handleTimeBasedQuery(query);
                        if (timeCheck?.needsMoreInfo) {
                            conversation.state = 'awaiting_timeframe';
                            conversation.context.originalQuery = query;
                            return {
                                success: true,
                                needsMoreInfo: true,
                                prompt: timeCheck.prompt
                            };
                        }
                    }

                    // If we were waiting for timeframe and got it
                    if (conversation.state === 'awaiting_timeframe') {
                        query = conversation.context.originalQuery;
                        timeframe = timeframe || query; // Use the provided timeframe
                        conversation.state = 'initial';
                    }

                    // Execute the natural query to get relevant tweets
                    const queryResults = await this.processNaturalQuery(query, timeframe);

                    // Analyze the results based on the user's prompt
                    const analysis = await this.analyzeTweets(queryResults.results, query);

                    return {
                        success: true,
                        response: analysis,
                        queryDetails: queryResults.query,
                        tweetCount: queryResults.count
                    };

                } catch (error) {
                    console.error('Chat query error:', error);
                    throw error;
                }
            }},
            { channel: 'natural-query', handler: async (event, query) => {
                try {
                    const results = await this.executeMongoQuery(query);
                    return {
                        success: true,
                        ...results
                    };
                } catch (error) {
                    console.error('Natural query error:', error);
                    throw error;
                }
            }}
        ];

        // Register handlers
        this.handlers.forEach(({ channel, handler }) => {
            ipcMain.handle(channel, handler);
        });
    }

    cleanup() {
        // Remove all registered handlers
        this.handlers.forEach(({ channel }) => {
            ipcMain.removeHandler(channel);
        });
        this.handlers = [];
        this.conversations.clear();
    }
}

module.exports = ChatManager; 